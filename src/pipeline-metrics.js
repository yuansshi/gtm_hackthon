// Account-level milestone reach. Scope and denominators are shared by all views.
export const analyticsModes = ['all', 'user_reported', 'dry_run', 'live'];
export const milestoneStages = ['Contacted', 'Replied', 'Meeting booked', 'RFQ received', 'Closed won'];
const timestamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const unique = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
export const activityModeLabel = mode => ({ all: 'All recorded activity', user_reported: 'User-reported', dry_run: 'Dry runs', live: 'Live provider activity', research: 'Research' }[mode] || 'Unclassified');

export function analyzePipeline(state, { accountIds, days = 0, mode = 'all', asOf = new Date().toISOString() } = {}) {
  if (!analyticsModes.includes(mode) || ![0, 7, 30, 90].includes(days)) throw new TypeError('Unsupported analytics filter');
  const end = timestamp(asOf);
  if (!Number.isFinite(end)) throw new TypeError('Analytics needs a valid observation time');
  const start = days ? end - days * 86400000 : -Infinity;
  const selected = accountIds === undefined ? null : new Set(accountIds);
  const accounts = unique((state.leads || []).filter(account => (!account.businessId || account.businessId === state.businessId) && (!selected || selected.has(account.id))), account => account.id);
  const ids = new Set(accounts.map(account => account.id));
  const matchesMode = value => mode === 'all' || value === mode;
  const inWindow = value => value >= start && value <= end;
  let invalidTimes = 0, futureTimes = 0, unclassifiedEvents = 0;
  const eventKey = event => JSON.stringify([event.at, event.stage, event.actor, event.mode, event.draftId]);
  const eventsByAccount = new Map(accounts.map(account => {
    const events = unique(account.events || [], eventKey).filter(event => {
      const time = timestamp(event.at);
      if (!Number.isFinite(time)) { invalidTimes++; return false; }
      if (time > end) { futureTimes++; return false; }
      if (!inWindow(time) || !matchesMode(event.mode)) return false;
      if (!['research', 'user_reported', 'dry_run', 'live'].includes(event.mode)) unclassifiedEvents++;
      return true;
    }).sort((a, b) => timestamp(a.at) - timestamp(b.at));
    return [account.id, events];
  }));
  const firstContact = new Map();
  for (const [id, events] of eventsByAccount) {
    const contact = events.find(event => event.stage === 'Contacted');
    if (contact) firstContact.set(id, timestamp(contact.at));
  }
  const reach = milestoneStages.map(stage => {
    const accountIds = accounts.filter(account => firstContact.has(account.id) && eventsByAccount.get(account.id).some(event => event.stage === stage && timestamp(event.at) >= firstContact.get(account.id))).map(account => account.id);
    return { stage, count: accountIds.length, denominator: firstContact.size, rate: firstContact.size ? accountIds.length / firstContact.size : null, accountIds };
  });
  const logged = milestoneStages.map(stage => ({ stage, count: accounts.filter(account => eventsByAccount.get(account.id).some(event => event.stage === stage)).length }));
  const repliesWithoutContact = accounts.filter(account => eventsByAccount.get(account.id).some(event => event.stage === 'Replied') && !reach.find(row => row.stage === 'Replied').accountIds.includes(account.id)).map(account => account.id);

  const outbound = unique((state.drafts || []).filter(draft => ids.has(draft.leadId) && (!draft.businessId || draft.businessId === state.businessId) && ['simulated', 'accepted'].includes(draft.status)), draft => draft.id).filter(draft => {
    const time = timestamp(draft.sentAt);
    if (!Number.isFinite(time)) { invalidTimes++; return false; }
    if (time > end) { futureTimes++; return false; }
    return inWindow(time) && matchesMode(draft.status === 'simulated' ? 'dry_run' : 'live');
  });
  const outboundById = new Map(outbound.map(draft => [draft.id, draft]));
  const linkedReplyIds = new Set();
  let unlinkedReplyAccounts = new Set();
  for (const [accountId, events] of eventsByAccount) for (const event of events.filter(event => event.stage === 'Replied')) {
    const draft = outboundById.get(event.draftId);
    if (draft && draft.leadId === accountId && timestamp(event.at) >= timestamp(draft.sentAt)) linkedReplyIds.add(draft.id);
    else unlinkedReplyAccounts.add(accountId);
  }
  const groups = new Map();
  for (const draft of outbound) {
    const method = draft.modelMetadata ? 'AI draft' : 'Source template';
    const key = JSON.stringify([draft.channel, draft.variant, draft.sequenceStep, method, draft.status]);
    const group = groups.get(key) || { channel: draft.channel, variant: draft.variant, sequenceStep: draft.sequenceStep, method, mode: draft.status === 'simulated' ? 'dry_run' : 'live', draftIds: [], accounts: new Set(), replies: new Set() };
    group.draftIds.push(draft.id); group.accounts.add(draft.leadId);
    if (linkedReplyIds.has(draft.id)) group.replies.add(draft.leadId);
    groups.set(key, group);
  }
  const experiments = [...groups.values()].map(group => ({ ...group, messages: group.draftIds.length, accounts: group.accounts.size, replies: group.replies.size, replyRate: group.accounts.size ? group.replies.size / group.accounts.size : null })).sort((a, b) => a.channel.localeCompare(b.channel) || a.variant.localeCompare(b.variant) || a.sequenceStep - b.sequenceStep || a.mode.localeCompare(b.mode));
  const segments = [...new Set(accounts.map(account => JSON.stringify([account.industry || 'Unknown industry', account.fit?.tier || 'Unrated'])))].map(key => {
    const [industry, tier] = JSON.parse(key);
    const groupIds = new Set(accounts.filter(account => (account.industry || 'Unknown industry') === industry && (account.fit?.tier || 'Unrated') === tier).map(account => account.id));
    const contactCount = [...firstContact.keys()].filter(id => groupIds.has(id)).length;
    const replyCount = reach.find(row => row.stage === 'Replied').accountIds.filter(id => groupIds.has(id)).length;
    return { industry, tier, accounts: groupIds.size, contacted: contactCount, replied: replyCount, replyRate: contactCount ? replyCount / contactCount : null, meetings: reach.find(row => row.stage === 'Meeting booked').accountIds.filter(id => groupIds.has(id)).length };
  }).sort((a, b) => a.industry.localeCompare(b.industry) || a.tier.localeCompare(b.tier));
  const records = accounts.map(account => ({ id: account.id, name: account.name, industry: account.industry || 'Unknown industry', tier: account.fit?.tier || 'Unrated', source: account.source, events: eventsByAccount.get(account.id), reached: reach.filter(row => row.accountIds.includes(account.id)).map(row => row.stage) }));
  return { asOf: new Date(end).toISOString(), startAt: Number.isFinite(start) ? new Date(start).toISOString() : null, days, mode,
    accounts: accounts.length, activeAccounts: records.filter(record => record.events.length).length,
    contacted: firstContact.size, reach, logged, records, segments, experiments,
    simulated: outbound.filter(draft => draft.status === 'simulated').length, liveAccepted: outbound.filter(draft => draft.status === 'accepted').length,
    repliesWithoutContact, unlinkedReplyAccounts: [...unlinkedReplyAccounts], invalidTimes, futureTimes, unclassifiedEvents };
}
