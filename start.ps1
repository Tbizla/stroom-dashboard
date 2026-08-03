# Detecteert het LAN-IP van deze machine en start docker compose daarmee, zodat de
# webapp bij het opstarten kan tonen onder welk adres hij op het netwerk bereikbaar is
# (zie webapp/server.js). Gebruik zoals je docker compose normaal zou aanroepen, bijv.:
#   .\start.ps1 up -d --build
#   .\start.ps1 --profile test up -d --build

$ip = Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address |
  Select-Object -ExpandProperty IPAddress

if ($ip) {
  $env:HOST_LAN_IP = $ip
  Write-Host "Host-IP gedetecteerd: $ip"
} else {
  $env:HOST_LAN_IP = ''
  Write-Host "Kon host-IP niet automatisch detecteren -- dashboard toont dan alleen localhost."
}

docker compose @args
