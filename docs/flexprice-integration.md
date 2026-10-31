# Project Flexprice integration

## Design and implementation plan

Preserve the desktop workbench palette (ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, action `#315CBA`, review `#9A5D0A`) and bundled Manrope. Add one provider section to Billing, with a separate external balance, consent, sync status, and per-operation events. Keep local demo reloads visibly separate. Use inline confirmations and existing button/form patterns rather than new navigation or nested dialogs.

```text
Billing & credits
  Local demo balance / demo reload / local ledger
  Project Flexprice
    Connection and rate-contract acknowledgement
    Fresh external wallet / pending usage / sync and same-ID retry
    Operation + opaque lead allocation / accepted vs processed status
```

The hierarchy is driven by billing decisions and reconciliation, not promotional metrics. Provider fields and credentials remain server-side. The current user-selected dummy configuration stays disabled.

The intended integration uses a persisted outbox written atomically when a successful local operation settles. A new external-credit reservation requires a fresh uncached wallet response and no unresolved local operation for that business. This serializes project usage while asynchronous metering catches up. Provider acceptance is distinct from processing, and processing is distinct from payment or invoicing. Free local reloads cannot bypass the external gate. No historical demo activity is backfilled automatically, no remote wallet is funded, and no payment is collected.

## Primary contracts researched

Reviewed October 31, 2026 against the official [OpenAPI document](https://docs.flexprice.io/api-reference/openapi.json), [JavaScript SDK](https://github.com/flexprice/javascript-sdk), and [credit-gating guide](https://flexprice.io/blog/how-to-implement-real-time-credit-gating).

- Fixed US/India API hosts; server-only `x-api-key` authentication.
- Customer identity and real-time wallet endpoints establish the configured customer/wallet binding. Only explicit `is_cached_fallback: false` supports a fresh gate; missing freshness is rejected.
- Event ingestion uses a stable `event_id`, external customer ID, timestamp, string properties and HTTP 202 acceptance. Lookup reports processing separately and exposes matched meter/price attribution.
- One configured `gtm_credits_consumed` SUM meter on the `credits` property must be priced to match the portal's credit units. Explicit owner acknowledgement is required; a configured ID does not prove the price contract is correct. Do not also bill the same usage through a second overlapping meter.
- Event properties distinguish enrichment checks, graph queries, AI/source work and local outreach dry runs. A dry run must never be labeled `Outreach Sent`. Per-lead allocation uses a business-scoped opaque digest; contact details, source quotes, message bodies and private notes are excluded.

Live provider access, meter/price correctness and bonus eligibility remain unverified until designated project credentials and a matching Flexprice catalog are configured. Shared project access is not production per-user billing authorization. Detailed setup and validation will be recorded with the implementation.


## Setup

1. Use a dedicated project test environment and existing published customer with an active PRE_PAID wallet. Keep Allco and Huasheng customer/external/wallet IDs distinct. This portal does not create or fund these resources.
2. Create one usage meter for gtm_credits_consumed, with SUM aggregation on the numeric credits property. Price one unit at the wallet’s conversion-rate amount in its currency, so one portal credit corresponds to one wallet credit. Do not attach another overlapping billable meter to these events. Configure the exact meter and price IDs. Their amounts and subscription setup still need independent operator verification.
3. Copy only designated project values into PROJECT_FLEXPRICE_API_KEY, REGION (us or india), METER_ID, PRICE_ID, and the per-business ENABLED/CUSTOMER_ID/EXTERNAL_CUSTOMER_ID/WALLET_ID fields in the local .env. Both global and business enable flags must be true. Generic FLEXPRICE_API_KEY and dummy placeholders are ignored. Never commit .env.
4. Restart the server and open Billing. Review the mapping and acknowledge future metadata transmission and the matching credit-price contract. Wallet verification rejects missing/cached freshness, identity/environment mismatches, frozen/postpaid wallets, unsupported precision and invalid conversion rates.
5. Run one inexpensive graph query, then inspect Provider usage events. The worker sends once, retains the original ID and polls processing. Sync checks the matching meter/price and fetches a fresh wallet. Compare the provider ledger and price amounts independently before claiming live success.
6. Test insufficient external credits: another operation must stop before research begins even if the local demo budget is reloaded. Local reloads are not provider funding or payment fulfillment.

## Operations and recovery

Every reservation uses a snapshot no older than 30 seconds, fetched before charged HTTP or scheduled work. No unresolved local reservation/event may coexist with another charged operation for that business. This is a conservative single-portal gate, not an atomic provider reservation against spending from other systems. Both demo budget and external credit checks apply.

Successful settlement writes the event atomically with the local ledger. Refunds do not emit billable usage. Outbox states distinguish reserved, queued, blocked-before-send, sending, accepted, processing, processed, unknown, failed, price_unmatched and not_billed. HTTP 202 is only acceptance. Processing must match the configured meter/price and be followed by an uncached wallet check before releasing the gate; no payment, invoicing amount or independent price validation is inferred.

Transport retries use the same ID and payload. Ambiguous sends are reconciled by lookup without automatic reposting. An explicit resend requires owner acknowledgement, provider not-found lookup and an event under 24 hours old. A failed lookup does not prove non-acceptance; live deduplication behavior remains a provider contract to validate. Restart turns in-flight transport into unknown and refunds interrupted local work. It never replays research or outreach. Config/environment/conversion changes cannot redirect pending usage. Restore the original context or resolve it with the provider. Campaign reset retains the ledger/outbox and consent.

Consent decisions bind to their own version and a configuration fingerprint. Billing telemetry and unrelated workspace changes do not invalidate a synchronization acknowledgement; a stale decision cannot override a pause. Pausing stops future dispatch and provider-enabled charged work while retaining unresolved events. Free corrections and demo reloads remain available.

The single billable event includes credits, units=1, operation_kind, operation, business_key, delivery_mode and an optional SHA-256 business-scoped lead_key. Graph queries are graph_query_evaluated; successful enrichment checks are enrichment_check_completed (not independently verified buyers); AI and source work have separate operation labels. Local outreach is outreach_dry_run, never outreach_sent. Real delivery metrics, production checkout/funding and complete per-user/tenant billing authorization remain incomplete.

## Validation

All 190 tests pass, including 30 Flexprice tests for disabled/dummy configuration, scoped identity/freshness/precision, consent and version races, quota gates, reload separation, durable settlement/refunds, accepted-vs-processed states, price matching, unknown ingestion and same-ID retries, restart, rebinding, private-data filtering, HTTP/CSRF/schema controls, scheduled source work and graph snapshot consistency. Build and npm audit pass. Browser QA uses a separately labeled synthetic provider fixture; no real provider integration or bonus is claimed from it. Main businesses remain in the user-selected disabled dummy mode.

Desktop browser QA confirmed both acknowledgements are required, wallet verification, queued/accepted/processing/processed progression, persistent single ingestion attempts across restart, a direct billing handoff from pending work, and graph results remaining visible during billing-only updates. Synchronization succeeds despite background status changes. A zero external balance blocks a query after a +100 demo reload, with no extra usage charged. Explicit pause returns to confirmation-required state; Huasheng has no Allco events. The page has no horizontal overflow and browser warning/error logs are empty. Screenshots are retained outside the source repository. This fixture evidence does not establish live provider billing.

Due source monitors wait through ordinary pending-usage reconciliation and resume on a later scheduler tick. Identity, freshness, configuration and insufficient-credit failures still pause the schedule for owner attention. The regression test verifies no source call during the wait and one completed check after usage reconciles.
