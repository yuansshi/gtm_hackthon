import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { publicSourceUrl, readPublicSource, sourceSite } from './public-source.js';
import { competitiveCategories, competitorContext, competitorDateFresh, proposeCompetitivePassages } from '../src/competitor-evidence.js';
import { costs } from './catalog.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const clean = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
const contains = (text, part) => clean(text).toLowerCase().includes(clean(part).toLowerCase());
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const runFor = (state, id) => (state.competitorResearch || []).find(run => run.id === id) || fail(404, 'Competitor research not found in this business.', 'competitor_run_not_found');
const passage = (page, value, required = [], optional = false) => {
  const text = clean(value); if (!text && optional) return null;
  if (text.length < 12 || text.length > 2000 || !contains(page.text, text) || required.some(word => !contains(text, word))) fail(400, 'Copy an exact source passage containing the requested company identity or fact.', 'ungrounded_competitor_quote');
  return { url: page.url, quote: text };
};
export function markCompetitorProjection(store, id, projected) {
  const ids = new Set((projected.competitorOperations || []).map(item => item.id));
  if (!(store.read(id).competitorOperations || []).some(item => ids.has(item.id) && item.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const item of state.competitorOperations || []) if (ids.has(item.id)) item.graphStatus = 'synced'; });
}
export function createCompetitorResearch({ store, graph, competitors, snapshot, readSource = readPublicSource }) {
  const project = async id => { const saved = store.read(id); try { await graph.sync(saved, competitors[id]); markCompetitorProjection(store, id, saved); } catch { /* Saved decisions can be projected by a later graph query. */ } return snapshot(id); };
  const checkReviews = (state, outcomes, runId) => {
    let changed = false;
    for (const review of (state.competitorReviews || []).filter(item => item.status === 'reviewed')) {
      const evidence = Object.values(review.evidence).filter(Boolean);
      if (!outcomes.some(outcome => evidence.some(item => item.url === outcome.url && (!outcome.page || !contains(outcome.page.text, item.quote))))) continue;
      review.status = 'needs_review'; review.sourceChangedAt = now(); changed = true;
      state.competitorOperations ||= [];
      state.competitorOperations.unshift({ id: randomUUID(), referenceId: review.referenceId, action: 'source_changed', hash: digest({ runId, reviewId: review.id }), at: now(), graphStatus: 'pending' });
      addActivity(state, 'Competitive evidence needs review', `${review.name}; a source failed or a supporting passage changed. Reviewed graph context is suspended.`, 'Source reviewer');
    }
    return changed;
  };
  const start = (id, input) => {
    if (input.acknowledged !== true) fail(400, 'Confirm that these are competitor-owned public pages and acknowledge the research charge.', 'competitor_ack_required');
    if (!uuid(input.requestId)) fail(400, 'Use a valid research request ID.', 'invalid_competitor_request');
    const state = store.read(id);
    const previous = (state.competitorResearch || []).find(run => run.id === input.requestId);
    const reference = input.referenceId ? (competitors[id].find(item => item.id === input.referenceId) || (state.competitorReviews || []).find(item => item.referenceId === input.referenceId)) : null;
    if (input.referenceId && !reference) fail(404, 'Competitive reference not found in this business.', 'competitor_not_found');
    const name = clean(input.name), category = input.category;
    if (!name || name.length > 200 || !competitiveCategories.includes(category)) fail(400, 'Name the competitor and choose a category.', 'invalid_competitor_input');
    const sourceUrl = publicSourceUrl(input.sourceUrl).href;
    const referenceUrl = reference?.source || reference?.pages?.[0]?.url;
    if (referenceUrl) publicSourceUrl(sourceUrl, sourceSite(referenceUrl));
    const detailUrl = input.detailUrl ? publicSourceUrl(input.detailUrl, sourceSite(sourceUrl)).href : sourceUrl;
    const hash = digest({ referenceId: input.referenceId || null, name, category, sourceUrl, detailUrl });
    if (previous) { if (previous.requestHash !== hash) fail(409, 'This request ID belongs to different competitor research.', 'competitor_request_conflict'); return { id: previous.id }; }
    if (!state.approved) fail(409, 'Approve the current business profile before competitor research.', 'profile_approval_required');
    if (state.revision !== input.revision) fail(409, 'This workspace changed. Reload before retrieving sources.', 'revision_conflict');
    if (state.jobs.some(job => job.status === 'running')) fail(409, 'Wait for current source research to finish.', 'job_running');
    if ((state.competitorResearch || []).length >= 100 || (state.competitorResearch || []).filter(run => run.status === 'ready').length >= 10) fail(409, 'Review or dismiss existing research before starting more.', 'competitor_research_limit');
    const reservation = store.reserve(id, 'competitor_research', costs.competitor_research);
    const run = { id: input.requestId, referenceId: input.referenceId || `custom:${input.requestId}`, name, category, sourceUrl, detailUrl, requestHash: hash, contextKey: competitorContext(state), status: 'running', startedAt: now(), reservation, pages: [] };
    store.mutate(id, current => { current.competitorResearch ||= []; current.competitorResearch.unshift(run); current.jobs.unshift({ id: run.id, kind: 'competitor_research', status: 'running', startedAt: run.startedAt, reservation, steps: [] }); addActivity(current, 'Competitor research started', `${name}; up to two public pages. Exact passages require review.`, 'Planner'); });
    const completion = (async () => {
      const urls = [...new Set([sourceUrl, detailUrl])]; let outcomes = [], changed = false;
      try {
        const results = await Promise.allSettled(urls.map(async url => {
          const page = await readSource(url); publicSourceUrl(page.finalUrl || page.url, sourceSite(url));
          if (page.url !== url || page.fetchStatus !== 'reachable' || typeof page.text !== 'string' || page.text.length < 30 || page.text.length > 48000 || !competitorDateFresh(page.checkedAt, 24)) fail(502, 'A readable, recent source snapshot was not returned.', 'invalid_competitor_source');
          return { url, finalUrl: page.finalUrl || url, text: page.text, title: clean(page.title).slice(0, 180), checkedAt: page.checkedAt, contentHash: digest(page.text) };
        }));
        outcomes = results.map((result, index) => ({ url: urls[index], page: result.status === 'fulfilled' ? result.value : null }));
        const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
        store.mutate(id, current => {
          if (!current.approved || competitorContext(current) !== run.contextKey) fail(409, 'The approved business context changed during retrieval. Fetch fresh pages.', 'stale_competitor_context');
          changed = checkReviews(current, outcomes, run.id);
          const pages = outcomes.map(item => item.page);
          Object.assign(runFor(current, run.id), { status: 'ready', completedAt: now(), pages, suggestions: proposeCompetitivePassages(run.name, pages.find(page => page.url === sourceUrl).text, pages.find(page => page.url === detailUrl).text) });
          Object.assign(current.jobs.find(job => job.id === run.id), { status: 'completed', completedAt: now(), steps: [{ actor: 'Builder', summary: 'Public source pages retrieved with bounded, pinned HTTPS.', at: now() }, { actor: 'Reviewer', summary: 'Company identity and competitive claims await exact-passage review.', at: now() }] });
          store.settleUsageInState(current, current.wallet.ledger.find(item => item.id === reservation), true);
          addActivity(current, 'Competitor sources ready', `${name}; no pricing, package or comparative claim was applied.`, 'Reviewer');
        });
      } catch (error) {
        store.mutate(id, current => {
          changed = checkReviews(current, outcomes, run.id);
          const message = error instanceof AppError ? error.message : 'Competitor source retrieval failed. Local credits refunded.';
          Object.assign(runFor(current, run.id), { status: 'failed', error: message, errorCode: error instanceof AppError ? error.code : 'competitor_source_unavailable', completedAt: now() });
          Object.assign(current.jobs.find(job => job.id === run.id), { status: 'failed', error: message, completedAt: now() });
          store.settleUsageInState(current, current.wallet.ledger.find(item => item.id === reservation), false);
        });
      }
      if (changed) await project(id);
    })();
    return { id: run.id, completion };
  };
  const operation = (id, input, action, values, apply) => {
    if (!uuid(input.requestId) || input.acknowledged !== true) fail(400, 'Confirm this competitive evidence decision.', 'competitor_ack_required');
    const hash = digest({ action, values }); const previous = (store.read(id).competitorOperations || []).find(item => item.id === input.requestId);
    if (previous) { if (previous.hash !== hash) fail(409, 'This request ID belongs to another competitor decision.', 'competitor_request_conflict'); return; }
    store.mutate(id, state => { if ((state.competitorOperations || []).length >= 500) fail(409, 'The competitive decision history is full.', 'competitor_history_limit'); const referenceId = apply(state); state.competitorOperations ||= []; state.competitorOperations.unshift({ id: input.requestId, referenceId, action, hash, at: now(), graphStatus: 'pending' }); }, input.revision);
  };
  const review = async (id, runId, input) => {
    const values = { runId, identityQuote: clean(input.identityQuote), positioningQuote: clean(input.positioningQuote), pricingMode: input.pricingMode, pricingQuote: clean(input.pricingQuote), packagingQuote: clean(input.packagingQuote), differentiatorQuote: clean(input.differentiatorQuote), comparisonNote: clean(input.comparisonNote) };
    operation(id, input, 'review', values, state => {
      const run = runFor(state, runId);
      if (run.status !== 'ready' || !state.approved || run.contextKey !== competitorContext(state)) fail(409, 'Retrieve sources for the current approved business profile.', 'stale_competitor_context');
      if (run.pages.some(page => !competitorDateFresh(page.checkedAt, 24))) fail(409, 'Source snapshots are over 24 hours old. Retrieve fresh pages.', 'competitor_source_expired');
      if ((state.competitorReviews || []).length >= 200 || values.comparisonNote.length > 1000) fail(400, 'Keep comparison notes within 1,000 characters and reviews within the workspace limit.', 'invalid_competitor_review');
      const identityPage = run.pages.find(page => page.url === run.sourceUrl), detailPage = run.pages.find(page => page.url === run.detailUrl);
      const evidence = { identity: passage(identityPage, values.identityQuote, [run.name]), positioning: passage(detailPage, values.positioningQuote), packaging: passage(detailPage, values.packagingQuote, [], true), differentiator: passage(detailPage, values.differentiatorQuote, [], true), pricing: null };
      if (!['published', 'quote_required', 'not_established'].includes(values.pricingMode)) fail(400, 'Choose a supported pricing evidence state.', 'invalid_competitor_pricing');
      if (values.pricingMode === 'not_established') { if (values.pricingQuote) fail(400, 'Clear the pricing passage when pricing is not established.', 'invalid_competitor_pricing'); }
      else {
        evidence.pricing = passage(detailPage, values.pricingQuote);
        if (values.pricingMode === 'published' && !/(?:[$€£¥]\s*\d|\b(?:USD|EUR|GBP|CNY)\s*\d|\d\s*(?:USD|EUR|GBP|CNY)\b)/i.test(evidence.pricing.quote)) fail(400, 'A published-price passage must contain a stated currency and amount.', 'invalid_competitor_pricing');
        if (values.pricingMode === 'quote_required' && !/quote|quotation|contact.{0,100}pric|request.{0,100}pric/i.test(evidence.pricing.quote)) fail(400, 'Copy the page’s explicit request-for-quote or pricing-contact instruction.', 'invalid_competitor_pricing');
      }
      state.competitorReviews ||= [];
      for (const old of state.competitorReviews.filter(item => item.referenceId === run.referenceId && ['reviewed', 'needs_review'].includes(item.status))) { old.status = 'superseded'; old.supersededAt = now(); }
      state.competitorReviews.unshift({ id: input.requestId, referenceId: run.referenceId, runId, name: run.name, category: run.category, contextKey: run.contextKey, evidence, pricingMode: values.pricingMode, comparisonNote: values.comparisonNote, pages: run.pages.map(({ url, checkedAt, contentHash }) => ({ url, checkedAt, contentHash })), status: 'reviewed', reviewedAt: now(), reviewedBy: 'You' });
      run.status = 'reviewed'; run.reviewedAt = now();
      addActivity(state, 'Competitive evidence reviewed', `${run.name}; ${run.category.toLowerCase()} reference. Comparison notes remain owner interpretation; no outreach authorized.`, 'You');
      return run.referenceId;
    });
    return project(id);
  };
  const withdraw = async (id, input) => {
    operation(id, input, 'withdraw', { reviewId: input.reviewId }, state => {
      const review = (state.competitorReviews || []).find(item => item.id === input.reviewId);
      if (!review || !['reviewed', 'needs_review'].includes(review.status)) fail(409, 'This competitive review is no longer active.', 'stale_competitor_review');
      review.status = 'withdrawn'; review.withdrawnAt = now(); addActivity(state, 'Competitive evidence withdrawn', `${review.name}; these passages no longer support graph comparisons.`, 'You'); return review.referenceId;
    }); return project(id);
  };
  const dismiss = (id, runId, revision) => { store.mutate(id, state => { const run = runFor(state, runId); if (run.status === 'running') fail(409, 'Wait for retrieval to finish.', 'job_running'); if (run.status === 'ready') run.status = 'dismissed'; }, revision); return snapshot(id); };
  return { start, review, withdraw, dismiss };
}
