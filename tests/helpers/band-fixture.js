import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createBandProvider, bandRoles } from '../../server/band-provider.js';
import { createModelProvider } from '../../server/model.js';
import { createStore } from '../../server/store.js';
import { createService } from '../../server/service.js';
import { researchCatalog } from '../../server/catalog.js';
import { defaultMessageBrief } from '../../src/message-brief.js';

const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
export const flush = () => new Promise(resolve=>setImmediate(resolve));
export async function bandFixture(t,{model=false}={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'gtm-band-fixture-')),store=createStore(directory);
  const ids=Object.fromEntries(bandRoles.map(role=>[role,randomUUID()])),keys=Object.fromEntries(bandRoles.map((role,index)=>[role,'band_a_'+String.fromCharCode(65+index).repeat(32)])),rooms={allco:randomUUID(),huasheng:randomUUID()};
  const env={PROJECT_BAND_ENABLED:'true',PROJECT_BAND_ALLCO_ENABLED:'true',PROJECT_BAND_ALLCO_ROOM_ID:rooms.allco,PROJECT_BAND_HUASHENG_ENABLED:'true',PROJECT_BAND_HUASHENG_ROOM_ID:rooms.huasheng};
  for(const role of bandRoles){env['PROJECT_BAND_'+role.toUpperCase()+'_AGENT_ID']=ids[role];env['PROJECT_BAND_'+role.toUpperCase()+'_API_KEY']=keys[role];}
  const participants=bandRoles.map(role=>({id:ids[role],type:'Agent',status:'active',name:role,handle:'project/'+role}));
  const calls=[],messages=[],sockets=new Map(),processed=new Set(),control={autoDeliver:true,postStatus:201,acceptUnknown:false,refuseClaim:false,ackUnknown:false,modelCalls:0,modelGate:null,invalidModel:false,missingUsage:false};
  const emit=message=>{for(const mention of message.metadata.mentions){const role=bandRoles.find(role=>ids[role]===mention.id),socket=sockets.get(role);if(socket?.readyState===1)socket.emit('message',Buffer.from(JSON.stringify([null,null,'chat_room:'+message.chat_room_id,'message_created',message])));}};
  const fetcher=async(url,options)=>{
    const role=bandRoles.find(role=>keys[role]===options.headers['X-API-Key']);calls.push({path:url.pathname,method:options.method,role});
    if(url.pathname.endsWith('/me'))return json({data:{id:ids[role],name:role,handle:'project/'+role}});
    if(url.pathname.endsWith('/participants'))return json({data:participants});
    const roomId=url.pathname.match(/\/chats\/([^/]+)/)?.[1];
    if(options.method==='POST'&&url.pathname.endsWith('/messages')){
      if(control.postStatus>=400&&!control.acceptUnknown)return json({error:'Fixture rejection'},control.postStatus);
      const payload=JSON.parse(options.body).message,message={id:randomUUID(),chat_room_id:roomId,sender_id:ids[role],sender_type:'Agent',message_type:'text',content:payload.content,metadata:{mentions:payload.mentions},inserted_at:new Date().toISOString()};messages.push(message);if(control.autoDeliver)queueMicrotask(()=>emit(message));
      return control.postStatus>=400?json({error:'Fixture ambiguous result'},control.postStatus):json({data:{id:message.id,success:true,recipients:payload.mentions}},201);
    }
    if(url.pathname.endsWith('/next')){const message=messages.find(message=>message.chat_room_id===roomId&&message.metadata.mentions.some(mention=>mention.id===ids[role])&&!processed.has(role+':'+message.id));return message?json({data:message}):new Response(null,{status:204});}
    if(options.method==='POST'&&/\/(processing|processed)$/.test(url.pathname)){
      const messageId=url.pathname.split('/').at(-2);if(url.pathname.endsWith('/processing')&&control.refuseClaim){control.refuseClaim=false;return new Response(null,{status:204});}
      if(url.pathname.endsWith('/processed')){if(control.ackUnknown){control.ackUnknown=false;return json({error:'Fixture ack timeout'},503);}processed.add(role+':'+messageId);}
      return json({data:{id:messageId,success:true,status:'processing'}});
    }
    throw Error('Unexpected Band fixture route');
  };
  class Socket extends EventEmitter {
    constructor(url,options){super();this.url=url;this.options=options;this.readyState=0;this.role=bandRoles.find(role=>ids[role]===new URL(url).searchParams.get('agent_id'));sockets.set(this.role,this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
    send(raw){const f=JSON.parse(raw);this.emit('message',Buffer.from(JSON.stringify([f[0],f[1],f[2],'phx_reply',{status:'ok',response:{}}])));}
    close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
    terminate(){this.close();}
  }
  const provider=createBandProvider({env,fetcher,socketFactory:(url,options)=>new Socket(url,options)});
  const projectModel=createModelProvider({env:model?{PROJECT_AI_ENABLED:'true',PROJECT_OPENAI_API_KEY:'fixture-project-model-never-network',PROJECT_OPENAI_MODEL:'fixture-model'}:{},fetcher:async(_url,options)=>{
    control.modelCalls++;const input=JSON.parse(options.body),context=JSON.parse(input.input[0].content).context;if(control.modelGate)await control.modelGate;
    const value={subject:'Supplier fit',body:control.invalidModel?'Missing selected CTA':`Compatibility, pricing and delivery require technical review. ${context.messageBrief.callToAction}\n[1] ${context.account.source}\n[2] ${context.supplier.company.website}`,claims:[{text:'Account source',sourceUrl:context.account.source},{text:'Supplier source',sourceUrl:context.supplier.company.website}],qualificationQuestions:['What application requirements apply?']};
    return json({id:'resp_band_fixture',object:'response',created_at:1,model:'fixture-model',status:'completed',output:[{id:'msg_band_fixture',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],...(control.missingUsage?{}:{usage:{input_tokens:20,output_tokens:10,total_tokens:30}})});
  }});
  const retryTasks=new Map();let retryId=0;const bandClock={setTimeout(fn){const id=++retryId;retryTasks.set(id,fn);return id;},clearTimeout:id=>retryTasks.delete(id)};
  const graph={sync:async()=>{},snapshot:async()=>({nodes:[],edges:[]}),paths:async()=>[]};
  const service=createService({store,graph,bandProvider:provider,model:projectModel,bandClock});
  for(const id of ['allco','huasheng']){store.mutate(id,state=>{state.icp.regions='United States';state.icp.motion='oem';state.icp.segments=['Equipment manufacturers (OEMs)'];});service.approveProfile(id,true,store.read(id).revision);store.mutate(id,state=>{state.leads=[{...structuredClone(researchCatalog[0]),name:'Synthetic Band Buyer',productFamily:state.productFamilies[0],selected:true,stage:'Matched',events:[],people:[],contact:{email:'buyer@band-fixture.test',linkedIn:'https://www.linkedin.com/in/band-fixture'},fit:{score:80,tier:'A'}}];});}
  const decision=(id,extra={})=>({requestId:randomUUID(),revision:store.read(id).revision,acknowledged:true,...extra});
  const wait=async predicate=>{for(let i=0;i<50;i++){await flush();if(predicate())return;}assert.ok(predicate(),'Fixture condition did not settle');};
  const enable=async(id='allco')=>{await service.checkBandTeam(id,decision(id));const view=service.snapshot(id).band;await service.connectBandTeam(id,decision(id,{bindingHash:view.bindingHash,teamHash:view.teamHash}));await wait(()=>service.snapshot(id).band.connected);await service.drainBand();};
  const input=(id='allco',extra={})=>({leadId:'elliott',channel:'email',variant:'A',sequenceStep:0,generation:'template',messageBrief:{...defaultMessageBrief},...extra});
  const start=async(id='allco',extra={})=>{const options=input(id,extra),plan=service.planBandDraft(id,options);return service.startBandDraft(id,{...options,...decision(id),previewHash:plan.previewHash,...extra});};
  t.after(async()=>{await service.stopBand();store.close();await rm(directory,{recursive:true,force:true});});
  return{retryTasks,advanceRetries(){const tasks=[...retryTasks.values()];retryTasks.clear();for(const fn of tasks)fn();},directory,store,service,provider,env,ids,rooms,participants,calls,messages,sockets,processed,control,emit,decision,enable,input,start,wait};
}
