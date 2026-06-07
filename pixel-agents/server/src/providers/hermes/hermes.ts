/**
 * Hermes provider metadata.
 *
 * Hermes (NousResearch/hermes-agent) is a PUSH-based agent: instead of pixel
 * installing hook scripts into a CLI (the HookProvider model used by Claude
 * Code), Hermes runs its own `pixel_observer` plugin that POSTs lifecycle
 * events to `${HOOK_API_PREFIX}/hermes`. Those events are consumed by
 * `HermesBridge` (server/src/hermesBridge.ts), which writes the shared
 * AgentStateStore directly — it does NOT go through the Claude-coupled
 * HookEventHandler (single-tool correlation, JSONL-backed agent creation, and
 * team-gated subagents make that handler unsuitable for a transcript-less
 * provider).
 *
 * This module therefore only exposes the provider IDENTITY + tool metadata the
 * bridge and the webview need. It is intentionally not a `HookProvider`:
 * provider.ts reserves a future `StreamProvider` type for exactly this
 * push-based shape.
 */

import * as path from 'path';

import { BASH_COMMAND_DISPLAY_MAX_LENGTH } from '../../constants.js';

export interface HermesProvider {
  readonly id: string;
  readonly displayName: string;
  /** Tools that should show the "reading" character animation instead of "typing". */
  readonly readingTools: ReadonlySet<string>;
  /** Tools that spawn sub-agent characters via the webview's auto-subagent path.
   *  EMPTY for Hermes: subagents are real, independent sessions with their own
   *  tool streams, so the bridge renders them as separate teammate characters
   *  (via the `subagent_start` hook) rather than as sub-tools under a parent. */
  readonly subagentToolNames: ReadonlySet<string>;
  /** Format a Hermes tool name + args into a human-readable status string. */
  formatToolStatus(toolName: string, input?: unknown): string;
}

/** Read-only Hermes tools — render the "reading" animation. */
const READING_TOOLS = new Set<string>([
  'read_file',
  'search_files',
  'session_search',
  'web_search',
  'web_extract',
  'x_search',
  'vision_analyze',
  'video_analyze',
  'skill_view',
  'skills_list',
  'browser_snapshot',
  'browser_get_images',
  'browser_console',
  'feishu_doc_read',
  'ha_get_state',
  'ha_list_entities',
  'ha_list_services',
  'kanban_list',
  'kanban_show',
]);

function base(p: unknown): string {
  return typeof p === 'string' ? path.basename(p) : '';
}

function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'read_file':
      return `Reading ${base(inp.path ?? inp.file_path ?? inp.filename)}`;
    case 'write_file':
      return `Writing ${base(inp.path ?? inp.file_path ?? inp.filename)}`;
    case 'patch':
      return `Patching ${base(inp.path ?? inp.file_path ?? inp.filename)}`;
    case 'search_files':
      return 'Searching files';
    case 'session_search':
      return 'Searching past sessions';
    case 'web_search':
    case 'x_search':
      return 'Searching the web';
    case 'web_extract':
      return 'Fetching web content';
    case 'terminal':
    case 'process': {
      const cmd = (inp.command as string) || '';
      return `Running: ${
        cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH
          ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '…'
          : cmd
      }`;
    }
    case 'execute_code':
      return 'Executing code';
    case 'delegate_task': {
      const goal = typeof inp.goal === 'string' ? inp.goal : '';
      return goal ? `Delegating: ${goal.slice(0, 40)}` : 'Delegating task';
    }
    case 'memory':
      return 'Recalling memory';
    case 'todo':
      return 'Updating plan';
    case 'image_generate':
      return 'Generating image';
    case 'vision_analyze':
    case 'video_analyze':
      return 'Analyzing media';
    case 'send_message':
      return 'Sending message';
    default:
      return `Using ${toolName}`;
  }
}

export const hermesProvider: HermesProvider = {
  id: 'hermes',
  displayName: 'Hermes',
  readingTools: READING_TOOLS,
  subagentToolNames: new Set<string>(),
  formatToolStatus,
};
