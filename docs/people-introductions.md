# Published people and warm introductions

## Design and scope

Keep the desktop workbench’s ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, blue `#315CBA`, and amber `#9A5D0A`. Retain bundled Manrope and left-aligned working text. Add an expandable people-research section inside Contacts and a warm-path section in the graph. Reuse the account preview and its existing tabs; do not add a navigation destination or nested dialog.

```text
Account / Contacts
  Contact research
  Published people & introductions
    Fetch company role page [+ optional former-employer identity page]
    Source text / exact quote review
    Reviewed person / local connection attestation / withdrawal
Graph
  Warm introduction paths / sources / relationship uncertainty
```

The memorable element remains amber human review. Source passages and explicit relationship decisions carry the hierarchy; decoration and vendor imitation add no value here.

## Evidence and behavior

- Two local credits retrieve one account-owned role page and optionally one public employer identity page through the shared bounded DNS-pinned HTTPS reader. No model or enrichment provider is called. Retrieval jobs persist and interrupted requests refund without replay.
- A reviewer copies the name, role, and exact source passage. Former employment also requires an exact passage containing the person and employer names, plus an employer-owned identity page quoting that organization’s name. This establishes a reviewed domain reference, not independently verified employment or corporate legal identity.
- Published-role reviews are separate from mailbox selection and from the original curated/vendor people. They are used for graph reasoning only. They do not change recipients, outreach copy, shortlists, purchase-intent scores, or sales history.
- Source snapshots must be at most 24 hours old at acceptance. Published evidence expires from warm-path eligibility after 30 days or account source identity changes. A new check of a reviewed URL suspends its reviews on retrieval failure or lost supporting passages. An unchanged fetch does not renew a review. A new review supersedes its prior name/source identity; old connection attestations do not transfer.
- The owner may attest that they worked together, know the person personally, or can request an introduction. Relationship notes stay local and are excluded from model context and graph projection. Withdrawal/revocation is explicit and replay-safe.
- Native Kuzu traversals join reviewed people through current or canonically identified former employers and continue to an eligible account/product match. Unresolved legacy employer-name nodes cannot support warm paths. Both people need current reviewed evidence and the anchor needs an active attestation bound to its exact review. Queries select current reviewed person IDs and active anchor IDs before traversal; results are bounded to 100 paths, without claiming exhaustive coverage or priority ranking. A graph snapshot clears when graph inputs change; billing-only telemetry does not clear it.
- Every result identifies published source passages and the self-reported relationship. Employment dates, contemporaneous overlap, acquaintance, present employment, buying authority, willingness to introduce, and purchase intent remain unconfirmed. Education paths and confirmed buying-cycle reasoning remain incomplete.
- Evidence, decisions, costs and graph repair stay business-scoped. Reviews persist before derived graph projection; query/replay can repair a failed projection without repeating a decision or charge.

## Validation

All 160 tests pass, including 16 new people tests covering source scope, consent/review, costs and deduplication, profile/source races, exact quotes, source age, identity review, business isolation, expiry, supersession, revocation/withdrawal replay, restart recovery and durable graph repair. Native Kuzu tests cover current/current, former/former and former/current employment paths, unresolved legacy employers, source failure/lost passages, qualification holds, preserved indexed reply attribution and private-note exclusion. A model stub confirms that relationship notes and graph-only person reviews are absent from drafting requests. Production build and npm audit pass.

Desktop browser QA uses an isolated labeled fixture workspace: two source fetches/reviews, acknowledgement reset on edit, local attestation, native path and citations, account handoff, revocation removing the path, Escape dismissal and no page overflow or warning/error logs. A separate real Elliott leadership article was retrieved through the shared reader without writing campaign records. Its public narrative is compatible with the exact-passage form; present employment and semantic accuracy are not independently verified. Main campaigns retain zero person reviews or local connections and their prior account counts/credits. No real introduction or external message was sent.
