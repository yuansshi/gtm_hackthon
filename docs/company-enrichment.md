# Company enrichment and ICP qualification

## Design plan

Add **Company** to the existing account preview tabs. Preserve Manrope and the workbench palette: ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, action blue `#315CBA`, review amber `#9A5D0A`. Use compact vendor-field rows, side-by-side target/comparison text, source details and a separate review action. No new landing page or decorative score is needed.

```text
Account / Company
  Explicit Hunter processing consent → company lookup + bounded company pages
  Vendor fields / source status / unknowns → select fields + review estimates
  Optional exact HQ city/country source corroboration → reviewed company profile
  ICP headcount/HQ comparison → qualification hold or unresolved questions
  Native Company projection / fresh HITL context; no automatic recipient changes
```

## Contract

- Use the designated project Hunter key and official Company Enrichment endpoint. Transmit only this account's domain. Keep supplier details, contacts, outcomes and private ICP criteria local. No key is accepted by the browser, and no personal/global key is used.
- Five local demo credits per lookup, separate from vendor billing. Retain request IDs, response metadata, no-match/failure distinctions, profile/account fingerprints, restart recovery and idempotency. A completed no-match consumes the lookup; failure refunds local credits without claiming a vendor refund.
- Retain only company name/domain, industry/classification, employee range/count, revenue fields, headquarters and vendor indexing date. Do not import phone numbers, site emails, personal profiles, identifiers or coordinates.
- Provider data remains vendor-reported, including after human review. Employee counts/revenue are not independent verification. An exact current company-source quote can corroborate the headquarters city/country only; it does not validate every address component or the whole vendor profile.
- Apply only fields selected from the exact returned run. Acknowledge uncertainty separately. Quote presence and domain agreement do not prove semantic accuracy or a legal company identity.
- Compare supported employee ranges and HQ country with the approved US campaign locally. Clear non-overlap requires qualification review; partial/unknown/unsupported criteria remain unresolved. Revenue comparisons remain unknown without an established currency/basis. Do not add confirmed-size or purchase-intent score points from vendor estimates.
- Company decisions invalidate editable unsent approvals and appear in HITL/graph evidence. Preserve sent receipts, selected contacts, account history and industry cohorts. Persist reviews before graph projection and support repair/withdrawal. Processing restrictions survive campaign reset and block repeated vendor-company lookup.

Primary contract: [Hunter Company Enrichment](https://hunter.io/api-documentation#company-enrichment). Company lookup retains at most 30 runs per campaign. Provider results must be reviewed within 24 hours; a retained company profile older than 30 days or with changed account source context requires refresh/review or withdrawal. Only current corroborated HQ evidence can enter explicitly requested AI drafts; those drafts retain a company-review link and block approval/dry run if it changes or expires.

Live provider verification requires a designated project key; fixture success does not establish live firmographic accuracy.


## Verification

All 144 tests pass, including 23 new company tests. Production build and npm audit pass. Tests cover exact provider domain/schema and bounded HTTP contract, omission of unrelated personal fields, opt-in project configuration, consent/revision/quota/concurrency, no-match/failed outcomes, account-source/profile races, selected-field/estimate/quote guards, range conflicts/overlap/unknown criteria, optional HQ-country enforcement, credit/idempotency, negative qualification effects, immutable history, review/withdrawal replay, source/age expiry, persistent restrictions/reset recovery, durable graph repair, native scoped Company projection, strict HTTP/session/CSRF policy, in-flight model invalidation and linked HQ evidence expiry/withdrawal at HITL.

Desktop browser QA at 1280 × 720 used an isolated copied workspace with explicit synthetic vendor/source labels. Verified five-credit lookup consent, no automatic field application, field selection, HQ quote corroboration, estimate/criterion acknowledgement reset, readonly company evidence in HITL and native graph inspector, fresh exact-version approval, a later employee range outside the target creating a visible hold and disabling HITL, explicit withdrawal without restoring selection/approval, unchanged contact/stage history, business separation, Escape and no dialog horizontal overflow. Browser warning/error logs were empty. Main campaigns received no synthetic company profiles or lookups.

The official primary Company Enrichment documentation supplied the contract. No live company lookup used a project key. Hunter's documented fictional-data public test endpoints were rechecked for existing contact search/verification; they applied zero contacts and cannot enable live enrichment. A header-auth public-test request returned 401, while the established query-key public contract passed; query-key authentication remains in use, with credentials and request URLs redacted from workflow errors. This does not establish live firmographic or corporate identity verification.
