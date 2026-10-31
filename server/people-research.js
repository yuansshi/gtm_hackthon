import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { publicSourceUrl, readPublicSource, sourceSite } from './public-source.js';
import { costs } from './catalog.js';
import { normalizePersonText as clean, personDateFresh, personSourceKey, personReviewCurrent, relationshipLabels } from '../src/people-evidence.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const includes = (text, part) => clean(text).toLowerCase().includes(clean(part).toLowerCase());
const leadFor = (state, id) => state.leads.find(lead => lead.id === id) || fail(404, 'Account not found in this business.', 'lead_not_found');
const runFor = (state, leadId, id) => (state.peopleResearch || []).find(run => run.id === id && run.leadId === leadId) || fail(404, 'People research not found for this account.', 'people_research_not_found');
const reviewFor = (state, leadId, id) => (state.personReviews || []).find(review => review.id === id && review.leadId === leadId) || fail(404, 'Published person review not found for this account.', 'person_review_not_found');
const field = (value, label, max = 200) => {
  const result = clean(value);
  if (!result || result.length > max) fail(400, `Copy a ${label} from the source text (at most ${max} characters).`, 'invalid_person_review');
  return result;
};
const quote = (page, value, required, max = 2000) => {
  const text = field(value, 'source passage', max);
  if (text.length < 12 || !includes(page.text, text) || required.some(value => !includes(text, value))) fail(400, 'Each exact source passage must contain the requested person, role or organization names.', 'ungrounded_person_quote');
  return text;
};

export function markPersonProjection(store, id, projected) {
  const ids = new Set((projected.personOperations || []).map(item => item.id));
  if (!(store.read(id).personOperations || []).some(item => ids.has(item.id) && item.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const item of state.personOperations || []) if (ids.has(item.id)) item.graphStatus = 'synced'; });
}

