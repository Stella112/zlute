<#
  Opens the Lute dashboard from the owner's laptop (Windows PowerShell 5.1).
  Keeps an SSH tunnel 127.0.0.1:48300 -> VPS 127.0.0.1:48300 open and reconnects when the network
  drops. The web app and API stay loopback-only on the VPS; nothing is exposed publicly.
  The Lute MCP server (apps/mcp) uses the same tunnel (LUTE_API_URL=http://127.0.0.1:48300).

    powershell -ExecutionPolicy Bypass -File C:\zecathon\tools\lute-web.ps1

  Leave this window open while you use the dashboard or the agent; press Ctrl+C to stop.
#>
param(
  [string]$SshHost = "hbar-vps",
  [int]$Port = 48300,
  [switch]$NoBrowser
)

$opened = $false
while ($true) {
  Write-Host ("[{0}] connecting tunnel on http://127.0.0.1:{1} ..." -f (Get-Date -Format HH:mm:ss), $Port)
  $p = Start-Process ssh -ArgumentList @("-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "-L", "${Port}:127.0.0.1:${Port}", $SshHost) -PassThru -NoNewWindow
  Start-Sleep -Seconds 3
  if (-not $opened -and -not $NoBrowser -and -not $p.HasExited) {
    Start-Process "http://127.0.0.1:$Port/"
    $opened = $true
  }
  $p.WaitForExit()
  Write-Host ("[{0}] tunnel closed (exit {1}); reconnecting in 3 s" -f (Get-Date -Format HH:mm:ss), $p.ExitCode)
  Start-Sleep -Seconds 3
}
