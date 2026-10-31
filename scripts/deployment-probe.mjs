// Test-only code, passed to the image on stdin. Never included in the runtime image.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.GTM_DEPLOYMENT_SMOKE, '1', 'Use only through the isolated deployment checker.');
const phase = process.env.GTM_SMOKE_PHASE;
const directory = process.env.DATA_DIR;
assert.ok(directory && path.isAbsolute(directory) && !directory.endsWith('/.data'), 'Use an isolated data volume.');
const moduleAt = name => import(pathToFileURL(path.resolve('server',name)).href);
const leadId = 'deployment-fixture';
const expansionPlan={name:'Synthetic forklift equipment OEMs',reason:'Synthetic owner interpretation; technical suitability remains unknown.'};
const assertExpansionPlan=state=>{assert.equal(state.expansionDecisions.forklifts,'accepted');assert.deepEqual(state.expansionAdjustments.forklifts,expansionPlan);};
// Synthetic owner inputs, never supplier prices or verified contract economics.
const commercialPlan = {monetizationModel:'Synthetic manufacturing per order',pricingFramework:'Synthetic quote after drawing review',targetContractValue:'USD 25,000–50,000 per synthetic order'};
const productDescription='Synthetic custom hydraulic cylinders, subject to application review';
const pressureStatement='Synthetic 250 bar target, seal and duty-cycle review pending';
const assertReviewedIntake = state => {for(const [key,value] of Object.entries(commercialPlan))assert.equal(state.commercial[key],value);assert.equal(state.icp.targetTitles,'Synthetic Engineering Director');assert.equal(state.icp.targetSeniority,'Director, Manager');assert.equal(state.company.description,productDescription);assert.deepEqual(state.capabilities.pressure,{value:pressureStatement,status:'unknown'});};

