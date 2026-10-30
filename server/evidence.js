import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { lookup, resolveMx } from 'node:dns/promises';
import { isIP } from 'node:net';
import { researchCatalog, competitors } from './catalog.js';
import { businesses } from '../src/businesses.js';
import { AppError, now } from './store.js';

const approvedHosts = new Set([
  ...researchCatalog.flatMap(c => [c.source, c.contactSource, c.signal.source, ...c.people.map(p => p.source)]),
  ...businesses.flatMap(b => b.sources), ...Object.values(competitors).flat().map(c => c.source).filter(Boolean),
].map(u => new URL(u).hostname.replace(/^www\./, '')));

export function privateAddress(ip) {
  return !isIP(ip) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|224\.|240\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === '::1' || ip === '::' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip) || ip.includes('::ffff:');
}
export async function checkSourceUrl(value, resolver = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new AppError(400, 'A valid public source URL is required.', 'invalid_source'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !approvedHosts.has(url.hostname.replace(/^www\./, ''))) throw new AppError(400, 'Only allowlisted public HTTPS research sources can be fetched.', 'source_not_allowed');
  const addresses = await resolver(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new AppError(400, 'Private or reserved source address blocked.', 'private_source');
  return url;
}

export async function fetchSource(url, { fetcher = fetch, resolver = lookup } = {}) {
  let current = url;
  for (let redirect = 0; redirect < 4; redirect++) {
    const checked = await checkSourceUrl(current, resolver);
    const response = await fetcher(checked, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'GTM-Engine-Research/0.3 (public-source review)', Accept: 'text/html,text/plain' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = new URL(response.headers.get('location'), checked).href; await response.body?.cancel(); continue;
    }
    if (!response.ok) throw new AppError(502, `Source returned HTTP ${response.status}.`, 'source_fetch_failed');
    const type = response.headers.get('content-type') || '';
    if (!/text\/(html|plain)/i.test(type)) throw new AppError(400, 'This research path accepts HTML and text sources only.', 'unsupported_source_type');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > 2_000_000) throw new AppError(400, 'Source exceeds the review size limit.', 'source_too_large'); chunks.push(chunk); }
    const html = Buffer.concat(chunks).toString('utf8'); const $ = load(html);
    const title = $('title').text().trim().slice(0, 180);
    $('script,style,noscript,nav,header,footer,form,svg').remove();
    const text = ($('main').text() || $('body').text()).replace(/\s+/g, ' ').trim();
    return { url: checked.href, finalUrl: current, title, checkedAt: now(), fetchStatus: 'reachable', contentHash: createHash('sha256').update(text).digest('hex'), preview: text.split(/\s+/).slice(0, 18).join(' '), text };
  }
  throw new AppError(400, 'Too many source redirects.', 'source_redirect_limit');
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

export async function reviewCandidate(candidate, state, options) {
  const urls = [...new Set([candidate.source, candidate.contactSource, candidate.signal.source, ...candidate.people.map(p => p.source)])];
  const reviews = await Promise.all(urls.map(async url => {
    try { const { text, ...review } = await fetchSource(url, options); return review; }
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
