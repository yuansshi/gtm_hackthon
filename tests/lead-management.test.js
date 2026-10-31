import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,initialRuntime} from '../server/store.js';
import {createService} from '../server/service.js';
import {createGraph} from '../server/graph.js';
import {createApp} from '../server/app.js';
import {researchCatalog} from '../server/catalog.js';
import {scoreAccount} from '../server/evidence.js';
import {graphContextKey} from '../src/graph-context.js';
import {managementOf,followupState,matchesFollowup} from '../src/followups.js';
import {bandFixture} from './helpers/band-fixture.js';
const graph={sync:async()=>{},snapshot:async()=>({nodes:[],edges:[]}),paths:async()=>[]};
async function fixture(t,options={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-management-')),store=createStore(directory);
  const service=createService({store,graph,...options});
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  for(const id of ['allco','huasheng']){store.mutate(id,state=>{state.icp.regions='United States';state.icp.segments=['Equipment manufacturer (OEM)'];state.icp.motion='oem';});service.approveProfile(id,true,store.read(id).revision);}
  const seed=()=>store.mutate('allco',state=>{state.leads=[{...structuredClone(researchCatalog[0]),name:'Synthetic Follow-up Buyer',fit:scoreAccount(researchCatalog[0],state),selected:true,stage:'Matched',events:[],contact:{email:'buyer@fixture.test'}}];});seed();
  const input=(patch={})=>({requestId:randomUUID(),revision:store.read('allco').revision,expectedVersion:managementOf(store.read('allco').leads[0]).version,ownerName:'Alex',nextAction:{text:'Review supplier requirements',dueAt:'2026-10-31T12:34:56.789Z',status:'open'},...patch});
  return{directory,store,service,input,seed};
}
test('owner, due task and completion are free manual records without stage progression or message approval changes',async t=>{
  const{store,service,input}=await fixture(t),id=service.draft('allco','elliott');service.approveDraft('allco',id,true,1);const before=store.read('allco'),key=graphContextKey(before);
  let state=service.manageLead('allco','elliott',input());assert.equal(state.leads[0].management.ownerName,'Alex');assert.equal(state.leads[0].management.version,1);assert.equal(state.leads[0].management.history[0].actor,'You');assert.equal(state.wallet.credits,100);assert.equal(state.leads[0].stage,'Matched');assert.deepEqual(store.read('allco').drafts,before.drafts);assert.equal(graphContextKey(store.read('allco')),key);
  const task=state.leads[0].management.nextAction;state=service.manageLead('allco','elliott',input({nextAction:{text:task.text,dueAt:task.dueAt,status:'completed'}}));assert.equal(state.leads[0].management.nextAction.id,task.id);assert.ok(state.leads[0].management.nextAction.completedAt);assert.equal(state.metrics.contacted,0);assert.equal(state.wallet.credits,100);
});
test('reopening and clearing a task preserve bounded history while an explicit unassignment overrides a legacy owner label',async t=>{
  const{store,service,input}=await fixture(t);store.mutate('allco',s=>{s.leads[0].owner='Legacy owner';});
  let state=service.manageLead('allco','elliott',input({ownerName:'',nextAction:null}));assert.equal(managementOf(state.leads[0]).ownerName,'');assert.equal(followupState(state.leads[0]),'none');
  state=service.manageLead('allco','elliott',input({nextAction:{text:'Review',dueAt:null,status:'completed'}}));const task=state.leads[0].management.nextAction;
  state=service.manageLead('allco','elliott',input({nextAction:{text:'Review',dueAt:null,status:'open'}}));assert.equal(state.leads[0].management.nextAction.id,task.id);assert.equal(state.leads[0].management.nextAction.completedAt,null);
  for(let i=0;i<22;i++)state=service.manageLead('allco','elliott',input({ownerName:'Owner '+i}));assert.equal(state.leads[0].management.history.length,20);assert.equal(state.wallet.credits,100);
});
test('same-ID replay never re-applies an old owner or adds activity and rejects a different intent',async t=>{
  const{store,service,input}=await fixture(t),first=input();service.manageLead('allco','elliott',first);service.manageLead('allco','elliott',input({ownerName:'Blair'}));const before=store.read('allco');
  const state=service.manageLead('allco','elliott',first);assert.equal(state.leads[0].management.ownerName,'Blair');assert.deepEqual(store.read('allco'),before);
  assert.throws(()=>service.manageLead('allco','elliott',{...first,ownerName:'Different'}),{code:'management_request_conflict'});assert.deepEqual(store.read('allco'),before);
});
test('concurrent edits and a reset/recreated account reject old work instead of restoring stale follow-ups',async t=>{
  const{store,service,input,seed}=await fixture(t),old=input();service.manageLead('allco','elliott',input());const state=store.read('allco');
  assert.throws(()=>service.manageLead('allco','elliott',old),{code:'revision_conflict'});assert.deepEqual(store.read('allco'),state);
  assert.throws(()=>service.manageLead('allco','elliott',input({expectedVersion:0})),{code:'stale_lead_management'});
  store.mutate('allco',s=>{const revision=s.revision;Object.assign(s,initialRuntime('allco'),{revision});});seed();
  assert.throws(()=>service.manageLead('allco','elliott',old),{code:'revision_conflict'});assert.equal(store.read('allco').leads[0].management,undefined);
});
test('invalid and injected task inputs do not mutate state or debit credits; business IDs stay scoped',async t=>{
  const{store,service,input}=await fixture(t),before=store.read('allco');
  for(const patch of [{ownerName:'x'.repeat(81)},{ownerName:null},{nextAction:{text:' ',dueAt:null,status:'open'}},{nextAction:{text:'Review',dueAt:'bad date',status:'open'}},{nextAction:{text:'Review',dueAt:'2026-10-31T12:00:00Z',status:'open'}},{nextAction:{text:'Review',dueAt:null,status:'sent'}},{approved:true}])assert.throws(()=>service.manageLead('allco','elliott',input(patch)),{code:'invalid_lead_management'});
  assert.throws(()=>service.manageLead('huasheng','elliott',input()),{code:'lead_not_found'});assert.deepEqual(store.read('allco'),before);assert.equal(store.read('huasheng').wallet.credits,100);
});
test('research refresh preserves local ownership/tasks and source proposals cannot assign new account owners',async t=>{
  const{store,service,input}=await fixture(t,{review:async(candidate,state)=>({...candidate,fit:scoreAccount(candidate,state),selected:false,stage:'Matched',events:[],management:{version:999,ownerName:'Source-injected owner'},owner:'Source-injected owner'})});
  service.manageLead('allco','elliott',input());const before=store.read('allco').leads[0].management,job=service.startDiscovery('allco');await job.completion;
  assert.equal(store.read('allco').jobs[0].status,'completed');assert.deepEqual(store.read('allco').leads.find(l=>l.id==='elliott').management,before);assert.ok(store.read('allco').leads.filter(l=>l.id!=='elliott').every(l=>!l.management&&!l.owner));
});
test('private owner and task text stay outside model payloads and native graph results',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'gtm-management-graph-')),native=await createGraph(dir);t.after(async()=>{await native.close();await rm(dir,{recursive:true,force:true});});let context;
  const model={status:()=>({configured:true}),requireConfigured:()=>{},draft:async input=>{context=input.context;return{value:{subject:'Supplier qualification',body:'Review requirements [1] '+researchCatalog[0].source+' [2] https://www.allcohydraulic.com/',claims:[{text:'Account source',sourceUrl:researchCatalog[0].source}],qualificationQuestions:['What requirements apply?']},metadata:{model:'fixture',usage:null}};}};
  const{store,service,input}=await fixture(t,{graph:native,model});service.manageLead('allco','elliott',input({ownerName:'PRIVATE_OWNER_MARKER',nextAction:{text:'PRIVATE_FOLLOWUP_MARKER',dueAt:null,status:'open'}}));
  const graphResult=await service.graphView('allco');assert.doesNotMatch(JSON.stringify(graphResult),/PRIVATE_OWNER_MARKER|PRIVATE_FOLLOWUP_MARKER/);
  await service.draftWithModel('allco','elliott',{channel:'email',variant:'A',sequenceStep:0,requestId:randomUUID(),acknowledgedExternalProcessing:true,revision:store.read('allco').revision});assert.doesNotMatch(JSON.stringify(context),/PRIVATE_OWNER_MARKER|PRIVATE_FOLLOWUP_MARKER/);
});
test('HTTP management requires authentication/CSRF, strict fields and the current account version',async t=>{
  const{store,service,input}=await fixture(t),server=createApp({store,service,serveStatic:false}).listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port;
  const route=root+'/api/businesses/allco/leads/elliott/management',send=(body,headers={})=>fetch(route,{method:'PATCH',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});assert.equal((await send(input())).status,401);
  const session=await fetch(root+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();assert.equal((await send(input(),{cookie})).status,403);
  const headers={cookie,'x-csrf-token':csrf};assert.equal((await send(input({approved:true}),headers)).status,400);const result=await send(input(),headers);assert.equal(result.status,200);assert.equal((await result.json()).leads[0].management.ownerName,'Alex');
});
test('follow-up cohort filters keep overdue open, completed tasks separate and unassigned labels unambiguous',()=>{
  const lead={management:{ownerName:'all',nextAction:{text:'Review',dueAt:'2026-10-31T12:00:00.000Z',status:'open'}}},clock=Date.parse('2026-10-31T13:00:00Z');
  assert.equal(followupState(lead,clock),'overdue');assert.equal(matchesFollowup(lead,'name:all','open',clock),true);assert.equal(matchesFollowup(lead,'unassigned','all',clock),false);
  assert.equal(matchesFollowup({...lead,management:{...lead.management,nextAction:{...lead.management.nextAction,status:'completed'}}},'all','overdue',clock),false);
  assert.equal(matchesFollowup({},'unassigned','none',clock),true);assert.equal(followupState({management:{nextAction:{text:'Review',dueAt:null,status:'open'}}},clock),'open');assert.equal(followupState(lead,Date.parse(lead.management.nextAction.dueAt)),'open');
});
test('saved follow-up state, request IDs and exact due instants persist through store close/reopen',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'gtm-management-persist-'));t.after(()=>rm(dir,{recursive:true,force:true}));let store=createStore(dir);store.mutate('allco',s=>{s.leads=[{...researchCatalog[0],management:undefined,events:[],stage:'Matched',contact:{},fit:scoreAccount(researchCatalog[0],s)}];});let service=createService({store,graph});const request={requestId:randomUUID(),revision:store.read('allco').revision,expectedVersion:0,ownerName:'Alex',nextAction:{text:'Review',dueAt:'2026-10-31T12:34:56.789Z',status:'open'}};service.manageLead('allco','elliott',request);const before=store.read('allco');store.close();store=createStore(dir);try{service=createService({store,graph});assert.deepEqual(store.read('allco'),before);service.manageLead('allco','elliott',request);assert.deepEqual(store.read('allco'),before);}finally{store.close();}
});

test('private follow-ups do not enter the exact Band public packet or alter its approved context fingerprint',async t=>{
  const x=await bandFixture(t);await x.enable();const options=x.input(),before=x.service.planBandDraft('allco',options);
  x.service.manageLead('allco','elliott',{requestId:randomUUID(),revision:x.store.read('allco').revision,expectedVersion:0,ownerName:'PRIVATE_BAND_OWNER',nextAction:{text:'PRIVATE_BAND_TASK',dueAt:null,status:'open'}});
  const after=x.service.planBandDraft('allco',options);assert.equal(after.previewHash,before.previewHash);assert.doesNotMatch(JSON.stringify(after.packet),/PRIVATE_BAND_OWNER|PRIVATE_BAND_TASK/);assert.equal(x.messages.length,0);assert.equal(x.store.read('allco').wallet.credits,100);
});
