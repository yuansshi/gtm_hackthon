import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import './flexprice.css';

const date = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not checked';
const words = value => value.replaceAll('_', ' ');
export default function FlexpriceBilling({ state, act, busy }) {
  const fp = state.flexprice || { configured: false, requested: false, enabled: false, status: 'Demo mode · Flexprice disabled', pendingCount: 0, events: [], binding: {} };
  const [consent, setConsent] = useState(false), [rates, setRates] = useState(false), [syncAck, setSyncAck] = useState(false), [pauseAck, setPauseAck] = useState(false), [retryId, setRetryId] = useState(''), [retryAck, setRetryAck] = useState(false), [error, setError] = useState('');
  const identity = JSON.stringify(fp.binding);
  useEffect(() => { setConsent(false); setRates(false); setSyncAck(false); setPauseAck(false); setRetryId(''); setRetryAck(false); }, [identity, fp.enabled]);
  const request = async (path, body) => {
    setError('');
    const result = await act('/billing/flexprice/' + path, { ...body, revision: state.revision, expectedConsentVersion: fp.consent?.version || 0, ...(path === 'pause' ? {} : { bindingHash: fp.bindingHash }) }, 'POST', true, e => setError(e.message));
    if (result) { setSyncAck(false); setPauseAck(false); setRetryAck(false); setRetryId(''); }
  };
  const retryable = fp.events.filter(event => ['unknown', 'accepted', 'processing'].includes(event.status));
  return <section className="panel fp-billing" aria-label="Project Flexprice metering">
    <div className="section-heading"><div><h2><Wallet size={18}/>Project Flexprice</h2><p>External usage metering and credit checks, separate from the demo balance above.</p></div><span className={`pill ${fp.enabled ? 'green' : 'amber'}`}>{fp.status}</span></div>
    <div className="fp-body">
      {state.billingFixture && <p className="fp-notice">Test fixture only · synthetic provider wallet and event responses</p>}
      {!fp.requested && <p className="fp-notice">Your dummy setup remains in demo mode. No Flexprice request or real charge is made. Enable designated project configuration to test the provider connection.</p>}
      {fp.requested && !fp.configured && <p className="fp-notice">This business’s project configuration is incomplete or shares another business’s customer/wallet. Provider-enabled actions stay blocked until it is corrected.</p>}
      <div className="fp-metrics"><div><span>External wallet credits</span><strong>{fp.wallet?.creditBalance ?? '—'}</strong><small>{fp.wallet ? `${fp.wallet.currency} wallet · credit units` : 'No verified wallet response'}</small></div><div><span>Pending usage</span><strong>{fp.pendingCount}</strong><small>Unresolved usage blocks another metered operation</small></div><div><span>Last wallet check</span><strong className="fp-date">{date(fp.wallet?.checkedAt)}</strong><small>Only an explicitly uncached response authorizes work</small></div></div>
      <details><summary>Customer and credit-price mapping</summary><dl className="fp-mapping">{[['Region',fp.binding.region],['Customer',fp.binding.customerId],['External customer',fp.binding.externalCustomerId],['Wallet',fp.binding.walletId],['SUM-credit meter',fp.binding.meterId],['Matching price',fp.binding.priceId]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Not configured'}</dd></div>)}</dl><p>The configured meter sums the credits property of gtm_credits_consumed events. Its price must match one portal credit to one external wallet credit. Matching IDs and event processing do not independently verify the price amount.</p></details>
      {!fp.enabled && <form onSubmit={event => { event.preventDefault(); request('connect',{acknowledged:consent,acknowledgedRates:rates}); }} className="fp-confirm">
        <h3>Confirm project metering</h3>
        <label><input type="checkbox" checked={consent} disabled={!fp.configured} onChange={event=>setConsent(event.target.checked)}/>I authorize future usage events for this business’s configured customer and wallet. No historical demo usage is backfilled.</label>
        <label><input type="checkbox" checked={rates} disabled={!fp.configured} onChange={event=>setRates(event.target.checked)}/>I checked that the SUM-credit meter and its price match the portal’s credit units, without overlapping billing meters.</label>
        <button className="button primary" disabled={busy||!fp.configured||!consent||!rates}><ShieldCheck size={15}/>Verify wallet & enable metering</button>
      </form>}
      {fp.enabled && <form className="fp-sync" onSubmit={event=>{event.preventDefault();request('sync',{acknowledged:syncAck,retryEventId:retryId||null,acknowledgedRetry:retryAck});}}>
        <label><input type="checkbox" checked={syncAck} onChange={event=>setSyncAck(event.target.checked)}/>Refresh the project wallet and reconcile pending usage.</label>
        <button className="button secondary" disabled={busy||!syncAck||(!!retryId&&!retryAck)}><RefreshCw size={15}/>Sync Flexprice status</button>
        {retryable.length>0&&<details><summary>Retry an unconfirmed event</summary><p>Use the original event ID. Resend requires a not-found lookup and an event less than 24 hours old. A failed lookup does not prove the original was never accepted.</p><label className="fp-field">Original usage event<select value={retryId} onChange={event=>{setRetryId(event.target.value);setRetryAck(false);}}><option value="">Reconcile only; do not resend</option>{retryable.map(event=><option key={event.id} value={event.id}>{event.id.slice(0,8)} · {words(event.operation)} · {event.credits} credits</option>)}</select></label><label><input type="checkbox" checked={retryAck} disabled={!retryId} onChange={event=>setRetryAck(event.target.checked)}/>I authorize a same-ID retry only after the provider reports this event not found.</label></details>}
      </form>}
      {error&&<p className="fp-error" role="alert">{error}</p>}
      <p className="fp-boundary">Both the local demo budget and the external wallet gate apply when enabled. Demo reloads do not fund Flexprice. Pending or ambiguous events must reconcile before more credit-consuming work. This portal does not collect payments or top up the provider wallet.</p>
      {fp.enabled&&<details><summary>Pause provider-metered execution</summary><label className="fp-check"><input type="checkbox" checked={pauseAck} onChange={event=>setPauseAck(event.target.checked)}/>Pause dispatch and new provider-metered work; retain unresolved usage.</label><button className="button secondary" disabled={busy||!pauseAck} onClick={()=>request('pause',{acknowledged:pauseAck})}>Pause metered execution</button></details>}
    </div>
    {fp.events.length>0&&<><div className="section-heading"><div><h3>Provider usage events</h3><p>Accepted means queued by Flexprice. Processed requires matched meter/price attribution and a new uncached wallet check; it does not establish payment.</p></div></div><div className="research-scroll"><table><thead><tr><th scope="col">Operation / local account</th><th scope="col">Credits</th><th scope="col">Provider status</th><th scope="col">Event</th><th scope="col">Last check</th></tr></thead><tbody>{fp.events.map(event=><tr key={event.id}><td><strong>{words(event.operation)}</strong><small>{event.leadId?state.leads.find(lead=>lead.id===event.leadId)?.name||event.leadId:'Business-scoped operation'}</small>{event.error&&<p className="fp-event-error">{event.error}</p>}</td><td>{event.credits}</td><td><span className={`pill ${event.status==='processed'?'green':event.status==='not_billed'?'':'amber'}`}>{words(event.status)}</span><small>{event.attempts} ingestion attempts</small></td><td><code title={event.id}>{event.id.slice(0,8)}</code>{event.leadKey&&<small title={event.leadKey}>Opaque lead allocation</small>}</td><td>{date(event.lastCheckAt)}</td></tr>)}</tbody></table></div></>}
  </section>;
}
