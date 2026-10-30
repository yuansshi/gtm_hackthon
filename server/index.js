import path from 'node:path';
import { createStore } from './store.js';
import { createGraph } from './graph.js';
import { createService } from './service.js';
import { createApp } from './app.js';

const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.PROJECT_ACCESS_TOKEN) throw new Error('PROJECT_ACCESS_TOKEN is required when listening beyond loopback.');
const directory = path.resolve(process.env.DATA_DIR || '.data');
const store = createStore(directory);
// Recover interrupted reservations on restart; jobs are never replayed as sends.
for (const id of ['allco', 'huasheng']) {
  for (const entry of store.read(id).wallet.ledger.filter(e => e.status === 'reserved')) store.settle(id, entry.id, false);
  store.mutate(id, s => { for (const job of s.jobs.filter(j => j.status === 'running')) { job.status = 'failed'; job.error = 'Server restarted; reserved credits refunded. Run discovery again.'; } });
  store.mutate(id, s => { for (const run of (s.assistantRuns || []).filter(r => r.status === 'running')) { run.status = 'failed'; run.error = 'Server restarted. No model request will be replayed automatically. Local credits were refunded; provider billing may differ.'; run.errorCode = 'interrupted_request'; } });
}
const graph = await createGraph(directory);
const service = createService({ store, graph });
const app = createApp({ service, store, accessToken: process.env.PROJECT_ACCESS_TOKEN || '', ...(process.env.PUBLIC_ORIGIN ? { allowedOrigins: [process.env.PUBLIC_ORIGIN] } : {}) });
const server = app.listen(Number(process.env.PORT || 3001), host, () => console.log(`GTM portal: http://${host}:${server.address().port} | Demo mode: no external delivery`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(); await graph.close(); store.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
