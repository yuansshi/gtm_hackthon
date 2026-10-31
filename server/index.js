import path from 'node:path';
import { createStore, recoverInterruptedWork } from './store.js';
import { createGraph } from './graph.js';
import { createService } from './service.js';
import { createApp } from './app.js';
import { createSignalScheduler } from './market-signals.js';

const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.PROJECT_ACCESS_TOKEN) throw new Error('PROJECT_ACCESS_TOKEN is required when listening beyond loopback.');
const directory = path.resolve(process.env.DATA_DIR || '.data');
const store = createStore(directory);
// Recover interrupted reservations on restart; jobs are never replayed as sends.
recoverInterruptedWork(store);
const graph = await createGraph(directory);
const service = createService({ store, graph });
const signalScheduler = createSignalScheduler(service);
const app = createApp({ service, store, accessToken: process.env.PROJECT_ACCESS_TOKEN || '', ...(process.env.PUBLIC_ORIGIN ? { allowedOrigins: [process.env.PUBLIC_ORIGIN] } : {}) });
const server = app.listen(Number(process.env.PORT || 3001), host, () => console.log(`GTM portal: http://${host}:${server.address().port} | Demo mode: no external delivery`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(); await signalScheduler.stop(); await graph.close(); store.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
