
import json
import uuid
import urllib.request
from pathlib import Path
import os

def find_vscode_workspace():
    log_dir = Path.home() / ".vscode-server" / "data" / "logs"
    if not log_dir.exists():
        return "/root/pixel-agents"
    git_logs = []
    for root, dirs, files in os.walk(log_dir):
        if "Git.log" in files:
            log_path = Path(root) / "Git.log"
            try:
                git_logs.append((log_path, log_path.stat().st_mtime))
            except Exception:
                pass
    if not git_logs:
        return "/root/pixel-agents"
    git_logs.sort(key=lambda x: x[1], reverse=True)
    for log_path, _ in git_logs:
        try:
            with open(log_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in reversed(lines):
                if "Opened repository (path):" in line:
                    parts = line.split("Opened repository (path):")
                    if len(parts) > 1:
                        workspace = parts[1].strip()
                        if os.path.exists(workspace):
                            return workspace
        except Exception:
            pass
    return "/root/pixel-agents"

server_json = Path.home() / ".pixel-agents" / "server.json"
if server_json.exists():
    cfg = json.loads(server_json.read_text())
    port, token = cfg["port"], cfg["token"]
    profiles = ["trader", "coder", "news", "system"]
    workspace_cwd = find_vscode_workspace()
    
    for p in profiles:
        session_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"hermes.profile.{p}"))
        url = f"http://127.0.0.1:{port}/api/hooks/claude"
        
        def send_post(event_name):
            payload = {
                "hook_event_name": event_name,
                "session_id": session_uuid,
                "cwd": workspace_cwd
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                method="POST"
            )
            with urllib.request.urlopen(req) as resp:
                return resp.getcode()
                
        try:
            code1 = send_post("SessionStart")
            code2 = send_post("UserPromptSubmit")
            code3 = send_post("Stop")
            print(f"Spawned {p}: Start={code1}, Confirm={code2}, Stop={code3} (UUID: {session_uuid}, CWD: {workspace_cwd})")
        except Exception as e:
            print(f"Failed to spawn {p}: {e}")
else:
    print("server.json not found on VPS")

