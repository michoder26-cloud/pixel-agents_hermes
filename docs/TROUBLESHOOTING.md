# 🔍 Troubleshooting Guide

Use this guide to diagnose and resolve common issues with the Pixel Agent Office & Hermes integration.

---

## 1. Characters Do Not Appear in the Office

### Symptoms
You run a Hermes session (`hermes --cli`), but the office remains empty or does not show your character.

### Diagnosis Steps
1.  **Check Server Status**:
    Ensure the office server is active.
    ```bash
    systemctl status pixel-office
    ```
2.  **Verify Server Discovery**:
    Ensure Hermes or the bridge can discover the server's token and port.
    ```bash
    cat ~/.pixel-agents/server.json
    ```
    If this file is missing or empty, restart the server to regenerate it:
    ```bash
    systemctl restart pixel-office
    ```
3.  **Check Logs**:
    Read the output logs for the office server to see if incoming payloads are rejected:
    ```bash
    tail -n 50 /root/pixel-office.log
    ```
    Look for errors like `Unauthorized` (token mismatch) or parsing issues.

---

## 2. SSH Tunnel Disconnection (Exit Code 255)

### Symptoms
If you are forwarding ports from a VPS to your local browser using SSH (`ssh -L 3100:localhost:3100 ...`) and the characters suddenly freeze or the page fails to load.

### Solution
Instead of relying on unstable SSH port forwarding, configure the system to run directly on the VPS with an open firewall port:
1.  Verify the service binds to all interfaces (`0.0.0.0`):
    ```bash
    systemctl cat pixel-office
    ```
    Look for `ExecStart=... dist/cli.js --host 0.0.0.0 --port 3100`
2.  Open the firewall port on the VPS:
    ```bash
    ufw allow 3100/tcp
    ```
3.  Open the browser using the public IP directly: `http://YOUR_VPS_IP:3100`

---

## 3. Plugin Loading Issues

### Symptoms
You enabled the plugin via `hermes plugins enable pixel_observer` but no events are sent.

### Solution
*   **Gateway Restart**: If you run a Telegram gateway daemon, it loads plugins only on startup. You MUST restart the daemon:
    ```bash
    systemctl restart hermes-gateway-watchdog
    ```
*   **Manual Validation**: Check if the plugin folder is in the correct directory:
    ```bash
    ls -la ~/.hermes/plugins/pixel_observer/
    ```

---

## 4. Stale Port Bindings (Port 3100 Already in Use)

### Symptoms
The service log shows `Error: listen EADDRINUSE: address already in use :::3100`.

### Solution
Find the process occupying the port and terminate it:
```bash
kill -9 $(lsof -t -i:3100)
systemctl restart pixel-office
```

---

## 5. Duplicate Characters in the Office

### Symptoms
Multiple identical characters appear for a single active session.

### Cause
This happens if both the Python plugin (`pixel_observer`) and the Python shell bridge (`pixel_agents_bridge.py`) are active and sending events for the same profile/session type.

### Solution
*   Disable the shell hook if using the plugin:
    Check your shell hook configuration (`~/.hermes/` settings or custom script hooks) and ensure it doesn't trigger the bridge script for sessions already observed by the plugin.
*   The v2 bridge script (`pixel_agents_bridge.py`) automatically attempts to de-duplicate events if a plugin event was already registered, but keeping only one enabled is cleaner.
