<#
  Lute owner helper (Windows PowerShell 5.1). Runs on the owner's laptop only.
  - Opens a temporary SSH tunnel to the loopback-only Lute API on the VPS.
  - Your password and owner key never leave this machine (the key is only read by lute-owner.exe).

  One-time account setup:
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -Setup
  Send a payment from a Lute wallet (LuteGuard evaluates before anything is signed):
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -To <shielded address> -Zec 0.0002 [-Wallet payout] [-MemoRef <8-64 base64url>]
#>
param(
  [switch]$Setup,
  [string]$To,
  [string]$Zec,
  [string]$Wallet = "payout",
  [string]$MemoRef,
  [string]$User = "maris",
  [string]$SshHost = "hbar-vps",
  [string]$OwnerExe = "C:\Users\Admin\lute-owner\lute-owner.exe",
  [string]$OwnerKey = "C:\Users\Admin\lute-owner\owner.key",
  [int]$LocalPort = 48201
)
$ErrorActionPreference = "Stop"

function Read-Password([string]$prompt) {
  $sec = Read-Host -AsSecureString $prompt
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

if ($Setup) {
  $pw = Read-Password "Choose a Lute password for '$User' (12+ characters)"
  $pw2 = Read-Password "Repeat it"
  if ($pw -ne $pw2) { throw "passwords differ" }
  if ($pw.Length -lt 12) { throw "password must be at least 12 characters" }
  $pw | ssh $SshHost "docker exec -i zlute-api node dist/server.js create-user $User owner"
  $pw = $null; $pw2 = $null
  return
}

if (-not $To -or -not $Zec) { throw "use -To <address> -Zec <amount> (or -Setup)" }
$base = "http://127.0.0.1:$LocalPort"
$tunnel = Start-Process ssh -ArgumentList @("-N", "-L", "${LocalPort}:127.0.0.1:48200", $SshHost) -PassThru -WindowStyle Hidden
try {
  for ($i = 0; $i -lt 20; $i++) {
    try { Invoke-RestMethod "$base/v1/health" -TimeoutSec 3 | Out-Null; break } catch { Start-Sleep -Milliseconds 700 }
  }

  $pw = Read-Password "Lute password for '$User'"
  $login = Invoke-WebRequest "$base/v1/auth/login" -Method Post -ContentType "application/json" -UseBasicParsing `
    -Body (@{ username = $User; password = $pw } | ConvertTo-Json)
  $pw = $null
  # The session cookie is marked Secure, so .NET will not resend it over the http tunnel by itself,
  # and PowerShell 5.1 drops a "Cookie" header passed via -Headers. Put it in a web session instead.
  $pair = ($login.Headers["Set-Cookie"] -split ";")[0]
  $name, $value = $pair -split "=", 2
  if ($name -ne "lute_session" -or -not $value) { throw "login did not return a session" }
  $ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $ws.Cookies.Add((New-Object System.Net.Cookie($name, $value, "/", "127.0.0.1")))
  $h = @{ "Idempotency-Key" = ("pay-" + [guid]::NewGuid().ToString("N")) }

  $body = @{ wallet = $Wallet; to = $To; amount_zec = $Zec }
  if ($MemoRef) { $body.memo_ref = $MemoRef }
  $r = Invoke-RestMethod "$base/v1/actions/send" -Method Post -ContentType "application/json" -Headers $h -WebSession $ws -Body ($body | ConvertTo-Json)
  $id = $r.action_id
  Write-Host "action $id -> $($r.result.state)"
  if ($r.result.state -ne "AWAITING_AUTHORIZATION") {
    Write-Host ("LuteGuard / sidecar result: " + ($r.result | ConvertTo-Json -Compress -Depth 6))
    return
  }
  Write-Host "LuteGuard: ALLOW (evaluated on the sidecar's exact proposal before any signing)"

  $view = @{ proposal_hash = $r.result.proposal_hash; summary = $r.result.summary } | ConvertTo-Json -Depth 6 -Compress
  $sig = $view | & $OwnerExe sign --key $OwnerKey
  if (-not $sig) { Write-Host "not approved; nothing was sent"; return }

  $h.Remove("Idempotency-Key")
  $a = Invoke-RestMethod "$base/v1/actions/$id/authorize" -Method Post -ContentType "application/json" -Headers $h -WebSession $ws `
    -Body (@{ signature = $sig.Trim() } | ConvertTo-Json)
  Write-Host ("result: " + ($a.result | ConvertTo-Json -Compress))
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
