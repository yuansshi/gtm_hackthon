# Published buying windows and supplier changes

Module 3 now supports two native, reviewed evidence traversals:

- `Signal(job) → supports_evaluation → Signal(evaluation) → signal_for → Company → matched_to → Product`
- `Company ← signal_for ← Signal(renewal/churn) → concerns_competitor → Competitor ← competes_with ← Product ← matched_to ← Company`

These paths expose owner-assessed relevance between public facts. They do not prove that a job caused an evaluation, that a customer wants to switch suppliers, that a particular person has buying authority, or that a purchase will occur. No real active buyer evaluation or displacement opportunity is claimed from the synthetic tests.

## Account workflow

1. In **Accounts → account preview → Signals**, configure one or two account-owned public pages. The existing manual or opt-in scheduled source checks cost two credits. Search/extraction proposes job requisitions, explicit procurement evaluations, supplier renewals and supplier changes alongside the existing event types.
2. Review each publication and its exact non-future publication/event date. Generic hiring and job duties are insufficient evidence of a procurement cycle. Extraction is a keyword/date proposal, not a verified interpretation; a nearby date may be irrelevant.
3. In **Buying windows & supplier changes**, link either an accepted job requisition to accepted procurement evidence, or an accepted renewal/churn notice to a current reviewed competitor identity. Competitor review is available in Accounts → Competitive landscape.
4. Copy the exact procurement/supplier-review window passage and both published opening and closing dates. The same passage must support the selected signal and dates. A job deadline, copyright year or contract term alone is not a procurement window. For a job link, copy its published title and exact requisition passage. For a supplier-change link, the passage must name the reviewed competitor exactly.
5. Acknowledge the evidence and relevance assessment. Editing fields or changing the relevant source/review/profile clears acknowledgement. Saving this association is free; it creates no lead, opportunity stage, message, approval, recipient or spend authorization.
6. Query the native graph for one credit. Only currently active, supported windows appear in the buying-path panel. Sources are inspectable and the account action opens its exact research record.

The date controls use UTC calendar days. Closing is inclusive through the end of that day. Windows can be past, upcoming or active, but must be valid calendar dates, ordered and at most 366 days long. An upcoming or ended window remains in the account history without an active graph path.

## Evidence and validity

- Creation requires an approved business profile, eligible account and source snapshots retrieved within 24 hours. Exact normalized passages must be present on their bound source pages.
- Job/evaluation signals must have the appropriate explicit type. The primary signal for a supplier link must be a renewal or churn/termination signal. Generic hiring cannot stand in for an evaluation.
- The link binds to the exact source acceptance version, public passages, account identity/application and business context. Reaccepting a withdrawn or changed source issues a new acceptance version; it cannot resurrect an old link. An unchanged source refresh can extend freshness without changing the association.
- Existing signal limits apply: positive events are usable for 180 days after their event and seven days after a source check. A supplier link also requires a current, exact competitor review. Source loss, expiry, changed identity or company qualification/negative holds remove support.
- Profile edits mark reviewed links as needing fresh review, even if a later edit restores the previous wording. Supersession and withdrawal preserve history; replay cannot revive a retired association.
- The graph panel checks time boundaries and reloads the authoritative workspace every minute while open. It clears stale snapshots with a refresh message. These reads do not query the native graph or spend credits. Revision guards prevent an older poll response from replacing newer local state. Native refresh remains explicit.

Source ownership, interpretation, name identity, title completeness and the meaning of dates remain owner-reviewed. The validators check literal support and allowed structures; they do not independently certify these semantics. Current scope supports account-owned HTTPS HTML/plain-text pages, ISO/English dates and explicit English procurement/supplier-change wording. It does not scrape authenticated procurement portals or infer unpublished deadlines.

## Persistence, API and graph projection

`POST /api/businesses/:business/leads/:lead/buying-links` accepts a request UUID, revision, acknowledgement, link kind, accepted primary signal ID, a job signal ID or competitor ID, two dates, a window quote and job fields when applicable. `POST .../buying-links/withdraw` accepts a separate request UUID, revision, acknowledgement and link ID. Session, CSRF, strict schemas and business/account-owned IDs remain mandatory. Links cannot request schema changes or dispatch messages.

SQLite retains up to 200 links and 500 decision records per business. Decisions persist before native projection; projection failure remains repairable by an identical decision retry or graph query. Replays do not duplicate decisions or reapply withdrawals. Reset clears campaign associations while retaining the existing billing history and restrictions.

Kuzu stores fixed `supports_evaluation` and `concerns_competitor` relationships. Edge evidence contains public window/job/competitor citations and review metadata, excluding profile/account binding keys. Queries run against native relationships, check currency and window dates again, and return at most 100 paths per traversal. A concurrent graph-input change rejects and refunds the query. No owner comparison note enters the public path proof. Existing model drafting and exact-version HITL remain independent; saving a buying association never approves outreach.

## Verification and remaining scope

Twelve tests cover explicit extraction, generic-hiring rejection, exact quotes/dates/title and signal types, consent and account holds, stale snapshots, native traversals, business isolation, window expiry/upcoming states, competitor identity and withdrawal, acceptance-version binding, unchanged refresh, profile invalidation, retry/projection recovery, SQLite persistence, HTTP session/CSRF/schemas, source loss, negative holds and the unchanged outreach approval gate.

Desktop QA uses isolated, clearly labeled synthetic company publications. It verifies retained date edits, acknowledgement reset, both link types, native cited paths, exact account handoff, withdrawal/history, Escape and business switching. Main campaign data and credits remain separate. The source proposals, owner-linked associations and tests are not live buying telemetry.

Real job-to-evaluation evidence, independently established causal/authority relationships, broad market ingestion, education paths, genuine Band orchestration, live provider verification, delivery/reply ingestion and production authorization remain incomplete. Snyk is still skipped under the owner’s separate workflow change; this capability does not establish passing SAST/SCA or an integration bonus.

The idle graph check was also exercised against an authoritative background change in the isolated fixture: the prior snapshot cleared, a refresh notice appeared, and credits stayed at 93. At 1280 × 720 the page had no horizontal overflow and warning/error logs were empty. All 216 tests and the production build pass.
