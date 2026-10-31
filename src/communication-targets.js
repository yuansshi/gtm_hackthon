// Canonical comparison rules only. These formats do not establish identity or consent.
export function communicationTarget(kind, value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2000 || /[\u0000-\u0020\u007f]/.test(text)) throw Error('Enter one valid target without spaces or control characters.');
  if (kind === 'account') {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    const domain = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw Error('Enter a company domain or website URL.');
    return domain;
  }
  if (kind === 'email') {
    const email = text.toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@')) throw Error('Enter one plain email address.');
    return email;
  }
  if (kind === 'linkedin') {
    const url = new URL(text);
    const slug = decodeURIComponent(url.pathname).match(/^\/in\/([a-z0-9._-]+)\/?$/i)?.[1];
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || url.username || url.password || url.port || !slug || slug === '.' || slug === '..') throw Error('Enter an HTTPS LinkedIn /in/ profile URL.');
    return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
  }
  throw Error('Choose an account, email address or LinkedIn profile.');
}
export function recipientTarget(channel, value) {
  const text = String(value || '').trim();
  if (channel === 'email') {
    const wrapped = text.match(/^[^<>@,;\r\n]*<([^<>]+)>$/);
    return communicationTarget('email', wrapped ? wrapped[1] : text);
  }
  return communicationTarget('linkedin', text);
}
export const domainMatches = (domain, held) => domain === held || domain.endsWith(`.${held}`);
export function maskedCommunicationTarget(kind, value) {
  if (kind === 'account') return value;
  if (kind === 'email') { const [name, domain] = value.split('@'); return `${name[0]}•••@${domain}`; }
  return `LinkedIn /in/${value.split('/').at(-1).slice(0, 2)}•••`;
}
