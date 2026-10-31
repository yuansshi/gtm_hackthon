import { randomUUID } from 'node:crypto';
import { AppError, addActivity, digest, now } from './store.js';
import { businessById } from '../src/businesses.js';
import { costs } from './catalog.js';
import { scoreAccount } from './evidence.js';
import { publicSourceUrl, readPublicSource, sourceSite } from './public-source.js';
import { invalidateAccountDrafts } from './review-policy.js';
import { mergeAccountPeople } from './contact-enrichment.js';

const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
const containsQuote = (page, text) => normalized(page.text).toLowerCase().includes(normalized(text).toLowerCase());
const sourceRecord = ({ text, emails, site, ...record }) => record;
const validRequestId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const usAddress = quote => /\bUnited States\b|\bU\.?S\.?A\.?\b/i.test(quote) || /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s+\d{5}(?:-\d{4})?\b/.test(quote);

export function markWebsiteProjection(store, id, projected) {
  const ids = new Set((projected.sourceIntakes || []).filter(intake => intake.status === 'accepted').map(intake => intake.id));
  if (!(store.read(id).sourceIntakes || []).some(intake => ids.has(intake.id) && intake.graphStatus !== 'synced')) return;
  store.mutate(id, state => { for (const intake of state.sourceIntakes || []) if (ids.has(intake.id)) intake.graphStatus = 'synced'; });
}

export async function reviewWebsiteCandidate(candidate, state, readSource = readPublicSource) {
  const urls = [...new Set(Object.values(candidate.evidenceQuotes).map(quote => quote.url))];
  const pages = await Promise.allSettled(urls.map(url => readSource(url)));
  const successful = pages.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const reviews = pages.map((result, index) => result.status === 'fulfilled' ? sourceRecord(result.value) : { url: urls[index], checkedAt: now(), fetchStatus: 'failed', error: result.reason instanceof AppError ? result.reason.code : 'source_unavailable', preview: '' });
  const unchanged = Object.values(candidate.evidenceQuotes).every(quote => successful.some(page => page.url === quote.url && containsQuote(page, quote.text))) && (!candidate.publicEmail || successful.some(page => page.emails.includes(candidate.publicEmail)));
  const needsReview = !!candidate.evidenceNeedsReview || !unchanged;
  return { ...candidate, businessId: state.businessId, sourceEvidenceState: needsReview ? 'needs_review' : 'quote_present', evidenceNeedsReview: needsReview, fit: scoreAccount(candidate, state), stage: 'Matched', selected: false, sourceReviews: reviews, researchedAt: now(), evidenceStatus: needsReview ? 'Website evidence needs a new review' : 'Owner-reviewed primary-source quotes', contact: { email: candidate.publicEmail, emailKind: candidate.publicEmail ? 'Published address selected by reviewer' : 'No public email established', source: candidate.contactSource, mailboxStatus: 'unverified', mxStatus: 'not_checked', linkedIn: null, roleMatch: 'Buying responsibility unverified' }, owner: 'You', events: [{ stage: 'Matched', at: now(), actor: 'You', mode: 'research' }] };
}

