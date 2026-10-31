import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { initialBusinessState, businesses } from '../src/businesses.js';

export class AppError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
export function assertBusiness(id) { if (!businesses.some(b => b.id === id)) throw new AppError(404, 'Unknown business.', 'business_not_found'); return id; }
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export const publicDraft = d => ({ ...d, approvedHash: d.approvedHash || null });

export function initialRuntime(id) {
  return {
    ...initialBusinessState(id), leads: [], drafts: [], sourceReviews: [], sourceIntakes: [], customCandidates: [], prospectSearches: [], enrichmentRuns: [], contactReviews: [], contactSuppressions: [], communicationRestrictions: [], communicationOperations: [], companyReviews: [], companyRestrictions: [], buyingLinks: [], buyingOperations: [], competitorResearch: [], competitorReviews: [], competitorOperations: [], peopleResearch: [], educationResearch: [], educationReviews: [], educationOperations: [], personReviews: [], personOperations: [], knownConnections: [], jobs: [], assistantRuns: [], assistantFieldProvenance: {}, delivery: { checks: [], attempts: [] },
    wallet: { credits: 100, initialCredits: 100, currency: 'demo credits', ledger: [] },
    version: 2, revision: 0, serverPersisted: true,
  };
}

export function addActivity(state, title, detail, actor = 'You', metadata = {}) {
  const event = { id: randomUUID(), at: now(), title, detail, actor, ...metadata };
  state.activity = [event, ...state.activity].slice(0, 300);
  return event;
}

export function recoverInterruptedWork(store) {
  for (const id of businesses.map(business => business.id)) {
    const pendingDelivery = new Set((store.read(id).delivery?.attempts || []).filter(item => ['sending', 'unknown'].includes(item.status)).map(item => item.reservation));
    for (const entry of store.read(id).wallet.ledger.filter(entry => entry.status === 'reserved' && !pendingDelivery.has(entry.id))) store.settle(id, entry.id, false);
    store.mutate(id, state => {
      for (const attempt of state.delivery?.attempts || []) if (attempt.status === 'sending') { attempt.status = 'unknown'; attempt.error = 'Server restarted during transmission. Acceptance is unknown; no automatic resend or refund. Await signed receipts and inspect provider records.'; const draft = state.drafts.find(item => item.id === attempt.draftId); if (draft) draft.status = 'delivery_unknown'; const entry = state.wallet.ledger.find(item => item.id === attempt.reservation); if (entry) entry.externalStatus = 'provider_unknown'; }
      for (const check of state.delivery?.checks || []) if (check.status === 'running') { check.status = 'failed'; check.error = 'Sender check interrupted. Check it again before live approval.'; check.completedAt = now(); }
      for (const job of state.jobs.filter(job => job.status === 'running')) { job.status = 'failed'; job.error = 'Server restarted; reserved credits refunded. Start a new research request.'; job.completedAt = now(); }
      for (const intake of state.sourceIntakes || []) if (intake.status === 'running') { intake.status = 'failed'; intake.error = 'Server restarted; reserved credits refunded. Start a new source request.'; intake.errorCode = 'interrupted_request'; intake.completedAt = now(); }
      for (const run of state.competitorResearch || []) if (run.status === 'running') { run.status = 'failed'; run.error = 'Server restarted; reserved credits refunded. Competitor research is not replayed.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); }
      for (const run of state.peopleResearch || []) if (run.status === 'running') { run.status = 'failed'; run.error = 'Server restarted; reserved credits refunded. No people research is replayed.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); }
      for (const run of state.educationResearch || []) if (run.status === 'running') { run.status = 'failed'; run.error = 'Server restarted; local credits refunded. Education research is not replayed.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); }
      for(const lead of state.leads)for(const run of lead.signalMonitor?.runs||[])if(run.status==='running'){run.status='failed';run.error='Server restarted; local credits refunded. This source check will not replay.';run.completedAt=now();lead.signalMonitor.enabled=false;lead.signalMonitor.nextCheckAt=null;lead.signalMonitor.pausedReason='An interrupted source check needs review before scheduled work resumes.';}
      for (const run of (state.prospectSearches || []).filter(run => run.status === 'running')) { run.status = 'failed'; run.error = 'Server restarted; reserved local credits were refunded. Search is not replayed automatically; vendor billing may differ.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); const entry = state.wallet.ledger.find(entry => entry.id === run.reservation); if (entry) entry.externalStatus = 'provider_unknown'; }
      for (const run of (state.enrichmentRuns || []).filter(run => ['running', 'pending'].includes(run.status))) { run.status = 'failed'; run.error = 'Server restarted. Local credits were refunded; vendor billing may differ. No contact request will replay automatically.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); const entry = state.wallet.ledger.find(entry => entry.id === run.reservation); if (entry) entry.externalStatus = 'provider_unknown'; }
      for (const run of (state.assistantRuns || []).filter(run => run.status === 'running')) { run.status = 'failed'; run.error = 'Server restarted. No model request will be replayed automatically. Local credits were refunded; provider billing may differ.'; run.errorCode = 'interrupted_request'; run.completedAt = now(); }
    });
  }
}

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces (business_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL);');
  for (const b of businesses) db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?, 0, ?)').run(b.id, JSON.stringify(initialRuntime(b.id)));
  const read = id => { assertBusiness(id); const row = db.prepare('SELECT revision,state FROM workspaces WHERE business_id=?').get(id); return { ...JSON.parse(row.state), revision: row.revision }; };
  let meteringPolicy = null;
  const mutate = (id, fn, expectedRevision) => {
    assertBusiness(id); db.exec('BEGIN IMMEDIATE');
    try {
      const state = read(id);
      if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new AppError(409, 'This workspace changed in another request. Reload before saving.', 'revision_conflict');
      const result = fn(state);
      if (result && typeof result.then === 'function') throw new Error('Store mutations must be synchronous.');
      state.revision += 1;
      db.prepare('UPDATE workspaces SET revision=?,state=? WHERE business_id=?').run(state.revision, JSON.stringify(state), id);
      db.exec('COMMIT'); return { state, result };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const reserve = (id, kind, credits, leadId, options = {}) => mutate(id, state => {
    if (!Number.isSafeInteger(credits) || credits < 0) throw new Error('Invalid metering amount');
    if (state.wallet.credits < credits) throw new AppError(402, `This action needs ${credits} credits; ${state.wallet.credits} remain.`, 'insufficient_credits');
    const entry = { id: randomUUID(), kind, credits, leadId, status: 'reserved', at: now(), externalStatus: 'not_connected', ...(options.mode ? { mode: options.mode, dispatchId: options.dispatchId } : {}) };
    meteringPolicy?.reserve(state, entry);
    state.wallet.credits -= credits; state.wallet.ledger.unshift(entry); return entry.id;
  }).result;
  const settleUsageInState = (state, entry, success) => {
    if (!entry || entry.status !== 'reserved') return;
    entry.status = success ? 'consumed' : 'refunded';
    if (!success) state.wallet.credits += entry.credits;
    meteringPolicy?.settle(state, entry, success);
  };
  const settle = (id, reservationId, success) => mutate(id, state => settleUsageInState(state, state.wallet.ledger.find(e => e.id === reservationId), success));
  const meterSettledUsage = (state, entry) => { meteringPolicy?.reserve(state, entry); meteringPolicy?.settle(state, entry, true); return entry; };
  return { read, mutate, reserve, settle, settleUsageInState, meterSettledUsage, setMeteringPolicy: policy => { meteringPolicy = policy; }, close: () => db.close(), directory };
}
