import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { assertBusiness, AppError, addActivity, initialRuntime } from './store.js';
import { costs, pipelineStages } from './catalog.js';
import { businessById } from '../src/businesses.js';
import { reloadCredits } from './billing.js';

const text = z.string().max(5000);
const strings = z.array(z.string().max(200)).max(30);
const revision = z.number().int().nonnegative();
const profile = z.object({
  company: z.object({ name: text, website: text, description: text }).strict(),
  productFamilies: strings,
  capabilities: z.record(z.string().max(100), z.object({ value: text, status: z.enum(['unknown', 'website', 'reviewed']) }).strict()),
  commercial: z.object({ certification: text, leadTime: text, minimumOrder: text, deliveryTerms: text, quoteBasis: text }).strict(),
  icp: z.object({ industries: text, regions: text, segments: strings, roles: strings, motion: z.enum(['', 'replacement', 'oem', 'channel']), exclusions: text,
    naics: text.optional(), headcount: text.optional(), revenue: text.optional(), triggers: text.optional(), referenceWins: text.optional(), excludedDomains: text.optional() }).strict(),
  expansionDecisions: z.record(z.string().max(100), z.enum(['accepted', 'rejected', 'undecided'])),
}).strict();
const parse = (schema, data) => { const r = schema.safeParse(data); if (!r.success) throw new AppError(400, 'Invalid request: ' + r.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; '), 'invalid_request'); return r.data; };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp({ service, store, accessToken = '', allowedOrigins = ['http://127.0.0.1:3001', 'http://localhost:3001', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://localhost:5173'], serveStatic = true }) {
  const app = express();
  app.disable('x-powered-by');
  const sessions = new Map();
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" });
    next();
  });
  app.use('/api', express.json({ limit: '100kb', type: 'application/json' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) return next(new AppError(403, 'Origin is not allowed.', 'origin_rejected'));
    const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('gtm_session='))?.slice(12);
    const session = sessions.get(raw);
    if (session && session.expires > Date.now()) { req.session = session; }
    if (req.path === '/session' && req.method === 'POST') return next();
    if (!req.session) return next(new AppError(401, 'Open the portal to start a local session.', 'session_required'));
    if (!['GET', 'HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'), req.session.csrf)) return next(new AppError(403, 'Session check failed. Reload the portal.', 'csrf_required'));
    next();
  });
  app.post('/api/session', (req, res) => {
    if (accessToken && !equal(req.body?.accessToken, accessToken)) throw new AppError(401, 'Enter the project access token.', 'access_token_required');
    if (req.session) return res.json({ csrf: req.session.csrf, mode: 'demo', delivery: 'dry_run' });
    for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    if (sessions.size >= 1000) throw new AppError(429, 'Too many sessions. Try again later.', 'session_limit');
    const id = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    sessions.set(id, { csrf, expires: Date.now() + 8 * 60 * 60 * 1000 });
    res.cookie('gtm_session', id, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 8 * 60 * 60 * 1000 });
    res.json({ csrf, mode: 'demo', delivery: 'dry_run' });
  });
  app.get('/api/status', (req, res) => res.json({ mode: 'demo', graph: 'Kuzu', delivery: 'dry_run', costs, stages: pipelineStages,
    assistant: service.assistantStatus(),
    integrations: ['Band Desktop', 'Flexprice', 'LLM', 'Enrichment vendor', 'Email / LinkedIn delivery'].map(name => name === 'LLM' ? { ...service.assistantStatus(), name, connected: !!service.assistantStatus().verifiedAt } : { name, connected: false, status: 'Not connected' }) }));
  app.param('business', (req, res, next, id) => { try { assertBusiness(id); next(); } catch (e) { next(e); } });
  const base = '/api/businesses/:business';
  const view = (req, res) => res.json(service.snapshot(req.params.business));
  app.get(base, view);
  const reloadSchema = z.object({ packId: z.enum(['starter', 'growth', 'scale', 'custom']), customCredits: z.number().int().min(1).max(100000).optional(), requestId: z.string().uuid() }).strict();
  app.post(base + '/billing/reloads', (req, res) => {
    const data = parse(reloadSchema, req.body);
    const receipt = reloadCredits(store, req.params.business, data);
    res.json({ ...service.snapshot(req.params.business), reloadReceipt: receipt });
  });
  app.post(base + '/assistant/intake', async (req, res) => {
    const p = parse(z.object({ message: z.string().trim().min(1).max(5000), mode: z.enum(['local', 'model']), requestId: z.string().uuid(), acknowledgedExternalProcessing: z.boolean(), revision }).strict(), req.body);
    res.json(await service.inferProfile(req.params.business, p));
  });
  app.post(base + '/assistant/intake/:run/review', (req, res) => {
    const p = parse(z.object({ revision, acknowledged: z.boolean(), decisions: z.array(z.object({ field: z.string().max(100), decision: z.enum(['accepted', 'adjusted', 'dismissed']), value: z.union([text, strings]).optional() }).strict()).max(12) }).strict(), req.body);
    res.json(service.reviewIntake(req.params.business, req.params.run, p));
  });
  app.put(base + '/profile', (req, res) => {
    const data = parse(z.object({ profile, revision }).strict(), req.body);
    const business = businessById(req.params.business);
    if (data.profile.productFamilies.some(key => !business.families.some(([id]) => id === key)) || business.capabilities.some(([id]) => !data.profile.capabilities[id]) || Object.keys(data.profile.capabilities).some(key => !business.capabilities.some(([id]) => id === key))) throw new AppError(400, 'Products and capability fields must belong to this business.', 'invalid_profile_scope');
    service.saveProfile(req.params.business, data.profile, data.revision); view(req, res);
  });
  app.post(base + '/approve', (req, res) => { const p = parse(z.object({ acknowledged: z.boolean(), revision }).strict(), req.body); service.approveProfile(req.params.business, p.acknowledged, p.revision); view(req, res); });
  app.post(base + '/discovery', (req, res) => { const j = service.startDiscovery(req.params.business); res.status(202).json({ jobId: j.id }); });
  app.patch(base + '/leads/:lead/selection', (req, res) => { const p = parse(z.object({ selected: z.boolean() }).strict(), req.body); service.selectLead(req.params.business, req.params.lead, p.selected); view(req, res); });
  app.post(base + '/leads/:lead/enrich', async (req, res) => { await service.enrich(req.params.business, req.params.lead); view(req, res); });
  app.post(base + '/leads/:lead/drafts', async (req, res) => { const p = parse(z.object({ channel: z.enum(['email', 'linkedin']), variant: z.enum(['A', 'B']), sequenceStep: z.number().int().min(0).max(2), generation: z.enum(['template', 'model']).optional(), requestId: z.string().uuid().optional(), acknowledgedExternalProcessing: z.boolean().optional(), revision: revision.optional() }).strict(), req.body); if (p.generation === 'model') { if (!p.requestId || p.revision === undefined) throw new AppError(400, 'Model drafting needs a request ID and current revision.', 'invalid_request'); return res.json(await service.draftWithModel(req.params.business, req.params.lead, p)); } const draftId = service.draft(req.params.business, req.params.lead, p.channel, p.variant, p.sequenceStep); res.json({ ...service.snapshot(req.params.business), activeDraftId: draftId }); });
  app.patch(base + '/drafts/:draft', (req, res) => { const p = parse(z.object({ recipient: z.string().max(1000), subject: z.string().max(500), body: z.string().max(10000), version: revision }).strict(), req.body); service.editDraft(req.params.business, req.params.draft, p, p.version); view(req, res); });
  app.post(base + '/drafts/:draft/approve', (req, res) => { const p = parse(z.object({ acknowledged: z.boolean(), version: revision }).strict(), req.body); service.approveDraft(req.params.business, req.params.draft, p.acknowledged, p.version); view(req, res); });
  app.post(base + '/drafts/:draft/reject', (req, res) => { service.rejectDraft(req.params.business, req.params.draft); view(req, res); });
  app.post(base + '/drafts/:draft/simulate', async (req, res) => { await service.simulateSend(req.params.business, req.params.draft); view(req, res); });
  app.patch(base + '/leads/:lead/stage', (req, res) => { const p = parse(z.object({ stage: z.enum(pipelineStages) }).strict(), req.body); service.stage(req.params.business, req.params.lead, p.stage); view(req, res); });
  app.post(base + '/leads/:lead/outcomes', async (req, res) => {
    const payload = parse(z.object({ requestId: z.string().uuid(), revision, kind: z.enum(['user_reported', 'demo']), stage: z.enum(pipelineStages.slice(1)), occurredAt: z.string().max(50), note: z.string().trim().min(1).max(2000), evidenceUrl: z.string().max(1000).optional(), draftId: z.string().max(100).nullable().optional(), respondent: z.object({ name: z.string().max(200), source: z.string().max(1000) }).strict().nullable().optional(), updateStage: z.boolean(), acknowledged: z.boolean() }).strict(), req.body);
    res.json(await service.recordOutcome(req.params.business, req.params.lead, payload));
  });
  app.post(base + '/graph/query', async (req, res) => res.json(await service.graphView(req.params.business)));
  app.post(base + '/credits', (req, res) => { const data = parse(reloadSchema, req.body); const receipt = reloadCredits(store, req.params.business, data); res.json({ ...service.snapshot(req.params.business), reloadReceipt: receipt }); });
  app.post(base + '/reset', (req, res) => { const id = req.params.business; const current = store.read(id); if (current.jobs.some(j => j.status === 'running') || current.assistantRuns?.some(r => r.status === 'running')) throw new AppError(409, 'Wait for research and assistant jobs to finish before resetting.', 'job_running'); store.mutate(id, s => { const nextRevision = s.revision; const wallet = s.wallet; Object.assign(s, initialRuntime(id), { wallet, revision: nextRevision, profileImported: true }); addActivity(s, 'Campaign workspace reset', 'Profile and campaign records reset. The credit balance and billing history were retained.'); }); view(req, res); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.', code: 'not_found' }));
  if (serveStatic) { app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html'))); }
  app.use((error, req, res, next) => { const status = error.status || 500; res.status(status).json({ error: status >= 500 ? 'The server could not complete this action. Check the local server log.' : error.message, code: error.code || 'server_error' }); if (status >= 500) console.error(error); });
  return app;
}
