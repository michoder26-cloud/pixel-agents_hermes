# pixel_observer

A [Hermes](https://github.com/NousResearch/hermes-agent) plugin that streams
session / tool / subagent activity to a running [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)
office UI, so each Hermes session shows up as an animated character.

## Install

```sh
cp -r pixel_observer ~/.hermes/plugins/
hermes plugins enable pixel_observer    # effective next session
```

## How it works

Registers lifecycle hooks (`on_session_start`, `pre_tool_call`, `post_tool_call`,
`post_llm_call`, `subagent_start`, `subagent_stop`, `post_api_request`,
`pre/post_approval_request`) and forwards each as a small JSON POST to the Pixel
Agents server.

- **Discovery + auth:** reads `~/.pixel-agents/server.json` ({port, token}) — the
  same file the Claude Code hook uses — and POSTs to
  `http://127.0.0.1:<port>/api/hooks/hermes` with `Authorization: Bearer <token>`.
  Override with `PIXEL_AGENTS_URL` / `PIXEL_AGENTS_TOKEN`.
- **Non-blocking:** events are enqueued and flushed by a single daemon worker
  thread in FIFO order, so the agent never waits on the network and a missing /
  closed UI is a silent no-op. `pre_tool_call` always returns `None` (never
  blocks a tool).
- **Stdlib only** (`urllib`) — no extra dependencies.

The server side (`HermesBridge` in the Pixel Agents fork) turns these into the
office's WebSocket messages.
