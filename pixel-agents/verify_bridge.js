// Verify the HermesBridge actually creates an office agent from a Hermes event.
// Connects to the standalone office WS, sends webviewReady, POSTs a synthetic
// on_session_start + pre_tool_call to /api/hooks/hermes, and reports any
// agentCreated / agentState messages received.
const WebSocket = require('ws');

const URL = 'ws://127.0.0.1:3100/ws';
const TOKEN = process.env.PA_TOKEN;
const SID = 'probe-hermes-session-' + Date.now();

const ws = new WebSocket(URL);
const events = [];
let agentCreatedSeen = false;

ws.on('open', () => {
  console.log('[ws] connected, sending webviewReady');
  ws.send(JSON.stringify({ type: 'webviewReady' }));
});

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  events.push(msg.type);
  if (msg.type === 'agentCreated') {
    agentCreatedSeen = true;
    console.log('[ws] *** agentCreated ***', JSON.stringify(msg));
  } else if (msg.type === 'agentState' || msg.type === 'agentToolStart' || msg.type === 'agentToolDone' || msg.type === 'agentStatus') {
    console.log('[ws] ->', msg.type, JSON.stringify(msg).slice(0, 300));
  }
});

ws.on('error', (e) => console.error('[ws] error', e.message));

// After WS is established + we've received initial state, fire Hermes events.
setTimeout(() => {
  const post = (body) => {
    const http = require('http');
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: 3100, path: '/api/hooks/hermes', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { console.log(`[http] POST ${body.hook_event_name} -> ${res.statusCode}`); res.resume(); });
    req.on('error', (e) => console.log('[http] err', e.message));
    req.write(data); req.end();
  };
  console.log('[hermes] firing synthetic events for session', SID);
  post({ hook_event_name: 'on_session_start', session_id: SID, platform: 'cli' });
  setTimeout(() => post({ hook_event_name: 'pre_llm_call', session_id: SID, platform: 'cli' }), 300);
  setTimeout(() => post({ hook_event_name: 'pre_tool_call', session_id: SID, tool_name: 'Read', tool_call_id: 'call_probe1', args: { file_path: '/tmp/x' } }), 700);
  setTimeout(() => post({ hook_event_name: 'post_tool_call', session_id: SID, tool_name: 'Read', tool_call_id: 'call_probe1', status: 'success', args: { file_path: '/tmp/x' } }), 1100);
}, 1500);

// Report + exit.
setTimeout(() => {
  console.log('\n=== RESULT ===');
  console.log('WS message types seen:', events);
  console.log('agentCreated seen:', agentCreatedSeen ? 'YES ✅ — bridge works' : 'NO ❌');
  ws.close();
  process.exit(agentCreatedSeen ? 0 : 1);
}, 4000);
