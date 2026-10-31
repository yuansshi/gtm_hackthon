import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createBandProvider, bandRoles, parseBandMessage } from '../server/band-provider.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type':'application/json' } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeClock() {
  let value=1000000,id=0;const timers=new Map();
  const schedule=(fn,ms,interval=0)=>{const key=++id;timers.set(key,{fn,at:value+ms,interval});return key;};
  return { now:()=>value,setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:key=>timers.delete(key),setInterval:(fn,ms)=>schedule(fn,ms,ms),clearInterval:key=>timers.delete(key),advance(ms){const end=value+ms;for(let i=0;i<1000;i++){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;value=next[1].at;timers.delete(next[0]);if(next[1].interval)timers.set(next[0],{...next[1],at:value+next[1].interval});next[1].fn();}value=end;} };
}
class FakeSocket extends EventEmitter {
  constructor(url,options){super();this.url=url;this.options=options;this.readyState=0;this.sent=[];this.autoReply=true;}
  open(){this.readyState=1;this.emit('open');}
  send(raw){const f=JSON.parse(raw);this.sent.push(f);if(this.autoReply)this.emit('message',Buffer.from(JSON.stringify([f[0],f[1],f[2],'phx_reply',{status:'ok',response:{}}])));}
  receive(topic,event,payload){this.emit('message',Buffer.from(JSON.stringify([null,null,topic,event,payload])));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
  terminate(){this.close();}
}
function setup(overrides={}) {
  const ids=Object.fromEntries(bandRoles.map(role=>[role,randomUUID()])),keys=Object.fromEntries(bandRoles.map((role,i)=>[role,'band_a_'+String.fromCharCode(65+i).repeat(32)])),roomId=randomUUID();
  const env={PROJECT_BAND_ENABLED:'true',PROJECT_BAND_ALLCO_ENABLED:'true',PROJECT_BAND_ALLCO_ROOM_ID:roomId};
  for(const role of bandRoles){env['PROJECT_BAND_'+role.toUpperCase()+'_AGENT_ID']=ids[role];env['PROJECT_BAND_'+role.toUpperCase()+'_API_KEY']=keys[role];}
  const participants=bandRoles.map(role=>({id:ids[role],type:'Agent',status:'active',name:role,handle:'project/'+role}));
  const calls=[],sockets=[],clock=fakeClock(),control={};
  const fetcher=async(url,options)=>{calls.push({url,options});if(control.fetch)return control.fetch(url,options);const role=bandRoles.find(role=>keys[role]===options.headers['X-API-Key']);if(url.pathname.endsWith('/me'))return json({data:{id:ids[role],name:role,handle:'project/'+role}});if(url.pathname.endsWith('/participants'))return json({data:participants});throw Error('Unexpected fixture endpoint');};
  const factory=(url,options)=>{const socket=new FakeSocket(url,options);sockets.push(socket);return socket;};
  const provider=createBandProvider({env:{...env,...overrides},fetcher,socketFactory:factory,clock});return{provider,env,ids,keys,roomId,participants,calls,sockets,clock,control};
}
const message = (x, patch={}) => ({id:randomUUID(),sender_id:x.ids.planner,sender_type:'Agent',message_type:'text',content:'GTM fixture handoff',metadata:{mentions:[{id:x.ids.builder,name:'builder'}]},inserted_at:new Date().toISOString(),...patch});

test('Band is off without designated agent keys and enabled business rooms, with no network or sockets',()=>{
  for(const env of [{},{BAND_API_KEY:'band_a_'+'A'.repeat(32),PROJECT_BAND_ENABLED:'true'},{PROJECT_BAND_ENABLED:'false'}]){
    let calls=0;const p=createBandProvider({env,fetcher:()=>{calls++;},socketFactory:()=>{calls++;}});assert.equal(p.status().configured,false);assert.throws(()=>p.open('planner'),{code:'band_not_configured'});assert.equal(calls,0);
  }
  for(const key of ['dummy-not-connected','band_u_'+'A'.repeat(32),'band_a_placeholder'+'A'.repeat(32)]){const x=setup({PROJECT_BAND_PLANNER_API_KEY:key});assert.equal(x.provider.binding('allco').configured,false);assert.equal(x.calls.length,0);}
  const x=setup({PROJECT_BAND_ALLCO_ENABLED:'false'});assert.throws(()=>x.provider.open('planner'),{code:'band_not_configured'});assert.equal(x.sockets.length,0);
});
test('four project IDs and keys must be distinct, and enabled businesses cannot share a room',()=>{
  const x=setup();for(const patch of [{PROJECT_BAND_BUILDER_AGENT_ID:x.ids.planner},{PROJECT_BAND_BUILDER_API_KEY:x.keys.planner},{PROJECT_BAND_HUASHENG_ENABLED:'true',PROJECT_BAND_HUASHENG_ROOM_ID:x.roomId}]){const p=createBandProvider({env:{...x.env,...patch}});assert.equal(p.binding('allco').configured,false);}
  assert.equal(x.provider.binding('huasheng').configured,false);assert.equal(x.provider.binding('allco').configured,true);
});
test('team verification matches all four identities and consistent dedicated-room membership using fixed header-auth endpoints',async()=>{
  const x=setup();x.participants.push({id:randomUUID(),type:'User',status:'active',name:'Project owner',handle:'owner'});const proof=await x.provider.checkTeam('allco');
  assert.equal(proof.roles.length,4);assert.equal(proof.participants.length,5);assert.equal(proof.roomId,x.roomId);assert.equal(proof.bindingHash,x.provider.binding('allco').hash);assert.equal(x.calls.length,8);
  assert.ok(x.calls.every(({url,options})=>url.origin==='https://app.band.ai'&&!url.search&&options.redirect==='error'&&options.headers['X-API-Key'].startsWith('band_a_')));
  assert.ok(!JSON.stringify(proof).includes(x.keys.planner));assert.equal((await x.provider.checkRoster('allco')).hash,proof.rosterHash);
});
test('foreign agents, inactive/duplicate members and mismatched credentials cannot verify a room',async()=>{
  for(const mutate of [x=>x.participants.push({id:randomUUID(),type:'Agent',status:'active',name:'Other',handle:'other/agent'}),x=>x.participants[0].status='inactive',x=>x.participants.push(x.participants[0])]){const x=setup();mutate(x);await assert.rejects(x.provider.checkTeam('allco'),{code:/band_roster/});}
  const x=setup();x.control.fetch=()=>json({data:{id:123,name:'Wrong',handle:'wrong'}});await assert.rejects(x.provider.checkTeam('allco'),{code:'band_identity_mismatch'});
});
test('roster checks detect changes across identities instead of confirming a mixed room snapshot',async()=>{
  const x=setup();x.control.fetch=(url,options)=>url.pathname.endsWith('/me')?json({data:{id:x.ids[bandRoles.find(role=>x.keys[role]===options.headers['X-API-Key'])],name:'Project agent',handle:'project/agent'}}):json({data:options.headers['X-API-Key']===x.keys.planner?x.participants:[...x.participants,{id:randomUUID(),type:'User',status:'active',name:'New reader',handle:'new-reader'}]});
  await assert.rejects(x.provider.checkTeam('allco'),{code:'band_roster_mismatch'});
});
test('one handoff posts one bounded text message with one exact mention and records the provider ID',async()=>{
  const x=setup(),id=randomUUID();x.control.fetch=()=>json({data:{id,success:true,recipients:[{id:x.ids.builder,handle:'project/builder',name:'Builder'}]}},201);
  const result=await x.provider.send('allco','planner','builder','GTM fixture handoff');assert.equal(result.id,id);assert.equal(x.calls.length,1);const sent=JSON.parse(x.calls[0].options.body);assert.deepEqual(sent,{message:{content:'GTM fixture handoff',mentions:[{id:x.ids.builder}]}});assert.equal(x.calls[0].url.pathname,`/api/v1/agent/chats/${x.roomId}/messages`);
  await assert.rejects(x.provider.send('allco','planner','planner','Self'),{code:'band_invalid_handoff'});await assert.rejects(x.provider.send('allco','planner','builder','x'.repeat(24001)),{code:'band_invalid_handoff'});assert.equal(x.calls.length,1);
});
test('rejected versus ambiguous handoffs are distinct and neither automatically retries or exposes provider errors',async()=>{
  for(const [status,code] of [[401,'band_operation_rejected'],[422,'band_operation_rejected'],[503,'band_operation_unknown']]){const x=setup();x.control.fetch=()=>json({error:x.keys.planner},status);await assert.rejects(x.provider.send('allco','planner','builder','Test'),error=>error.code===code&&!error.message.includes(x.keys.planner));assert.equal(x.calls.length,1);}
  for(const respond of [()=>{throw Error('secret body');},()=>json({data:{id:randomUUID(),success:true,recipients:[{id:123}]}})]){const x=setup();x.control.fetch=respond;await assert.rejects(x.provider.send('allco','planner','builder','Test'),{code:'band_operation_unknown'});assert.equal(x.calls.length,1);}
});
test('next/claim/processed follow at-least-once processing semantics including a refused claim',async()=>{
  const x=setup(),raw=message(x);x.control.fetch=url=>url.pathname.endsWith('/next')?json({data:{...raw,chat_room_id:x.roomId}}):json({data:{id:raw.id,success:true,status:'processing'}});
  const next=await x.provider.next('allco','builder');assert.equal(next.id,raw.id);assert.equal(await x.provider.claim('allco','builder',raw.id),true);assert.equal(await x.provider.processed('allco','builder',raw.id),true);
  x.control.fetch=()=>new Response(null,{status:204});assert.equal(await x.provider.next('allco','builder'),null);assert.equal(await x.provider.claim('allco','builder',raw.id),false);
});
test('malformed queued messages, attachments, off-room IDs and oversized lookup bodies are rejected',async()=>{
  const x=setup();for(const patch of [{chat_room_id:randomUUID()},{content:'x'.repeat(24001)},{metadata:{mentions:[{id:'invalid'}]}},{attachments:[{id:randomUUID()}]}])assert.equal(parseBandMessage(message(x,patch),x.roomId),null);
  x.control.fetch=()=>json({data:message(x,{sender_id:12})});await assert.rejects(x.provider.next('allco','builder'),{code:'band_message_invalid'});
  x.control.fetch=()=>json({data:'x'.repeat(200001)});await assert.rejects(x.provider.checkRoster('allco'),{code:'band_lookup_failed'});
});
test('socket keys stay in headers, existing connections are protected, and only explicitly joined rooms deliver mentions',async()=>{
  const x=setup(),received=[],joined=[];const session=x.provider.open('builder',{onMessage:(...value)=>received.push(value),onJoined:id=>joined.push(id)});await session.join(x.roomId);assert.throws(()=>x.provider.open('builder'),{code:'band_runtime_exists'});
  const socket=x.sockets[0],url=new URL(socket.url);assert.equal(url.origin,'wss://app.band.ai');assert.equal(url.searchParams.get('on_conflict'),'reject');assert.equal(url.searchParams.has('api_key'),false);assert.equal(socket.options.headers['X-API-Key'],x.keys.builder);assert.equal(socket.options.followRedirects,false);
  socket.open();await flush();assert.deepEqual(joined,[x.roomId]);assert.equal(session.status().state,'connected');assert.ok(socket.sent.some(frame=>frame[2]==='agent_control:'+x.ids.builder));
  socket.receive('chat_room:'+randomUUID(),'message_created',message(x));socket.receive('chat_room:'+x.roomId,'message_created',message(x,{metadata:{mentions:[{id:x.ids.reviewer}]}}));socket.receive('chat_room:'+x.roomId,'message_created',message(x,{sender_id:x.ids.builder}));socket.receive('chat_room:'+x.roomId,'message_created',message(x));await flush();assert.equal(received.length,1);assert.equal(received[0][0],x.roomId);
  await assert.rejects(session.join(randomUUID()),{code:'band_room_not_allowed'});session.close();x.clock.advance(120000);assert.equal(x.sockets.length,1);
});
test('socket heartbeats, interrupted reconnect and room catch-up notifications retain one role identity',async()=>{
  const x=setup(),joins=[];const session=x.provider.open('builder',{onJoined:id=>joins.push(id)});await session.join(x.roomId);x.sockets[0].open();await flush();x.clock.advance(30000);await flush();assert.ok(x.sockets[0].sent.some(frame=>frame[2]==='phoenix'&&frame[3]==='heartbeat'));
  x.sockets[0].close();x.clock.advance(1000);assert.equal(x.sockets.length,2);x.sockets[1].open();await flush();assert.deepEqual(joins,[x.roomId,x.roomId]);assert.equal(new URL(x.sockets[1].url).searchParams.get('agent_id'),x.ids.builder);session.close();
});
test('superseded and rejected-auth/conflict sockets stop instead of displacing an existing runtime',async()=>{
  for(const code of [403,409]){const x=setup(),session=x.provider.open('planner');x.sockets[0].emit('unexpected-response',{}, {statusCode:code,resume(){}});x.clock.advance(120000);assert.equal(x.sockets.length,1);assert.equal(session.status().state,'conflict');session.close();}
  const x=setup(),session=x.provider.open('planner');x.sockets[0].open();await flush();x.sockets[0].receive('agent_control:'+x.ids.planner,'supersede',{retryable:false});x.clock.advance(120000);assert.equal(x.sockets.length,1);assert.equal(session.status().state,'conflict');session.close();
});
test('room removal suspends message delivery and channel timeout reconnects without leaking message content',async()=>{
  const x=setup(),removed=[],received=[],session=x.provider.open('builder',{onRoomRemoved:id=>removed.push(id),onMessage:(...args)=>received.push(args)});await session.join(x.roomId);x.sockets[0].open();await flush();x.sockets[0].receive('agent_rooms:'+x.ids.builder,'room_removed',{id:x.roomId});x.sockets[0].receive('chat_room:'+x.roomId,'message_created',message(x));assert.deepEqual(removed,[x.roomId]);assert.equal(received.length,0);session.close();
  const y=setup(),next=y.provider.open('builder');y.sockets[0].autoReply=false;y.sockets[0].open();y.clock.advance(10000);await flush();y.clock.advance(1000);assert.equal(y.sockets.length,2);next.close();
});
