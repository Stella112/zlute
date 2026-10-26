<#
  Signs the Lute proposal (or mandate) on the clipboard with the owner key, on this laptop.
  The dashboard's "Copy proposal" / "Copy mandate" buttons put it on the clipboard; this script
  checks it, hands it to lute-owner through a file (not a PowerShell pipe, which can alter the
  text), lets lute-owner ask for the typed confirmation, and puts only the signature back on the
  clipboard. The owner key never leaves lute-owner.

    powershell -ExecutionPolicy Bypass -File C:\zecathon\tools\lute-sign.ps1            (payment)
    powershell -ExecutionPolicy Bypass -File C:\zecathon\tools\lute-sign.ps1 -Mandate   (agent mandate)
#>
param(
  [switch]$Mandate,
  [string]$OwnerExe = "$HOME\lute-owner\lute-owner.exe",
  [string]$OwnerKey = "$HOME\lute-owner\owner.key"
)
$ErrorActionPreference = "Stop"

function Read-Clip {
  $t = Get-Clipboard -Raw
  if ($null -eq $t) { return "" }
  return $t.Trim().TrimStart([char]0xFEFF)
}
$what = if ($Mandate) { "mandate" } else { "proposal" }
# Always wait for a NEW copy from the dashboard: whatever is on the clipboard now may be this
# command or an older (expired) proposal, and signing that would only be refused.
$before = Read-Clip
Write-Host "Waiting: in the dashboard click 'Copy $what' now (up to 3 minutes)..." -ForegroundColor Yellow
$text = $before
for ($i = 0; $i -lt 360; $i++) {
  Start-Sleep -Milliseconds 500
  $text = Read-Clip
  if ($text -ne $before -and $text.StartsWith("{")) { break }
}
if ($text -eq $before -or -not $text.StartsWith("{")) {
  Write-Host "No new $what arrived on the clipboard; nothing was signed." -ForegroundColor Yellow
  exit 1
}
Write-Host "Got it. Check the details below before you approve." -ForegroundColor Green

$in = [IO.Path]::GetTempFileName()
$out = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($in, $text, (New-Object System.Text.UTF8Encoding $false))
  $cmd = if ($Mandate) { "sign-mandate" } else { "sign" }
  # Same console (-NoNewWindow): lute-owner shows the details and reads the typed confirmation.
  $p = Start-Process -FilePath $OwnerExe -ArgumentList @($cmd, "--key", "`"$OwnerKey`"") -RedirectStandardInput $in -RedirectStandardOutput $out -NoNewWindow -Wait -PassThru
  $sig = (Get-Content $out -Raw)
  if ($p.ExitCode -ne 0 -or -not $sig -or $sig.Trim() -notmatch '^[0-9a-f]{128}$') {
    Write-Host "Not signed (nothing was sent)." -ForegroundColor Yellow
    exit 1
  }
  Set-Clipboard -Value $sig.Trim()
  Write-Host "Signature copied. Paste it into the dashboard." -ForegroundColor Green
} finally {
  Remove-Item $in, $out -Force -ErrorAction SilentlyContinue
}
