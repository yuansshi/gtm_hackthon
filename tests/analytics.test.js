import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePipeline } from '../src/pipeline-metrics.js';
import { metrics } from '../server/service.js';

const asOf = '2026-10-30T12:00:00.000Z';
const event = (stage, at, mode = 'user_reported', extra = {}) => ({ stage, at, mode, actor: mode === 'user_reported' ? 'You' : 'Provider fixture', ...extra });
const account = (id, industry, tier, events, extra = {}) => ({ id, name: id.toUpperCase(), businessId: 'allco', industry, fit: { tier }, stage: events.at(-1)?.stage || 'Matched', events, ...extra });
const draft = (id, leadId, sentAt, status = 'accepted', extra = {}) => ({ id, leadId, businessId: 'allco', channel: 'email', variant: 'A', sequenceStep: 0, sentAt, status, ...extra });
function fixture() {
  const linkedReply = event('Replied', '2026-10-26T12:00:00Z', 'user_reported', { draftId: 'live-a' });
  return { businessId: 'allco', leads: [
    account('a', 'Construction', 'Tier A', [event('Closed won', '2026-10-24T12:00:00Z'), event('Contacted', '2026-10-25T12:00:00Z', 'live'), linkedReply, { ...linkedReply }, event('Meeting booked', '2026-10-27T12:00:00Z')]),
    account('b', 'Construction', 'Tier A', [event('Contacted', '2026-10-26T12:00:00Z', 'dry_run', { draftId: 'dry-b' }), event('Replied', '2026-10-29T12:00:00Z')]),
    account('c', 'Mining', 'Tier B', [event('Replied', '2026-10-28T12:00:00Z'), event('RFQ received', '2026-10-29T12:00:00Z')]),
    account('d', 'Mining', 'Tier B', [event('Contacted', '2026-09-01T12:00:00Z'), event('Replied', '2026-10-29T12:00:00Z')]),
    account('e', '', '', []),
    account('foreign', 'Construction', 'Tier A', [event('Contacted', '2026-10-25T12:00:00Z', 'live')], { businessId: 'huasheng' }),
  ], drafts: [
    draft('live-a', 'a', '2026-10-25T12:00:00Z'), draft('live-a', 'a', '2026-10-25T12:00:00Z'),
    draft('dry-b', 'b', '2026-10-26T12:00:00Z', 'simulated'),
    draft('old-d', 'd', '2026-09-01T12:00:00Z', 'accepted', { channel: 'linkedin', variant: 'B', sequenceStep: 1 }),
    draft('foreign', 'foreign', '2026-10-25T12:00:00Z', 'accepted', { businessId: 'huasheng' }),
  ] };
}
const counts = data => data.reach.map(row => [row.stage, row.count, row.denominator]);

test('conversion uses one distinct contact cohort, preserves unlinked history, and does not infer intermediate milestones', () => {
  const data = analyzePipeline(fixture(), { asOf });
  assert.equal(data.accounts, 5);
  assert.deepEqual(counts(data), [['Contacted', 3, 3], ['Replied', 3, 3], ['Meeting booked', 1, 3], ['RFQ received', 0, 3], ['Closed won', 0, 3]]);
  assert.equal(data.logged.find(row => row.stage === 'Replied').count, 4);
  assert.equal(data.logged.find(row => row.stage === 'Closed won').count, 1);
  assert.deepEqual(data.repliesWithoutContact, ['c']);
  assert.equal(data.reach.find(row => row.stage === 'Meeting booked').rate, 1 / 3);
  assert.equal(data.segments.find(row => row.industry === 'Construction').replyRate, 1);
  assert.deepEqual(data.segments.find(row => row.industry === 'Mining'), { industry: 'Mining', tier: 'Tier B', accounts: 2, contacted: 1, replied: 1, replyRate: 1, meetings: 0 });
});

test('rolling windows bound both contact eligibility and outcomes, retaining replies with contacts outside the window', () => {
  const data = analyzePipeline(fixture(), { asOf, days: 7 });
  assert.equal(data.startAt, '2026-10-23T12:00:00.000Z');
  assert.equal(data.contacted, 2);
  assert.equal(data.reach.find(row => row.stage === 'Replied').count, 2);
  assert.equal(data.logged.find(row => row.stage === 'Replied').count, 4);
  assert.deepEqual(data.repliesWithoutContact, ['c', 'd']);
  assert.equal(data.liveAccepted, 1);
  assert.equal(data.simulated, 1);
  assert.equal(data.experiments.length, 2);
});

