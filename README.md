# Hermes × Pixel Agents

**Watch your Hermes agent work, live, as an animated character in a pixel-art office.**

🇹🇭 **อ่านคู่มือภาษาไทยได้ที่ [README_TH.md](README_TH.md)**

![Hermes running live in the Pixel Agents office](docs/demo.png)

> Hermes (`nemotron-3-super-120b`) running in the TUI on the left while its
> character moves through the office on the right — a teammate already seated at
> the meeting table.

This project makes [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
show up inside the [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)
office UI: every Hermes session becomes a character that types when it writes,
reads when it searches, spawns **teammates** when it delegates subagents, and
raises a "waiting" bubble when a turn ends. Hermes and Claude Code can run in the
**same office at the same time**.

> **About** — A bridge between Hermes (a self-improving Python agent) and Pixel
> Agents (a "watch your AI agents like The Sims" UI). Hermes wasn't supported by
> Pixel Agents — it has no transcript file and runs concurrent tools + real
> subagents. This adds a push-based Hermes provider so you can run `hermes` and
> literally see which agent is doing what, in real time, in the browser.

---

## 🚀 Quick Setup (1-Command VPS Install)

If you are setting this up on a VPS, run the following command to install, build, configure systemd, and open ports automatically:

```bash
git clone https://github.com/michoder26-cloud/pixel-agents_hermes.git
cd pixel-agents_hermes
bash scripts/install_vps.sh
```

Once done, open `http://YOUR_VPS_IP:3100` in your browser.

---

## How it works

```
Hermes  (pixel_observer plugin or bridge)       Pixel Agents server (standalone)
  hooks: session / tool / subagent  ──HTTP──▶   POST /api/hooks/hermes  (Bearer token)
  reads ~/.pixel-agents/server.json             └─▶ HermesBridge ─▶ AgentStateStore
  for {port, token}; fire-and-forget                 └─▶ WebSocket ─▶ office UI
```

- **No Hermes core changes.** The Hermes side is a normal plugin that registers
  lifecycle hooks (`pre_tool_call`, `subagent_start`, `post_llm_call`, …) and
  forwards them. It works for every Hermes frontend — CLI, TUI, gateway — not
  just ACP.
- **No new Pixel Agents protocol.** `HermesBridge` writes the **existing**
  `AgentStateStore`, emitting the same WebSocket messages the webview already
  renders. It shares that store with the Claude runtime, so agent ids never
  collide and both providers appear in one office.
- **Subagents = teammates.** A Hermes subagent is a real session with its own
  tool stream, so it's drawn as a separate teammate character (palette inherited
  from its parent), not as a sub-tool under the parent.

Why a dedicated bridge instead of reusing the Claude hook path: Pixel Agents'
`HookEventHandler` correlates tools through a single id (can't represent Hermes'
**concurrent** tools), gates subagents behind a team provider, and creates agents
only from JSONL transcript files (Hermes has none). The bridge sidesteps all
three while reusing everything downstream of the store.

---

## Repository layout

```
pixel-agents_hermes/
├── pixel-agents/           # Office Server (fork with Hermes bridge)
│   ├── server/src/
│   │   ├── hermesBridge.ts         # ★ event → office animation
│   │   └── providers/hermes/       # ★ metadata of Hermes tools
│   └── webview-ui/                 # pixel-art UI (React)
├── hermes-plugin/
│   └── pixel_observer/             # ★ Hermes plugin (auto-loads)
├── bridge/
│   ├── pixel_agents_bridge.py      # ★ Python bridge v2 (recommended)
│   └── pixel_agents_bridge_legacy.py # Python bridge v1
├── scripts/
│   ├── install_vps.sh              # 1-command installer script
│   ├── install_plugin.sh           # installs plugin only
│   └── setup_systemd.sh            # sets up systemd service
├── systemd/
│   └── pixel-office.service        # systemd template file
└── docs/
    ├── demo.png                    # Demo screenshot
    ├── ARCHITECTURE.md             # In-depth architectural details
    └── TROUBLESHOOTING.md          # Common issues & fixes
```

★ = files authored for this integration. Everything else under `pixel-agents/`
is upstream.

---

## Setup (Manual Walkthrough)

### 1. Run the office (standalone web — no VS Code needed)

```sh
cd pixel-agents
npm install --legacy-peer-deps && (cd webview-ui && npm install --legacy-peer-deps) && (cd server && npm install --legacy-peer-deps)
npm run build
node dist/cli.js --port 3100
```

Open **http://127.0.0.1:3100** — an empty office.

Startup writes `~/.pixel-agents/server.json` (port + auth token) and installs
Claude Code hooks into `~/.claude/settings.json` so Claude sessions show up too.

### 2. Install + enable the Hermes plugin or Python bridge

You can use the plugin or the python bridge (or both):

#### Option A: Plugin (Recommended for CLI/TUI)
Copy the plugin into your Hermes user-plugins directory, then enable it:
```sh
cp -r hermes-plugin/pixel_observer ~/.hermes/plugins/
hermes plugins enable pixel_observer      # takes effect on the next session
```

#### Option B: Python Bridge (Recommended for Gateway/Telegram)
```sh
cp bridge/pixel_agents_bridge.py ~/.hermes/pixel_agents_bridge.py
```

---

## Test

```sh
cd pixel-agents && npm run test:server   # full suite, incl. hermesBridge.test.ts
```

---

## Credits

- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT)
- [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)

Forked and extended by **michoder26-cloud** with automated installers, systemd services, Thai documentation, and bridge scripts.
