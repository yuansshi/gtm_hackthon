import { AppError, digest, now } from './store.js';

const hosts = { us: 'https://us.api.flexprice.io/v1', india: 'https://api.cloud.flexprice.io/v1' };
const idPattern = /^[a-zA-Z0-9_.:-]{3,160}$/;
const fail = (status, message, code) => { throw new AppError(status, message, code); };
// Fixed point arithmetic: external credits are units, never floating-point money.
export function creditMicros(value, { negative = true } = {}) {
  if (typeof value !== 'string' || !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) fail(502, 'Flexprice returned an unsupported credit amount.', 'invalid_flexprice_amount');
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const result = sign * (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')));
  if (!negative && result < 0n) fail(502, 'Flexprice returned a negative amount.', 'invalid_flexprice_amount');
  return result;
}

export function createFlexpriceProvider({ env = process.env, fetcher = fetch } = {}) {
  const requested = env.PROJECT_FLEXPRICE_ENABLED === 'true';
  const key = (env.PROJECT_FLEXPRICE_API_KEY || '').trim();
  const region = env.PROJECT_FLEXPRICE_REGION || 'us';
  const meterId = env.PROJECT_FLEXPRICE_METER_ID || '', priceId = env.PROJECT_FLEXPRICE_PRICE_ID || '';
  const providerConfigured = requested && !!hosts[region] && key.length >= 12 && !/dummy|your[_ -]|replace[_ -]|placeholder|test-api-key/i.test(key) && idPattern.test(meterId) && idPattern.test(priceId);
  const rawBinding = id => {
    const prefix = `PROJECT_FLEXPRICE_${id.toUpperCase()}_`;
    return { businessId: id, enabled: requested && env[prefix + 'ENABLED'] === 'true', region, customerId: env[prefix + 'CUSTOMER_ID'] || '', externalCustomerId: env[prefix + 'EXTERNAL_CUSTOMER_ID'] || '', walletId: env[prefix + 'WALLET_ID'] || '', meterId, priceId };
  };
  const binding = id => {
    const value = rawBinding(id);
    const other = rawBinding(id === 'allco' ? 'huasheng' : 'allco');
    const collision = value.enabled && other.enabled && ['customerId', 'externalCustomerId', 'walletId'].some(field => value[field] && value[field] === other[field]);
    const configured = value.enabled && providerConfigured && !collision && ['customerId', 'externalCustomerId', 'walletId'].every(field => idPattern.test(value[field]));
    return { ...value, configured, collision, hash: digest(value) };
  };
  const requireBinding = id => {
    const result = binding(id);
    if (!result.configured) fail(503, result.collision ? 'Each business needs a distinct Flexprice customer and wallet.' : 'Complete this business’s designated project Flexprice configuration.', 'flexprice_not_configured');
    return result;
  };
  const request = async (config, path, { method = 'GET', body, expected = 200 } = {}) => {
    let response;
    try {
      response = await fetcher(hosts[config.region] + path, { method, headers: { Accept: 'application/json', 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(12000) });
      if (response.status !== expected) {
        await response.body?.cancel();
        const code = response.status === 404 ? 'flexprice_not_found' : [401, 403].includes(response.status) ? 'flexprice_auth_failed' : response.status === 429 ? 'flexprice_rate_limited' : 'flexprice_http_failed';
        fail(response.status === 404 ? 404 : 502, 'Flexprice did not confirm the requested operation. Check the project connection and retry explicitly.', code);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail(502, 'Flexprice returned an unsupported response type.', 'invalid_flexprice_output');
      const reader = response.body?.getReader();
      if (!reader) fail(502, 'Flexprice returned an empty response.', 'invalid_flexprice_output');
      const chunks = []; let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 131072) { await reader.cancel(); fail(502, 'Flexprice response exceeded the supported size.', 'flexprice_response_limit'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail(502, 'Flexprice returned an invalid object.', 'invalid_flexprice_output');
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail(502, 'Flexprice response was unavailable or invalid. External acceptance may be unknown.', 'flexprice_unavailable');
    }
  };
  const wallet = async id => {
    const config = requireBinding(id);
    const results = await Promise.allSettled([
      request(config, `/customers/${encodeURIComponent(config.customerId)}`),
      request(config, `/wallets/${encodeURIComponent(config.walletId)}/balance/real-time`),
    ]);
    const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
    const [customer, wallet] = results.map(result => result.value);
    if (customer.id !== config.customerId || customer.external_id !== config.externalCustomerId || customer.status !== 'published' || wallet.id !== config.walletId || wallet.customer_id !== config.customerId || !customer.environment_id || customer.environment_id !== wallet.environment_id || wallet.wallet_type !== 'PRE_PAID' || wallet.wallet_status !== 'active' || wallet.status !== 'published' || !/^[A-Za-z]{3}$/.test(wallet.currency || '')) fail(502, 'Flexprice customer, environment or active prepaid wallet does not match this business.', 'flexprice_identity_mismatch');
    if (wallet.is_cached_fallback !== false) fail(503, 'A fresh uncached Flexprice balance is required. Cached fallback cannot authorize work.', 'flexprice_stale_balance');
    creditMicros(wallet.real_time_credit_balance);
    if (creditMicros(wallet.conversion_rate, { negative: false }) <= 0n) fail(502, 'Flexprice wallet conversion rate must be positive.', 'invalid_flexprice_amount');
    return { bindingHash: config.hash, walletId: config.walletId, customerId: config.customerId, externalCustomerId: config.externalCustomerId, environmentId: wallet.environment_id, currency: wallet.currency.toUpperCase(), creditBalance: wallet.real_time_credit_balance, conversionRate: wallet.conversion_rate, checkedAt: now(), isCachedFallback: false };
  };
  const ingest = async (id, event) => {
    const config = requireBinding(id);
    if (event.bindingHash !== config.hash || event.payload.external_customer_id !== config.externalCustomerId || event.payload.customer_id !== config.customerId) fail(409, 'Resolve pending usage for the original Flexprice binding before changing destinations.', 'flexprice_binding_changed');
    const result = await request(config, '/events', { method: 'POST', body: event.payload, expected: 202 });
    if (result.event_id !== event.id) fail(502, 'Flexprice did not return the expected event ID. Acceptance remains unknown.', 'flexprice_event_identity_mismatch');
    return { eventId: result.event_id, acceptedAt: now() };
  };
  const lookup = async (id, event) => {
    const config = requireBinding(id);
    if (event.bindingHash !== config.hash) fail(409, 'Pending usage belongs to another configured Flexprice destination.', 'flexprice_binding_changed');
    const params = new URLSearchParams({ id: event.id, external_customer_id: config.externalCustomerId, start_time: new Date(Date.parse(event.payload.timestamp) - 60000).toISOString(), end_time: new Date(Date.now() + 60000).toISOString() });
    const result = await request(config, '/events/lookup?' + params);
    const value = result.event;
    if (!value || value.id !== event.id || value.customer_id !== config.customerId || value.environment_id !== event.environmentId || value.external_customer_id !== config.externalCustomerId || value.event_name !== event.payload.event_name || value.source !== event.payload.source || !['processing', 'processed', 'failed'].includes(result.status) || Object.entries(event.payload.properties).some(([key, expected]) => String(value.properties?.[key]) !== expected) || Date.parse(value.timestamp) !== Date.parse(event.payload.timestamp)) fail(502, 'Flexprice event lookup did not match the stored usage intent.', 'flexprice_event_identity_mismatch');
    const matched = Array.isArray(result.processed_events) && result.processed_events.some(item => item.customer_id === config.customerId && item.meter_id === config.meterId && item.price_id === config.priceId && typeof item.qty_total === 'string' && creditMicros(item.qty_total, { negative: false }) > 0n);
    return { status: result.status, matchedPrice: matched, checkedAt: now() };
  };
  return { binding, wallet, ingest, lookup };
}