export function createWebsiteIntake({ store, graph, competitors, snapshot, profileDigest, exclusionReason, readSource = readPublicSource }) {
  const findIntake = (state, intakeId) => { const intake = (state.sourceIntakes || []).find(intake => intake.id === intakeId); if (!intake) throw new AppError(404, 'Website intake not found in this business.', 'intake_not_found'); return intake; };
  const start = (id, input) => {
    if (!validRequestId(input?.requestId) || !Array.isArray(input.urls) || !input.urls.length || input.urls.length > 2) throw new AppError(400, 'Supply one or two company pages and a valid request ID.', 'invalid_source_intake');
    const urls = [...new Set(input.urls.map(value => publicSourceUrl(value).href))]; const site = sourceSite(urls[0]);
    urls.forEach(url => publicSourceUrl(url, site));
    const initial = store.read(id); const requestHash = digest({ urls });
    const previous = (initial.sourceIntakes || []).find(intake => intake.id === input.requestId);
    if (previous) { if (previous.requestHash !== requestHash) throw new AppError(409, 'This request ID belongs to different source pages.', 'intake_request_conflict'); return { id: previous.id, jobId: previous.jobId }; }
    if (!initial.approved) throw new AppError(409, 'Approve the customer profile before researching a website.', 'profile_approval_required');
    if (initial.revision !== input.revision) throw new AppError(409, 'This workspace changed. Refresh before researching sources.', 'revision_conflict');
    if (initial.jobs.some(job => job.status === 'running')) throw new AppError(409, 'Wait for the current source research job to finish.', 'job_running');
    if ((initial.sourceIntakes || []).filter(intake => ['running', 'ready'].includes(intake.status)).length >= 10) throw new AppError(409, 'Review or dismiss pending website intakes before starting more.', 'intake_limit');
    if (initial.leads.some(lead => lead.domain.replace(/^www\./, '') === site && !lead.customEvidence)) throw new AppError(409, 'This account is already in the researched collection. Open its record to inspect it.', 'account_exists');
    const reservation = store.reserve(id, 'discovery', costs.discovery);
    const job = { id: randomUUID(), kind: 'website_intake', intakeId: input.requestId, status: 'running', startedAt: now(), steps: [], reservation };
    const intake = { id: input.requestId, jobId: job.id, businessId: id, site, urls, requestHash, profileHash: profileDigest(initial), status: 'running', startedAt: now(), reservation, pages: [] };
    store.mutate(id, state => { state.sourceIntakes ||= []; state.sourceIntakes.unshift(intake); state.jobs.unshift(job); const entry = state.wallet.ledger.find(entry => entry.id === reservation); entry.sourceSite = site; entry.sourceIntakeId = intake.id; addActivity(state, 'Website research started', `${site}; ${urls.length} source page(s). Account admission requires quoted evidence review.`, 'Planner'); });
    const step = (actor, summary) => store.mutate(id, state => { state.jobs.find(item => item.id === job.id).steps.push({ actor, summary, at: now() }); });
    const completion = (async () => {
      try {
        step('Planner', `Scope: ${site}, ${urls.length} same-site public pages, ${initial.company.name} only.`);
        step('Builder', 'Retrieving bounded HTML/text with pinned public DNS addresses and hostname TLS verification.');
        const results = await Promise.allSettled(urls.map(url => readSource(url)));
        const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
        const pages = results.map(result => result.value);
        step('Reviewer', 'Source text is retained for exact quote review. No buyer, address deliverability, or purchase intent is inferred.');
        step('Security reviewer', 'No page scripts, embedded instructions, cookies, authentication headers, or model requests were executed.');
        store.mutate(id, state => {
          if (!state.approved || profileDigest(state) !== intake.profileHash) throw new AppError(409, 'The profile changed during source retrieval. Start a new intake for the approved profile.', 'stale_research');
          const current = findIntake(state, intake.id); current.status = 'ready'; current.pages = pages; current.completedAt = now();
          const currentJob = state.jobs.find(item => item.id === job.id); currentJob.status = 'completed'; currentJob.completedAt = now();
          addActivity(state, 'Website sources ready for review', `${site}; ${pages.length} pages retrieved. No account has been added or shortlisted.`, 'Reviewer');
        });
        store.settle(id, reservation, true);
      } catch (error) {
        store.settle(id, reservation, false);
        store.mutate(id, state => { const current = findIntake(state, intake.id); current.status = 'failed'; current.error = error instanceof AppError ? error.message : 'Source retrieval failed. No account was added.'; current.errorCode = error instanceof AppError ? error.code : 'source_unavailable'; current.completedAt = now(); const currentJob = state.jobs.find(item => item.id === job.id); currentJob.status = 'failed'; currentJob.error = current.error; currentJob.completedAt = now(); addActivity(state, 'Website research failed', `${site}; ${current.error} Reserved credits were refunded.`, 'Reviewer'); });
      }
    })();
    return { id: intake.id, jobId: job.id, completion };
  };

  const review = async (id, intakeId, input) => {
    if (!input?.acknowledged) throw new AppError(400, 'Confirm the company, geography, OEM, and source quote review.', 'source_review_required');
    const initial = store.read(id); const intake = findIntake(initial, intakeId);
    const fields = ['name', 'industry', 'location', 'country', 'buyerType', 'productFamily', 'application', 'reason'];
    const values = Object.fromEntries(fields.map(field => [field, normalized(input[field])]));
    if (fields.some(field => !values[field] || values[field].length > (field === 'reason' ? 1000 : 500))) throw new AppError(400, 'Complete the account and application fields.', 'invalid_account_review');
    const quotes = Object.fromEntries(['application', 'geography', 'organization'].map(field => [field, { url: input.quotes?.[field]?.url || '', text: normalized(input.quotes?.[field]?.text) }]));
    const publicEmail = input.publicEmail ? normalized(input.publicEmail).toLowerCase() : null;
    const reviewHash = digest({ values, quotes, publicEmail });
    if (intake.status === 'accepted') {
      if (intake.reviewHash !== reviewHash) throw new AppError(409, 'This intake already has a different accepted review. Research fresh sources to change it.', 'intake_already_reviewed');
    } else {
      if (intake.status !== 'ready') throw new AppError(409, 'Retrieve readable sources before reviewing this intake.', 'intake_not_ready');
      if (initial.jobs.some(job => job.status === 'running')) throw new AppError(409, 'Wait for current source research to finish before admitting an account.', 'job_running');
      if (!initial.approved || intake.profileHash !== profileDigest(initial)) throw new AppError(409, 'Approve the current profile and fetch fresh sources for it.', 'stale_research');
      if (intake.pages.some(page => Date.now() - Date.parse(page.checkedAt) > 86400000 || !Number.isFinite(Date.parse(page.checkedAt)))) throw new AppError(409, 'These source snapshots are over 24 hours old. Retrieve fresh pages before admission.', 'source_snapshot_expired');
      if (!intake.pages.some(page => containsQuote(page, values.name))) throw new AppError(400, 'Use a company name that appears in the fetched source text.', 'company_evidence_required');
      for (const quote of Object.values(quotes)) if (quote.text.length < 12 || quote.text.length > 600 || !intake.pages.some(page => page.url === quote.url && containsQuote(page, quote.text))) throw new AppError(400, 'Each evidence quote must occur in its selected fetched page. Copy the relevant source text exactly.', 'ungrounded_source_quote');
      if (values.country === 'United States' && !usAddress(quotes.geography.text)) throw new AppError(400, 'The geography quote must identify the United States or a US state abbreviation with ZIP code.', 'country_evidence_required');
      if (values.buyerType !== 'OEM' || !/\bmanufactur(?:er|ers|ing|ed|e|es)\b|\bdesigns?\b|\bbuilds?\b/i.test(quotes.organization.text)) throw new AppError(400, 'Review a source quote supporting an equipment manufacturer. Other buyer types are not supported by this campaign collection.', 'oem_evidence_required');
      if (!businessById(id).families.some(([key]) => key === values.productFamily)) throw new AppError(400, 'Choose a product family belonging to this business.', 'invalid_profile_scope');
      if (publicEmail && !intake.pages.some(page => page.emails.includes(publicEmail))) throw new AppError(400, 'Select an address actually published in a fetched page, or leave it unknown.', 'unpublished_contact');
      const existing = initial.leads.find(lead => lead.domain.replace(/^www\./, '') === intake.site);
      if (existing && !existing.customEvidence) throw new AppError(409, 'This company already exists in the researched collection.', 'account_exists');
      const candidate = { id: existing?.id || `web-${randomUUID()}`, name: values.name, domain: intake.site, country: values.country, location: values.location, industry: values.industry, tier: 'OEM', application: values.application, reason: values.reason, businesses: [id], productFamily: values.productFamily, source: quotes.application.url, contactSource: quotes.geography.url, publicEmail, people: [], customEvidence: true, evidenceNeedsReview: false, sourceEvidenceState: 'quote_present', evidenceQuotes: quotes, factEvidence: [quotes.organization, quotes.geography, quotes.application], facts: [quotes.organization.text, quotes.geography.text, quotes.application.text], signal: { title: 'Owner-reviewed application evidence', kind: 'Application', intent: 'Application hypothesis only; no buying cycle or supplier opening verified', source: quotes.application.url }, sourceIntakeId: intake.id, evidenceReviewedAt: now() };
      const exclusion = exclusionReason(candidate, initial); if (exclusion) throw new AppError(409, exclusion, 'account_excluded');
      const lead = { ...candidate, businessId: id, fit: scoreAccount(candidate, initial), stage: 'Matched', selected: false, sourceReviews: intake.pages.map(sourceRecord), researchedAt: now(), evidenceStatus: 'Owner-reviewed primary-source quotes', owner: 'You', contact: { email: publicEmail, emailKind: publicEmail ? 'Published address selected by reviewer' : 'No public email established', source: publicEmail ? intake.pages.find(page => page.emails.includes(publicEmail)).url : candidate.contactSource, mxStatus: 'not_checked', mailboxStatus: 'unverified', linkedIn: null, roleMatch: 'Named buying responsibility unverified' }, events: [{ stage: 'Matched', at: now(), actor: 'You', mode: 'research' }] };
      store.mutate(id, state => {
        const current = findIntake(state, intakeId);
        if (state.revision !== input.revision || !state.approved || profileDigest(state) !== intake.profileHash || current.status !== 'ready') throw new AppError(409, 'The workspace changed. Refresh and review the current profile and sources.', 'revision_conflict');
        if (existing) { const currentLead = state.leads.find(item => item.id === existing.id); Object.assign(currentLead, lead, { stage: currentLead.stage, selected: false, events: currentLead.events, people: mergeAccountPeople(lead.people, currentLead.vendorPeople), contact: currentLead.contact.email === publicEmail ? currentLead.contact : lead.contact }); invalidateAccountDrafts(state, lead.id, { reason: 'account_source_changed', intakeId }); }
        else state.leads.push(lead);
        state.customCandidates ||= []; state.customCandidates = [...state.customCandidates.filter(item => item.domain !== candidate.domain), candidate];
        current.status = 'accepted'; current.leadId = lead.id; current.reviewHash = reviewHash; current.review = { ...values, quotes, publicEmail }; current.reviewedAt = now(); current.graphStatus = 'pending';
        const entry = state.wallet.ledger.find(entry => entry.id === current.reservation); if (entry) entry.leadId = lead.id;
        addActivity(state, existing ? 'Website account evidence updated' : 'Website account admitted', `${candidate.name}; exact primary-source quotes reviewed by you. Not shortlisted; buyer authority and intent remain unverified.`, 'You', { leadId: lead.id, sourceIntakeId: intakeId });
      });
    }
    const saved = store.read(id);
    if (findIntake(saved, intakeId).graphStatus !== 'synced') { try { await graph.sync(saved, competitors[id]); markWebsiteProjection(store, id, saved); } catch { /* Account admission is durable; a replay or graph query repairs projection. */ } }
    return { ...snapshot(id), admittedLeadId: findIntake(store.read(id), intakeId).leadId, activeSourceIntakeId: intakeId };
  };
  const dismiss = (id, intakeId) => {
    store.mutate(id, state => { const intake = findIntake(state, intakeId); if (!['ready', 'failed', 'dismissed'].includes(intake.status)) throw new AppError(409, 'Wait for source work to finish; accepted records stay in the account collection.', 'intake_not_dismissible'); if (intake.status !== 'dismissed') { intake.status = 'dismissed'; intake.dismissedAt = now(); addActivity(state, 'Website intake dismissed', `${intake.site}; no account was added. Completed source work is not refunded.`, 'You'); } });
    return snapshot(id);
  };
  return { start, review, dismiss };
}
