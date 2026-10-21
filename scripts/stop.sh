#!/bin/bash
# stoppt Supervisor und Bot
pkill -f "supervisor\.sh" 2>/dev/null
sleep 1
pkill -f "node bot\.js" 2>/dev/null
sleep 2
pgrep -af "supervisor\.sh|node bot\.js" || echo "alles gestoppt"
