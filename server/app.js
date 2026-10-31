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
    assistant: service.assistantStatus(), enrichment: service.enrichmentStatus(), prospectSearch: service.prospectSearchStatus(),
    integrations: ['Band Desktop', 'Flexprice', 'LLM', 'Enrichment vendor', 'Prospect search', 'Email / LinkedIn delivery'].map(name => name === 'Flexprice' ? { ...service.billingStatus(), name } : name === 'Prospect search' ? { ...service.prospectSearchStatus(), name: 'Tavily', connected: !!service.prospectSearchStatus().verifiedAt } : name === 'Enrichment vendor' ? { ...service.enrichmentStatus(), name: 'Hunter', connected: !!service.enrichmentStatus().verifiedAt } : name === 'LLM' ? { ...service.assistantStatus(), name, connected: !!service.assistantStatus().verifiedAt } : { name, connected: false, status: 'Not connected' }) }));
  app.param('business', (req, res, next, id) => { try { assertBusiness(id); next(); } catch (e) { next(e); } });
  const base = '/api/businesses/:business';
  app.use(base, async (req, res, next) => {
    try {
      const path = req.path;
      const charged = req.method === 'POST' && (
        ['/discovery', '/source-intakes', '/prospect-searches', '/competitor-research', '/graph/query'].includes(path) ||
        /^\/leads\/[^/]+\/(?:enrich|people-research|signal-checks|company\/lookup|contacts\/(?:search|verify))$/.test(path) ||
        /^\/drafts\/[^/]+\/simulate$/.test(path) ||
        (path === '/assistant/intake' && req.body?.mode === 'model') ||
        (/^\/leads\/[^/]+\/drafts$/.test(path) && req.body?.generation === 'model')
      );
      if (charged) await service.prepareBilling(req.params.business, { path, requestId: req.body?.requestId });
      next();
    } catch (error) { next(error); }
  });
  const view = (req, res) => res.json(service.snapshot(req.params.business));
  app.get(base, view);
  const communicationDecision = { requestId: z.string().uuid(), revision, acknowledged: z.boolean(), note: z.string().max(500) };
  app.post(base + '/communication/holds', (req, res) => res.json(service.holdCommunication(req.params.business, parse(z.object({ ...communicationDecision, kind: z.enum(['account', 'email', 'linkedin']), target: z.string().min(1).max(2000), reason: z.enum(['opt_out', 'bounce', 'complaint', 'manual_hold']), reportedAt: z.string().datetime({ offset: true }) }).strict(), req.body))));
  app.post(base + '/communication/releases', (req, res) => res.json(service.releaseCommunication(req.params.business, parse(z.object({ ...communicationDecision, restrictionId: z.string().uuid(), expectedVersion: revision, reason: z.enum(['permission_updated', 'recorded_in_error']) }).strict(), req.body))));
  const buyingDecision = { requestId: z.string().uuid(), revision, acknowledged: z.boolean() };
  app.post(base + '/leads/:lead/buying-links', async (req, res) => {
    const input = parse(z.object({ ...buyingDecision, kind: z.enum(['evaluation', 'displacement']), signalId: z.string().uuid(), jobSignalId: z.string().uuid().nullable(), competitorId: z.string().min(1).max(100).nullable(), startDate: z.string().max(10), endDate: z.string().max(10), windowQuote: z.string().max(2000), jobTitle: z.string().max(200), jobQuote: z.string().max(2000) }).strict(), req.body);
    res.json(await service.reviewBuyingLink(req.params.business, req.params.lead, input));
  });
  app.post(base + '/leads/:lead/buying-links/withdraw', async (req, res) => {
    const input = parse(z.object({ ...buyingDecision, linkId: z.string().uuid() }).strict(), req.body);
    res.json(await service.withdrawBuyingLink(req.params.business, req.params.lead, input));
  });
  const competitiveDecision = { requestId: z.string().uuid(), revision, acknowledged: z.boolean() };
  app.post(base + '/competitor-research', (req, res) => {
    const input = parse(z.object({ ...competitiveDecision, referenceId: z.string().min(1).max(100).nullable(), name: z.string().trim().min(1).max(200), category: z.enum(['Direct', 'Indirect', 'Alternative']), sourceUrl: z.string().max(2000), detailUrl: z.string().max(2000).nullable() }).strict(), req.body);
    const run = service.startCompetitorResearch(req.params.business, input);
    res.status(202).json({ ...service.snapshot(req.params.business), activeCompetitorResearchId: run.id });
  });
  app.post(base + '/competitor-research/:run/review', async (req, res) => {
    const quote = z.string().max(2000);
    const input = parse(z.object({ ...competitiveDecision, identityQuote: quote, positioningQuote: quote, pricingMode: z.enum(['published', 'quote_required', 'not_established']), pricingQuote: quote, packagingQuote: quote, differentiatorQuote: quote, comparisonNote: z.string().max(1000) }).strict(), req.body);
    res.json(await service.reviewCompetitor(req.params.business, req.params.run, input));
  });
  app.post(base + '/competitor-research/:run/dismiss', (req, res) => {
    const input = parse(z.object({ revision }).strict(), req.body);
    res.json(service.dismissCompetitorResearch(req.params.business, req.params.run, input.revision));
  });
  app.post(base + '/competitors/withdraw', async (req, res) => {
    const input = parse(z.object({ ...competitiveDecision, reviewId: z.string().uuid() }).strict(), req.body);
    res.json(await service.withdrawCompetitor(req.params.business, input));
  });
  const billingConsent = z.object({ revision, expectedConsentVersion: revision, bindingHash: z.string().length(64), acknowledged: z.boolean(), acknowledgedRates: z.boolean() }).strict();
  app.post(base + '/billing/flexprice/connect', async (req, res) => res.json(await service.connectBilling(req.params.business, parse(billingConsent, req.body))));
  app.post(base + '/billing/flexprice/pause', (req, res) => res.json(service.pauseBilling(req.params.business, parse(z.object({ revision, expectedConsentVersion: revision, acknowledged: z.boolean() }).strict(), req.body))));
  app.post(base + '/billing/flexprice/sync', async (req, res) => res.json(await service.syncBilling(req.params.business, parse(z.object({ revision, expectedConsentVersion: revision, bindingHash: z.string().length(64), acknowledged: z.boolean(), retryEventId: z.string().uuid().nullable(), acknowledgedRetry: z.boolean() }).strict(), req.body))));
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
  app.post(base + '/prospect-searches', (req, res) => {
    const input = parse(z.object({ requestId: z.string().uuid(), revision, productFamilies: z.array(z.string().max(100)).min(1).max(2), queries: z.array(z.string().max(600)).min(1).max(2), acknowledgedExternalProcessing: z.boolean() }).strict(), req.body);
    const run = service.startProspectSearch(req.params.business, input);
    res.status(202).json({ ...service.snapshot(req.params.business), activeProspectSearchId: run.id });
  });
  app.post(base + '/source-intakes', (req, res) => {
    const payload = parse(z.object({ requestId: z.string().uuid(), revision, urls: z.array(z.string().max(2000)).min(1).max(2) }).strict(), req.body);
    const intake = service.startWebsiteIntake(req.params.business, payload);
    res.status(202).json({ ...service.snapshot(req.params.business), activeSourceIntakeId: intake.id });
  });
  const evidenceQuote = z.object({ url: z.string().max(2000), text: z.string().min(12).max(600) }).strict();
  app.post(base + '/source-intakes/:intake/review', async (req, res) => {
    const payload = parse(z.object({ revision, acknowledged: z.boolean(), name: z.string().trim().min(1).max(200), industry: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(200), country: z.enum(['United States', 'Canada', 'Mexico', 'Other']), buyerType: z.enum(['OEM', 'Other']), productFamily: z.string().max(100), application: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(1000), publicEmail: z.string().max(320).nullable(), quotes: z.object({ application: evidenceQuote, geography: evidenceQuote, organization: evidenceQuote }).strict() }).strict(), req.body);
    res.json(await service.reviewWebsiteIntake(req.params.business, req.params.intake, payload));
  });
  app.post(base + '/source-intakes/:intake/dismiss', (req, res) => { parse(z.object({}).strict(), req.body); res.json(service.dismissWebsiteIntake(req.params.business, req.params.intake)); });
  app.patch(base + '/leads/:lead/selection', (req, res) => { const p = parse(z.object({ selected: z.boolean() }).strict(), req.body); service.selectLead(req.params.business, req.params.lead, p.selected); view(req, res); });
  app.post(base + '/leads/:lead/people-research', (req, res) => {
    const input = parse(z.object({ requestId: z.string().uuid(), revision, sourceUrl: z.string().max(2000), employerUrl: z.string().max(2000).nullable() }).strict(), req.body);
    const run = service.startPeopleResearch(req.params.business, req.params.lead, input);
    res.status(202).json({ ...service.snapshot(req.params.business), activePeopleResearchId: run.id });
  });
  const personDecision = { requestId: z.string().uuid(), revision, acknowledged: z.boolean() };
  app.post(base + '/leads/:lead/people-research/:run/review', async (req, res) => {
    const input = parse(z.object({ ...personDecision, name: z.string().trim().min(1).max(200), role: z.string().trim().min(1).max(200), roleQuote: z.string().min(12).max(2000), formerEmployer: z.object({ name: z.string().min(1).max(200), quote: z.string().min(12).max(2000), identityQuote: z.string().min(12).max(600) }).strict().nullable() }).strict(), req.body);
    res.json(await service.reviewPerson(req.params.business, req.params.lead, req.params.run, input));
  });
  app.post(base + '/leads/:lead/people-research/:run/dismiss', (req, res) => {
    const input = parse(z.object({ revision }).strict(), req.body);
    res.json(service.dismissPeopleResearch(req.params.business, req.params.lead, req.params.run, input.revision));
  });
  app.post(base + '/leads/:lead/people/withdraw', async (req, res) => {
    const input = parse(z.object({ ...personDecision, reviewId: z.string().uuid() }).strict(), req.body);
    res.json(await service.withdrawPerson(req.params.business, req.params.lead, input));
  });
  app.post(base + '/leads/:lead/connections', async (req, res) => {
    const input = parse(z.object({ ...personDecision, reviewId: z.string().uuid(), relationship: z.enum(['worked_together', 'know_personally', 'can_request_intro']), note: z.string().max(500) }).strict(), req.body);
    res.json(await service.attestConnection(req.params.business, req.params.lead, input));
  });
  app.post(base + '/leads/:lead/connections/revoke', async (req, res) => {
    const input = parse(z.object({ ...personDecision, connectionId: z.string().uuid() }).strict(), req.body);
    res.json(await service.revokeConnection(req.params.business, req.params.lead, input));
  });
  app.post(base + '/leads/:lead/enrich', async (req, res) => { await service.enrich(req.params.business, req.params.lead); view(req, res); });
  app.put(base + '/leads/:lead/signal-monitor', (req, res) => res.json(service.configureSignalMonitor(req.params.business, req.params.lead, parse(z.object({ revision, urls:z.array(z.string().max(2000)).min(1).max(2), enabled:z.boolean(), frequency:z.enum(['daily','weekly']), acknowledgedSchedule:z.boolean() }).strict(), req.body))));
  app.post(base + '/leads/:lead/signal-checks', (req, res) => {const run=service.startSignalCheck(req.params.business,req.params.lead,parse(z.object({requestId:z.string().uuid(),revision}).strict(),req.body));res.status(202).json({...service.snapshot(req.params.business),activeSignalRunId:run.id});});
  app.post(base + '/leads/:lead/signals/:signal/review', async (req,res)=>res.json(await service.reviewMarketSignal(req.params.business,req.params.lead,req.params.signal,parse(z.object({revision,decision:z.enum(['accept','dismiss','withdraw']),eventDate:z.string().max(10),dateQuote:z.string().max(100),note:z.string().max(1000),acknowledged:z.boolean()}).strict(),req.body))));
  const vendorRequest = z.object({ requestId: z.string().uuid(), revision, acknowledgedExternalProcessing: z.boolean() }).strict();
  app.post(base + '/leads/:lead/company/lookup',async(req,res)=>res.json(await service.lookupCompany(req.params.business,req.params.lead,parse(vendorRequest,req.body))));
  app.post(base + '/leads/:lead/company/apply',async(req,res)=>res.json(await service.applyCompany(req.params.business,req.params.lead,parse(z.object({requestId:z.string().uuid(),revision,runId:z.string().uuid(),fields:z.array(z.enum(['headquarters','employees','industry','classification','revenue'])).min(1).max(5),enforceHeadquartersCountry:z.boolean(),headquartersEvidence:z.object({url:z.string().max(2000),text:z.string().min(12).max(600)}).strict().nullable(),acknowledged:z.boolean(),acknowledgedEstimates:z.boolean()}).strict(),req.body))));
  app.post(base + '/leads/:lead/company/withdraw',async(req,res)=>res.json(await service.withdrawCompany(req.params.business,req.params.lead,parse(z.object({requestId:z.string().uuid(),revision,reviewId:z.string().uuid(),acknowledged:z.boolean()}).strict(),req.body))));
  app.post(base + '/leads/:lead/contacts/search', async (req, res) => res.json(await service.searchContacts(req.params.business, req.params.lead, parse(vendorRequest, req.body))));
  app.post(base + '/leads/:lead/contacts/verify', async (req, res) => {
    const input = parse(vendorRequest.extend({ searchRunId: z.string().uuid(), candidateId: z.string().min(1).max(100) }).strict(), req.body);
    res.json(await service.verifyContact(req.params.business, req.params.lead, input));
  });
  app.post(base + '/leads/:lead/contacts/:run/poll', async (req, res) => {
    const input = parse(z.object({ revision, acknowledgedExternalProcessing: z.boolean() }).strict(), req.body);
    res.json(await service.pollContact(req.params.business, req.params.lead, req.params.run, input));
  });
  app.post(base + '/leads/:lead/contacts/:run/cancel', (req, res) => { const input = parse(z.object({ revision }).strict(), req.body); res.json(service.cancelContact(req.params.business, req.params.lead, req.params.run, input)); });
  app.post(base + '/leads/:lead/contacts/apply', async (req, res) => {
    const input = parse(z.object({ requestId: z.string().uuid(), revision, searchRunId: z.string().uuid(), candidateId: z.string().min(1).max(100), verificationRunId: z.string().uuid(), acknowledged: z.boolean(), acknowledgedUncertain: z.boolean() }).strict(), req.body);
    res.json(await service.applyContact(req.params.business, req.params.lead, input));
  });
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
  app.post(base + '/reset', (req, res) => { const id = req.params.business; const current = store.read(id); if (current.jobs.some(j => j.status === 'running') || current.assistantRuns?.some(r => r.status === 'running') || current.enrichmentRuns?.some(r => ['running', 'pending'].includes(r.status))) throw new AppError(409, 'Finish or close pending research, assistant, and contact work before resetting.', 'job_running'); store.mutate(id, s => { const nextRevision = s.revision; const wallet = s.wallet; const contactSuppressions = s.contactSuppressions || []; const companyRestrictions=s.companyRestrictions||[]; const communicationRestrictions=s.communicationRestrictions||[]; const communicationOperations=s.communicationOperations||[]; const flexprice=s.flexprice; Object.assign(s, initialRuntime(id), { wallet, contactSuppressions, companyRestrictions, communicationRestrictions, communicationOperations, ...(flexprice ? { flexprice } : {}), revision: nextRevision, profileImported: true }); addActivity(s, 'Campaign workspace reset', 'Profile and campaign records reset. Credit balance, billing history, provider restrictions and communication preferences were retained.'); }); view(req, res); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.', code: 'not_found' }));
  if (serveStatic) { app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html'))); }
  app.use((error, req, res, next) => { const status = error.status || 500; res.status(status).json({ error: status >= 500 ? 'The server could not complete this action. Check the local server log.' : error.message, code: error.code || 'server_error' }); if (status >= 500) console.error(error); });
  return app;
}
