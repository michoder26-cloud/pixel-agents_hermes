# Bridge Scripts

## pixel_agents_bridge.py (v2 — Recommended)

Sends Hermes shell-hook events directly to the **Hermes bridge endpoint** (`/api/hooks/hermes`).

- Creates **clean, visible characters** in the office
- One stable character per Hermes profile (UUID5-based)
- Handles: session start/end, tool calls, LLM calls, subagents

### How it works
1. Hermes fires a shell hook → stdin JSON → this script
2. Script reads `~/.pixel-agents/server.json` for port + token
3. POSTs event to `http://127.0.0.1:{port}/api/hooks/hermes`

### Install
```bash
cp pixel_agents_bridge.py ~/.hermes/pixel_agents_bridge.py
```

## pixel_agents_bridge_legacy.py (v1 — Legacy)

Original version that sends events to `/api/hooks/claude` (Claude Code format).

- Maps Hermes events to Claude Code event names
- Less reliable character rendering for Hermes sessions
- Kept for backwards compatibility

## When to use which?

| Scenario | Use |
|---|---|
| Fresh install | v2 (this is default) |
| Already using Claude Code hooks | v1 (compatible) |
| Both Hermes + Claude Code | v2 (they coexist) |
