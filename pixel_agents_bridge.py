import sys
import os
import json
import uuid
import urllib.request
from pathlib import Path

# Sibling path is clean and portable across Windows and Linux
DEBUG_LOG = Path(__file__).parent / 'pixel_agents_bridge.log'

def log_message(msg):
    try:
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except Exception:
        pass

def get_hermes_profile():
    # Only works on Linux (VPS)
    if os.name == 'nt':
        return 'default'
    
    pid = os.getpid()
    for _ in range(5):  # Walk up to 5 levels of parent processes
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

def find_vscode_workspace():
    # Only works on Linux (VPS)
    if os.name == 'nt':
        return os.getcwd()
    
    log_dir = Path.home() / '.vscode-server' / 'data' / 'logs'
    if not log_dir.exists():
        return '/root/pixel-agents'  # default fallback based on active workspace
    
    # Find all Git.log files and sort by modification time (most recent first)
    git_logs = []
    for root, dirs, files in os.walk(log_dir):
        if 'Git.log' in files:
            log_path = Path(root) / 'Git.log'
            try:
                git_logs.append((log_path, log_path.stat().st_mtime))
            except Exception:
                pass
            
    if not git_logs:
        return '/root/pixel-agents'
        
    git_logs.sort(key=lambda x: x[1], reverse=True)
    
    # Read the most recent Git.log
    for log_path, _ in git_logs:
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            for line in reversed(lines):
                if 'Opened repository (path):' in line:
                    parts = line.split('Opened repository (path):')
                    if len(parts) > 1:
                        workspace = parts[1].strip()
                        if os.path.exists(workspace):
                            return workspace
        except Exception:
            pass
            
    return '/root/pixel-agents'

def main():
    try:
        # 1. Read input
        if sys.stdin.isatty():
            return
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            return
        
        data = json.loads(raw_input)
        log_message(f'Received hermes-agent event: {json.dumps(data)}')

        # 2. Locate server.json
        server_json_path = Path.home() / '.pixel-agents' / 'server.json'
        if not server_json_path.exists():
            log_message(f'server.json not found at {server_json_path}, pixel-agents is likely not running.')
            return

        with open(server_json_path, 'r', encoding='utf-8') as f:
            server_config = json.load(f)
        
        port = server_config.get('port')
        token = server_config.get('token')
        if not port or not token:
            log_message('Invalid server.json structure.')
            return

        # 3. Map events to Claude Code format
        hermes_event = data.get('hook_event_name')
        
        # We map on_session_end to Stop so characters walk to the lounge/couch to rest
        # rather than disappearing completely (which SessionEnd does).
        mapping = {
            'on_session_start': 'SessionStart',
            'pre_tool_call': 'PreToolUse',
            'post_tool_call': 'PostToolUse',
            'subagent_start': 'SubagentStart',
            'subagent_stop': 'SubagentStop',
            'on_session_reset': 'SessionStart',
            'on_session_end': 'Stop'
        }
        
        claude_type = mapping.get(hermes_event)
        if not claude_type:
            log_message(f'Skipping event: {hermes_event} (no mapping)')
            return

        # Get stable session ID based on profile name using UUID v5 (name-based UUID)
        profile = get_hermes_profile()
        session_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f'hermes.profile.{profile}'))

        # Find active VS Code workspace folder to match CWD
        workspace_cwd = find_vscode_workspace()

        claude_payload = {
            'hook_event_name': claude_type,
            'session_id': session_uuid,
            'cwd': workspace_cwd,
        }

        if 'tool_name' in data and data['tool_name']:
            claude_payload['tool_name'] = data['tool_name']
        
        if 'tool_input' in data:
            claude_payload['tool_input'] = data['tool_input']

        if claude_type == 'SubagentStart':
            subagent_profile = data.get('agent_type') or data.get('profile') or 'subagent'
            claude_payload['agent_type'] = subagent_profile

        log_message(f'Sending mapped event to pixel-agents: {json.dumps(claude_payload)}')

        # 4. POST to server
        url = f'http://127.0.0.1:{port}/api/hooks/claude'
        
        def send_post(payload):
            body = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {token}'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=2) as response:
                return response.getcode()

        status = send_post(claude_payload)
        log_message(f'POST response status: {status} for event: {claude_type}')

        # If it is SessionStart, immediately send UserPromptSubmit to confirm and spawn the character
        if claude_type == 'SessionStart':
            confirm_payload = {
                'hook_event_name': 'UserPromptSubmit',
                'session_id': session_uuid,
                'cwd': workspace_cwd
            }
            confirm_status = send_post(confirm_payload)
            log_message(f'POST confirm status: {confirm_status}')

    except Exception as e:
        log_message(f'Error: {e}')

if __name__ == '__main__':
    main()
