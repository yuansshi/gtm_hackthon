# Dated market signals and source monitoring

## Design plan

Add a **Signals** tab to the existing account preview. Retain the desktop workbench's Manrope, ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, action blue `#315CBA`, and review amber `#9A5D0A`. Show the monitored company pages, explicit refresh cost/schedule, source-check outcomes, and dated evidence proposals. A compact source review appears inline, preserving account context. Accepted evidence also appears beside HITL copy.

```text
Account / Signals
  Company news/jobs URLs → manual refresh or opt-in daily/weekly schedule
  Bounded HTTPS retrieval → dated keyword proposals → accept / dismiss
  Accepted source evidence → native Signal → Company → Product
  Fresh positive context → cited draft → exact-version HITL
  Negative / removed evidence → hold or fresh review; unsent approvals clear
```

This is a working account surface, so a separate landing page, new typeface, and animated signal counters would obscure the task. Signal dates, source freshness, review decisions, and purchase intent remain distinct. Keyword matches are proposals rather than verified buying cycles. Existing application fit scores do not gain purchase-intent points.

## Contract

- Monitor one or two public HTTPS pages from the account's own website using the existing DNS-pinned reader. Do not send account or supplier context to another model/provider.
- Two local credits per check. Daily/weekly checks require explicit opt-in, current profile approval and eligibility, sufficient credits, and a running server. Disabled monitors do no background work.
- Preserve run IDs, source hashes, source failures, exact event/date passages, actor and timestamps. Retrying a completed request does not fetch or charge again. Changed configuration/profile/account source discards in-flight work and refunds once; interrupted jobs never replay.
- Extract bounded leadership, hiring, expansion, launch, funding, and hiring-freeze/closure proposals. A reviewer must confirm meaning and an exact dated source passage before acceptance. Company-site publication does not prove independent accuracy or purchase intent.
- Accepted positive signals can contextualize drafts only while the event is within 180 days and the successful source check is within seven days. Approval and dry run recheck linked evidence. Removed quotes and failed source checks require new review and invalidate editable unsent versions. Historical outbound receipts survive.
- Accepted negative signals hold new qualification and outreach until explicit withdrawal; source failure/expiry does not silently release the hold. Source refresh never manufactures responses or advances sales stages.
- Store decisions before graph projection and expose repair. Retain business separation and provider/contact restrictions.


## Implementation and limits

The timer runs every minute in the single server process. It processes at most one due account in each business per tick, schedules the next ordinary interval, and does not replay missed intervals. Manual checks also move the next check forward. Each account retains at most 50 evidence records and 100 run receipts. Company-site sources only are supported; external ATS pages, regulatory feeds and competitor renewal telemetry remain future work. Dates support ISO and full English month/day/year strings. A nearby date can refer to another event, so acceptance still requires the reviewer’s interpretation. Proposals never prove an active evaluation cycle or RFQ.

## Verification

All 115 tests pass, including 20 signal tests. Production build and npm audit pass. Tests cover source restrictions and secret parameters, valid/invalid dates, undated/negative/funding extraction boundaries, consent/revision/quota/overlap gates, partial/all-source failure, profile/account-source races, idempotency, reviewed acceptance, negative holds and withdrawal, approval/dry-run expiry, template regeneration, immutable sent receipts, durable graph repair, SQLite restart recovery, schedule opt-in/due/credit/profile gates, native scoped paths and HTTP schemas/session/CSRF policy.

A live HTTPS fetch of Elliott’s published leadership page succeeded. Its retained text had no usable event date; no dated event was accepted. A Link-Belt news page exceeded the bounded source size and was rejected. Neither result establishes a verified buying cycle. End-to-end browser and timer QA use isolated, explicitly labeled synthetic publications rather than inventing dates for these companies.

Desktop browser QA at 1280 × 720 confirmed monitor configuration, schedule consent gating, a manual two-credit check, date-passage errors and acknowledgement reset, accepted positive context in copy, fresh exact-version HITL approval, and native dated signal paths. An accelerated due time in the isolated fixture database exercised the actual server timer: one scheduled two-credit check completed, generated no duplicate proposals, retained acceptance, and scheduled the next daily interval. A changed publication then invalidated prior evidence/approval. Accepting a hiring freeze disabled qualification and HITL actions; explicit withdrawal released the hold without selecting the account or restoring old approval. Huasheng stayed empty/separate. Escape and page/dialog overflow checks passed; browser warning/error logs were empty. Main campaigns received no fixture signals or schedules.
