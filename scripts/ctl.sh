#!/bin/bash
# schickt einen Befehl an den laufenden Bot (eine Zeile pro Aufruf)
if [ $# -eq 0 ]; then
  echo "Nutzung: ctl.sh <befehl> [args...]"
  echo "  say <text> | look <yaw> <pitch> | forward|back|left|right <sek> | jump <sek>"
  echo "  up|down <sek> | pos | follow <spieler> | attack <spieler> | stop"
  exit 1
fi
printf '%s\n' "$*" >> ./cmd.txt
echo "gesendet: $*"