if (phase === 'seed') {
  const {createStore} = await moduleAt('store.js');
  const {scoreAccount} = await moduleAt('evidence.js');
  const store = createStore(directory);
  try {
    for (const id of ['allco','huasheng']) assert.equal(store.read(id).leads.length + store.read(id).drafts.length, 0, 'Refuse to seed a populated workspace.');
    store.mutate('allco', state => {
      state.signalFixture = true;
      const source = 'https://manufacturer.fixture.test/';
      const lead = {id:leadId,businessId:'allco',name:'Synthetic Deployment OEM',domain:'manufacturer.fixture.test',country:'United States',location:'Synthetic US location',industry:'Mobile equipment',tier:'OEM',application:'Synthetic lifting equipment',reason:'Deployment test data only',businesses:['allco'],productFamily:'custom',source,contactSource:source,publicEmail:null,facts:['Synthetic equipment portfolio; not customer research.'],signal:{title:'Synthetic product fixture',kind:'Application',intent:'No buying intent established',source},people:[{name:'Synthetic Engineer',role:'Engineering',relevance:'Fixture role only',source}],selected:false,stage:'Matched',contact:{email:'buyer@manufacturer.fixture.test',mailboxStatus:'unverified'},events:[]};
      lead.fit = scoreAccount(lead,state); state.leads = [lead];
    });
  } finally {store.close();}
  console.log('Isolated synthetic deployment fixture created.');
} else if (phase === 'storage') {
  // Open only after the server/container stops: no concurrent embedded DB owner.
  const {createStore} = await moduleAt('store.js');
  const {createGraph} = await moduleAt('graph.js');
  const store = createStore(directory);
  try {
    const state = store.read('allco');
    assert.equal(state.signalFixture,true);assert.equal(state.wallet.credits,123);
    assertReviewedIntake(state);
    assertExpansionPlan(state);
    assert.equal(state.drafts.length,1);assert.equal(state.drafts[0].status,'simulated');
    assert.equal(state.leads[0].management.ownerName,'Synthetic Sales Owner');
    assert.equal(state.leads[0].management.nextAction.text,'Review synthetic supplier requirements');
    const graph = await createGraph(directory);
    try {
      const snapshot = await graph.snapshot('allco');
      assert.ok(snapshot.nodes.some(n=>n.type==='Company' && n.data.leadId===leadId));
      assert.ok(snapshot.edges.some(e=>e.type==='matched_to'));
      assert.ok(snapshot.edges.some(e=>e.type==='contacted_via'));
      assert.ok(snapshot.edges.some(e=>e.type==='replied_to'));
      assert.ok((await graph.paths('allco')).length>0);
      assert.ok(!JSON.stringify(snapshot).includes('Synthetic Sales Owner'));
      assert.ok(!JSON.stringify(snapshot).includes(commercialPlan.targetContractValue));
      assert.equal((await graph.snapshot('huasheng')).nodes.length,0);
    } finally {await graph.close();}
  } finally {store.close();}
  console.log('SQLite balances/receipts and native Kuzu nodes/paths persisted across shutdown without rebuilding the graph.');
} else {
  assert.ok(['exercise','verify'].includes(phase));
  const origin = new URL(process.env.GTM_SMOKE_URL || 'http://127.0.0.1:3001');
  assert.ok(origin.protocol==='http:' && ['127.0.0.1','localhost'].includes(origin.hostname) && origin.pathname==='/' && !origin.username && !origin.password && !origin.search && !origin.hash,'Probe only an isolated loopback server.');
  const token = process.env.PROJECT_ACCESS_TOKEN;
  assert.ok(token?.length>=32,'Checker needs its ephemeral test token.');
  let cookie='',csrf='';
  const request = async (route, method='GET', data, expected=200, overrides={}) => {
    const response = await fetch(new URL(route,origin),{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie,'x-csrf-token':csrf}:{}),...overrides},...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.equal(response.status,expected,`${method} ${route} status`);
    return response;
  };
  const json = async (...args) => (await request(...args)).json();
  let ready=false;
  for(let i=0;i<80;i++) {
    try {const r=await fetch(new URL('/healthz',origin),{signal:AbortSignal.timeout(500),redirect:'error'});if(r.ok){assert.deepEqual(await r.json(),{status:'ok'});ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Server did not become ready.');
  await request('/api/businesses/allco','GET',undefined,401);
  await request('/api/session','POST',{accessToken:'incorrect-test-token'},401);
  const session=await request('/api/session','POST',{accessToken:token});cookie=session.headers.get('set-cookie').split(';')[0];csrf=(await session.json()).csrf;
  const html=await (await request('/')).text();assert.match(html,/id="root"/);
  const asset=html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];assert.ok(asset);assert.match((await request(asset)).headers.get('content-type'),/javascript/);
  const status=await json('/api/status');assert.match(status.graph,/Kuzu/);assert.ok(status.integrations.every(i=>!i.configured&&!i.connected));
  let state=await json('/api/businesses/allco');assert.equal(state.signalFixture,true,'Refuse to mutate a non-fixture workspace.');assert.equal(state.leads[0].id,leadId);
  if(phase==='exercise') {
    assert.equal(state.wallet.credits,100);assert.equal(state.drafts.length,0);
    state=await json('/api/businesses/allco/assistant/intake','POST',{message:`Target United States OEMs with 50-500 employees.\nProduct description: ${productDescription}\nRated working pressure: ${pressureStatement}\nMonetization model: ${commercialPlan.monetizationModel}\nPricing framework: ${commercialPlan.pricingFramework}\nTarget contract value: ${commercialPlan.targetContractValue}\nTarget job titles: Synthetic Engineering Director\nTarget seniority: Director, Manager`,mode:'local',requestId:randomUUID(),acknowledgedExternalProcessing:false,revision:state.revision});
    const run=state.assistantRuns.find(r=>r.id===state.activeAssistantRunId);assert.ok(run.result.suggestions.length>0);
    state=await json(`/api/businesses/allco/assistant/intake/${run.id}/review`,'POST',{revision:state.revision,acknowledged:true,decisions:run.result.suggestions.map(s=>({field:s.field,decision:'accepted'}))});
    assert.match(state.icp.regions,/United States/);assert.ok(state.icp.segments.some(s=>/OEM|manufacturer/i.test(s)));
    assertReviewedIntake(state);
    const profile=Object.fromEntries(['company','productFamilies','capabilities','commercial','icp','expansionDecisions'].map(key=>[key,state[key]]));profile.expansionDecisions={...profile.expansionDecisions,forklifts:'accepted'};profile.expansionAdjustments={forklifts:expansionPlan};
    state=await json('/api/businesses/allco/profile','PUT',{profile,revision:state.revision});assertExpansionPlan(state);
    state=await json('/api/businesses/allco/approve','POST',{acknowledged:true,revision:state.revision});assert.equal(state.approved,true);
    state=await json(`/api/businesses/allco/leads/${leadId}/selection`,'PATCH',{selected:true});
    const graph=await json('/api/businesses/allco/graph/query','POST',{});assert.match(graph.engine,/Kuzu/);assert.ok(graph.paths.length>0);assert.ok(graph.edges.some(e=>e.type==='matched_to'));
    state=await json(`/api/businesses/allco/leads/${leadId}/drafts`,'POST',{channel:'email',variant:'A',sequenceStep:0,generation:'template',messageBrief:{audience:'engineering',tone:'technical',valueProposition:'application_fit',maxWords:180,cta:'technical_review'}});
    let draft=state.drafts.find(d=>d.id===state.activeDraftId);assert.equal(draft.status,'draft');assert.equal(draft.approvedHash,null);
    await request(`/api/businesses/allco/drafts/${draft.id}/simulate`,'POST',{},409);
    await request(`/api/businesses/allco/drafts/${draft.id}/approve`,'POST',{acknowledged:true,version:draft.version},403,{'x-csrf-token':''});
    state=await json(`/api/businesses/allco/drafts/${draft.id}/approve`,'POST',{acknowledged:true,version:draft.version,deliveryMode:'dry_run'});
    state=await json(`/api/businesses/allco/drafts/${draft.id}/simulate`,'POST',{});
    assert.equal(state.wallet.credits,98);assert.equal(state.metrics.simulated,1);assert.equal(state.metrics.liveAccepted,0);
    draft=state.drafts[0];assert.equal(draft.status,'simulated');assert.equal(draft.messageBrief.valueProposition,'application_fit');
    state=await json(`/api/businesses/allco/leads/${leadId}/outcomes`,'POST',{requestId:randomUUID(),revision:state.revision,kind:'demo',stage:'Replied',occurredAt:new Date().toISOString(),note:'Synthetic deployment reply; no external outreach or customer response.',draftId:draft.id,respondent:{name:'Synthetic Engineer',source:'https://manufacturer.fixture.test/'},updateStage:true,acknowledged:true});
    assert.equal(state.metrics.replied,1);assert.equal(state.metrics.replyRate,1);assert.equal(state.leads[0].stage,'Replied');
    state=await json(`/api/businesses/allco/leads/${leadId}/management`,'PATCH',{requestId:randomUUID(),revision:state.revision,expectedVersion:0,ownerName:'Synthetic Sales Owner',nextAction:{text:'Review synthetic supplier requirements',dueAt:new Date(Date.now()+86400000).toISOString(),status:'open'}});
    assert.equal(state.leads[0].management.version,1);assert.equal(state.wallet.credits,98);assert.equal(state.leads[0].stage,'Replied');
    const reload={packId:'custom',customCredits:25,requestId:randomUUID()};
    state=await json('/api/businesses/allco/billing/reloads','POST',reload);state=await json('/api/businesses/allco/billing/reloads','POST',reload);assert.equal(state.wallet.credits,123);
    assert.equal(state.delivery.attempts.length,0);assert.equal(state.band.runs.length,0);
    console.log('Authenticated intake → native graph → draft → exact HITL → dry run → attributed demo reply and idempotent credit reload passed.');
  } else {
    assert.equal(state.wallet.credits,123);assert.equal(state.drafts.length,1);assert.equal(state.drafts[0].status,'simulated');assert.equal(state.leads[0].stage,'Replied');assert.equal(state.metrics.simulated,1);assert.equal(state.metrics.replied,1);
    assert.equal(state.leads[0].management.ownerName,'Synthetic Sales Owner');assert.equal(state.leads[0].management.nextAction.status,'open');
    assertReviewedIntake(state);assertExpansionPlan(state);
    const before=state.wallet.credits;state=await json(`/api/businesses/allco/drafts/${state.drafts[0].id}/simulate`,'POST',{});assert.equal(state.wallet.credits,before);assert.equal(state.metrics.simulated,1);
    console.log('Fresh server sessions read persisted campaign state; replay does not create a second receipt/debit.');
  }
  const other=await json('/api/businesses/huasheng');assert.equal(other.leads.length,0);assert.equal(other.drafts.length,0);assert.equal(other.wallet.credits,100);
  console.log('Business isolation and disabled-provider status verified.');
}
