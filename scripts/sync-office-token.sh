#!/bin/bash
# Auto-sync Pixel Office token after restart
OFFICE_PORT=3100
SERVER_JSON="/root/.pixel-agents/server.json"

for i in {1..10}; do
    sleep 1
    [ ! -f "$SERVER_JSON" ] && continue
    
    PORT=$(jq -r '.port // empty' "$SERVER_JSON" 2>/dev/null)
    PID=$(jq -r '.pid // empty' "$SERVER_JSON" 2>/dev/null)
    TOKEN=$(jq -r '.token // empty' "$SERVER_JSON" 2>/dev/null)
    
    if [ -n "$PORT" ] && [ -n "$PID" ] && [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
        [ "$PORT" != "3100" ] && jq --arg port 3100 '.port = ($port|tonumber)' "$SERVER_JSON" > "$SERVER_JSON.tmp" && mv "$SERVER_JSON.tmp" "$SERVER_JSON"
        echo "Token sync: OK"
        exit 0
    fi
done
echo "Office not ready"
exit 0
