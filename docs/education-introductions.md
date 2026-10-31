# Shared education introduction paths

## Desktop design

Reuse the light workbench, Manrope, ink/muted text, blue actions and amber human review from the existing people workflow. In **Accounts → Contacts → reviewed person**, add an inline **Education evidence** disclosure: fetch the company biography and institution identity page, inspect retained text, review exact passages, then retain or withdraw the education record. Reuse the account dialog; no new destination or nested dialog. In the graph, show a separate **Shared education paths** section with person → institution → person chains, cited passages and an exact target-account handoff. Add `Institution` as an auxiliary record type with directional `studied_at` edges. A shared institution is a possible route, not a confirmed acquaintance or invitation.

## Evidence and limits

Education requires a current source-reviewed person, the exact account-owned biography, and a separate institution-owned identity reference. The reviewer copies passages with the full person/institution names, chooses study/attendance or a degree claim, and acknowledges their interpretation. Literal passage matching and educational terms are guardrails; the app does not independently validate semantics, attendance, degrees, dates, campus identity, overlap, acquaintance or willingness to introduce.

Two public-person-research credits retrieve the two bounded, DNS-pinned HTTPS snapshots. Snapshots must be at most 24 hours old at acceptance; accepted education and its bound person must remain within 30 days. Institution matching requires both the reviewed full name and canonical source hostname. Aliases and shared-name campuses are not automatically merged. Names alone never join schools. Superseded/withdrawn/stale person reviews, source loss or changed passages, education withdrawal, revoked connections and ineligible target accounts remove path support. New evidence never transfers an old person connection attestation.

Native traversal requires education on both reviewed people and an active owner attestation on the anchor’s exact person review. Education remains separate from employment paths, mailbox selection, model drafts and message approval. Private connection notes stay outside native graph projection and model/provider requests. Account-wide do-not-contact controls apply before and after retrieval. A hold/release or profile/account change during work rejects the result with one local refund. Requests and decisions are replay-safe, persist in business-scoped SQLite, and can repair graph projection without a second charge. Interrupted retrievals refund without automatic replay.

Public company intelligence and historical records remain available. No introduction, email or LinkedIn message is sent by this workflow.

## Verification

All 244 tests pass, including 16 education tests. Coverage includes two-source scope, account/person/profile/credit gates, request replay, quote/type/identity review, source age, withdrawal/supersession, durable projection repair, native education-only paths, private-note exclusion, institution name/domain mismatches, native 100-path bounds, live query-time expiry, person/connection lifecycle, source loss from both research flows, hold/release races and single refunds, model/HITL separation, SQLite/restart typed authenticated HTTP routes, and profile-only loading during graph navigation/business switching. The production build passes without chunk-size warnings.

Desktop QA used a separate synthetic workspace: two biographies and an institution reference were fetched/reviewed through the actual form; edits reset acknowledgement; native graph traversal produced the cited path; Institution filtering/inspection retained directional evidence; account handoff selected the correct target; withdrawal removed the path without spending credits; Escape, business state, page overflow and warning/error logs were checked. Fixture evidence cannot establish real education, acquaintance or provider integration. Main campaigns retain zero reviewed people, education claims and connection attestations, and their prior account counts/credits.

A real [Elliott leadership publication](https://elliottequip.com/press-release-andrew-schumacher-vice-president-nebraska-operations-chad-barrett-director-product-management/) was separately retrieved through the shared reader. No education claim or relationship was admitted from that retrieval. School and connection data were not inferred.
