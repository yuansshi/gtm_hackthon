import { businesses } from '../src/businesses.js';
import { AppError, addActivity, digest, now } from './store.js';
import { creditMicros, createFlexpriceProvider } from './flexprice-provider.js';

const unresolved = entry => entry.metering && !['processed', 'not_billed'].includes(entry.metering.status);
const fail = (status, message, code) => { throw new AppError(status, message, code); };
const eventFor = (state, id) => state.wallet.ledger.find(entry => entry.id === id && entry.metering) || fail(404, 'Metered usage event not found in this business.', 'metering_event_not_found');
const operationLabel = kind => kind === 'graph_query' ? 'graph_query_evaluated' : kind === 'outreach' ? 'outreach_dry_run' : /vendor_|enrichment/.test(kind) ? 'enrichment_check_completed' : kind === 'inference' ? 'ai_request_completed' : kind === 'market_signals' ? 'market_source_check_completed' : 'source_research_completed';

export function createFlexpriceBilling({ store, provider = createFlexpriceProvider() }) {
  const cache = new Map(), running = new Map();
  const readWallet = async id => { cache.delete(id); return provider.wallet(id); };
  const sameContext = (expected, wallet) => expected?.environmentId === wallet.environmentId && expected.currency === wallet.currency && typeof expected.conversionRate === 'string' && creditMicros(expected.conversionRate) === creditMicros(wallet.conversionRate);
  // Recover only metering transport state; never replay enrichment or messages.
  for (const { id } of businesses) {
    if (!store.read(id).wallet.ledger.some(entry => entry.metering && (entry.metering.status === 'sending' || (entry.status === 'refunded' && entry.metering.status === 'reserved')))) continue;
    store.mutate(id, state => {
      for (const entry of state.wallet.ledger.filter(entry => entry.metering)) {
        if (entry.status === 'refunded' && entry.metering.status === 'reserved') entry.metering.status = 'not_billed';
        if (entry.metering.status === 'sending') { entry.metering.status = 'unknown'; entry.metering.error = 'Server restarted during event ingestion. Reconcile the same event ID.'; }
      }
    });
  }
  const requireConsent = (state, config) => {
    if (!config.configured) fail(503, 'Complete this business’s designated Flexprice configuration.', 'flexprice_not_configured');
    if (!state.flexprice?.consent?.enabled || state.flexprice.consent.bindingHash !== config.hash) fail(409, 'Confirm the project Flexprice binding and credit-price contract in Billing.', 'flexprice_confirmation_required');
  };
  const requireDecision = (state,input,config,checkBinding=true) => {
    if (input.expectedConsentVersion !== (state.flexprice?.consent?.version || 0) || (checkBinding && input.bindingHash !== config.hash)) fail(409,'The metering decision or customer mapping changed. Refresh Billing before confirming it.','flexprice_decision_changed');
  };
  store.setMeteringPolicy({
    reserve(state, entry) {
      const config = provider.binding(state.businessId); if (!config.enabled) return;
      requireConsent(state, config);
      if (state.wallet.ledger.some(unresolved)) fail(409, 'Reconcile the previous Flexprice usage event before starting another credit-consuming operation.', 'flexprice_usage_pending');
      const wallet = cache.get(state.businessId);
      if (!wallet || wallet.bindingHash !== config.hash || wallet.isCachedFallback !== false || !Number.isFinite(Date.parse(wallet.checkedAt)) || Date.now() - Date.parse(wallet.checkedAt) > 30000 || Date.parse(wallet.checkedAt) > Date.now()) fail(503, 'Refresh the uncached project wallet before this operation.', 'flexprice_balance_required');
      if (!sameContext(state.flexprice.consent, wallet)) fail(409, 'The Flexprice environment or credit conversion changed. Refresh Billing and confirm the new contract.', 'flexprice_wallet_context_changed');
      if (creditMicros(wallet.creditBalance) < BigInt(entry.credits) * 1000000n) fail(402, `The project Flexprice wallet needs ${entry.credits} ${entry.credits === 1 ? 'credit' : 'credits'} for this operation. Local demo reloads do not fund it.`, 'flexprice_insufficient_credits');
      state.flexprice.lastWallet = wallet;
      entry.metering = { id: entry.id, bindingHash: config.hash, environmentId: wallet.environmentId, currency: wallet.currency, conversionRate: wallet.conversionRate, status: 'reserved', creditUnits: String(entry.credits), operation: operationLabel(entry.kind), leadKey: entry.leadId ? digest({ businessId: state.businessId, leadId: entry.leadId }) : null, reservedAt: now(), attempts: 0 };
      cache.delete(state.businessId);
    },
    settle(state, entry, success) {
      if (!entry.metering) return;
      const event = entry.metering;
      if (!success) { event.status = 'not_billed'; event.completedAt = now(); entry.flexpriceStatus = 'not_billed_refunded'; return; }
      const config = provider.binding(state.businessId);
      event.status = 'queued'; event.queuedAt = now();
      event.payload = { event_id: event.id, event_name: 'gtm_credits_consumed', customer_id: state.flexprice.lastWallet.customerId, external_customer_id: state.flexprice.lastWallet.externalCustomerId, timestamp: event.queuedAt, source: 'gtm_portal', properties: { credits: event.creditUnits, units: '1', operation: event.operation, operation_kind: entry.kind, business_key: state.businessId, delivery_mode: entry.kind === 'outreach' ? 'dry_run' : 'research', ...(event.leadKey ? { lead_key: event.leadKey } : {}) } };
      entry.flexpriceStatus = 'flexprice_queued';
      if (config.hash !== event.bindingHash) event.error = 'Project binding changed. Resolve this event at its original destination.';
    },
  });
  const prepare = async (id, { path = '', requestId = null } = {}) => {
    const config = provider.binding(id); if (!config.enabled) return;
    const state = store.read(id);
    // Existing handlers validate the full request hash before returning a saved
    // result. Let a replay reach that check without authorizing another charge.
    const leadId = path.match(/^\/leads\/([^/]+)\//)?.[1];
    const runs = path === '/source-intakes' ? state.sourceIntakes : path === '/prospect-searches' ? state.prospectSearches : /\/people-research$/.test(path) ? state.peopleResearch : /\/(?:company\/lookup|contacts\/(?:search|verify))$/.test(path) ? state.enrichmentRuns : path === '/assistant/intake' || /\/drafts$/.test(path) ? state.assistantRuns : /\/signal-checks$/.test(path) ? state.leads.find(lead => lead.id === leadId)?.signalMonitor?.runs : [];
    if (requestId && (runs || []).some(run => run.id === requestId && (!run.leadId || run.leadId === leadId))) return;
    const draftId = path.match(/^\/drafts\/([^/]+)\/simulate$/)?.[1];
    if (draftId && state.drafts.some(draft => draft.id === draftId && ['simulated', 'accepted'].includes(draft.status))) return;
    requireConsent(state, config);
    if (state.wallet.ledger.some(unresolved)) fail(409, 'Reconcile pending Flexprice usage in Billing before starting another credit-consuming operation.', 'flexprice_usage_pending');
    const wallet = await readWallet(id);
    if (!sameContext(state.flexprice.consent, wallet)) fail(409, 'The Flexprice environment or conversion changed. Refresh Billing and reconfirm the contract.', 'flexprice_wallet_context_changed');
    cache.set(id, wallet);
  };
  const connect = async (id, input) => {
    const config = provider.binding(id); const state = store.read(id);
    if (!input.acknowledged || !input.acknowledgedRates) fail(409, 'Confirm the current customer/wallet mapping and matching SUM-credit meter price.', 'flexprice_confirmation_required');
    requireDecision(state,input,config);
    if (!config.enabled || !config.configured) fail(503, 'Enable a complete designated project Flexprice binding for this business.', 'flexprice_not_configured');
    if (state.wallet.ledger.some(entry => unresolved(entry) && entry.metering.bindingHash !== config.hash)) fail(409, 'Resolve pending events at the original Flexprice destination before changing this binding.', 'flexprice_binding_changed');
    const wallet = await readWallet(id);
    if (state.wallet.ledger.some(entry => unresolved(entry) && !sameContext(entry.metering, wallet))) fail(409, 'Pending usage belongs to the original wallet environment and conversion. Resolve it there before rebinding.', 'flexprice_wallet_context_changed');
    store.mutate(id, current => {
      requireDecision(current,input,config);
      if (current.wallet.ledger.some(entry => unresolved(entry) && (entry.metering.bindingHash !== config.hash || !sameContext(entry.metering,wallet)))) fail(409,'Pending usage changed during wallet verification. Resolve its original binding.','flexprice_binding_changed');
      current.flexprice ||= {};
      current.flexprice.consent = { version: (current.flexprice.consent?.version || 0)+1, enabled: true, bindingHash: config.hash, environmentId: wallet.environmentId, currency: wallet.currency, conversionRate: wallet.conversionRate, acknowledgedAt: now(), actor: 'You', acknowledgedRates: true };
      current.flexprice.lastWallet = wallet;
      addActivity(current, 'Project Flexprice metering enabled', 'Future successful operations will emit credit usage. Existing demo history is not backfilled; no wallet funded or payment collected.');
    });
    cache.set(id, wallet);
  };
  const pause = (id, input) => {
    if (!input.acknowledged) fail(400, 'Confirm pausing metered execution.', 'flexprice_confirmation_required');
    store.mutate(id, state => {
      requireDecision(state,input,provider.binding(id),false);
      if (state.flexprice?.consent) { state.flexprice.consent.enabled = false; state.flexprice.consent.version = (state.flexprice.consent.version || 0)+1; }
      addActivity(state, 'Project metering paused', 'Provider-enabled credit-consuming operations remain blocked until metering is confirmed again. Unresolved usage is retained.');
    });
    cache.delete(id);
  };
  const changeEvent = (id, eventId, update) => store.mutate(id, state => update(eventFor(state, eventId), state));
  const poll = async (id, entry) => {
    const event = entry.metering;
    try {
      const result = await provider.lookup(id, event);
      if (result.status === 'processed' && result.matchedPrice) {
        const wallet = await readWallet(id);
        if (!sameContext(event, wallet)) fail(409, 'The processed event’s wallet context changed. Resolve its original credit contract before continuing.', 'flexprice_wallet_context_changed');
        changeEvent(id, entry.id, (current, state) => { Object.assign(current.metering, { status: 'processed', processedAt: result.checkedAt, lastCheckAt: now(), error: null }); current.flexpriceStatus = 'flexprice_processed'; state.flexprice.lastWallet = wallet; });
        cache.set(id, wallet);
      } else changeEvent(id, entry.id, current => { Object.assign(current.metering, { status: result.status === 'processed' ? 'price_unmatched' : result.status, lastCheckAt: now(), error: result.status === 'processed' ? 'No matching configured meter and price was confirmed. Execution remains blocked.' : result.status === 'failed' ? 'Flexprice reports failed processing. Resolve the event in the provider before continuing.' : null }); });
      return true;
    } catch (error) {
      changeEvent(id, entry.id, current => { current.metering.lastCheckAt = now(); current.metering.error = error instanceof AppError ? error.message : 'Usage reconciliation failed.'; current.metering.errorCode = error instanceof AppError ? error.code : 'flexprice_unavailable'; });
      return error instanceof AppError && error.code === 'flexprice_not_found' ? false : null;
    }
  };
  const flush = (id, { retryEventId = null, force = false } = {}) => {
    if (running.has(id)) return running.get(id);
    const promise = (async () => {
      const config = provider.binding(id); if (!config.enabled || !config.configured) return;
      const initial = store.read(id); if (!initial.flexprice?.consent?.enabled || initial.flexprice.consent.bindingHash !== config.hash) return;
      const pending = [...initial.wallet.ledger].reverse().find(entry => unresolved(entry) && entry.metering.status !== 'reserved' && (!retryEventId || entry.id === retryEventId));
      if (!pending) return;
      const event = pending.metering;
      if (event.bindingHash !== config.hash) fail(409, 'Pending usage belongs to another Flexprice binding.', 'flexprice_binding_changed');
      let send = event.status === 'queued' || (event.status === 'blocked' && !event.attempts && (force || !event.lastCheckAt || Date.now() - Date.parse(event.lastCheckAt) >= 10000));
      if (!send && (force || !event.lastCheckAt || Date.now() - Date.parse(event.lastCheckAt) >= 10000)) {
        const found = await poll(id, pending);
        if (retryEventId && found === false && ['unknown', 'accepted', 'processing'].includes(event.status)) {
          if (Date.now() - Date.parse(event.payload.timestamp) > 86400000) fail(409, 'This event is over 24 hours old. Resolve it with the provider before any resend.', 'flexprice_retry_expired');
          send = true;
        }
      }
      if (!send) return;
      try {
        const wallet = await readWallet(id);
        if (!sameContext(event, wallet)) fail(409, 'The event’s original wallet environment or conversion changed. It was not resent.', 'flexprice_wallet_context_changed');
      } catch (error) {
        changeEvent(id, event.id, current => { current.metering.status = current.metering.attempts ? 'unknown' : 'blocked'; current.metering.lastCheckAt = now(); current.metering.error = error instanceof AppError ? error.message : 'The original wallet could not be confirmed.'; });
        return;
      }
      changeEvent(id, event.id, (current,state) => { requireConsent(state,config); if(state.flexprice.consent.version!==initial.flexprice.consent.version)fail(409,'Metering consent changed before dispatch.','flexprice_decision_changed'); current.metering.status = 'sending'; current.metering.attempts += 1; current.metering.lastAttemptAt = now(); });
      try {
        const accepted = await provider.ingest(id, event);
        changeEvent(id, event.id, current => { Object.assign(current.metering, { status: 'accepted', acceptedAt: accepted.acceptedAt, lastCheckAt: now(), error: null }); current.flexpriceStatus = 'flexprice_accepted'; });
      } catch (error) {
        changeEvent(id, event.id, current => { Object.assign(current.metering, { status: 'unknown', lastCheckAt: now(), error: error instanceof AppError ? error.message : 'External event acceptance is unknown.', errorCode: error instanceof AppError ? error.code : 'flexprice_unavailable' }); current.flexpriceStatus = 'flexprice_unknown'; });
      }
    })().finally(() => running.delete(id));
    running.set(id, promise); return promise;
  };
  const sync = async (id, input) => {
    const state = store.read(id); const config = provider.binding(id); requireConsent(state, config);
    if (!input.acknowledged) fail(409, 'Confirm reconciliation for the current billing state.', 'flexprice_confirmation_required');
    requireDecision(state,input,config);
    if (input.retryEventId && !input.acknowledgedRetry) fail(400, 'Confirm retrying the original event ID after a not-found lookup.', 'flexprice_retry_confirmation_required');
    if (input.retryEventId) eventFor(state, input.retryEventId);
    await flush(id, { retryEventId: input.retryEventId || null, force: true });
    const wallet = await readWallet(id);
    store.mutate(id, current => { current.flexprice.lastWallet = wallet; }); cache.set(id, wallet);
  };
  const view = state => {
    const config = provider.binding(state.businessId), fp = state.flexprice || {};
    const enabled = config.enabled && config.configured && fp.consent?.enabled && fp.consent.bindingHash === config.hash && fp.lastWallet && sameContext(fp.consent,fp.lastWallet);
    return { requested: config.enabled, configured: config.configured, enabled: !!enabled, bindingHash: config.hash, status: !config.enabled ? 'Demo mode · Flexprice disabled' : !config.configured ? 'Project configuration required' : !enabled ? 'Confirmation required' : 'Project metering enabled', binding: { region: config.region, customerId: config.customerId, externalCustomerId: config.externalCustomerId, walletId: config.walletId, meterId: config.meterId, priceId: config.priceId }, consent: fp.consent || null, wallet: fp.lastWallet?.bindingHash === config.hash ? fp.lastWallet : null,
      pendingCount: state.wallet.ledger.filter(unresolved).length,
      events: state.wallet.ledger.filter(entry => entry.metering).slice(0, 40).map(entry => ({ id: entry.id, leadId: entry.leadId || null, kind: entry.kind, localStatus: entry.status, credits: entry.credits, at: entry.at, status: entry.metering.status, operation: entry.metering.operation, leadKey: entry.metering.leadKey, attempts: entry.metering.attempts, acceptedAt: entry.metering.acceptedAt || null, processedAt: entry.metering.processedAt || null, lastCheckAt: entry.metering.lastCheckAt || null, error: entry.metering.error || null })) };
  };
  const tick = async () => { for (const { id } of businesses) { try { await flush(id); } catch { /* Per-event errors remain visible. No new destination is inferred. */ } } };
  return { prepare, connect, pause, sync, view, tick, drain: () => Promise.allSettled([...running.values()]) };
}

export function createFlexpriceScheduler(service) {
  let stopped = false, pending = Promise.resolve();
  const timer = setInterval(() => { if (stopped) return; pending = service.tickBilling().catch(() => {}); }, 2000); timer.unref();
  return { stop: async () => { stopped = true; clearInterval(timer); await pending; await service.drainBilling(); } };
}
