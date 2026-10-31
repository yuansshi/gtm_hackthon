import { AppError, addActivity, digest, now } from './store.js';
import { normalizeText, sourceDates } from './signal-extraction.js';
import { signalFresh } from '../src/market-signals.js';
import { competitiveReferences } from '../src/competitor-evidence.js';
import { buyingProfileKey, buyingAccountKey, buyingSignalKey, calendarDay } from '../src/buying-evidence.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const leadFor = (state, id) => state.leads.find(lead => lead.id === id) || fail(404, 'Account not found in this business.', 'lead_not_found');
const contains = (text, value) => normalizeText(text).toLowerCase().includes(normalizeText(value).toLowerCase());
const patterns = { evaluation: /\b(?:RFQ|RFP|request for (?:quotation|proposal|quote)|supplier evaluation|vendor selection|procurement tender)\b/i, renewal: /\b(?:renewal|renew(?:s|ed|ing)?|expires?|expiration)\b/i, churn: /\b(?:terminat(?:e|ed|ion)|replac(?:e|es|ed|ement)|end(?:s|ed|ing)? (?:the |our )?(?:contract|agreement)|supplier exit|churn)\b/i };
const boundPassage = (page, signal, value) => {
  const quote = normalizeText(value);
  if (quote.length < 12 || quote.length > 2000 || !contains(page.text, quote) || !(contains(quote, signal.quote) || contains(signal.quote, quote))) fail(400, 'Copy an exact passage from this signal’s retained source context.', 'buying_quote_required');
  return quote;
};
export function markBuyingProjection(store, id, projected) {
  const ids = new Set((projected.buyingOperations || []).map(item => item.id));
  if (!(store.read(id).buyingOperations || []).some(item => ids.has(item.id) && item.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const item of state.buyingOperations || []) if (ids.has(item.id)) item.graphStatus = 'synced'; });
}
export function createBuyingEvidence({ store, graph, competitors, snapshot, exclusionReason }) {
  const project = async id => { const state = store.read(id); try { await graph.sync(state, competitors[id]); markBuyingProjection(store, id, state); } catch { /* Saved decisions remain pending for graph repair. */ } return snapshot(id); };
  const operation = (id, leadId, input, action, values, apply) => {
    if (!uuid(input.requestId) || input.acknowledged !== true) fail(400, 'Confirm the exact buying-evidence decision with a request ID.', 'buying_review_required');
    const initial = store.read(id); leadFor(initial, leadId); const hash = digest({ leadId, action, values });
    const previous = (initial.buyingOperations || []).find(item => item.id === input.requestId);
    if (previous) { if (previous.hash !== hash) fail(409, 'This request ID belongs to another buying-evidence decision.', 'buying_request_conflict'); return; }
    store.mutate(id, state => {
      if ((state.buyingOperations || []).length >= 500) fail(409, 'The buying-evidence decision history is full.', 'buying_history_limit');
      apply(state, leadFor(state, leadId)); state.buyingOperations ||= [];
      state.buyingOperations.unshift({ id: input.requestId, leadId, action, hash, at: now(), graphStatus: 'pending' });
    }, input.revision);
  };
  const sourceFor = (lead, signal) => {
    if (!signal?.acceptedAt || !signalFresh(signal)) fail(409, 'Accept fresh company signal evidence first.', 'buying_signal_required');
    const page = lead.signalMonitor?.pages?.find(page => page.url === signal.source);
    const age = Date.now() - Date.parse(page?.checkedAt);
    if (!page || !Number.isFinite(age) || age < 0 || age > 86400000 || !contains(page.text, signal.quote) || !contains(page.text, signal.dateQuote)) fail(409, 'Refresh and review the exact company source before linking evidence.', 'buying_source_required');
    return page;
  };
  const review = async (id, leadId, input) => {
    const values = { kind: input.kind, signalId: input.signalId, jobSignalId: input.jobSignalId || null, competitorId: input.competitorId || null, startDate: input.startDate, endDate: input.endDate, windowQuote: normalizeText(input.windowQuote), jobTitle: normalizeText(input.jobTitle), jobQuote: normalizeText(input.jobQuote) };
    operation(id, leadId, input, 'review', values, (state, lead) => {
      if (!state.approved || lead.evidenceNeedsReview || exclusionReason(lead, state)) fail(409, 'Approve the current business and resolve account evidence holds first.', 'buying_account_hold');
      if (!['evaluation', 'displacement'].includes(values.kind)) fail(400, 'Choose an evaluation or supplier-change link.', 'invalid_buying_kind');
      if ((state.buyingLinks || []).length >= 200) fail(409, 'This workspace reached its 200 buying-link limit.', 'buying_link_limit');
      const signal = lead.marketSignals?.find(item => item.id === values.signalId), page = sourceFor(lead, signal);
      if (values.kind === 'evaluation' ? signal.kind !== 'evaluation' : !['renewal', 'churn'].includes(signal.kind)) fail(400, 'The selected signal is not the required evaluation, renewal or churn evidence.', 'buying_signal_kind');
      const start = calendarDay(values.startDate), end = calendarDay(values.endDate);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 366 * 86400000) fail(400, 'Use a valid published window of at most 366 days, with its opening on or before its closing.', 'invalid_buying_window');
      const windowQuote = boundPassage(page, signal, values.windowQuote);
      const dates = sourceDates(windowQuote).map(item => item.date);
      if (!dates.includes(values.startDate) || !dates.includes(values.endDate) || !patterns[signal.kind].test(windowQuote)) fail(400, 'The same source passage must explicitly state both window dates and the procurement or supplier-change context.', 'buying_window_evidence_required');
      const record = { id: input.requestId, businessId: id, leadId, kind: values.kind, signalId: signal.id, signalKey: buyingSignalKey(signal), startDate: values.startDate, endDate: values.endDate, windowQuote, source: page.url, profileKey: buyingProfileKey(state), accountKey: buyingAccountKey(lead), status: 'reviewed', reviewedAt: now(), reviewedBy: 'You' };
      if (values.kind === 'evaluation') {
        if (!values.jobSignalId || values.competitorId || values.jobSignalId === signal.id) fail(400, 'Select a separate reviewed job requisition for this evaluation.', 'buying_job_required');
        const job = lead.marketSignals?.find(item => item.id === values.jobSignalId), jobPage = sourceFor(lead, job);
        if (job.kind !== 'job_requisition' || values.jobTitle.length < 3 || values.jobTitle.length > 200) fail(400, 'Select a job requisition and copy its published job title.', 'buying_job_required');
        const jobQuote = boundPassage(jobPage, job, values.jobQuote);
        if (!contains(jobQuote, values.jobTitle) || !/job|requisition|position|hiring|vacanc/i.test(jobQuote)) fail(400, 'The job passage must identify the published title and requisition context.', 'buying_job_evidence_required');
        Object.assign(record, { jobSignalId: job.id, jobSignalKey: buyingSignalKey(job), jobTitle: values.jobTitle, jobQuote, jobSource: jobPage.url });
      } else {
        if (!values.competitorId || values.jobSignalId || values.jobTitle || values.jobQuote) fail(400, 'Choose the reviewed competitor named in the supplier-change publication.', 'buying_competitor_required');
        const competitor = competitiveReferences(state, competitors[id]).find(item => item.id === values.competitorId);
        if (!competitor?.current || !contains(windowQuote, competitor.review.name)) fail(409, 'Review current competitor identity evidence and copy its published name in this window passage.', 'buying_competitor_evidence_required');
        Object.assign(record, { competitorId: competitor.id, competitorName: competitor.review.name, competitorReviewId: competitor.review.id, competitorSource: competitor.review.evidence.identity.url, competitorIdentityQuote: competitor.review.evidence.identity.quote });
      }
      const key = digest({ leadId, kind: record.kind, signalId: record.signalId, jobSignalId: record.jobSignalId, competitorId: record.competitorId });
      state.buyingLinks ||= [];
      for (const old of state.buyingLinks.filter(item => item.key === key && ['reviewed', 'needs_review'].includes(item.status))) { old.status = 'superseded'; old.supersededAt = now(); }
      state.buyingLinks.unshift({ ...record, key });
      addActivity(state, 'Buying evidence linked', `${lead.name}; ${record.kind}; published window ${record.startDate} to ${record.endDate}. Relevance is owner-assessed; no purchase or message is authorized.`, 'You', { leadId, buyingLinkId: record.id });
    });
    return project(id);
  };
  const withdraw = async (id, leadId, input) => {
    operation(id, leadId, input, 'withdraw', { linkId: input.linkId }, state => {
      const link = (state.buyingLinks || []).find(item => item.id === input.linkId && item.leadId === leadId);
      if (!link || !['reviewed', 'needs_review'].includes(link.status)) fail(409, 'This buying-evidence link is no longer active.', 'stale_buying_link');
      link.status = 'withdrawn'; link.withdrawnAt = now(); addActivity(state, 'Buying link withdrawn', 'This association no longer supports evaluation or supplier-change graph paths.', 'You', { leadId, buyingLinkId: link.id });
    }); return project(id);
  };
  return { review, withdraw };
}
