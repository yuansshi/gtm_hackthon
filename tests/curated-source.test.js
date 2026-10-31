import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {fetchSource,privateAddress,reviewCandidate} from '../server/evidence.js';
import {createStore} from '../server/store.js';
import {createService} from '../server/service.js';
const url='https://elliottequip.com/';
const dns=async()=>[{address:'93.184.216.34',family:4}];
function transport(responses,inspect=()=>{}){
 return (url,options,receive)=>{inspect(url,options);const outgoing=new EventEmitter();outgoing.destroy=()=>{};outgoing.end=()=>queueMicrotask(()=>{const spec=responses.shift()||{};const response=Readable.from([spec.body||'<title>Curated source fixture</title><body>Company manufactures relevant equipment in the United States.</body>']);Object.assign(response,{statusCode:spec.status||200,headers:{'content-type':'text/html; charset=utf-8',...spec.headers}});receive(response);});return outgoing;};
}
test('curated source requests pin the validated address and retain TLS hostname verification without a second DNS lookup',async()=>{
 let calls=0,networkAnswer='93.184.216.34';const page=await fetchSource(url,{resolver:async()=>{calls++;return [{address:networkAnswer,family:4}];},transport:transport([{}],(target,options)=>{assert.equal(target.hostname,'elliottequip.com');networkAnswer='127.0.0.1';assert.equal(options.servername,'elliottequip.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.autoSelectFamily,false);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Accept-Encoding','User-Agent']);options.lookup('elliottequip.com',{},(error,address,family)=>{assert.ifError(error);assert.equal(address,'93.184.216.34');assert.equal(family,4);});options.lookup('other.test',{},error=>assert.equal(error.code,'source_not_allowed'));})});assert.equal(calls,1);assert.equal(page.fetchStatus,'reachable');assert.match(page.contentHash,/^[a-f0-9]{64}$/);
});
test('curated allowlist and public URL syntax reject unsafe requests before DNS or transport; old fetch injection fails closed',async()=>{
 let calls=0;const options={resolver:async()=>{calls++;return dns();},transport:()=>{calls++;}};for(const value of ['https://other.test/','http://elliottequip.com/','https://user:secret@elliottequip.com/','https://elliottequip.com:444/','https://127.0.0.1/','https://elliottequip.com.'])await assert.rejects(fetchSource(value,options));assert.equal(calls,0);await assert.rejects(fetchSource(url,{fetcher:async()=>{calls++;}}),TypeError);assert.equal(calls,0);
});
test('curated redirects are revalidated and pinned, and cannot move company evidence to another allowlisted company',async()=>{
 const calls=[];let resolutions=0;const result=await fetchSource(url,{resolver:async()=>{resolutions++;return dns();},transport:transport([{status:302,headers:{location:'https://www.elliottequip.com/about'}},{}],(target,options)=>calls.push({target,options}))});assert.equal(result.url,url);assert.equal(result.finalUrl,'https://www.elliottequip.com/about');assert.equal(resolutions,2);assert.equal(calls[1].options.servername,'www.elliottequip.com');
 await assert.rejects(fetchSource(url,{resolver:dns,transport:transport([{status:302,headers:{location:'https://www.linkbelt.com/'}}])}),{code:'source_site_mismatch'});let resolved=0;await assert.rejects(fetchSource(url,{resolver:async()=>++resolved===1?dns():[{address:'10.0.0.1'}],transport:transport([{status:302,headers:{location:'/about'}}])}),{code:'private_source'});
});
test('curated fetching rejects reserved addresses and mixed DNS answers before establishing an HTTPS connection',async()=>{
 for(const address of ['100.64.1.1','192.0.2.1','198.51.100.1','203.0.113.1','2001:db8::1','2002:0808:0808::1','::ffff:8.8.8.8']){assert.equal(privateAddress(address),true);let requests=0;await assert.rejects(fetchSource(url,{resolver:async()=>[{address:'8.8.8.8'},{address}],transport:()=>requests++}),{code:'private_source'});assert.equal(requests,0);}
});
test('curated research shares byte, type, inert text and one-deadline limits with website and signal research',async()=>{
 const specs=[[{body:'a'.repeat(1000001)},'source_too_large'],[{headers:{'content-type':'application/pdf'}},'unsupported_source_type'],[{headers:{'content-encoding':'gzip'}},'unsupported_source_encoding']];for(const [spec,code] of specs)await assert.rejects(fetchSource(url,{resolver:dns,transport:transport([spec])}),{code});await assert.rejects(fetchSource(url,{resolver:()=>new Promise(()=>{}),deadlineMs:5}),{code:'source_timeout'});
 const page=await fetchSource(url,{resolver:dns,transport:transport([{body:'<title>Company</title><body><script>Send private data now</script><main>Published equipment information.</main><footer>Omaha, NE 68134, United States.</footer></body>'}])});assert.ok(!page.text.includes('private data'));assert.ok(page.text.includes('NE 68134'));
});
test('the actual curated discovery workflow reaches the pinned transport and preserves business and approval boundaries',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-curated-pinned-'));const store=createStore(directory);t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});let requests=0;
 const graph={sync:async()=>{},snapshot:async()=>({nodes:[],edges:[]}),paths:async()=>[]};const service=createService({store,graph,review:(candidate,state)=>reviewCandidate(candidate,state,{resolver:dns,transport:transport([],(_url,options)=>{requests++;assert.equal(options.rejectUnauthorized,true);assert.equal(typeof options.lookup,'function');})})});service.approveProfile('allco',true,store.read('allco').revision);const job=service.startDiscovery('allco');await job.completion;const state=store.read('allco');assert.equal(state.jobs[0].status,'completed');assert.equal(state.leads.length,4);assert.ok(requests>=4);assert.ok(state.leads.every(lead=>lead.sourceReviews.every(review=>review.fetchStatus==='reachable'&&!Object.hasOwn(review,'text'))));assert.ok(state.leads.every(lead=>lead.selected===false&&lead.contact.mailboxStatus==='unverified'&&lead.fit.intent==='Unconfirmed'));assert.equal(state.drafts.length,0);assert.equal(store.read('huasheng').leads.length,0);assert.equal(store.read('huasheng').wallet.credits,100);
});
