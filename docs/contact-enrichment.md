# Vendor contact research

## Design

Accounts keep their compact contact status and an inline **Find contacts with Hunter** action. A desktop dialog presents vendor candidates, source links, proposed roles, verification results, and the final contact decision together. This extends the workbench’s source-review pattern; it does not introduce a new landing page or mobile flow.

Use the existing ink `#202A38`, muted `#667085`, background `#F7F8FA`, border `#E6E9EF`, action blue `#315CBA`, and review amber `#9A5D0A`, with bundled Manrope. Align fields and records left. Keep email deliverability, persona relevance, and buying authority separate. The final action explicitly updates unsent recipients and requires new message approval.

```text
Account / Contact research
  Account domain + approved persona scope
  Explicit provider processing confirmation → search (5 local credits)
  Candidate / role / public evidence | verify selected email (5 local credits)
                                    | provider result, checks, date
  Human contact decision → selected contact, graph, unsent recipient/version reset
```

## Contract

- Hunter Domain Search and Email Verifier V2 use fixed provider endpoints. Only explicitly enabled project configuration is accepted; personal/global keys, placeholders, and Hunter’s public test key do not enable the live adapter.
- Requests transmit this account’s domain or a vendor-returned same-domain address only after acknowledgement. No supplier profile, outcome notes, other businesses, or message content is sent.
- Strict HTTP routes, session/CSRF, profile and account context checks, revision checks, persistent request IDs, and local credit reservations apply before requests. Local refunds do not imply vendor refunds.
- Search results never become selected recipients automatically. Masked, off-domain, disposable/webmail, and unsupported records cannot supply invented addresses. Only safe vendor-returned evidence and LinkedIn profile URLs are retained; profile ownership and buying authority remain unverified.
- A selected candidate must have a completed verifier result. Pending (HTTP 202), failed, invalid, disposable, webmail, and restricted responses cannot authorize a contact. An uncertain/accept-all result requires a separate acknowledgement and stays labeled uncertain.
- A provider-valid label requires the matching address, valid status, successful MX/SMTP checks, no accept-all/block/disposable/webmail flag, and a dated verification within 30 days. This is a dated vendor assertion, not guaranteed inbox delivery or verified buying authority.
- Human application updates the selected contact, preserves historical sent receipts and stage history, advances editable unsent versions, clears their approvals, and updates their recipients. Contact decisions persist before graph projection and replay without repeating the decision or charge.
- Hunter processing restrictions prevent repeat verification, contact selection, approval, and dry runs for that address in this business. This is not a complete suppression/opt-out product.

Primary API reference: [Hunter API V2](https://hunter.io/api-documentation). Hunter’s public `test-api-key` returns fixed fictional data; it may validate the transport contract but never establishes actual contact enrichment. Live provider verification still requires a project key.


## Verification and current limits

- All 79 tests pass, including 20 new Hunter/selection tests. They cover project-only configuration, real HTTP request shape with intercepted responses, secret-safe failures, masked/off-domain/unsafe-source rejection, dated validity, credit/revision/acknowledgement guards, idempotency, stale context, pending checks/closure/restart, recipient/version invalidation, restricted recipients, durable projection repair, native graph provenance, SQLite restart, and strict HTTP boundaries. Existing outcome, source-intake, analytics, billing, and HITL tests still pass.
- Production build and npm audit pass. Snyk remains blocked at the project credential gate; this work does not bypass it.
- The manual `node scripts/check-hunter-contract.js` check passed against Hunter’s official fixed-data public test API. It confirmed search/verifier parsing, wrong-domain rejection, and that the public test key cannot enable the live adapter. It applied no contacts and is not a live enrichment success.
- Browser checks used an isolated SQLite copy, a clearly labeled synthetic account, and intercepted provider responses. They covered consent and credit labels, candidate review, HTTP-202 pending/poll flow, separate selection acknowledgement, recipient/version reset, fresh exact-message approval, accept-all acknowledgement, graph provenance, Escape, and no horizontal overflow at the normal 1280 × 720 desktop viewport. The main campaign received no synthetic contacts, vendor requests, or outcomes.

Live verification requires a designated project Hunter key. Domain Search does not establish headquarters, current employment, buying authority, or LinkedIn ownership. No external email or LinkedIn message is sent. The existing public-address/MX path remains available without the provider.

Vendor-company metadata uses a separate lookup/review path in the account’s Company tab. Company/contact requests share the project key, credit policy and workspace concurrency gate; company fields never silently replace selected contacts. Details: [Company enrichment](company-enrichment.md).
