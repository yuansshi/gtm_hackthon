// Isolated recording workspace. Never loads .env or enables live providers.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareRecordingWorkspace} from './recording-workspace.js';
import {createStore} from '../../server/store.js';
import {createGraph} from '../../server/graph.js';
import {createService} from '../../server/service.js';
import {createApp} from '../../server/app.js';
import {createModelProvider} from '../../server/model.js';
import {createHunterProvider} from '../../server/hunter.js';
import {createProspectSearchProvider} from '../../server/prospect-search-provider.js';
import {createFlexpriceProvider} from '../../server/flexprice-provider.js';
import {createSendgridProvider} from '../../server/sendgrid-provider.js';
import {createBandProvider} from '../../server/band-provider.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),port=Number(process.argv[3]||3022);
if(!process.argv[2]||!Number.isInteger(port)||port<1024||port>65535)throw Error('Supply a dedicated recording data directory and loopback port.');
const directory=await prepareRecordingWorkspace(process.argv[2],path.join(root,'.data'));
const store=createStore(directory),graph=await createGraph(directory);
const denied=async()=>{throw Error('External provider access is disabled in the recording workspace.');};
const offline={env:{},fetcher:denied};
const service=createService({store,graph,model:createModelProvider(offline),hunter:createHunterProvider(offline),prospectProvider:createProspectSearchProvider(offline),flexpriceProvider:createFlexpriceProvider(offline),emailProvider:createSendgridProvider(offline),bandProvider:createBandProvider(offline)});
const origin='http://localhost:'+port;
const app=createApp({service,store,allowedOrigins:[origin]});
const server=app.listen(port,'127.0.0.1',()=>console.log('Recording workspace: '+origin+'/#overview; providers disabled; native Kuzu; pid='+process.pid));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await new Promise(resolve=>server.close(resolve));await service.stopBand();await graph.close();store.close();process.exit(0);});
