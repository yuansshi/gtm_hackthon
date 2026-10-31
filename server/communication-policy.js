import { AppError, digest } from './store.js';
import { communicationTarget, recipientTarget, domainMatches } from '../src/communication-targets.js';

export const communicationKey = (state, kind, target) => digest({ businessId: state.businessId, kind, target });
// Include released versions: blocking and releasing during a request must not revive its old context.
export const communicationContext = state => digest((state.communicationRestrictions || []).map(({ id, version, status }) => ({ id, version, status })));
export function accountCommunicationBlock(state, lead) {
  let domain;
  try { domain = communicationTarget('account', lead?.domain); } catch { return null; }
  return (state.communicationRestrictions || []).find(item => item.status === 'active' && item.kind === 'account' && domainMatches(domain, item.domain)) || null;
}
export function recipientCommunicationBlock(state, channel, recipient) {
  let target;
  try { target = recipientTarget(channel, recipient); } catch { return null; }
  return (state.communicationRestrictions || []).find(item => item.status === 'active' && (item.kind === channel && item.targetKey === communicationKey(state, channel, target) || channel === 'email' && item.kind === 'account' && domainMatches(target.split('@')[1], item.domain))) || null;
}
export function communicationStatus(state, lead, channel, recipient) {
  const hold = accountCommunicationBlock(state, lead) || recipientCommunicationBlock(state, channel, recipient);
  if (hold) return { blocked: true, restrictionId: hold.id, message: `${hold.kind === 'account' ? 'Account-wide' : hold.kind === 'email' ? 'Email' : 'LinkedIn'} do-not-contact hold. Review Communication preferences.`, code: 'communication_restricted' };
  if (channel === 'email' && (String(recipient || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).some(email => (state.contactSuppressions || []).some(item => item.addressHash === digest({ businessId: state.businessId, email })))) return { blocked: true, message: 'Provider processing restriction. Manual release cannot remove this restriction.', code: 'contact_suppressed' };
  if (String(recipient || '').trim()) { try { recipientTarget(channel, recipient); } catch { return { blocked: true, message: channel === 'email' ? 'Enter one email recipient before approval.' : 'Enter one HTTPS LinkedIn /in/ profile before approval.', code: 'invalid_recipient' }; } }
  return { blocked: false };
}
export function requireCommunicationAllowed(state, lead, channel, recipient) {
  const status = communicationStatus(state, lead, channel, recipient);
  if (status.blocked) throw new AppError(409, status.message, status.code);
}
export function requireAccountCommunication(state, lead) {
  if (accountCommunicationBlock(state, lead)) throw new AppError(409, 'This account has a do-not-contact hold. Contact processing and outreach are paused.', 'communication_restricted');
}