test('activity modes never relabel simulations as live or manual outcomes as provider events', () => {
  const state = fixture();
  const dry = analyzePipeline(state, { asOf, days: 7, mode: 'dry_run' });
  assert.equal(dry.contacted, 1); assert.equal(dry.simulated, 1); assert.equal(dry.liveAccepted, 0);
  assert.deepEqual(dry.reach.find(row => row.stage === 'Replied').accountIds, []);
  const live = analyzePipeline(state, { asOf, days: 7, mode: 'live' });
  assert.equal(live.contacted, 1); assert.equal(live.liveAccepted, 1); assert.equal(live.simulated, 0);
  assert.equal(live.reach.find(row => row.stage === 'Replied').count, 0);
  const manual = analyzePipeline(state, { asOf, mode: 'user_reported' });
  assert.equal(manual.contacted, 1); assert.equal(manual.liveAccepted, 0); assert.equal(manual.simulated, 0);
  assert.equal(manual.reach.find(row => row.stage === 'Replied').count, 1);
});

test('variant attribution requires the exact same-account draft reference and a later reply', () => {
  const state = fixture();
  state.leads[1].events.push(event('Replied', '2026-10-29T13:00:00Z', 'user_reported', { draftId: 'live-a' }));
  state.leads[0].events.push(event('Replied', '2026-10-24T13:00:00Z', 'user_reported', { draftId: 'live-a' }));
  const data = analyzePipeline(state, { asOf });
  const live = data.experiments.find(row => row.channel === 'email' && row.mode === 'live');
  const dry = data.experiments.find(row => row.mode === 'dry_run');
  assert.equal(live.messages, 1); assert.equal(live.accounts, 1); assert.equal(live.replies, 1); assert.equal(live.replyRate, 1);
  assert.equal(dry.messages, 1); assert.equal(dry.replies, 0); assert.equal(dry.replyRate, 0);
  assert.deepEqual([...data.unlinkedReplyAccounts].sort(), ['a', 'b', 'c', 'd']);
  state.leads[0].events = state.leads[0].events.filter(row => row.at !== '2026-10-26T12:00:00Z');
  assert.equal(analyzePipeline(state, { asOf }).experiments.find(row => row.channel === 'email' && row.mode === 'live').replies, 0);
});

test('industry/tier account cohorts constrain every calculation and empty selection is distinct from all accounts', () => {
  const state = fixture();
  const data = analyzePipeline(state, { asOf, accountIds: ['a', 'b'] });
  assert.equal(data.accounts, 2); assert.equal(data.contacted, 2); assert.equal(data.segments.length, 1);
  assert.equal(data.records.length, 2); assert.equal(data.liveAccepted, 1); assert.equal(data.simulated, 1);
  assert.ok(data.experiments.every(row => row.draftIds.every(id => ['live-a', 'dry-b'].includes(id))));
  const empty = analyzePipeline(state, { asOf, accountIds: [] });
  assert.equal(empty.accounts, 0); assert.equal(empty.contacted, 0); assert.equal(empty.experiments.length, 0);
  assert.ok(empty.reach.every(row => row.count === 0 && row.rate === null));
});

test('window endpoints are inclusive, invalid/future timestamps are disclosed, and unknown attribution is not inferred', () => {
  const state = { businessId: 'allco', drafts: [], leads: [account('a', 'Mining', 'Tier A', [
    event('Contacted', '2026-10-23T12:00:00Z', 'user_reported'),
    event('Replied', asOf, 'user_reported'), event('Meeting booked', '2026-10-30T12:00:00.001Z'),
    event('Closed won', 'bad date'), event('RFQ received', '2026-10-29T12:00:00Z', undefined),
  ])] };
  delete state.leads[0].events[4].mode;
  const data = analyzePipeline(state, { asOf, days: 7 });
  assert.equal(data.contacted, 1); assert.equal(data.reach.find(row => row.stage === 'Replied').count, 1);
  assert.equal(data.futureTimes, 1); assert.equal(data.invalidTimes, 1); assert.equal(data.unclassifiedEvents, 1);
  assert.equal(data.reach.find(row => row.stage === 'RFQ received').count, 1);
  const manual = analyzePipeline(state, { asOf, days: 7, mode: 'user_reported' });
  assert.equal(manual.reach.find(row => row.stage === 'RFQ received').count, 0);
  assert.throws(() => analyzePipeline(state, { asOf: 'invalid' }), TypeError);
  assert.throws(() => analyzePipeline(state, { asOf, days: -7 }), TypeError);
});

