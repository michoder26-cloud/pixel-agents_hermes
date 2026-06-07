/**
 * HermesBridge: ingests Hermes `pixel_observer` plugin events and drives the
 * shared office UI by writing the AgentStateStore directly.
 *
 * Why a dedicated bridge instead of the Claude HookEventHandler:
 *   - Hermes has NO transcript file; standalone agent creation in the Claude
 *     path routes entirely through JSONL adoption (adoptExternalSessionFromHook).
 *   - HookEventHandler correlates tools via a single `currentHookToolId`, which
 *     cannot represent Hermes' concurrent tool execution.
 *   - subagentStart/Stop in that handler are gated behind `provider.team`.
 * The bridge sidesteps all three. It shares the SAME AgentStateStore as the
 * Claude runtime, so Hermes and Claude agents coexist in one office and agent
 * ids (assigned by `store.nextAgentId`) never collide.
 *
 * Subagent model: a Hermes subagent is a real, independent session with its own
 * `session_id` and its own pre_tool_call / post_tool_call stream. The bridge
 * renders each subagent as a separate "teammate" character (palette inherited
 * from the parent, no focus stealing) via the `subagent_start` hook, and the
 * child's own tool events animate it — exactly like a top-level agent.
 *
 * Every WS message emitted here matches a branch the webview already handles
 * (see webview-ui/src/hooks/useExtensionMessages.ts). The bridge adds no new
 * protocol surface.
 */

import type { AgentStateStore } from './agentStateStore.js';
import type { HermesProvider } from './providers/hermes/hermes.js';
import type { AgentState } from './types.js';

/** Raw event payload POSTed by the Hermes pixel_observer plugin. */
interface HermesEvent {
  /** Hermes plugin hook name, e.g. 'pre_tool_call'. Required by the HTTP route. */
  hook_event_name: string;
  /** Session id (for subagent_* this is the child session id). Required by the HTTP route. */
  session_id: string;
  [key: string]: unknown;
}

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

export class HermesBridge {
  /** session_id → office agent id. Covers both top-level sessions and subagents. */
  private readonly sessionToAgentId = new Map<string, number>();

  constructor(
    private readonly store: AgentStateStore,
    private readonly provider: HermesProvider,
  ) {}

  /** Entry point wired from the HTTP hook route for providerId === 'hermes'. */
  handleEvent(raw: Record<string, unknown>): void {
    const event = raw as HermesEvent;
    const name = event.hook_event_name;
    const sessionId = event.session_id;
    if (typeof name !== 'string' || typeof sessionId !== 'string' || !sessionId) return;

    if (debug) {
      console.log(`[Pixel Agents] Hermes: ${name} (session=${sessionId.slice(0, 8)}…)`);
    }

    switch (name) {
      case 'on_session_start':
      case 'pre_llm_call':
        // Turn / session begin → ensure the character exists and mark it active.
        this.ensureAgent(sessionId, this.str(event.platform) || 'hermes');
        this.setActive(sessionId);
        break;

      case 'pre_tool_call':
        this.handleToolStart(sessionId, event);
        break;

      case 'post_tool_call':
        this.handleToolDone(sessionId, event);
        break;

      case 'post_llm_call':
        // Turn end → clear tools and mark the agent as waiting.
        this.markWaiting(sessionId);
        break;

      case 'pre_approval_request':
        this.handlePermission(sessionId);
        break;

      case 'post_approval_response':
        this.clearPermission(sessionId);
        break;

      case 'post_api_request':
        this.handleTokens(sessionId, event);
        break;

      case 'subagent_start':
        this.handleSubagentStart(event);
        break;

      case 'subagent_stop':
      case 'on_session_end':
      case 'on_session_finalize':
        this.removeAgent(sessionId);
        break;

      default:
        // Unhandled hook — ignore.
        break;
    }
  }

  // ── Agent lifecycle ───────────────────────────────────────────

  /** Look up or create a top-level agent character for a session. */
  private ensureAgent(sessionId: string, folderName: string): number {
    const existing = this.sessionToAgentId.get(sessionId);
    if (existing !== undefined) return existing;
    return this.createAgent(sessionId, { folderName });
  }

