import { lookup, resolveMx } from 'node:dns/promises';
import { researchCatalog, competitors } from './catalog.js';
import { businesses } from '../src/businesses.js';
import { AppError, now } from './store.js';
import { publicAddress, publicSourceUrl, readPublicSource } from './public-source.js';

const approvedHosts = new Set([
  ...researchCatalog.flatMap(c => [c.source, c.contactSource, c.signal.source, ...c.people.map(p => p.source)]),
  ...businesses.flatMap(b => b.sources), ...Object.values(competitors).flat().map(c => c.source).filter(Boolean),
].map(u => new URL(u).hostname.replace(/^www\./, '')));

export const privateAddress = ip => !publicAddress(ip);
function allowlistedSourceUrl(value) {
  const url=publicSourceUrl(value);
  if(!approvedHosts.has(url.hostname.replace(/^www\./,'')))throw new AppError(400,'Only allowlisted public HTTPS research sources can be fetched.','source_not_allowed');
  return url;
}
export async function checkSourceUrl(value, resolver = lookup) {
  // Diagnostic preflight only; a later request must resolve and pin its own address.
  const url=allowlistedSourceUrl(value);
  const addresses = await resolver(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new AppError(400, 'Private or reserved source address blocked.', 'private_source');
  return url;
}

export async function fetchSource(value, options = {}) {
  const url=allowlistedSourceUrl(value);
  // Do not silently ignore legacy test injection and make a real request.
  if(Object.hasOwn(options,'fetcher'))throw new TypeError('Use the pinned HTTPS transport or a reviewCandidate readSource fixture.');
  return readPublicSource(url.href,options);
}

export function scoreAccount(candidate, state) {
  const us = /united states|\busa?\b/i.test(state.icp.regions);
  const countryMatch = us && candidate.country === 'United States';
  const application = candidate.businesses.includes(state.businessId);
  const parts = [
    { label: 'Application relevance', value: application ? 35 : 0, maximum: 35, evidence: candidate.source },
    { label: 'Target geography', value: countryMatch ? 20 : 0, maximum: 20, evidence: candidate.contactSource },
    { label: 'Buyer segment', value: state.icp.segments.some(s => /OEM|manufacturer/i.test(s)) && candidate.tier === 'OEM' ? 20 : 10, maximum: 20, evidence: candidate.source },
    { label: 'Public technical / leadership context', value: candidate.people.length ? 10 : 5, maximum: 10, evidence: candidate.people[0]?.source || candidate.source },
    { label: 'Company size confirmed', value: 0, maximum: 5, evidence: null },
    { label: 'Purchase intent confirmed', value: 0, maximum: 10, evidence: null },
  ];
  const score = parts.reduce((sum, p) => sum + p.value, 0);
  return { score, tier: score >= 80 ? 'Tier A' : score >= 60 ? 'Tier B' : 'Tier C', breakdown: parts, technicalFit: 'Requires engineering review', intent: 'Unconfirmed', companySize: 'Unknown' };
}

export async function reviewCandidate(candidate, state, { readSource=fetchSource, ...options } = {}) {
  const urls = [...new Set([candidate.source, candidate.contactSource, candidate.signal.source, ...candidate.people.map(p => p.source)])];
  const reviews = await Promise.all(urls.map(async url => {
    try { const { text, ...review } = await readSource(url, options); return review; }
    catch (error) { return { url, checkedAt: now(), fetchStatus: 'failed', error: typeof error.code === 'string' ? error.code : 'source_unavailable', preview: '' }; }
  }));
  return {
    ...candidate, businessId: state.businessId, fit: scoreAccount(candidate, state), stage: 'Matched', selected: false,
    evidenceStatus: 'Primary-source research', researchedAt: now(), sourceReviews: reviews, reviewBasisDate: '2026-10-30',
    contact: { email: candidate.publicEmail, emailKind: candidate.publicEmail ? 'Published general company address' : 'No public email established', source: candidate.contactSource, mailboxStatus: 'unverified', mxStatus: 'not_checked', linkedIn: null, roleMatch: 'Named buyer responsibility not independently confirmed' },
    owner: 'You', events: [{ stage: 'Matched', at: now(), actor: 'Research agent', mode: 'research' }],
  };
}

export async function checkMx(email, resolver = resolveMx) {
  const domain = String(email).split('@')[1];
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { status: 'invalid', records: [] };
  try { const records = await resolver(domain); return { status: records.some(r => r.exchange && r.exchange !== '.') ? 'found' : 'missing', records: records.map(r => ({ exchange: r.exchange, priority: r.priority })) }; }
  catch { return { status: 'missing', records: [] }; }
}
