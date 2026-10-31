import path from 'node:path';
import { createStore, recoverInterruptedWork } from './store.js';
import { createGraph } from './graph.js';
import { createService } from './service.js';
import { createApp } from './app.js';
import { createSignalScheduler } from './market-signals.js';
import { createFlexpriceScheduler } from './flexprice-billing.js';
import { runtimeConfig } from './runtime-config.js';

const {host,port,publicOrigin,secureCookies}=runtimeConfig();
const directory = path.resolve(process.env.DATA_DIR || '.data');
const store = createStore(directory);
// Recover interrupted reservations on restart; jobs are never replayed as sends.
recoverInterruptedWork(store);
const graph = await createGraph(directory);
const service = createService({ store, graph });
const signalScheduler = createSignalScheduler(service);
const billingScheduler = createFlexpriceScheduler(service);
const app = createApp({ service, store, accessToken: process.env.PROJECT_ACCESS_TOKEN || '', secureCookies, ...(publicOrigin ? { allowedOrigins: [publicOrigin] } : {}) });
const server = app.listen(port, host, () => console.log(`GTM portal: http://${host}:${server.address().port} | Project email: ${service.deliveryStatus().configured ? 'configured; sender confirmation and exact live approval required' : 'disabled'}`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await new Promise(resolve => server.close(resolve)); await signalScheduler.stop(); await billingScheduler.stop(); await service.stopBand(); await graph.close(); store.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
