# Source-backed competitive research

In **Accounts → Competitive landscape**, research a starting reference or add a named direct, indirect, or alternative supplier. This extends the catalog with business-scoped, reviewed competitor records; it does not establish an objective competitive ranking.

## Retrieval and review

1. Enter the published company name, your competitive category, a company-owned identity page and an optional product/pricing page on the same website. Confirm page ownership and the two-credit charge. Existing references stay pinned to their recorded website.
2. The shared DNS-pinned HTTPS reader retrieves at most two pages. Hostname TLS verification, same-website redirects, response/time limits and public-address checks apply. Pages are untrusted text. No model, contact vendor or outbound messaging service is invoked.
3. Local keyword extraction proposes literal passages for identity, positioning, pricing, packaging/product range and technical differentiation. These excerpts can be irrelevant or incomplete. Inspect the snapshots, edit or clear the proposals, and review their scope.
4. Confirm the exact company identity, source passages, pricing scope and category to save a comparison. Changes to the form clear acknowledgement. Comparative advantages and limitations belong in the separate owner-interpretation note.

The server checks exact normalized passage presence, company-name presence in the identity quote, the approved business context, and snapshot age of at most 24 hours. Quote presence is not independent semantic verification, source ownership verification, product equivalence or supplier qualification.

## Pricing states

| State | Required support | What remains unknown |
| --- | --- | --- |
| Published price passage | A source passage containing a currency and amount | Applicability, unit, configuration, taxes, delivery and availability require review. A currency match can be unrelated to the product. |
| Quote explicitly required | A passage with an explicit quote/quotation or pricing-contact instruction | No actual commercial quotation or price is established. |
| Pricing not established in reviewed pages | No pricing claim or pricing passage is applied | This is limited research coverage, not proof that the supplier publishes no prices. |

There is no inferred industrial price tier, discount, lead-time advantage, OEM approval or performance equivalence. Catalog pricing hints that previously implied a quote requirement without a reviewed passage now say pricing is not established.

## Currency and graph use

Reviewed evidence is usable for up to 30 days and only while its business/product/profile context remains current. A later retrieval that fails or loses an accepted passage marks that review as needing fresh review. The old passages remain inspectable as history. A new successful retrieval does not silently restore approval; it needs a new review. Withdrawal and supersession remove active support.

The native graph stores reviewed quoted facts and source URLs on `Competitor` nodes. An owner-classified competitive reference can support `Product → competes_with → Competitor`; that classification remains an assessment. Custom references have no active competitive edge without a current review. Existing catalog edges remain explicitly unreviewed hypotheses. Query-time validity and graph context checks reject results if relevant evidence changes during traversal. Cached graph snapshots have an explicit query time and need refresh for current evidence.

Owner comparison notes stay out of native graph facts, graph context fingerprints, model requests and outreach. Source review does not change accounts, recipients, shortlists, pipeline stages, message versions or approvals. Competitive passages are not automatically inserted into messages. Outreach retains its separate exact-message HITL gate.

## Operations and accounting

- `POST /api/businesses/:business/competitor-research`: request UUID, revision, reference ID or null, name, category, identity URL, optional same-site detail URL, acknowledgement. Returns 202 and `activeCompetitorResearchId`.
- `POST .../competitor-research/:run/review`: separate decision UUID, revision, acknowledgement and reviewed fields. Review consumes no additional credit.
- `POST .../competitor-research/:run/dismiss`: revision; discards a pending proposal without refunding completed retrieval.
- `POST .../competitors/withdraw`: separate decision UUID, revision, review ID and acknowledgement.

All routes require the project session and CSRF protection, strict typed bodies and business-owned IDs. Retrieval uses the existing local and optional project Flexprice gates. `competitor_research` reserves two credits; successful retrieval consumes them, while failed or stale-context work refunds once. The Flexprice operation is a source-research completion, not a lead-enrichment or outreach-sent claim. Retry IDs preserve results and prevent repeat retrieval/charging. Decision replay can repair projection without reapplying a withdrawal or resurrecting evidence.

Research and decisions persist in SQLite. Up to 100 runs, ten pending proposals, 200 reviews and a bounded decision history are allowed per business. An interrupted retrieval is marked failed and its reservation refunded on restart; it never replays automatically. Graph projection failure leaves the durable decision pending for repair by another decision retry or graph query. Reset clears campaign competitive research while preserving the existing billing history and provider restrictions.

## Verification and limits

Fourteen tests exercise source scope/consent, exact quotes and pricing, unknown fields, request replay, refunds, profile/source races, expiry, business isolation, supersession/withdrawal, restart, projection repair, native graph edges, private-note exclusion, model context and the unchanged outreach approval gate. HTTP tests cover session, CSRF, typed payloads and the new Flexprice preflight path.

A separate local example retrieved two real public Yates pages through the complete source-proposal workflow and confirmed literal excerpts, two-credit consumption and zero approved facts or drafts. This demonstrates public-source retrieval, not approval of competitive claims. Desktop fixture QA uses clearly labeled synthetic sources; fixtures and captured source text are excluded from the source repository.

Broader autonomous competitor discovery, independently verified comparative advantages, multilingual price semantics, renewal/churn evidence, displacement reasoning and automated competitive outreach remain incomplete. No Band, live model, enrichment-vendor or live Flexprice bonus is established by this capability.

Desktop QA confirmed proposal acknowledgement reset, reviewed quote-required pricing, five graph source citations, failed-source suspension and a two-credit refund, withdrawal and cross-business absence. At 1280 × 720 there was no page overflow and no browser warning/error logs. All 204 automated tests and the production build pass.
