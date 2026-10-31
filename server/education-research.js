import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { publicSourceUrl, readPublicSource, sourceSite } from './public-source.js';
import { costs } from './catalog.js';
import { communicationContext, requireAccountCommunication } from './communication-policy.js';
import { normalizePersonText as clean, personDateFresh, personReviewCurrent, personSourceKey } from '../src/people-evidence.js';
import { educationLabels, institutionIdentity } from '../src/education-evidence.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const includes = (text, value) => clean(text).toLowerCase().includes(clean(value).toLowerCase());
const leadFor = (state, leadId) => state.leads.find(item => item.id === leadId) || fail(404, 'Account not found in this business.', 'lead_not_found');
const personFor = (state, leadId, personReviewId) => (state.personReviews || []).find(item => item.id === personReviewId && item.leadId === leadId) || fail(404, 'Published person review not found in this account.', 'person_review_not_found');
const runFor = (state, leadId, id) => (state.educationResearch || []).find(item => item.id === id && item.leadId === leadId) || fail(404, 'Education source research not found in this account.', 'education_research_not_found');
const field = (value, max) => { const text = clean(value); if (!text || text.length > max) fail(400, 'Complete the education evidence fields within their length limits.', 'invalid_education_review'); return text; };
const quote = (page, value, names, max) => {
  const text = field(value, max);
  if (text.length < 12 || !includes(page?.text, text) || names.some(name => !includes(text, name))) fail(400, 'Copy an exact retained source passage containing the requested person and institution names.', 'ungrounded_education_quote');
  return text;
};
export function markEducationProjection(store, id, projected) {
  const ids = new Set((projected.educationOperations || []).map(item => item.id));
  if (!(store.read(id).educationOperations || []).some(item => ids.has(item.id) && item.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const item of state.educationOperations || []) if (ids.has(item.id)) item.graphStatus = 'synced'; });
}
// Called by both people and education refreshes, including failed retrievals.
export function checkEducationSources(state, outcomes, runId) {
  let changed = false;
  for (const review of (state.educationReviews || []).filter(item => item.status === 'reviewed')) {
    const checks = outcomes.filter(item => item.url === review.source || item.url === review.institution.identitySource);
    if (!checks.some(item => !item.page || !includes(item.page.text, item.url === review.source ? review.quote : review.institution.identityQuote))) continue;
    review.status = 'needs_review'; review.sourceChangedAt = now(); changed = true;
    state.educationOperations ||= [];
    state.educationOperations.unshift({ id: randomUUID(), leadId: review.leadId, reviewId: review.id, action: 'source_refresh_requires_review', hash: digest({ runId, reviewId: review.id }), at: now(), graphStatus: 'pending' });
    addActivity(state, 'Education evidence needs review', `${review.institution.name}; a supporting passage changed or could not be retrieved. Its education paths are suspended.`, 'Source reviewer', { leadId: review.leadId, educationReviewId: review.id });
  }
  return changed;
}
export function createEducationResearch({ store, graph, competitors, snapshot, profileDigest, checkSources = checkEducationSources, markSourceProjection = () => {}, readSource = readPublicSource }) {
  const project = async id => {
    const state = store.read(id);
    try { await graph.sync(state, competitors[id]); markEducationProjection(store, id, state); markSourceProjection(store, id, state); } catch { /* Durable decisions can repair graph projection on replay or query. */ }
    return snapshot(id);
  };
  const requireContext = (state, lead, person, run) => {
    requireAccountCommunication(state, lead);
    if (!state.approved || !personReviewCurrent(person, lead)) fail(409, 'Approve the profile and review current published person evidence first.', 'education_person_review_required');
    if (run && (run.profileHash !== profileDigest(state) || run.accountKey !== personSourceKey(lead) || run.communicationContext !== communicationContext(state))) fail(409, 'Profile, person context or communication preferences changed. Fetch fresh education sources.', 'stale_education_context');
  };
  const operation = (id, leadId, input, action, values, apply) => {
    if (!uuid(input.requestId) || !input.acknowledged) fail(400, 'Review and acknowledge this education decision.', 'education_acknowledgement_required');
    const initial = store.read(id); leadFor(initial, leadId); const hash = digest({ leadId, action, values });
    const old = (initial.educationOperations || []).find(item => item.id === input.requestId);
    if (old) { if (old.hash !== hash) fail(409, 'This request ID belongs to another education decision.', 'education_request_conflict'); return; }
    if ((initial.educationOperations || []).length >= 1000) fail(409, 'Export education history before adding more decisions.', 'education_history_limit');
    store.mutate(id, state => {
      apply(state, leadFor(state, leadId)); state.educationOperations ||= [];
      state.educationOperations.unshift({ id: input.requestId, leadId, action, hash, at: now(), graphStatus: 'pending' });
    }, input.revision);
  };
  const start = (id, leadId, input) => {
    if (!uuid(input.requestId)) fail(400, 'Use a valid request ID.', 'invalid_education_request');
    const initial = store.read(id), lead = leadFor(initial, leadId), person = personFor(initial, leadId, input.personReviewId);
    const sourceUrl = publicSourceUrl(person.source, sourceSite(`https://${lead.domain}`)).href;
    const identityUrl = publicSourceUrl(input.identityUrl).href;
    if (sourceSite(sourceUrl) === sourceSite(identityUrl)) fail(400, 'Use a separate institution-owned identity page.', 'institution_identity_required');
    const hash = digest({ leadId, personReviewId: person.id, sourceUrl, identityUrl });
    const previous = (initial.educationResearch || []).find(item => item.id === input.requestId);
    if (previous) { if (previous.requestHash !== hash) fail(409, 'This request ID belongs to other education research.', 'education_request_conflict'); return { id: previous.id, jobId: previous.jobId }; }
    requireContext(initial, lead, person);
    if (initial.revision !== input.revision) fail(409, 'Refresh this workspace before research.', 'revision_conflict');
    if (initial.jobs.some(item => item.status === 'running')) fail(409, 'Wait for current source research to finish.', 'job_running');
    if ((initial.educationResearch || []).length >= 100 || (initial.educationResearch || []).filter(item => item.status === 'ready').length >= 10) fail(409, 'Review or dismiss pending education sources before more research.', 'education_research_limit');
    const reservation = store.reserve(id, 'people_research', costs.people_research, leadId);
    const job = { id: randomUUID(), kind: 'education_research', status: 'running', reservation, startedAt: now(), steps: [] };
    const run = { id: input.requestId, jobId: job.id, leadId, personReviewId: person.id, personKey: person.personKey, sourceUrl, identityUrl, requestHash: hash, accountKey: personSourceKey(lead), profileHash: profileDigest(initial), communicationContext: communicationContext(initial), reservation, status: 'running', startedAt: now(), pages: [] };
    store.mutate(id, state => { state.educationResearch ||= []; state.educationResearch.unshift(run); state.jobs.unshift(job); state.wallet.ledger.find(item => item.id === reservation).researchType = 'education'; addActivity(state, 'Education source research started', `${person.name}; company biography and institution identity page. Two local public-person-research credits reserved.`, 'Planner', { leadId }); });
    const completion = (async () => {
      let outcomes = [], changed = false;
      try {
        const urls = [sourceUrl, identityUrl];
        const results = await Promise.allSettled(urls.map(async url => {
          const page = await readSource(url); publicSourceUrl(page.finalUrl || page.url, sourceSite(url));
          if (page.url !== url || page.fetchStatus !== 'reachable' || typeof page.text !== 'string' || page.text.length < 30 || page.text.length > 48000 || !personDateFresh(page.checkedAt, Date.now(), 1)) fail(502, 'A readable, current source snapshot was not returned.', 'invalid_education_source');
          return { url, finalUrl: page.finalUrl || url, text: page.text, title: page.title || 'Education source', checkedAt: page.checkedAt, contentHash: digest(page.text) };
        }));
        outcomes = results.map((result, index) => ({ url: urls[index], page: result.status === 'fulfilled' ? result.value : null }));
        const failure = results.find(item => item.status === 'rejected'); if (failure) throw failure.reason;
        store.mutate(id, state => {
          changed = checkSources(state, outcomes, run.id); requireContext(state, leadFor(state, leadId), personFor(state, leadId, person.id), run);
          Object.assign(runFor(state, leadId, run.id), { status: 'ready', pages: outcomes.map(item => item.page), completedAt: now() });
          Object.assign(state.jobs.find(item => item.id === job.id), { status: 'completed', completedAt: now(), steps: [{ actor: 'Builder', summary: 'Company biography and institution reference fetched with bounded pinned HTTPS.', at: now() }, { actor: 'Reviewer', summary: 'Education not inferred. Exact passages and your assessment are required.', at: now() }] });
          addActivity(state, 'Education sources ready', `${person.name}; no education claim admitted or outreach authorized.`, 'Reviewer', { leadId });
        });
        store.settle(id, reservation, true);
        if (changed) await project(id);
      } catch (error) {
        store.settle(id, reservation, false);
        store.mutate(id, state => {
          changed = checkSources(state, outcomes, run.id);
          const message = error instanceof AppError ? error.message : 'Education source retrieval failed. Local credits refunded.';
          Object.assign(runFor(state, leadId, run.id), { status: 'failed', error: message, errorCode: error instanceof AppError ? error.code : 'education_source_unavailable', completedAt: now() });
          Object.assign(state.jobs.find(item => item.id === job.id), { status: 'failed', error: message, completedAt: now() });
        });
        if (changed) await project(id);
      }
    })();
    return { id: run.id, jobId: job.id, completion };
  };
  const review = async (id, leadId, runId, input) => {
    const values = { runId, institutionName: clean(input.institutionName), kind: input.kind, educationQuote: clean(input.educationQuote), identityQuote: clean(input.identityQuote) };
    operation(id, leadId, input, 'review', values, (state, lead) => {
      const run = runFor(state, leadId, runId), person = personFor(state, leadId, run.personReviewId);
      requireContext(state, lead, person, run);
      if (run.status !== 'ready' || person.personKey !== run.personKey) fail(409, 'Fetch sources for this exact reviewed person first.', 'stale_education_context');
      if (run.pages.some(page => !personDateFresh(page.checkedAt, Date.now(), 1))) fail(409, 'Education source snapshots are over 24 hours old. Fetch fresh sources.', 'education_source_expired');
      if ((state.educationReviews || []).length >= 500) fail(409, 'Export education review history before adding more.', 'education_review_limit');
      const name = field(values.institutionName, 200);
      if (!Object.hasOwn(educationLabels, values.kind)) fail(400, 'Choose published study/attendance or degree claim.', 'invalid_education_review');
      const biography = run.pages.find(page => page.url === run.sourceUrl), identity = run.pages.find(page => page.url === run.identityUrl);
      const educationQuote = quote(biography, values.educationQuote, [person.name, name], 2000), identityQuote = quote(identity, values.identityQuote, [name], 600);
      const terms = values.kind === 'degree' ? /graduat|degree|bachelor|master|doctor|ph\.?d|\bmba\b|diploma/i : /graduat|degree|bachelor|master|doctor|ph\.?d|\bmba\b|diploma|studied|study|alumn|attend|education/i;
      if (!terms.test(educationQuote)) fail(400, 'The education passage must explicitly describe study, attendance or a degree; employment and partnerships are not education.', 'education_claim_required');
      const institution = { name, domain: sourceSite(identity.url), identitySource: identity.url, identityQuote, checkedAt: identity.checkedAt };
      const institutionKey = digest(institutionIdentity(institution.domain, name));
      state.educationReviews ||= [];
      for (const previous of state.educationReviews.filter(item => item.personReviewId === person.id && item.institutionKey === institutionKey && ['reviewed', 'needs_review'].includes(item.status))) { previous.status = 'superseded'; previous.supersededAt = now(); }
      state.educationReviews.unshift({ id: input.requestId, leadId, runId, personReviewId: person.id, personKey: person.personKey, accountKey: run.accountKey, institutionKey, institution, kind: values.kind, quote: educationQuote, source: biography.url, checkedAt: biography.checkedAt, status: 'reviewed', reviewedAt: now(), reviewedBy: 'You' });
      addActivity(state, 'Published education reviewed', `${person.name}; ${name}. Public claim reviewed by you; degree, attendance and dates are not independently verified.`, 'You', { leadId, educationReviewId: input.requestId });
    });
    return project(id);
  };
  const withdraw = async (id, leadId, input) => {
    operation(id, leadId, input, 'withdraw', { reviewId: input.reviewId }, state => {
      const record = (state.educationReviews || []).find(item => item.id === input.reviewId && item.leadId === leadId);
      if (!record || !['reviewed', 'needs_review'].includes(record.status)) fail(409, 'This education review is no longer active.', 'stale_education_review');
      record.status = 'withdrawn'; record.withdrawnAt = now(); addActivity(state, 'Education review withdrawn', `${record.institution.name}; no longer supports education introduction paths.`, 'You', { leadId });
    });
    return project(id);
  };
  const dismiss = (id, leadId, runId, revision) => { store.mutate(id, state => { const run = runFor(state, leadId, runId); if (run.status === 'running') fail(409, 'Wait for retrieval to finish.', 'job_running'); if (run.status === 'ready') { run.status = 'dismissed'; run.dismissedAt = now(); } }, revision); return snapshot(id); };
  return { start, review, withdraw, dismiss };
}
