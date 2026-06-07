import { beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { HermesBridge } from '../src/hermesBridge.js';
import { hermesProvider } from '../src/providers/hermes/hermes.js';
import type { AgentState } from '../src/types.js';

/** Capture store events the way the WebSocket layer (httpServer.ts) consumes them. */
function attach(store: AgentStateStore) {
  const added: Array<{ id: number; agent: AgentState }> = [];
  const removed: number[] = [];
  const broadcasts: Array<Record<string, unknown>> = [];
  store.on('agentAdded', (id, agent) => added.push({ id, agent }));
  store.on('agentRemoved', (id) => removed.push(id));
  store.on('broadcast', (m) => broadcasts.push(m));
  return { added, removed, broadcasts };
}

function ev(hook_event_name: string, session_id: string, extra: Record<string, unknown> = {}) {
  return { hook_event_name, session_id, ...extra };
}

describe('HermesBridge', () => {
  let store: AgentStateStore;
  let bridge: HermesBridge;

  beforeEach(() => {
    store = new AgentStateStore();
    bridge = new HermesBridge(store, hermesProvider);
  });

  it('creates a hooks-only agent on session start', () => {
    const { added } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A', { platform: 'cli' }));

    expect(added).toHaveLength(1);
    const agent = added[0].agent;
    expect(agent.hooksOnly).toBe(true);
    expect(agent.providerId).toBe('hermes');
    expect(agent.jsonlFile).toBe('');
    expect(agent.isExternal).toBe(true);
    expect(agent.folderName).toBe('cli');
    expect(store.size).toBe(1);
  });

  it('reuses one agent across the session and broadcasts tool start/done with real ids', () => {
    const { added, broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    bridge.handleEvent(
      ev('pre_tool_call', 'sess-A', {
        tool_name: 'read_file',
        tool_call_id: 'tc-1',
        args: { path: '/tmp/foo.py' },
      }),
    );
    bridge.handleEvent(ev('post_tool_call', 'sess-A', { tool_call_id: 'tc-1' }));

    expect(added).toHaveLength(1); // single agent reused
    const id = added[0].id;

    const start = broadcasts.find((m) => m.type === 'agentToolStart');
    expect(start).toMatchObject({ id, toolId: 'tc-1', toolName: 'read_file' });
    expect(start?.status).toContain('Reading foo.py'); // formatToolStatus + reading verb
    expect(broadcasts).toContainEqual({ type: 'agentStatus', id, status: 'active' });
    expect(broadcasts).toContainEqual({ type: 'agentToolDone', id, toolId: 'tc-1' });
  });

  it('tracks concurrent tools independently (distinct toolIds)', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    bridge.handleEvent(ev('pre_tool_call', 'sess-A', { tool_name: 'terminal', tool_call_id: 'tc-1' }));
    bridge.handleEvent(ev('pre_tool_call', 'sess-A', { tool_name: 'web_search', tool_call_id: 'tc-2' }));
    bridge.handleEvent(ev('post_tool_call', 'sess-A', { tool_call_id: 'tc-1' }));
    bridge.handleEvent(ev('post_tool_call', 'sess-A', { tool_call_id: 'tc-2' }));

    const starts = broadcasts.filter((m) => m.type === 'agentToolStart').map((m) => m.toolId);
    const dones = broadcasts.filter((m) => m.type === 'agentToolDone').map((m) => m.toolId);
    expect(starts).toEqual(['tc-1', 'tc-2']);
    expect(dones).toEqual(['tc-1', 'tc-2']);
  });

  it('marks the agent waiting on turn end (post_llm_call)', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    broadcasts.length = 0;
    bridge.handleEvent(ev('post_llm_call', 'sess-A'));

    const id = [...store.keys()][0];
    expect(broadcasts).toContainEqual({ type: 'agentToolsClear', id });
    expect(broadcasts).toContainEqual({ type: 'agentStatus', id, status: 'waiting' });
    expect(store.get(id)?.isWaiting).toBe(true);
  });

  it('renders a subagent as a teammate of its parent', () => {
    const { added } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'parent-1'));
    const parentId = added[0].id;

    bridge.handleEvent(
      ev('subagent_start', 'child-1', {
        parent_session_id: 'parent-1',
        child_session_id: 'child-1',
        child_role: 'researcher',
      }),
    );

    expect(added).toHaveLength(2);
    const child = added[1].agent;
    expect(child.leadAgentId).toBe(parentId);
    expect(child.agentName).toBe('researcher');
    expect(child.teamName).toBe('Hermes');
    expect(child.providerId).toBe('hermes');
  });

  it('animates a subagent via its own child-session tool stream', () => {
    const { added, broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'parent-1'));
    bridge.handleEvent(
      ev('subagent_start', 'child-1', { parent_session_id: 'parent-1', child_role: 'coder' }),
    );
    const childId = added[1].id;
    broadcasts.length = 0;

    bridge.handleEvent(
      ev('pre_tool_call', 'child-1', { tool_name: 'write_file', tool_call_id: 'c-tc-1' }),
    );
    expect(broadcasts).toContainEqual(
      expect.objectContaining({ type: 'agentToolStart', id: childId, toolId: 'c-tc-1' }),
    );
  });

  it('does NOT remove the agent on on_session_end (it fires every turn)', () => {
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    bridge.handleEvent(ev('post_llm_call', 'sess-A'));
    bridge.handleEvent(ev('on_session_end', 'sess-A')); // per-turn marker, not teardown
    expect(store.size).toBe(1); // agent persists across turns

    // a second turn reuses the same character
    bridge.handleEvent(ev('pre_llm_call', 'sess-A'));
    expect(store.size).toBe(1);
  });

  it('removes the agent (and its teammates) on session finalize', () => {
    const { removed } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'parent-1'));
    bridge.handleEvent(ev('subagent_start', 'child-1', { parent_session_id: 'parent-1' }));
    expect(store.size).toBe(2);

    bridge.handleEvent(ev('on_session_finalize', 'parent-1'));
    expect(store.size).toBe(0);
    expect(removed).toHaveLength(2); // parent + teammate
  });

  it('synthesizes a tool start when only post_tool_call fires (no pre_tool_call)', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    const id = [...store.keys()][0];
    broadcasts.length = 0;

    // Only the completion event arrives — pre_tool_call was skipped by Hermes.
    bridge.handleEvent(
      ev('post_tool_call', 'sess-A', { tool_name: 'read_file', tool_call_id: 'p1', args: { path: '/a/b.py' } }),
    );

    const start = broadcasts.find((m) => m.type === 'agentToolStart');
    expect(start).toMatchObject({ id, toolId: 'p1', toolName: 'read_file' });
    expect(broadcasts).toContainEqual({ type: 'agentToolDone', id, toolId: 'p1' });
  });

  it('does not double-start a tool that already had pre_tool_call', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    bridge.handleEvent(ev('pre_tool_call', 'sess-A', { tool_name: 'terminal', tool_call_id: 'p1' }));
    bridge.handleEvent(ev('post_tool_call', 'sess-A', { tool_name: 'terminal', tool_call_id: 'p1' }));

    const starts = broadcasts.filter((m) => m.type === 'agentToolStart' && m.toolId === 'p1');
    expect(starts).toHaveLength(1); // exactly one start, not two
  });

  it('removes only the subagent on subagent_stop', () => {
    bridge.handleEvent(ev('on_session_start', 'parent-1'));
    bridge.handleEvent(ev('subagent_start', 'child-1', { parent_session_id: 'parent-1' }));
    expect(store.size).toBe(2);

    bridge.handleEvent(ev('subagent_stop', 'child-1'));
    expect(store.size).toBe(1);
    expect([...store.values()][0].leadAgentId).toBeUndefined(); // parent remains
  });

  it('accumulates and broadcasts token usage', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('on_session_start', 'sess-A'));
    const id = [...store.keys()][0];
    bridge.handleEvent(ev('post_api_request', 'sess-A', { usage: { input_tokens: 100, output_tokens: 20 } }));
    bridge.handleEvent(ev('post_api_request', 'sess-A', { usage: { input_tokens: 50, output_tokens: 10 } }));

    const usages = broadcasts.filter((m) => m.type === 'agentTokenUsage');
    expect(usages.at(-1)).toEqual({ type: 'agentTokenUsage', id, inputTokens: 150, outputTokens: 30 });
  });

  it('ignores tool events for unknown sessions (no crash, no agent)', () => {
    const { broadcasts } = attach(store);
    bridge.handleEvent(ev('post_tool_call', 'ghost', { tool_call_id: 'x' }));
    bridge.handleEvent(ev('post_llm_call', 'ghost'));
    expect(store.size).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('drops payloads missing session_id', () => {
    const { added } = attach(store);
    bridge.handleEvent({ hook_event_name: 'on_session_start' } as Record<string, unknown>);
    expect(added).toHaveLength(0);
  });
});