test('unequal overlapping variant audiences remain separate and no unlinked reply is credited to either variant', () => {
  const state = fixture();
  state.drafts.push(draft('followup-a', 'a', '2026-10-27T12:00:00Z', 'accepted', { variant: 'B', sequenceStep: 1, modelMetadata: { model: 'fixture' } }));
  const data = analyzePipeline(state, { asOf, accountIds: ['a'] });
  assert.equal(data.experiments.length, 2);
  assert.deepEqual(data.experiments.map(row => [row.variant, row.sequenceStep, row.method, row.accounts, row.replies]), [['A', 0, 'Source template', 1, 1], ['B', 1, 'AI draft', 1, 0]]);
});

test('server summary never reports over-100% conversion or attributes a manual stage edit to a variant', () => {
  const state = fixture(); state.leads = state.leads.filter(row => row.businessId === 'allco'); state.drafts = state.drafts.filter(row => row.businessId === 'allco');
  const summary = metrics(state, { asOf });
  assert.equal(summary.contacted, 3); assert.equal(summary.replied, 4); assert.equal(summary.replyRate, 1);
  const a = summary.experiments.find(row => row.variant === 'A');
  assert.equal(a.sent, 2); assert.equal(a.recipients, 2); assert.equal(a.responses, 1); assert.equal(a.replyRate, 0.5);
  state.leads.forEach(row => { row.events = row.events.filter(event => event.stage !== 'Contacted'); });
  assert.equal(metrics(state, { asOf }).replyRate, null);
});

test('value proposition cohorts use immutable saved briefs, separate the same variant, and never infer old focus from copy',()=>{
  const state=fixture();state.drafts=[
    draft('fit','a','2026-10-25T12:00:00Z','accepted',{messageBrief:{valueProposition:'application_fit'}}),
    draft('supplier','b','2026-10-25T12:00:00Z','accepted',{messageBrief:{valueProposition:'supplier_qualification'}}),
    draft('legacy','c','2026-10-25T12:00:00Z','accepted',{body:'Assess application fit before proposing a component.',messageBrief:{audience:'team'}}),
    draft('unknown','d','2026-10-25T12:00:00Z','accepted',{messageBrief:{valueProposition:'unrecognized'}}),
  ];state.leads[0].events=[event('Contacted','2026-10-25T12:00:00Z','live'),event('Replied','2026-10-26T12:00:00Z','user_reported',{draftId:'fit'})];
  const data=analyzePipeline(state,{asOf}),fit=data.experiments.find(row=>row.valueProposition==='application_fit'),supplier=data.experiments.find(row=>row.valueProposition==='supplier_qualification'),old=data.experiments.find(row=>row.valueProposition===null);
  assert.equal(data.experiments.length,3);assert.equal(fit.messages,1);assert.equal(fit.replies,1);assert.equal(supplier.messages,1);assert.equal(supplier.replies,0);assert.equal(old.messages,2);assert.equal(old.valuePropositionLabel,'Unrecorded');assert.equal(old.replies,0);
});
test('value proposition observations preserve mode, step, method, account and time filters without duplicating linked replies',()=>{
  const state=fixture();state.drafts=[
    draft('fit','a','2026-10-25T12:00:00Z','accepted',{messageBrief:{valueProposition:'application_fit'}}),
    draft('followup','a','2026-10-27T12:00:00Z','accepted',{sequenceStep:1,modelMetadata:{model:'fixture'},messageBrief:{valueProposition:'engineering_collaboration'}}),
    draft('dry','b','2026-10-26T12:00:00Z','simulated',{messageBrief:{valueProposition:'application_fit'}}),
    draft('old','d','2026-09-01T12:00:00Z','accepted',{messageBrief:{valueProposition:'application_fit'}}),
  ];state.leads[0].events.push(event('Replied','2026-10-28T12:00:00Z','user_reported',{draftId:'followup'}));
  const data=analyzePipeline(state,{asOf,days:7,accountIds:['a']});assert.equal(data.experiments.length,2);assert.equal(data.experiments.find(row=>row.valueProposition==='application_fit').replies,0);assert.equal(data.experiments.find(row=>row.valueProposition==='engineering_collaboration').replies,1);
  const dry=analyzePipeline(state,{asOf,days:7,mode:'dry_run'});assert.equal(dry.experiments.length,1);assert.equal(dry.experiments[0].messages,1);assert.equal(dry.experiments[0].replies,0);assert.equal(dry.experiments[0].mode,'dry_run');
});
