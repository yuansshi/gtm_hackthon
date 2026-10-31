import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { AppError, now } from './store.js';

export const sourceSite = value => new URL(value).hostname.toLowerCase().replace(/^www\./, '');
export function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('.') || address.includes('%')) return false;
  const parts = address.split(':'); const first = parseInt(parts[0], 16); const second = parseInt(parts[1] || '0', 16);
  return first >= 0x2000 && first < 0x4000 && first !== 0x2002 && first !== 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}
export function publicSourceUrl(value, site) {
  let url;
  if (typeof value !== 'string') throw new AppError(400, 'Enter a public HTTPS page URL.', 'invalid_source');
  try { url = new URL(value); } catch { throw new AppError(400, 'Enter a valid public HTTPS page URL.', 'invalid_source'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /\.(localhost|local|internal|home|lan|onion)$/i.test(host) || host.endsWith('.') || value.length > 2000) throw new AppError(400, 'Use a public HTTPS website on port 443 without embedded credentials.', 'source_not_allowed');
  if (site && sourceSite(url.href) !== site) throw new AppError(400, 'Use pages and redirects from the same company website.', 'source_site_mismatch');
  url.hash = ''; return url;
}

async function resolvePublic(hostname, resolver, remaining) {
  let timer;
  try {
    const addresses = await Promise.race([resolver(hostname, { all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError(504, 'Source lookup timed out.', 'source_timeout')), remaining); })]);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new AppError(400, 'Private or reserved source addresses are blocked.', 'private_source');
    return addresses.map(item => ({ address: item.address, family: isIP(item.address) }));
  } finally { clearTimeout(timer); }
}

async function requestPage(url, pinned, transport, remaining) {
  return new Promise((resolve, reject) => {
    const options = { method: 'GET', agent: false, autoSelectFamily: false, family: pinned.family, servername: url.hostname, rejectUnauthorized: true, signal: AbortSignal.timeout(remaining), headers: { 'User-Agent': 'GTM-Engine-SourceReview/0.4', Accept: 'text/html,text/plain', 'Accept-Encoding': 'identity' }, lookup: (hostname, settings, callback) => {
      if (hostname !== url.hostname) return callback(new AppError(400, 'Unexpected source hostname.', 'source_not_allowed'));
      if (settings?.all) callback(null, [pinned]); else callback(null, pinned.address, pinned.family);
    } };
    let outgoing;
    try {
      outgoing = transport(url, options, async response => {
        try {
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) { resolve({ redirect: response.headers.location }); response.destroy(); return; }
          if (response.statusCode < 200 || response.statusCode >= 300) throw new AppError(502, `Source returned HTTP ${response.statusCode}.`, 'source_fetch_failed');
          if (!/^text\/(html|plain)(?:;|$)/i.test(response.headers['content-type'] || '')) throw new AppError(400, 'Use an HTML or plain-text source page.', 'unsupported_source_type');
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new AppError(400, 'Compressed source responses are not supported in this review path.', 'unsupported_source_encoding');
          let size = 0; const chunks = [];
          for await (const chunk of response) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1_000_000) throw new AppError(400, 'Source page exceeds the review size limit.', 'source_too_large'); chunks.push(buffer); }
          resolve({ html: Buffer.concat(chunks).toString('utf8') });
        } catch (error) { response.destroy(); reject(error); }
      });
      outgoing.on('error', error => reject(error instanceof AppError ? error : new AppError(502, 'The public source could not be retrieved securely. Check the URL or try another page.', 'source_fetch_failed')));
      outgoing.end();
    } catch (error) { outgoing?.destroy(); reject(error instanceof AppError ? error : new AppError(502, 'The public source request failed.', 'source_fetch_failed')); }
  });
}

export async function readPublicSource(value, { resolver = lookup, transport = request, deadlineMs = 15000, clock = () => performance.now() } = {}) {
  const initial = publicSourceUrl(value); const site = sourceSite(initial.href); const deadline = clock() + deadlineMs;
  let current = initial;
  for (let hop = 0; hop < 4; hop++) {
    const remaining = Math.ceil(deadline - clock());
    if (remaining <= 0) throw new AppError(504, 'Source review timed out.', 'source_timeout');
    current = publicSourceUrl(current.href, site);
    const addresses = await resolvePublic(current.hostname, resolver, remaining);
    const timeout = Math.ceil(deadline - clock());
    if (timeout <= 0) throw new AppError(504, 'Source review timed out.', 'source_timeout');
    const result = await requestPage(current, addresses[0], transport, timeout);
    if (Object.hasOwn(result, 'redirect')) {
      if (!result.redirect) throw new AppError(400, 'Source redirect has no destination.', 'invalid_source_redirect');
      let destination; try { destination = new URL(result.redirect, current).href; } catch { throw new AppError(400, 'Invalid source redirect.', 'invalid_source_redirect'); }
      current = publicSourceUrl(destination, site); continue;
    }
    const $ = load(result.html); const title = $('title').text().replace(/\s+/g, ' ').trim().slice(0, 180);
    $('script,style,noscript,nav,header,form,svg,iframe').remove();
    const text = `${title}\n${$('body').text()}`.replace(/\s+/g, ' ').trim().slice(0, 48000);
    if (text.length < 30) throw new AppError(400, 'This page has too little readable text. Try a product, about, or contact page.', 'source_text_unavailable');
    const emails = [...new Set($('a[href^="mailto:"]').map((_, element) => { try { return decodeURIComponent($(element).attr('href').slice(7).split('?')[0]).trim().toLowerCase(); } catch { return ''; } }).get())].filter(email => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) && email.split('@')[1].replace(/^www\./, '') === site).slice(0, 10);
    return { url: initial.href, finalUrl: current.href, site, title, text, emails, checkedAt: now(), fetchStatus: 'reachable', contentHash: createHash('sha256').update(text).digest('hex'), preview: text.split(/\s+/).slice(0, 25).join(' ') };
  }
  throw new AppError(400, 'Source redirects exceeded the review limit.', 'source_redirect_limit');
}
