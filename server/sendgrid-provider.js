import { createPublicKey, verify } from 'node:crypto';
import { AppError, digest, now } from './store.js';
import { communicationTarget } from '../src/communication-targets.js';

const fail = (status, message, code) => { throw new AppError(status, message, code); };
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const usefulKey = value => typeof value === 'string' && /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}$/.test(value) && !/dummy|placeholder|replace|changeme|example/i.test(value);
const number = value => /^\d{1,12}$/.test(String(value || '')) && Number(value) > 0 ? Number(value) : null;
const email = value => { try { return communicationTarget('email', value); } catch { return null; } };
export const unsubscribeToken = '<%asm_group_unsubscribe_raw_url%>';
function verificationKey(value) {
  try { const key = createPublicKey({ key: Buffer.from(value || '', 'base64'), format: 'der', type: 'spki' }); return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null; } catch { return null; }
}
export function senderProof(config, value, group) {
  if (value?.id !== config.senderId || value.verified !== true || email(value.from_email) !== config.fromEmail || !clean(value.from_name) || clean(value.from_name).length > 120 || !clean(value.address) || !clean(value.city) || !clean(value.country) || group?.id !== config.groupId || !clean(group.name)) fail(409, 'The configured sender, postal identity or unsubscribe group could not be verified.', 'delivery_sender_unverified');
  for (const [key, max] of Object.entries({ from_name: 120, address: 500, address2: 500, city: 200, state: 100, zip: 40, country: 100 })) if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > max)) fail(502, 'Invalid sender identity fields. No email was sent.', 'delivery_sender_unverified');
  if (typeof group.name !== 'string' || group.name.length > 120) fail(502, 'Invalid unsubscribe group identity.', 'delivery_sender_unverified');
  const replyTo = email(value.reply_to || value.from_email); if (!replyTo) fail(409, 'The verified sender has no usable reply address.', 'delivery_sender_unverified');
  const sender = { bindingHash: config.hash, senderId: value.id, from: { email: config.fromEmail, name: clean(value.from_name) }, replyTo: { email: replyTo }, postalAddress: [value.address, value.address2, value.city, value.state, value.zip, value.country].map(clean).filter(Boolean).join(', '), group: { id: group.id, name: clean(group.name) } };
  sender.hash = digest(sender); sender.checkedAt = now(); return sender;
}
export function liveMessage(draft, sender) {
  return { from: sender.from, replyTo: sender.replyTo, to: communicationTarget('email', draft.recipient.trim().match(/^[^<>@,;\r\n]*<([^<>]+)>$/)?.[1] || draft.recipient), subject: draft.subject, body: `${draft.body}\n\n${sender.from.name}\n${sender.postalAddress}\nUnsubscribe: ${unsubscribeToken}`, group: sender.group, senderHash: sender.hash };
}
export function createSendgridProvider({ env = process.env, fetcher = fetch } = {}) {
  const key = env.PROJECT_SENDGRID_API_KEY, region = env.PROJECT_SENDGRID_REGION || 'us';
  const publicKey = verificationKey(env.PROJECT_SENDGRID_EVENT_PUBLIC_KEY), previousKey = verificationKey(env.PROJECT_SENDGRID_EVENT_PUBLIC_KEY_PREVIOUS);
  const globalEnabled = env.PROJECT_SENDGRID_ENABLED === 'true';
  let webhookUrl = null;
  try { const url = new URL(env.PUBLIC_ORIGIN); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash && !/^(localhost|127\.|\[|10\.)/i.test(url.hostname) && !/\.(local|internal)$/.test(url.hostname)) webhookUrl = url.origin + '/api/delivery/sendgrid/events'; } catch {}
  const protectedProject = typeof env.PROJECT_ACCESS_TOKEN === 'string' && env.PROJECT_ACCESS_TOKEN.length >= 24 && !/dummy|placeholder|replace|changeme/i.test(env.PROJECT_ACCESS_TOKEN);
  const root = region === 'eu' ? 'https://api.eu.sendgrid.com' : 'https://api.sendgrid.com';
  const rawBinding = id => {
    const prefix = 'PROJECT_SENDGRID_' + id.toUpperCase() + '_';
    return { enabled: globalEnabled && env[prefix + 'ENABLED'] === 'true', senderId: number(env[prefix + 'SENDER_ID']), fromEmail: email(env[prefix + 'FROM_EMAIL']), groupId: number(env[prefix + 'UNSUBSCRIBE_GROUP_ID']) };
  };
  const binding = id => {
    const config = rawBinding(id), other = rawBinding(id === 'allco' ? 'huasheng' : 'allco');
    const conflict = config.enabled && other.enabled && (config.senderId === other.senderId || config.fromEmail === other.fromEmail || config.groupId === other.groupId);
    const configured = config.enabled && usefulKey(key) && ['us', 'eu'].includes(region) && !!publicKey && !!webhookUrl && protectedProject && !!config.senderId && !!config.fromEmail && !!config.groupId && !conflict;
    return { ...config, configured, region, conflict, webhookUrl, hash: digest({ ...config, region, webhookUrl, projectAccess: protectedProject ? digest(env.PROJECT_ACCESS_TOKEN) : null, credential: usefulKey(key) ? digest(key) : null, eventKey: publicKey ? digest(publicKey.export({ format: 'der', type: 'spki' }).toString('base64')) : null }) };
  };
  const requireConfigured = id => { const config = binding(id); if (!config.configured) fail(503, 'Live email is disabled. Configure designated project SendGrid credentials, signed events, and separate business sender/group identities.', 'delivery_not_configured'); return config; };
  const request = async (pathname, options = {}, post = false) => {
    try {
      const response = await fetcher(new URL(pathname, root), { method: post ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}) }, ...options });
      if (post) {
        if (response.status === 202) { const id = response.headers.get('x-message-id'); return { accepted: true, messageId: id && /^[a-z0-9._-]{1,256}$/i.test(id) ? id : null, acceptedAt: now() }; }
        const rejected = [400, 401, 403, 404, 413, 415, 429].includes(response.status);
        fail(rejected ? 502 : 503, rejected ? 'SendGrid rejected this request. No automatic retry; review the message and project connection.' : 'SendGrid acceptance is unknown. Do not resend; wait for a signed receipt and inspect provider records.', rejected ? 'delivery_rejected' : 'delivery_unknown');
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) fail(502, 'SendGrid sender or suppression lookup failed. No email was sent.', 'delivery_lookup_failed');
      let size = 0, chunks = []; for await (const part of response.body || []) { const bytes = Buffer.from(part); size += bytes.length; if (size > 200000) fail(502, 'SendGrid lookup exceeded its response limit. No email was sent.', 'delivery_lookup_failed'); chunks.push(bytes); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail(503, post ? 'Provider acceptance is unknown. Do not resend; wait for a signed receipt and inspect provider records.' : 'SendGrid lookup failed. No email was sent.', post ? 'delivery_unknown' : 'delivery_lookup_failed');
    }
  };
  const checkSender = async id => {
    const config = requireConfigured(id);
    const [senders, groups] = await Promise.all([request(`/v3/verified_senders?id=${config.senderId}`), request('/v3/asm/groups')]);
    if (!Array.isArray(senders?.results) || senders.results.length > 200 || !Array.isArray(groups) || groups.length > 200) fail(502, 'SendGrid returned an invalid identity response. No email was sent.', 'delivery_lookup_failed');
    return senderProof(config, senders.results.find(item => item.id === config.senderId), groups.find(item => item.id === config.groupId));
  };
  const suppressed = async (id, address) => {
    const config = requireConfigured(id), target = communicationTarget('email', address), encoded = encodeURIComponent(target);
    const [global, groups] = await Promise.all([request('/v3/asm/suppressions/global/' + encoded), request('/v3/asm/suppressions/' + encoded)]);
    if (!global || typeof global !== 'object' || Array.isArray(global) || Object.keys(global).some(key => key !== 'recipient_email') || Object.hasOwn(global, 'recipient_email') && email(global.recipient_email) !== target || !Array.isArray(groups?.suppressions) || groups.suppressions.length > 200 || groups.suppressions.some(group => !Number.isSafeInteger(group.id) || group.id <= 0 || typeof group.suppressed !== 'boolean')) fail(502, 'SendGrid returned an invalid suppression response. No email was sent.', 'delivery_lookup_failed');
    return !!global.recipient_email || groups.suppressions.some(group => group.id === config.groupId && group.suppressed);
  };
  const send = async (id, message, dispatchId) => {
    const config = requireConfigured(id); if (config.hash !== message.bindingHash) fail(409, 'Project sender configuration changed. Review it again before sending.', 'stale_delivery_sender');
    return request('/v3/mail/send', { body: JSON.stringify({ personalizations: [{ to: [{ email: message.to }], custom_args: { gtm_dispatch_id: dispatchId, gtm_business_id: id } }], from: message.from, reply_to: message.replyTo, subject: message.subject, content: [{ type: 'text/plain', value: message.body }], asm: { group_id: message.group.id, groups_to_display: [message.group.id] }, tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } } }) }, true);
  };
  const verifyEvents = (bytes, signature, timestamp) => {
    if (!publicKey) fail(503, 'Signed SendGrid events are not configured.', 'delivery_webhook_not_configured');
    if (!Buffer.isBuffer(bytes) || bytes.length > 256000 || typeof signature !== 'string' || !/^[A-Za-z0-9+/=]{40,200}$/.test(signature) || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Number(timestamp) * 1000 > Date.now() + 300000 || Date.now() - Number(timestamp) * 1000 > 7 * 86400000) fail(403, 'Invalid signed event request.', 'delivery_signature_invalid');
    const value = Buffer.concat([Buffer.from(timestamp), bytes]);
    if (![publicKey, previousKey].filter(Boolean).some(key => { try { return verify('sha256', value, key, Buffer.from(signature, 'base64')); } catch { return false; } })) fail(403, 'Invalid signed event request.', 'delivery_signature_invalid');
  };
  return { binding, requireConfigured, checkSender, suppressed, send, verifyEvents, status: () => ({ configured: ['allco','huasheng'].some(id => binding(id).configured), status: ['allco','huasheng'].some(id => binding(id).configured) ? 'Project configured; sender confirmation required' : 'Not configured', provider: 'SendGrid', signedEventsConfigured: !!publicKey }) };
}
