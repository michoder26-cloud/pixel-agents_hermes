// Passive office listener: connect WS, send webviewReady, log every agent
// lifecycle event for a while. Used to capture a REAL Hermes session.
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3100/ws');
ws.on('open', () => { console.log('[listen] connected'); ws.send(JSON.stringify({ type: 'webviewReady' })); });
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (['agentCreated','agentClosed','agentStatus','agentToolStart','agentToolDone','agentTextStart','agentTextDone','agentWaiting','agentTeammateCreated'].includes(m.type)) {
    console.log('[listen]', m.type, JSON.stringify(m).slice(0, 220));
  }
});
ws.on('error', (e) => console.error('[listen] err', e.message));
const MS = parseInt(process.env.LISTEN_MS || '45000', 10);
setTimeout(() => { console.log('[listen] done'); ws.close(); process.exit(0); }, MS);
