#!/bin/bash
# haelt den Bot online: bei Verbindungsende nach 3 s neu verbinden
cd . || exit 1
export MC_VERSION="${MC_VERSION:-26.1}"
export VIEWER_PORT="${VIEWER_PORT:-0}"
export LOOK_PITCH="${LOOK_PITCH:--0.15}"
export LOOK_YAW="${LOOK_YAW:-1.9}"
export MC_SWITCHES="${MC_SWITCHES:-}"
while true; do
  echo "=== reconnect $(date -u +%H:%M:%S) ===" >> supervisor.log
  node bot.js >> bot.log 2>&1
  sleep 3
done
