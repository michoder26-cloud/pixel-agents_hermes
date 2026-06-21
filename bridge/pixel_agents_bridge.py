import sys, os, json, uuid, urllib.request
from pathlib import Path

DEBUG_LOG = Path(__file__).parent / 'pixel_agents_bridge.log'

def log_message(msg):
    try:
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except Exception:
        pass

def get_hermes_profile():
    if os.name == 'nt':
        return 'default'
    try:
        with open('/proc/self/cmdline', 'rb') as f:
            cmdline = f.read().decode('utf-8').split('\x00')
        for i, arg in enumerate(cmdline):
            if arg == '--profile' and i + 1 < len(cmdline):
                return cmdline[i + 1]
    except:
        pass
    return 'default'

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
            log_message('server.json not found')
            return
        with open(server_json_path) as f:
            cfg = json.load(f)
        port = cfg.get('port')
        token = cfg.get('token')
        if not port or not token:
            log_message('Invalid server.json')
            return

        event = data.get('hook_event_name')
        if event not in HANDLED:
            return

        profile = get_hermes_profile()
        session_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'hermes.profile.{profile}'))

        payload = dict(data)
        payload['session_id'] = session_uuid
        payload.setdefault('platform', profile)

        # Extract subagent fields from extra so Office can read them
        if 'extra' in payload and isinstance(payload['extra'], dict):
            for key in ['child_session_id', 'child_role', 'child_subagent_id', 'parent_session_id']:
                if key in payload['extra']:
                    payload[key] = payload['extra'][key]

        url = f'http://127.0.0.1:{port}/api/hooks/hermes'
        body = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
        }, method='POST')
        with urllib.request.urlopen(req, timeout=2) as resp:
            log_message(f'POST -> {resp.getcode()} ({event})')
    except Exception as e:
        log_message(f'Error: {e}')

if __name__ == '__main__':
    main()
