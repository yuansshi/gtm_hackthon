import WebSocket from 'ws';
import { AppError, digest, now } from './store.js';

export const bandRoles = ['planner', 'builder', 'reviewer', 'security'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const keyValid = value => typeof value === 'string' && /^band_a_[\x21-\x7e]{24,}$/.test(value) && !/dummy|placeholder|replace|changeme|example/i.test(value);
const fail = (status, message, code) => { throw new AppError(status, message, code); };
const label = value => typeof value === 'string' && value.trim().length <= 200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
export function parseBandMessage(value, roomId) {
  if (!uuid(value?.id) || !uuid(value.sender_id) || !['Agent','User'].includes(value.sender_type) || value.message_type !== 'text' || typeof value.content !== 'string' || value.content.length > 24000 || value.chat_room_id && (!uuid(value.chat_room_id) || value.chat_room_id.toLowerCase() !== roomId) || !Array.isArray(value.metadata?.mentions) || value.metadata.mentions.length > 30 || value.metadata.mentions.some(item => !uuid(item.id)) || value.attachments?.length) return null;
  return { id: value.id.toLowerCase(), content: value.content, senderId: value.sender_id.toLowerCase(), senderType: value.sender_type, mentions: value.metadata.mentions.map(item => item.id.toLowerCase()), at: value.inserted_at || null };
}
export function createBandProvider({ env = process.env, fetcher = fetch, socketFactory = (url, options) => new WebSocket(url, options), clock = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval } } = {}) {
  // Only dedicated project agent keys; never Band Desktop sign-in, owner keys or custom destinations.
  const enabled = env.PROJECT_BAND_ENABLED === 'true';
  const agents = Object.fromEntries(bandRoles.map(role => { const prefix = 'PROJECT_BAND_' + role.toUpperCase() + '_'; return [role, { id: env[prefix + 'AGENT_ID']?.toLowerCase(), key: env[prefix + 'API_KEY'] }]; }));
  const rolesValid = bandRoles.every(role => uuid(agents[role].id) && keyValid(agents[role].key)) && new Set(bandRoles.map(role => agents[role].id)).size === 4 && new Set(bandRoles.map(role => agents[role].key)).size === 4;
  const room = id => ['allco','huasheng'].includes(id) ? { enabled: enabled && env['PROJECT_BAND_' + id.toUpperCase() + '_ENABLED'] === 'true', id: env['PROJECT_BAND_' + id.toUpperCase() + '_ROOM_ID']?.toLowerCase() } : { enabled: false };
  const binding = id => {
    const value = room(id), other = room(id === 'allco' ? 'huasheng' : 'allco');
    const conflict = value.enabled && other.enabled && value.id === other.id;
    const configured = value.enabled && rolesValid && uuid(value.id) && !conflict;
    return { enabled: value.enabled, configured, roomId: value.id || null, conflict, hash: digest({ businessId: id, roomId: value.id, roles: bandRoles.map(role => ({ role, id: agents[role].id, credential: keyValid(agents[role].key) ? digest(agents[role].key) : null })) }) };
  };
  const configured = id => { const value = binding(id); if (!value.configured) fail(503, 'Band is disabled. Configure four separate project agent identities and a separate existing room for this business.', 'band_not_configured'); return value; };
  const credentials = role => { if (!bandRoles.includes(role) || !enabled || !rolesValid) fail(503, 'Project Band agents are not configured.', 'band_not_configured'); return agents[role]; };
  const request = async (role, pathname, { method = 'GET', body, empty = false, mutation = false } = {}) => {
    const agent = credentials(role);
    try {
      const response = await fetcher(new URL('/api/v1/agent' + pathname, 'https://app.band.ai'), { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'X-API-Key': agent.key, Accept: 'application/json', 'Cache-Control': 'no-store', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 204 && empty) return null;
      if (!response.ok) { const rejected = [400,401,403,404,422,429].includes(response.status); fail(rejected ? 502 : 503, mutation ? rejected ? 'Band rejected this operation. No automatic message retry.' : 'Band operation acceptance is unknown. Inspect the room before any new submission.' : 'Band project identity or room lookup failed.', mutation ? rejected ? 'band_operation_rejected' : 'band_operation_unknown' : 'band_lookup_failed'); }
      if (!response.headers.get('content-type')?.includes('application/json')) fail(502, 'Band returned an invalid response.', mutation ? 'band_operation_unknown' : 'band_lookup_failed');
      const chunks = []; let size = 0;
      for await (const part of response.body || []) { const bytes = Buffer.from(part); size += bytes.length; if (size > 200000) fail(502, 'Band response exceeded its limit.', mutation ? 'band_operation_unknown' : 'band_lookup_failed'); chunks.push(bytes); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error instanceof AppError) throw error; fail(503, mutation ? 'Band operation acceptance is unknown. Inspect the room; no automatic message retry.' : 'Band lookup failed. Check the designated project connection.', mutation ? 'band_operation_unknown' : 'band_lookup_failed'); }
  };
  const roster = value => {
    if (!Array.isArray(value?.data) || value.data.length < 4 || value.data.length > 30) fail(502, 'Band returned an invalid room roster.', 'band_roster_invalid');
    const result = value.data.map(item => {
      if (!uuid(item.id) || !['Agent','User'].includes(item.type) || item.status !== 'active' || !label(item.name) || !label(item.handle)) fail(502, 'Band returned an invalid room participant.', 'band_roster_invalid');
      return { id: item.id.toLowerCase(), type: item.type, name: label(item.name), handle: label(item.handle) };
    }).sort((a,b) => a.id.localeCompare(b.id));
    if (new Set(result.map(item => item.id)).size !== result.length || result.filter(item => item.type === 'Agent').length !== 4 || bandRoles.some(role => !result.some(item => item.type === 'Agent' && item.id === agents[role].id))) fail(409, 'Use a dedicated room containing exactly these four project agents. Review the room membership before connecting.', 'band_roster_mismatch');
    return result;
  };
  const checkTeam = async id => {
    const config = configured(id);
    const values = await Promise.all(bandRoles.map(async role => {
      const [identity, participants] = await Promise.all([request(role, '/me'), request(role, `/chats/${config.roomId}/participants`)]);
      if (!uuid(identity?.data?.id) || identity.data.id.toLowerCase() !== agents[role].id || !label(identity.data.name) || !label(identity.data.handle)) fail(409, 'A Band key does not match its configured project agent.', 'band_identity_mismatch');
      return { role, id: agents[role].id, name: label(identity.data.name), handle: label(identity.data.handle), participants: roster(participants) };
    }));
    const participants = values[0].participants;
    if (values.some(value => digest(value.participants) !== digest(participants))) fail(409, 'Band room membership changed during the check. Check again.', 'band_roster_mismatch');
    return { bindingHash: config.hash, roomId: config.roomId, roles: values.map(({participants,...value}) => value), participants, rosterHash: digest(participants), checkedAt: now() };
  };
  const checkRoster = async (id, role = 'planner') => { const config = configured(id); const participants = roster(await request(role, `/chats/${config.roomId}/participants`)); return { participants, hash: digest(participants) }; };
  const send = async (id, role, targetRole, content) => {
    const config = configured(id); credentials(targetRole);
    if (role === targetRole || typeof content !== 'string' || !content.trim() || content.length > 24000) fail(400, 'A Band handoff needs one different project recipient and bounded content.', 'band_invalid_handoff');
    const target = agents[targetRole].id;
    const value = await request(role, `/chats/${config.roomId}/messages`, { method: 'POST', mutation: true, body: { message: { content, mentions: [{ id: target }] } } });
    if (!uuid(value?.data?.id) || value.data.success !== true || !Array.isArray(value.data.recipients) || value.data.recipients.length !== 1 || !uuid(value.data.recipients[0]?.id) || value.data.recipients[0].id.toLowerCase() !== target) fail(503, 'Band handoff acceptance could not be confirmed. Do not repost automatically.', 'band_operation_unknown');
    return { id: value.data.id.toLowerCase(), from: agents[role].id, to: target, acceptedAt: now() };
  };
  const next = async (id, role) => { const config = configured(id), value = await request(role, `/chats/${config.roomId}/messages/next`, { empty: true }); if (!value) return null; const result = parseBandMessage(value.data, config.roomId); if (!result) fail(502, 'Band returned an invalid queued message.', 'band_message_invalid'); return result; };
  const mark = async (id, role, messageId, processed = false) => {
    const config = configured(id); if (!uuid(messageId)) fail(400, 'Invalid Band message identity.', 'band_message_invalid');
    const value = await request(role, `/chats/${config.roomId}/messages/${messageId}/${processed ? 'processed' : 'processing'}`, { method: 'POST', empty: !processed, mutation: true });
    if (!value) return false;
    if (!uuid(value.data?.id) || value.data.id.toLowerCase() !== messageId.toLowerCase() || value.data.success !== true) fail(503, 'Band message processing state is unknown.', 'band_operation_unknown');
    return true;
  };
  const sessions = new Map();
  const open = (role, handlers = {}) => {
    if (!['allco','huasheng'].some(id => binding(id).configured)) fail(503, 'No project Band room is configured.', 'band_not_configured');
    const existing = sessions.get(role); if (existing && !['stopped','conflict','needs_reconnect'].includes(existing.status().state)) fail(409, 'This project agent already has a local connection.', 'band_runtime_exists');
    const session = createBandSocket({ agent: credentials(role), role, permittedRooms: () => ['allco','huasheng'].map(id => binding(id)).filter(value => value.configured).map(value => value.roomId), socketFactory, clock, handlers }); sessions.set(role,session); return session;
  };
  return { binding, requireConfigured: configured, checkTeam, checkRoster, send, next, claim: (id,role,messageId) => mark(id,role,messageId), processed: (id,role,messageId) => mark(id,role,messageId,true), open, agentId: role => credentials(role).id, status: () => ({ name: 'Band project agents', configured: ['allco','huasheng'].some(id => binding(id).configured), status: ['allco','huasheng'].some(id => binding(id).configured) ? 'Project configured; room review required' : 'Not configured' }) };
}

function createBandSocket({ agent, role, permittedRooms, socketFactory, clock, handlers }) {
  let socket, stopped = false, generation = 0, ref = 0, retry = 0, reconnectTimer, heartbeatTimer, lastSeen = clock.now();
  const rooms = new Set(), joined = new Set(), pending = new Map(), joinRefs = new Map();
  let connectionState = 'starting';
  const report = (state, reason) => { connectionState = state; try { Promise.resolve(handlers.onStatus?.({ role, state, reason: reason || null, at: now() })).catch(()=>{}); } catch {} };
  const invoke = (name, ...args) => { try { Promise.resolve(handlers[name]?.(...args)).catch(() => report('handler_error', 'Project agent handler failed; review the persisted run.')); } catch { report('handler_error', 'Project agent handler failed; review the persisted run.'); } };
  const clearPending = () => { for (const item of pending.values()) { clock.clearTimeout(item.timer); item.reject(new AppError(503, 'Band socket disconnected.', 'band_socket_offline')); } pending.clear(); joined.clear(); joinRefs.clear(); };
  const push = (topic, event) => new Promise((resolve,reject) => {
    if (!socket || socket.readyState !== 1) return reject(new AppError(503,'Band socket is not connected.','band_socket_offline'));
    const id = String(++ref), joinRef = event === 'phx_join' ? id : joinRefs.get(topic) || null;
    const submittedSocket = socket;
    const timer = clock.setTimeout(() => { pending.delete(id); reject(new AppError(503,'Band channel acknowledgement timed out.','band_socket_timeout')); submittedSocket?.terminate?.(); }, 10000);
    pending.set(id,{resolve,reject,timer,topic,event,joinRef});
    try { socket.send(JSON.stringify([joinRef,id,topic,event,{}])); } catch { pending.delete(id); clock.clearTimeout(timer); reject(new AppError(503,'Band frame could not be submitted.','band_socket_offline')); }
  });
  const joinRoom = async roomId => {
    if (stopped || !rooms.has(roomId) || !permittedRooms().includes(roomId) || joined.has(roomId)) return;
    await push('chat_room:'+roomId,'phx_join');
    if (!rooms.has(roomId) || stopped) return;
    joined.add(roomId); invoke('onJoined',roomId);
  };
  const connect = () => {
    if (stopped) return; const own = ++generation; let ended = false, fatal = false;
    const url = new URL('wss://app.band.ai/api/v1/socket/websocket'); url.searchParams.set('vsn','2.0.0'); url.searchParams.set('agent_id',agent.id); url.searchParams.set('on_conflict','reject');
    const disconnected = () => {
      if (ended || own !== generation) return; ended = true; clock.clearInterval(heartbeatTimer); clearPending();
      if (stopped || fatal) return;
      report('offline','Band connection interrupted; bounded reconnect is pending.');
      if (++retry > 5) { stopped = true; report('needs_reconnect','Reconnect the project agents after inspecting the connection.'); return; }
      reconnectTimer = clock.setTimeout(connect,Math.min(30000,1000*2**(retry-1)));
    };
    try { socket = socketFactory(url.toString(), { headers: { 'X-API-Key': agent.key }, followRedirects: false, handshakeTimeout: 10000, maxPayload: 256000 }); }
    catch { disconnected(); return; }
    const activeSocket = socket;
    socket.on('open',async () => {
      if (stopped || own !== generation) return activeSocket.close(); lastSeen = clock.now(); report('joining');
      try { await push('agent_control:'+agent.id,'phx_join'); await push('agent_rooms:'+agent.id,'phx_join'); for (const roomId of rooms) await joinRoom(roomId); retry = 0; report('connected'); }
      catch { activeSocket?.terminate?.(); }
      if (stopped || own !== generation || ended) return;
      heartbeatTimer = clock.setInterval(() => { if (clock.now()-lastSeen>45000) { activeSocket?.terminate?.(); return; } push('phoenix','heartbeat').catch(()=>activeSocket?.terminate?.()); },30000);
    });
    socket.on('message',raw => {
      if (stopped || own !== generation) return;
      let frame; try { if (Buffer.byteLength(raw)>256000) return socket.terminate(); frame=JSON.parse(String(raw)); } catch { return socket.terminate(); }
      if (!Array.isArray(frame)||frame.length!==5||typeof frame[2]!=='string'||typeof frame[3]!=='string'||!frame[4]||typeof frame[4]!=='object') return socket.terminate();
      lastSeen=clock.now();const [joinRef,messageRef,topic,event,payload]=frame;
      if(event==='phx_reply') { const item=pending.get(messageRef); if(!item||item.topic!==topic)return;pending.delete(messageRef);clock.clearTimeout(item.timer);if(payload.status==='ok'){if(item.event==='phx_join')joinRefs.set(topic,item.joinRef);item.resolve(payload.response);}else item.reject(new AppError(503,'Band channel access was refused.','band_channel_refused'));return; }
      if(topic==='agent_control:'+agent.id&&event==='supersede'){fatal=true;stopped=true;report('conflict','This project agent was connected elsewhere. It will not reconnect automatically.');socket.close();clearPending();clock.clearInterval(heartbeatTimer);return;}
      if(topic==='agent_rooms:'+agent.id&&event==='room_removed'&&rooms.has(payload.id)){rooms.delete(payload.id);joined.delete(payload.id);invoke('onRoomRemoved',payload.id);return;}
      const roomId=topic.startsWith('chat_room:')?topic.slice(10):null;
      if(!roomId||!rooms.has(roomId)||!joined.has(roomId)||!permittedRooms().includes(roomId))return;
      if(event==='phx_close'||event==='phx_error'){joined.delete(roomId);invoke('onRoomRemoved',roomId);return;}
      if(event==='message_created'){const message=parseBandMessage(payload,roomId);if(message&&message.senderId!==agent.id&&message.mentions.includes(agent.id))invoke('onMessage',roomId,message);}
    });
    socket.on('unexpected-response',(_request,response)=>{ response.resume?.();if(own!==generation){activeSocket?.terminate?.();return;}if([403,409].includes(response.statusCode)){fatal=true;stopped=true;report('conflict','Band authentication or exclusive agent connection failed. Check the project identities.');}activeSocket?.terminate?.();disconnected(); });
    socket.on('error',()=>{}); socket.on('close',disconnected);
  };
  connect();
  return {
    async join(roomId) { if(!uuid(roomId)||!permittedRooms().includes(roomId)||stopped)fail(409,'Review the configured project room before joining.','band_room_not_allowed');rooms.add(roomId);if(connectionState==='connected')await joinRoom(roomId); },
    async leave(roomId) { rooms.delete(roomId);joined.delete(roomId);if(socket?.readyState===1)await push('chat_room:'+roomId,'phx_leave'); },
    status:()=>({role,state:connectionState,rooms:[...joined]}),
    close(){stopped=true;++generation;clock.clearTimeout(reconnectTimer);clock.clearInterval(heartbeatTimer);clearPending();socket?.close?.();report('stopped');},
  };
}
