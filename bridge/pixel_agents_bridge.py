import sys
import os
import json
import uuid
import urllib.request
from pathlib import Path

# Streams Hermes shell-hook events to the Pixel Agents office's HERMES bridge
# (POST /api/hooks/hermes -> HermesBridge), which renders clean visible
# characters. (Previous version posted Claude-format to /api/hooks/claude,
# which the office renders poorly for Hermes.)
#
# One STABLE character per Hermes profile (uuid5 of the profile name), so each
# Telegram/gateway profile gets its own persistent character that animates on
# activity instead of spawning a new one per message.

DEBUG_LOG = Path(__file__).parent / 'pixel_agents_bridge.log'


def log_message(msg):
    try:
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except Exception:
        pass


def get_hermes_profile():
    # Only resolves parent --profile on Linux; Windows CLI defaults to 'default'.
    if os.name == 'nt':
        return 'default'
    pid = os.getpid()
    for _ in range(5):
        try:
            status_path = f'/proc/{pid}/status'
            if not os.path.exists(status_path):
                break
            with open(status_path, 'r') as f:
                ppid = None
                for line in f:
                    if line.startswith('PPid:'):
                        ppid = int(line.split()[1])
                        break
            if not ppid or ppid <= 1:
                break
            cmdline_path = f'/proc/{ppid}/cmdline'
            if os.path.exists(cmdline_path):
                with open(cmdline_path, 'r') as f:
                    cmdline = f.read().split('\x00')
                for i, arg in enumerate(cmdline):
                    if arg == '--profile' and i + 1 < len(cmdline):
                        return cmdline[i + 1]
            pid = ppid
        except Exception:
            break
    return 'default'


# Events HermesBridge (server/src/hermesBridge.ts) knows how to handle.
HANDLED = {
    'on_session_start', 'on_session_end', 'on_session_finalize', 'on_session_reset',
    'pre_llm_call', 'post_llm_call', 'pre_tool_call', 'post_tool_call',
    'post_api_request', 'subagent_start', 'subagent_stop',
}


def main():
    try:
        if sys.stdin.isatty():
            return
        raw = sys.stdin.read()
        if not raw.strip():
            return
        data = json.loads(raw)
        log_message(f'Received hermes event: {json.dumps(data)}')

        server_json_path = Path.home() / '.pixel-agents' / 'server.json'
        if not server_json_path.exists():
            log_message('server.json not found; office not running.')
            return
        with open(server_json_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        port = cfg.get('port')
        token = cfg.get('token')
        if not port or not token:
            log_message('Invalid server.json.')
            return

        event = data.get('hook_event_name')
        if event not in HANDLED:
            log_message(f'Skipping {event} (not handled by HermesBridge).')
            return

        profile = get_hermes_profile()
        session_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'hermes.profile.{profile}'))

        # Forward the raw Hermes event, but pin a stable per-profile session_id
        # and label the character by profile name.
        payload = dict(data)
        payload['session_id'] = session_uuid
        payload.setdefault('platform', profile)

        url = f'http://127.0.0.1:{port}/api/hooks/hermes'
        body = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
        }, method='POST')
        with urllib.request.urlopen(req, timeout=2) as resp:
            log_message(f'POST /api/hooks/hermes -> {resp.getcode()} ({event})')
    except Exception as e:
        log_message(f'Error: {e}')


if __name__ == '__main__':
    main()
