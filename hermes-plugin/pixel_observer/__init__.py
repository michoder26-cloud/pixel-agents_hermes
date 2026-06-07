"""pixel_observer — stream Hermes activity to a Pixel Agents office UI.

This optional plugin forwards Hermes lifecycle hooks (session/turn/tool/subagent)
to a locally-running Pixel Agents server (pixel-agents-hq/pixel-agents) so each
Hermes session appears as an animated character in the office and subagents show
up as teammates.

Design:
  * Discovery + auth mirror the Claude Code hook: the Pixel Agents standalone
    server writes ``~/.pixel-agents/server.json`` ({port, token, ...}) on start.
    We read it and POST events to ``http://127.0.0.1:<port>/api/hooks/hermes``
    with ``Authorization: Bearer <token>``. Override with PIXEL_AGENTS_URL /
    PIXEL_AGENTS_TOKEN.
  * The server's hook route only accepts payloads carrying BOTH ``session_id``
    and ``hook_event_name``, so every payload includes them (for subagent_* the
    session_id is the child session id).
  * Delivery is fire-and-forget on a single daemon worker thread: hooks enqueue
    and return instantly (never blocking the agent), the worker POSTs in FIFO
    order (preserving subagent_start-before-child ordering), and failures are
    swallowed so a missing/closed UI never affects Hermes.

The consumer is HermesBridge on the server side, which maps these events to the
office's WebSocket protocol. Stdlib only (urllib) — no new dependencies.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

PROVIDER_ID = "hermes"
_SERVER_JSON = Path.home() / ".pixel-agents" / "server.json"
_CONFIG_TTL_SECONDS = 5.0
_POST_TIMEOUT_SECONDS = 2.0
_QUEUE_MAX = 1000


class _Sink:
    """Single-worker fire-and-forget POST queue with cached server discovery."""

    def __init__(self) -> None:
        self._q: "queue.Queue[Optional[dict[str, Any]]]" = queue.Queue(maxsize=_QUEUE_MAX)
        self._worker: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._cfg: Optional[tuple[str, str]] = None  # (url, token)
        self._cfg_at = 0.0

    # -- discovery -----------------------------------------------------------

    def _resolve_config(self, force: bool = False) -> Optional[tuple[str, str]]:
        now = time.monotonic()
        if not force and self._cfg is not None and (now - self._cfg_at) < _CONFIG_TTL_SECONDS:
            return self._cfg

        env_url = os.environ.get("PIXEL_AGENTS_URL", "").strip()
        env_token = os.environ.get("PIXEL_AGENTS_TOKEN", "").strip()
        if env_url:
            self._cfg = (env_url.rstrip("/"), env_token)
            self._cfg_at = now
            return self._cfg

        try:
            data = json.loads(_SERVER_JSON.read_text(encoding="utf-8"))
            port = int(data["port"])
            token = str(data.get("token", ""))
            self._cfg = (f"http://127.0.0.1:{port}", token)
            self._cfg_at = now
            return self._cfg
        except Exception:
            # No server running / unreadable discovery file — disabled for now.
            self._cfg = None
            self._cfg_at = now
            return None

    # -- public --------------------------------------------------------------

    def emit(self, payload: dict[str, Any]) -> None:
        """Enqueue an event. Never raises; drops silently if the queue is full."""
        # Cheap gate: if no server is discoverable, skip enqueuing entirely.
        if self._resolve_config() is None:
            return
        self._ensure_worker()
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            pass

    def _ensure_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._run, name="pixel-observer", daemon=True
            )
            self._worker.start()

    def _run(self) -> None:
        while True:
            payload = self._q.get()
            if payload is None:
                return
            try:
                self._post(payload)
            except Exception as exc:  # pragma: no cover - best-effort relay
                logger.debug("pixel_observer post failed: %s", exc)
            finally:
                self._q.task_done()

    def _post(self, payload: dict[str, Any]) -> None:
        cfg = self._resolve_config()
        if cfg is None:
            return
        url, token = cfg
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{url}/api/hooks/{PROVIDER_ID}",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=_POST_TIMEOUT_SECONDS):
                pass
        except Exception:
            # Server may have restarted (new port/token) — refresh discovery once
            # so the next event can reconnect, then give up on this one.
            self._resolve_config(force=True)
            raise


_SINK = _Sink()


def _emit(hook_event_name: str, session_id: Any, **fields: Any) -> None:
    sid = str(session_id) if session_id is not None else ""
    if not sid:
        return  # server route requires a session_id
    payload: dict[str, Any] = {"hook_event_name": hook_event_name, "session_id": sid}
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    _SINK.emit(payload)


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------


def register(ctx) -> None:
    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("on_session_finalize", on_session_finalize)
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("post_llm_call", on_post_llm_call)
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("post_api_request", on_post_api_request)
    ctx.register_hook("pre_approval_request", on_pre_approval_request)
    ctx.register_hook("post_approval_response", on_post_approval_response)
    ctx.register_hook("subagent_start", on_subagent_start)
    ctx.register_hook("subagent_stop", on_subagent_stop)


def on_session_start(**kw: Any) -> None:
    _emit("on_session_start", kw.get("session_id"), platform=kw.get("platform"))


def on_session_end(**kw: Any) -> None:
    _emit("on_session_end", kw.get("session_id"))


def on_session_finalize(**kw: Any) -> None:
    _emit("on_session_finalize", kw.get("session_id"))


def on_pre_llm_call(**kw: Any) -> None:
    _emit("pre_llm_call", kw.get("session_id"), platform=kw.get("platform"))


def on_post_llm_call(**kw: Any) -> None:
    _emit("post_llm_call", kw.get("session_id"))


def on_pre_tool_call(**kw: Any) -> None:
    # Observer only — MUST return None so the tool is never blocked.
    _emit(
        "pre_tool_call",
        kw.get("session_id"),
        tool_name=kw.get("tool_name"),
        tool_call_id=kw.get("tool_call_id"),
        args=kw.get("args"),
    )


def on_post_tool_call(**kw: Any) -> None:
    _emit(
        "post_tool_call",
        kw.get("session_id"),
        tool_name=kw.get("tool_name"),
        tool_call_id=kw.get("tool_call_id"),
        status=kw.get("status"),
    )


def on_post_api_request(**kw: Any) -> None:
    _emit("post_api_request", kw.get("session_id"), usage=kw.get("usage"))


def on_pre_approval_request(**kw: Any) -> None:
    # Approval hooks carry session_key (not session_id). Pass it through as the
    # session id; the bridge no-ops if it doesn't match a known agent.
    _emit("pre_approval_request", kw.get("session_key"))


def on_post_approval_response(**kw: Any) -> None:
    _emit("post_approval_response", kw.get("session_key"))


def on_subagent_start(**kw: Any) -> None:
    child = kw.get("child_session_id")
    _emit(
        "subagent_start",
        child,  # session_id == child session id (route requires it)
        parent_session_id=kw.get("parent_session_id"),
        child_session_id=child,
        child_role=kw.get("child_role"),
        child_subagent_id=kw.get("child_subagent_id"),
    )


def on_subagent_stop(**kw: Any) -> None:
    _emit("subagent_stop", kw.get("child_session_id"))
