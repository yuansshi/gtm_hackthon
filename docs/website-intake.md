# Website-sourced account intake

## Design and boundary

Account research supports a **Research a website** action alongside the existing collection refresh. A native desktop dialog separates source retrieval from account admission: supply up to two same-site public HTTPS pages, inspect the retained text, enter account/application fields and exact supporting quotes, then confirm the evidence review. Sources are data, never instructions.

The existing light workbench, Manrope typography, blue action `#315CBA`, ink `#202A38`, border `#E6E9EF`, and amber review `#9A5D0A` remain consistent. A source-text column stays beside the account form; the final action says **Add researched account**. The account preview exposes quotes, citation URLs, retrieval time, provenance, and remaining unknowns. No new hero or mobile-specific flow is needed.

```text
Accounts / Research a website
  Page URLs → bounded source job → review
  Source text / citations       | Account, geography, OEM, application quotes
                               | Product family / fit hypothesis / confirmation
  Add researched account → existing table, graph, pipeline, and HITL workflow
```

This expands the collection without treating a user-entered URL or search snippet as a verified prospect. Evidence quotes must occur in the retained fetched text. The reviewer owns their interpretation. Source-backed relevance does not establish company size, buying responsibility, mailbox deliverability, an RFQ, or technical compatibility.

## Network and state contract

- Authenticated, CSRF-protected intake requires the current approved profile and revision. Source work uses the existing two-credit research rate; failures refund once.
- Public HTTPS on port 443 only. No credentials, IP-literal targets, local hostnames, private/reserved DNS answers, or cross-site redirects. DNS is resolved once per hop and the connection is pinned to a validated address while retaining hostname TLS verification. No cookies, authorization headers, ambient proxy, or insecure TLS option is sent.
- At most two same-site pages, bounded redirects, total deadline per page, response-size and text-retention limits, and HTML/plain-text content types. No JavaScript is executed.
- Intake request IDs deduplicate retries. Results are bound to the originating business and profile fingerprint. Profile changes or restart discard interrupted work rather than promoting stale proposals.
- Review validates source membership, exact quote coverage, product-family ownership, geography/OEM/domain exclusions, and account deduplication before admission. New records retain unknown people and contact verification unless a published address is explicitly selected from the fetched source.
- Accepted custom candidates remain in the business’s collection and participate in source refresh. A missing or changed quote blocks qualification until reviewed again, while preserving historical stages and sent receipts.

Open-ended search-provider discovery remains unconnected. The optional Hunter contact adapter is a separate workflow and requires a project key for live verification. This source-review flow is the admission path those results can use later; it does not claim those integrations are connected.


## Verification

- All 59 tests pass, including 17 new tests for URL/address restrictions, transport pinning and TLS options, redirects, response/deadline limits, inert source extraction, scope and quote validation, quota/refund/deduplication, persistence/restart, projection repair, stale evidence, and in-flight model/MX context changes. Existing outcome, billing, analytics, and HITL checks still pass.
- Production build passes; npm audit reports zero vulnerabilities. This does not establish a passing Snyk scan.
- Live source retrieval was checked against Gradall’s official home and news pages with TLS verification enabled. In an isolated SQLite copy, the browser rejected an absent application quote, admitted a reviewed Gradall account, preserved unknown people/mailbox/intent, and left it unshortlisted. Explicit shortlisting then made it available in graph matching and the source-template/HITL composer. No recipient was invented and no external message was sent.
- Browser checked queue resumption, acknowledgement reset after quote editing, Escape dismissal, completed-work dismissal, business isolation, and no page/dialog horizontal overflow at the normal 1280 × 720 desktop viewport. Browser warning/error logs were empty. Screenshots and live source snapshots remain private local QA artifacts.
- The main campaign retained its four accounts and received no test intakes, accounts, or outcomes.

## Limits

This is owner-reviewed website research, not autonomous web search, semantic fact checking, a verified buyer database, or a guarantee of source freshness after review. The US evidence check accepts an explicit United States/USA reference or a state abbreviation plus ZIP code. Product fit and buyer type remain review judgments grounded in retained quotes. Pages behind authentication, scripts, unsupported content encodings, site-wide redirects, or network restrictions may fail; there is no insecure retrieval fallback. Project credentials are still needed for live provider work and Snyk.
