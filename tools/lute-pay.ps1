<#
  Lute owner helper (Windows PowerShell 5.1). Runs on the owner's laptop only.
  - Opens a temporary SSH tunnel to the loopback-only Lute API on the VPS.
  - Your password and owner key never leave this machine (the key is only read by lute-owner.exe).

  One-time account setup:
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -Setup
  Send a payment from a Lute wallet (LuteGuard evaluates before anything is signed):
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -To <shielded address> -Zec 0.0002 [-Wallet payout] [-MemoRef <8-64 base64url>]
  Stream demo: per-second accrual, settled in -Settlements owner-approved payouts spread over the stream:
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -Stream -To <shielded address> -Zec 0.0003 -DurationS 120 [-Settlements 2]
  Check a stream (and move mined settlements to CONFIRMED); add -Settle to also pay what is due:
    powershell -ExecutionPolicy Bypass -File tools\lute-pay.ps1 -StreamId <id> [-Settle]
#>
param(
  [switch]$Setup,
  [string]$To,
  [string]$Zec,
  [string]$Wallet = "payout",
  [string]$MemoRef,
  [switch]$Stream,
  [int]$DurationS = 120,
  [int]$Settlements = 2,
  [string]$StreamId,
  [switch]$Settle,
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

if (-not $StreamId -and (-not $To -or -not $Zec)) { throw "use -To <address> -Zec <amount> [-Stream] (or -StreamId <id>, or -Setup)" }
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
  # Signs the sidecar's exact proposal on this laptop (typed confirmation), then authorizes it.
  function Approve-Action($r) {
    $id = $r.action_id
    Write-Host "action $id -> $($r.result.state)"
    if ($r.result.state -ne "AWAITING_AUTHORIZATION") {
      Write-Host ("LuteGuard / sidecar result: " + ($r.result | ConvertTo-Json -Compress -Depth 6))
      return $null
    }
    Write-Host "LuteGuard: ALLOW (evaluated on the sidecar's exact proposal before any signing)"
    $view = @{ proposal_hash = $r.result.proposal_hash; summary = $r.result.summary } | ConvertTo-Json -Depth 6 -Compress
    $sig = $view | & $OwnerExe sign --key $OwnerKey
    if (-not $sig) { Write-Host "not approved; nothing was sent"; return $null }
    $a = Invoke-RestMethod "$base/v1/actions/$id/authorize" -Method Post -ContentType "application/json" -WebSession $ws `
      -Body (@{ signature = $sig.Trim() } | ConvertTo-Json)
    Write-Host ("result: " + ($a.result | ConvertTo-Json -Compress))
    return $a
  }
  function Show-Stream($v) {
    $paid = ($v.settlements | ForEach-Object { "#$($_.seq) $($_.amount_zat) zat $($_.state) $($_.txid)" }) -join "; "
    Write-Host ("[{0}] {1}  accrued {2} / {3} zat  pending {4}  confirmed paid {5}  outstanding {6}" -f `
      ([DateTimeOffset]::FromUnixTimeSeconds($v.server_time).UtcDateTime.ToString("HH:mm:ss")), $v.status, $v.accrued_zat, $v.contracted_zat, $v.pending_zat, $v.confirmed_paid_zat, $v.outstanding_zat)
    if ($paid) { Write-Host "  settlements: $paid" }
  }

  if ($StreamId) {
    Show-Stream (Invoke-RestMethod "$base/v1/streams/$StreamId/refresh" -Method Post -ContentType "application/json" -Body "{}" -WebSession $ws)
    if ($Settle) {
      $key = "settle-" + [guid]::NewGuid().ToString("N")
      $r = Invoke-RestMethod "$base/v1/streams/$StreamId/settle" -Method Post -ContentType "application/json" -Body "{}" -WebSession $ws -Headers @{ "Idempotency-Key" = $key }
      Approve-Action $r | Out-Null
      Show-Stream (Invoke-RestMethod "$base/v1/streams/$StreamId" -WebSession $ws)
    }
    return
  }

  if ($Stream) {
    $v = Invoke-RestMethod "$base/v1/streams" -Method Post -ContentType "application/json" -WebSession $ws `
      -Body (@{ wallet = $Wallet; to = $To; total_zec = $Zec; duration_s = $DurationS } | ConvertTo-Json)
    Write-Host "stream $($v.id) created: $($v.contracted_zat) zat over $DurationS s ($($v.rate_zat_per_s) zat/s). $($v.labels.model)"
    $sid = $v.id
    for ($k = 1; $k -le $Settlements; $k++) {
      $at = $v.start_ts + [int][Math]::Ceiling($DurationS * $k / $Settlements)
      while ($true) {
        $v = Invoke-RestMethod "$base/v1/streams/$sid" -WebSession $ws
        Show-Stream $v
        if ($v.server_time -ge $at) { break }
        Start-Sleep -Seconds ([Math]::Min(15, [Math]::Max(1, $at - $v.server_time)))
      }
      Write-Host "settlement $k of ${Settlements}: paying what is due now"
      $key = "settle-" + [guid]::NewGuid().ToString("N")
      $r = Invoke-RestMethod "$base/v1/streams/$sid/settle" -Method Post -ContentType "application/json" -Body "{}" -WebSession $ws -Headers @{ "Idempotency-Key" = $key }
      if (-not (Approve-Action $r)) { Write-Host "stopping: settlement $k was not sent (the stream keeps accruing; nothing is paid without approval)"; break }
    }
    Show-Stream (Invoke-RestMethod "$base/v1/streams/$sid" -WebSession $ws)
    Write-Host "Check confirmations later with: -StreamId $sid"
    return
  }

  $body = @{ wallet = $Wallet; to = $To; amount_zec = $Zec }
  if ($MemoRef) { $body.memo_ref = $MemoRef }
  $h = @{ "Idempotency-Key" = ("pay-" + [guid]::NewGuid().ToString("N")) }
  $r = Invoke-RestMethod "$base/v1/actions/send" -Method Post -ContentType "application/json" -Headers $h -WebSession $ws -Body ($body | ConvertTo-Json)
  Approve-Action $r | Out-Null
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
