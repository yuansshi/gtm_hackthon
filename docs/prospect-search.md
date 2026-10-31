# ICP-driven prospect search

## Design and scope

Accounts gains **Search prospects** alongside direct website intake and collection refresh. The desktop dialog shows an inspectable query plan from approved product families and industries, an explicit external-processing acknowledgement, costs and limits, and persistent search results with source-retrieval status. A result opens its already-fetched website intake for exact-quote review without a second fetch charge.

Retain bundled Manrope, ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, blue `#315CBA`, and amber `#9A5D0A`. Use a left-aligned plan and dense result rows. Search relevance, source retrieval, account admission, and buying intent remain separate. This is an operational workbench; no marketing hero or mobile-specific work is needed.

```text
Approved ICP / selected families
  Inspect exact query plan → consent → Tavily search
  Group domains / apply local exclusions and existing-account filters
  Fetch bounded public sources → persistent website-intake proposals
  Exact-quote account review → account / graph / contact research / HITL
```

## Contract

- One or two approved product families generate deterministic application/manufacturer queries using the approved industries and current supported US OEM scope. The server rebuilds and checks the submitted query plan and revision before spending or transmission.
- Only the displayed queries and fixed search parameters go to Tavily. Supplier identity, capabilities, pricing, contacts, outcomes, and private domain exclusions are not sent. Excluded domains and subdomains, existing accounts, and queued websites are filtered locally.
- Project-only opt-in configuration fixes the provider destination to Tavily’s HTTPS API. Dummy/global keys do not enable it. Provider errors are redacted; redirects, response bodies, requests, and source reads are bounded.
- Two local demo credits cover up to two basic searches, eight results per query, three candidate domains, and two source pages per domain. Provider usage is recorded only when returned; local credits are separate from vendor charges/refunds.
- Search responses and snippets are untrusted hints. Only successfully fetched same-site HTTPS text can become a ready website intake. Search rank is not a fit or intent score; company type, geography, contacts, and buying cycle are not invented from snippets.
- Failed sources, unsafe URLs, duplicate accounts, and excluded domains stay distinguishable in run results. Partial source retrieval is visible. A profile change discards staged proposals and refunds local credits; no work is automatically replayed on retry or restart.
- Source review uses the existing company-name, exact-quote, geography/OEM/product/domain checks and remains an explicit human decision. Admission does not shortlist an account or approve outreach. Shared search cost stays business-scoped rather than charging the entire run to each admitted account.

Primary API contract: [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search). Live provider verification requires a designated project key. This feature does not establish fully autonomous validated-account admission or a verified buying-cycle signal feed.


## Verification

- All 95 tests pass, including 16 new search tests covering plan privacy, fixed provider HTTP/schema contracts, safe URLs, consent/revision/quota gates, exclusions/subdomains, duplicate/queued domains, page limits, partial and complete failures, actual/unknown usage, stale profiles, idempotency, restart recovery, persistence, strict API schemas, source admission/shared costs, and native graph-to-HITL handoff. Production build passes; npm audit reports zero vulnerabilities.
- Desktop browser QA used an isolated copied workspace with explicitly labeled synthetic search/source fixtures. Confirmed two-family limits and acknowledgement reset, durable run resumption, excluded and failed domains, partial retrieval, quote-review handoff, admitted account with no extra charge/no automatic shortlist/no invented people, accepted result history, separate-fetch URL prefill, business separation, Escape, and no page/dialog horizontal overflow at 1280 × 720. Browser warning/error logs were empty.
- Search dialog title, close control, and fixture label stay visible while plan and results scroll independently. No fixture data is applied to the main campaign.
- Tavily’s contract was checked against its official Search documentation. No live project key or live Tavily response was verified. Synthetic provider usage is not actual vendor billing.
