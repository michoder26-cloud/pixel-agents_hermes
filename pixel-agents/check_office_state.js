// Connect to the office, send webviewReady, print the CURRENT agent roster
// (existingAgents) so we know what the browser should be showing right now.
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3100/ws');
let got = false;
ws.on('open', () => ws.send(JSON.stringify({ type: 'webviewReady' })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === 'existingAgents') {
    got = true;
    const agents = m.agents || m.state?.agents || m.payload?.agents || [];
    console.log('=== CURRENT OFFICE STATE ===');
    console.log('agent count:', Array.isArray(agents) ? agents.length : Object.keys(agents).length);
    console.log('raw existingAgents:', JSON.stringify(m).slice(0, 1200));
    setTimeout(() => { ws.close(); process.exit(0); }, 500);
  }
});
ws.on('error', (e) => { console.error('ws err', e.message); process.exit(1); });
setTimeout(() => { if (!got) console.log('NO existingAgents message received'); ws.close(); process.exit(0); }, 3000);
