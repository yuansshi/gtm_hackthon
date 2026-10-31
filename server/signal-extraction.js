import { digest } from './store.js';
import { signalKinds } from '../src/market-signals.js';

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const patterns = {
  negative: /\b(?:hiring freeze|freez(?:e|ing) (?:all )?hiring|plant closure|facility closure|closing (?:its |our |the )?(?:plant|factory|facility)|layoffs|laying off)\b/gi,
  leadership: /\b(?:appoint(?:s|ed|ment)?|named|promot(?:ed|es)|recent hire|joins as)\b/gi,
  expansion: /\b(?:expan(?:d(?:s|ed|ing)?|sion)|new (?:manufacturing |production )?(?:plant|factory|facility)|groundbreaking)\b/gi,
  product_launch: /\b(?:launch(?:es|ed)?|introduc(?:es|ed|ing)|unveil(?:s|ed)?)\b/gi,
  funding: /\b(?:secured|raised|receiv(?:ed|es))\b[^.!?]{0,80}\b(?:funding|financing|capital|investment)\b|\b(?:series [a-f]|funding round)\b/gi,
  hiring: /\b(?:hiring|job opening|job requisition|recruiting|vacanc(?:y|ies))\b/gi,
};
export const normalizeText = value => String(value || '').replace(/\s+/g,' ').trim();
export function sourceDates(text) {
  const expression = new RegExp(`\\b(?:20\\d{2}-\\d{2}-\\d{2}|(?:${monthNames.join('|')}) \\d{1,2},? 20\\d{2})\\b`, 'gi');
  return [...text.matchAll(expression)].flatMap(match => {
    const raw = match[0]; let date;
    if (/^20\d{2}-/.test(raw)) date = raw;
    else { const parts = raw.replace(',','').split(' '); date = `${parts[2]}-${String(monthNames.findIndex(month=>month.toLowerCase()===parts[0].toLowerCase())+1).padStart(2,'0')}-${parts[1].padStart(2,'0')}`; }
    const timestamp = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === date ? [{ date, text:raw, index:match.index }] : [];
  });
}
export function extractSignals(page) {
  const text = normalizeText(page.text); const dates = sourceDates(text); const results = [];
  for (const [kind, pattern] of Object.entries(patterns)) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const before = text.lastIndexOf('. ', match.index), after = text.indexOf('. ', match.index + match[0].length);
      const start = Math.max(0, before < 0 ? 0 : before + 2, match.index - 180), end = Math.min(text.length, after<0 ? text.length : after+1, start+580);
      const quote = text.slice(start,end).trim(); if (quote.length < 12) continue;
      if (kind === 'hiring' && /hiring freeze|freez(?:e|ing).*hiring|layoffs/i.test(quote)) continue;
      const date = [...dates].sort((a,b)=>Math.abs(a.index-match.index)-Math.abs(b.index-match.index)).find(date=>Math.abs(date.index-match.index)<=350);
      const fingerprint = digest({ source:page.url, kind, quote, dateQuote:date?.text||'' });
      if (results.some(item=>item.fingerprint===fingerprint)) continue;
      results.push({ fingerprint, kind, title:signalKinds[kind], quote, dateQuote:date?.text||'', eventDate:date?.date||'', source:page.url, sourceHash:page.contentHash, checkedAt:page.checkedAt, extraction:'keyword_date_proposal', status:'proposed' });
      if (results.length>=8) return results;
    }
  }
  return results;
}
