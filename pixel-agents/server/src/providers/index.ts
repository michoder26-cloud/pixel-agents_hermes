/**
 * Provider registry: re-exports all bundled providers.
 *
 * Adding a new CLI provider:
 *   1. Create `server/src/providers/hook/<cli>/<cli>.ts` implementing HookProvider.
 *      (File-based and stream-based provider types will land when the first such
 *       provider ships.)
 *   2. Add an export line below.
 *
 * The adapter (VS Code extension, standalone CLI, etc.) imports from here rather
 * than reaching into each provider directory directly.
 */

export { claudeProvider } from './hook/claude/claude.js';
export { copyHookScript } from './hook/claude/claudeHookInstaller.js';

// Hermes: push-based provider (its own pixel_observer plugin POSTs events).
// Not a HookProvider — exposes identity + tool metadata consumed by HermesBridge
// and the providerCapabilities union. See providers/hermes/hermes.ts.
export { hermesProvider } from './hermes/hermes.js';
