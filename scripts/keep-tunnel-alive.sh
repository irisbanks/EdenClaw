#!/bin/bash
# Keep-alive daemon: restarts cloudflared when tunnel drops
ROOT=/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai
LOG=$ROOT/logs/tunnel-keepalive.log
URLFILE=$ROOT/logs/external-url-CURRENT.txt
CF_BIN=/home/shinseohee/bin/cloudflared
CF_LOG=~/cf-keepalive.log

while true; do
  URL=$(cat "$URLFILE" 2>/dev/null)

  if [ -z "$URL" ]; then
    HTTP=000
  else
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null)
  fi

  if [ "$HTTP" != "200" ] && [ "$HTTP" != "301" ] && [ "$HTTP" != "302" ]; then
    echo "[$(date)] tunnel response=$HTTP, restarting" >> "$LOG"

    # Kill by PID file if available, fallback to process name
    CF_PID_FILE=$ROOT/logs/cf-pid.txt
    if [ -f "$CF_PID_FILE" ]; then
      OLD_PID=$(cat "$CF_PID_FILE")
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi

    sleep 5
    nohup "$CF_BIN" tunnel --url http://localhost:3000 > "$CF_LOG" 2>&1 &
    NEW_CF_PID=$!
    echo "$NEW_CF_PID" > "$CF_PID_FILE"

    # Wait up to 60s for new URL
    for i in $(seq 1 6); do
      sleep 10
      NEW_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1)
      if [ -n "$NEW_URL" ]; then
        echo "$NEW_URL" > "$URLFILE"
        echo "[$(date)] new URL: $NEW_URL" >> "$LOG"
        break
      fi
    done
  fi

  sleep 60
done