export function createPeopleResearch({ store, graph, competitors, snapshot, profileDigest, readSource = readPublicSource }) {
  const project = async id => {
    const saved = store.read(id);
    try { await graph.sync(saved, competitors[id]); markPersonProjection(store, id, saved); }
    catch { /* Decisions are durable. A later graph query repairs the projection. */ }
    return snapshot(id);
  };
  const checkExistingReviews = (state, outcomes, runId) => {
    let changed = false;
    for (const review of (state.personReviews || []).filter(item => item.status === 'reviewed')) {
      const checks = outcomes.filter(item => item.url === review.source || item.url === review.formerEmployer?.identitySource);
      if (!checks.some(item => !item.page || (item.url === review.source && (!includes(item.page.text, review.roleQuote) || (review.formerEmployer && !includes(item.page.text, review.formerEmployer.quote)))) || (item.url === review.formerEmployer?.identitySource && !includes(item.page.text, review.formerEmployer.identityQuote)))) continue;
      review.status = 'needs_review'; review.sourceChangedAt = now(); changed = true;
      state.personOperations ||= [];
      state.personOperations.unshift({ id: randomUUID(), leadId: review.leadId, action: 'source_refresh_requires_review', hash: digest({ runId, reviewId: review.id }), at: now(), graphStatus: 'pending' });
      addActivity(state, 'Published person needs fresh review', `${review.name}; source retrieval failed or a supporting passage changed. Its introduction paths are suspended.`, 'Source reviewer', { leadId: review.leadId });
    }
    return changed;
  };
  const operation = (id, leadId, input, action, values, apply) => {
    if (!uuid(input.requestId) || !input.acknowledged) fail(400, 'Confirm this evidence or relationship decision.', 'person_acknowledgement_required');
    const state = store.read(id); leadFor(state, leadId);
    const hash = digest({ leadId, action, values });
    const old = (state.personOperations || []).find(item => item.id === input.requestId);
    if (old) {
      if (old.hash !== hash) fail(409, 'This request ID belongs to another person decision.', 'person_request_conflict');
      return false;
    }
    if ((state.personOperations || []).length >= 1000) fail(409, 'The person-decision history is full. Export it before extending this workspace.', 'person_history_limit');
    store.mutate(id, current => {
      apply(current, leadFor(current, leadId));
      current.personOperations ||= [];
      current.personOperations.unshift({ id: input.requestId, leadId, action, hash, at: now(), graphStatus: 'pending' });
    }, input.revision);
    return true;
  };
  const start = (id, leadId, input) => {
    if (!uuid(input.requestId)) fail(400, 'Use a valid request ID.', 'invalid_person_request');
    const initial = store.read(id); const lead = leadFor(initial, leadId);
    const sourceUrl = publicSourceUrl(input.sourceUrl, sourceSite(`https://${lead.domain}`)).href;
    const employerUrl = input.employerUrl ? publicSourceUrl(input.employerUrl).href : null;
    const hash = digest({ leadId, sourceUrl, employerUrl });
    const previous = (initial.peopleResearch || []).find(run => run.id === input.requestId);
    if (previous) {
      if (previous.requestHash !== hash) fail(409, 'This request ID belongs to different people research.', 'person_request_conflict');
      return { id: previous.id, jobId: previous.jobId };
    }
    if (!initial.approved || lead.evidenceNeedsReview) fail(409, 'Approve the current profile and account sources before people research.', 'profile_approval_required');
    if (initial.revision !== input.revision) fail(409, 'This workspace changed. Reload before researching people.', 'revision_conflict');
    if (initial.jobs.some(job => job.status === 'running')) fail(409, 'Wait for current source research to finish.', 'job_running');
    if ((initial.peopleResearch || []).length >= 100 || (initial.peopleResearch || []).filter(run => run.status === 'ready').length >= 10) fail(409, 'Review or dismiss pending people research before starting more.', 'people_research_limit');
    const reservation = store.reserve(id, 'people_research', costs.people_research, leadId);
    const job = { id: randomUUID(), kind: 'people_research', status: 'running', startedAt: now(), steps: [], reservation };
    const run = { id: input.requestId, jobId: job.id, leadId, sourceUrl, employerUrl, requestHash: hash, profileHash: profileDigest(initial), accountKey: personSourceKey(lead), status: 'running', startedAt: now(), reservation, pages: [] };
    store.mutate(id, state => { state.peopleResearch ||= []; state.peopleResearch.unshift(run); state.jobs.unshift(job); addActivity(state, 'People source research started', `${lead.name}; exact role and employment passages require review. Two local credits reserved.`, 'Planner', { leadId }); });
    const completion = (async () => {
      let outcomes = [], changed = false;
      try {
        const urls = [...new Set([sourceUrl, employerUrl].filter(Boolean))];
        const results = await Promise.allSettled(urls.map(async url => {
          const page = await readSource(url);
          publicSourceUrl(page.finalUrl || page.url, sourceSite(url));
          if (page.url !== url || page.fetchStatus !== 'reachable' || typeof page.text !== 'string' || page.text.length < 30 || page.text.length > 48000 || !personDateFresh(page.checkedAt, Date.now(), 1)) fail(502, 'A readable and dated source snapshot was not returned.', 'invalid_person_source');
          return { url, finalUrl: page.finalUrl || url, text: page.text, title: page.title || 'Company source', checkedAt: page.checkedAt, contentHash: digest(page.text) };
        }));
        outcomes = results.map((result, index) => ({ url: urls[index], page: result.status === 'fulfilled' ? result.value : null }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        const pages = outcomes.map(item => item.page);
        store.mutate(id, state => {
          changed = checkExistingReviews(state, outcomes, run.id);
          if (!state.approved || profileDigest(state) !== run.profileHash || personSourceKey(leadFor(state, leadId)) !== run.accountKey) fail(409, 'The account or profile changed during retrieval. Fetch fresh sources.', 'stale_person_context');
          Object.assign(runFor(state, leadId, run.id), { status: 'ready', pages, completedAt: now() });
          Object.assign(state.jobs.find(item => item.id === job.id), { status: 'completed', completedAt: now(), steps: [{ actor: 'Builder', summary: 'Bounded public pages fetched with pinned DNS and TLS verification.', at: now() }, { actor: 'Reviewer', summary: 'No person or connection inferred. Review exact source passages.', at: now() }] });
          addActivity(state, 'People sources ready', `${lead.name}; ${pages.length} source snapshots. No contacts or recipients changed.`, 'Reviewer', { leadId });
        });
        store.settle(id, reservation, true);
        if (changed) await project(id);
      } catch (error) {
        store.settle(id, reservation, false);
        store.mutate(id, state => {
          changed = checkExistingReviews(state, outcomes, run.id);
          const message = error instanceof AppError ? error.message : 'People source retrieval failed. Local credits refunded.';
          Object.assign(runFor(state, leadId, run.id), { status: 'failed', error: message, errorCode: error instanceof AppError ? error.code : 'person_source_unavailable', completedAt: now() });
          Object.assign(state.jobs.find(item => item.id === job.id), { status: 'failed', error: message, completedAt: now() });
        });
        if (changed) await project(id);
      }
    })();
    return { id: run.id, jobId: job.id, completion };
  };
  const review = async (id, leadId, runId, input) => {
    const values = { runId, name: clean(input.name), role: clean(input.role), roleQuote: clean(input.roleQuote), formerEmployer: input.formerEmployer ? { name: clean(input.formerEmployer.name), quote: clean(input.formerEmployer.quote), identityQuote: clean(input.formerEmployer.identityQuote) } : null };
    operation(id, leadId, input, 'review', values, (state, lead) => {
      const run = runFor(state, leadId, runId);
      if (run.status !== 'ready' || !state.approved || run.profileHash !== profileDigest(state) || run.accountKey !== personSourceKey(lead)) fail(409, 'Fetch fresh sources for the current approved profile and account.', 'stale_person_context');
      if (run.pages.some(page => !personDateFresh(page.checkedAt, Date.now(), 1))) fail(409, 'Source snapshots are over 24 hours old. Retrieve fresh pages.', 'person_source_expired');
      if ((state.personReviews || []).length >= 500) fail(409, 'This workspace has reached its published-person review limit.', 'person_review_limit');
      const name = field(values.name, 'full name'); const role = field(values.role, 'role');
      const page = run.pages.find(page => page.url === run.sourceUrl);
      const roleQuote = quote(page, values.roleQuote, [name, role]);
      let formerEmployer = null;
      if (values.formerEmployer) {
        const identity = run.pages.find(page => page.url === run.employerUrl);
        if (!identity || sourceSite(identity.url) === sourceSite(page.url)) fail(400, 'Fetch a separate employer-owned identity page before reviewing former employment.', 'employer_identity_required');
        const name = field(values.formerEmployer.name, 'former employer name');
        formerEmployer = { name, domain: sourceSite(identity.url), quote: quote(page, values.formerEmployer.quote, [values.name, name]), identityQuote: quote(identity, values.formerEmployer.identityQuote, [name], 600), identitySource: identity.url, checkedAt: identity.checkedAt };
      }
      const personKey = digest({ leadId, name: name.toLowerCase(), source: page.url });
      state.personReviews ||= [];
      for (const old of state.personReviews.filter(old => old.personKey === personKey && ['reviewed', 'needs_review'].includes(old.status))) { old.status = 'superseded'; old.supersededAt = now(); }
      state.personReviews.unshift({ id: input.requestId, personKey, leadId, runId, name, role, source: page.url, roleQuote, checkedAt: page.checkedAt, accountKey: run.accountKey, formerEmployer, status: 'reviewed', reviewedAt: now(), reviewedBy: 'You', qualification: 'Published role reviewed; current employment, authority and employment dates unverified.' });
      addActivity(state, 'Published person reviewed', `${name}; ${role}. Graph evidence only; mailbox and outreach unchanged.`, 'You', { leadId, personReviewId: input.requestId });
    });
    return project(id);
  };
  const withdraw = async (id, leadId, input) => {
    operation(id, leadId, input, 'withdraw', { reviewId: input.reviewId }, state => {
      const review = reviewFor(state, leadId, input.reviewId);
      if (!['reviewed', 'needs_review'].includes(review.status)) fail(409, 'This person review is no longer active.', 'stale_person_review');
      review.status = 'withdrawn'; review.withdrawnAt = now();
      addActivity(state, 'Published person withdrawn', `${review.name}; this review no longer supports introduction paths.`, 'You', { leadId });
    });
    return project(id);
  };
  const connection = async (id, leadId, input) => {
    const values = { reviewId: input.reviewId, relationship: input.relationship, note: clean(input.note) };
    operation(id, leadId, input, 'connection', values, (state, lead) => {
      const review = reviewFor(state, leadId, input.reviewId);
      if (!personReviewCurrent(review, lead)) fail(409, 'Review fresh person evidence before attesting a connection.', 'stale_person_review');
      if (!Object.hasOwn(relationshipLabels, input.relationship) || values.note.length > 500) fail(400, 'Choose a relationship and keep its local note within 500 characters.', 'invalid_connection');
      state.knownConnections ||= [];
      for (const old of state.knownConnections.filter(item => item.reviewId === review.id && item.status === 'active')) { old.status = 'superseded'; old.revokedAt = now(); }
      state.knownConnections.unshift({ id: input.requestId, reviewId: review.id, personKey: review.personKey, leadId, relationship: input.relationship, note: values.note, status: 'active', attestedAt: now(), actor: 'You' });
      addActivity(state, 'Local connection attested', `${review.name}; owner-reported relationship. No introduction sent.`, 'You', { leadId });
    });
    return project(id);
  };
  const revoke = async (id, leadId, input) => {
    operation(id, leadId, input, 'revoke', { connectionId: input.connectionId }, state => {
      const item = (state.knownConnections || []).find(item => item.id === input.connectionId && item.leadId === leadId);
      if (!item || item.status !== 'active') fail(409, 'This connection attestation is no longer active.', 'stale_connection');
      item.status = 'revoked'; item.revokedAt = now();
      addActivity(state, 'Local connection revoked', 'This attestation no longer supports an introduction path.', 'You', { leadId });
    });
    return project(id);
  };
  const dismiss = (id, leadId, runId, revision) => {
    store.mutate(id, state => { const run = runFor(state, leadId, runId); if (run.status === 'running') fail(409, 'Wait for this retrieval to finish.', 'job_running'); if (run.status === 'ready') { run.status = 'dismissed'; run.dismissedAt = now(); } }, revision);
    return snapshot(id);
  };
  return { start, review, withdraw, connection, revoke, dismiss };
}