  /** Create an agent (top-level or teammate) and register it. */
  private createAgent(
    sessionId: string,
    opts: { folderName?: string; leadAgentId?: number; agentName?: string; teamName?: string },
  ): number {
    const id = this.store.nextAgentId.current++;
    const agent: AgentState = {
      id,
      sessionId,
      terminalRef: undefined,
      isExternal: true,
      projectDir: '',
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: opts.folderName,
      hookDelivered: true,
      hooksOnly: true,
      providerId: 'hermes',
      inputTokens: 0,
      outputTokens: 0,
      teamName: opts.teamName,
      agentName: opts.agentName,
      leadAgentId: opts.leadAgentId,
    };
    this.store.set(id, agent); // fires agentAdded → 'agentCreated' WS
    this.sessionToAgentId.set(sessionId, id);
    return id;
  }

  /** Remove an agent and any of its subagent teammates. */
  private removeAgent(sessionId: string): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    this.sessionToAgentId.delete(sessionId);

    // Remove any teammate subagents still parented to this agent.
    for (const [childSession, childId] of [...this.sessionToAgentId]) {
      const child = this.store.get(childId);
      if (child?.leadAgentId === id) {
        this.sessionToAgentId.delete(childSession);
        this.store.delete(childId); // fires 'agentClosed'
      }
    }

    this.store.delete(id); // fires agentRemoved → 'agentClosed' WS
  }

  // ── Tool activity ─────────────────────────────────────────────

  private handleToolStart(sessionId: string, event: HermesEvent): void {
    const id = this.ensureAgent(sessionId, this.str(event.platform) || 'hermes');
    const toolName = this.str(event.tool_name);
    const toolId = this.str(event.tool_call_id) || `hermes-${toolName}-${this.seq()}`;
    const status = this.provider.formatToolStatus(toolName, event.args);

    this.store.broadcast({ type: 'agentToolStart', id, toolId, status, toolName });
    this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
  }

  private handleToolDone(sessionId: string, event: HermesEvent): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const toolId = this.str(event.tool_call_id);
    if (!toolId) return;
    this.store.broadcast({ type: 'agentToolDone', id, toolId });
  }

  private setActive(sessionId: string): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const agent = this.store.get(id);
    if (agent) agent.isWaiting = false;
    this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
  }

  private markWaiting(sessionId: string): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const agent = this.store.get(id);
    if (agent) {
      agent.isWaiting = true;
      agent.permissionSent = false;
    }
    this.store.broadcast({ type: 'agentToolsClear', id });
    this.store.broadcast({ type: 'agentStatus', id, status: 'waiting' });
  }

  // ── Permission ────────────────────────────────────────────────

  private handlePermission(sessionId: string): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const agent = this.store.get(id);
    if (agent) agent.permissionSent = true;
    this.store.broadcast({ type: 'agentToolPermission', id });
  }

  private clearPermission(sessionId: string): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const agent = this.store.get(id);
    if (agent) agent.permissionSent = false;
    this.store.broadcast({ type: 'agentToolPermissionClear', id });
  }

  // ── Subagents (rendered as teammate characters) ───────────────

  private handleSubagentStart(event: HermesEvent): void {
    // Ordering assumption: `subagent_start` must arrive BEFORE the child's first
    // tool event, otherwise the child is created as a plain top-level agent by
    // ensureAgent() (and is never promoted to a teammate — the early-return below
    // skips already-known sessions). This holds because the pixel_observer plugin
    // delivers events via a single FIFO worker thread, and Hermes fires
    // subagent_start before the child session runs. If that guarantee ever breaks,
    // add a promote-to-teammate path here instead of the early return.
    const childSession = this.str(event.child_session_id) || event.session_id;
    const parentSession = this.str(event.parent_session_id);
    if (!childSession) return;
    if (this.sessionToAgentId.has(childSession)) return; // already created

    const parentId =
      parentSession !== '' ? this.sessionToAgentId.get(parentSession) : undefined;
    const role = this.str(event.child_role) || 'subagent';

    this.createAgent(childSession, {
      leadAgentId: parentId,
      agentName: role,
      teamName: 'Hermes',
      folderName: role,
    });
  }

  // ── Token usage ───────────────────────────────────────────────

  private handleTokens(sessionId: string, event: HermesEvent): void {
    const id = this.sessionToAgentId.get(sessionId);
    if (id === undefined) return;
    const usage = event.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    const inputTokens = this.num(usage.input_tokens);
    const outputTokens = this.num(usage.output_tokens);
    if (inputTokens === 0 && outputTokens === 0) return;
    const agent = this.store.get(id);
    if (agent) {
      agent.inputTokens += inputTokens;
      agent.outputTokens += outputTokens;
      this.store.broadcast({
        type: 'agentTokenUsage',
        id,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private _seq = 0;
  private seq(): number {
    return this._seq++;
  }

  private str(v: unknown): string {
    return typeof v === 'string' ? v : '';
  }

  private num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
}
