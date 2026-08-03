#!/usr/bin/env sh
# Detecteert het LAN-IP van deze machine en start docker compose daarmee, zodat de
# webapp bij het opstarten kan tonen onder welk adres hij op het netwerk bereikbaar is
# (zie webapp/server.js). Gebruik zoals je docker compose normaal zou aanroepen, bijv.:
#   ./start.sh up -d --build
#   ./start.sh --profile test up -d --build
set -e

HOST_LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
if [ -z "$HOST_LAN_IP" ]; then
  HOST_LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
export HOST_LAN_IP

if [ -n "$HOST_LAN_IP" ]; then
  echo "Host-IP gedetecteerd: $HOST_LAN_IP"
else
  echo "Kon host-IP niet automatisch detecteren — dashboard toont dan alleen localhost."
fi

exec docker compose "$@"
