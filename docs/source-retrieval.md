# Shared public-source retrieval

Curated account research, website intake/refresh, prospect-search source retrieval, and account signal monitoring use `server/public-source.js`. The curated path additionally restricts its initial host to the catalog/supplier/competitor allowlist. A separate DNS preflight never authorizes a later unpinned connection.

## Connection boundary

- Public HTTPS only, port 443, with no embedded credentials, IP-literal destinations, or local host suffixes.
- Resolve all addresses and reject a response containing a non-public/reserved address. Pin one validated address to the actual HTTPS connection through the request's lookup callback. Keep TLS hostname verification and the original hostname as server name; no global connection pool is reused.
- Revalidate/re-resolve every redirect, retain same-company host scope (allowing the `www` alias), and stop after four request hops. Another catalog company is not an acceptable redirect destination for the original company's evidence.
- Use one 15-second deadline spanning lookup, connection, redirects, and body reads. Accept HTML/plain text with identity encoding; bound HTML to 1 MB and retained text to 48,000 characters.
- Send only research identification, content acceptance and encoding headers. Do not send browser cookies, authorization, model keys or supplier context to public sites. Page scripts are not executed; retained company/contact footer text remains available for review.
- Keep source URL, final URL, hash, retrieval timestamp and failure status. Retrieval is not semantic verification, a current RFQ, or mailbox validity.

This change removes the curated path's separate generic `fetch` connection, which could resolve a hostname again after validation. The old curated 2 MB/per-request timeout differs from the shared limits above; large, compressed, cross-host or otherwise unsupported pages can fail. Review failures rather than weakening TLS/DNS checks or silently marking cached context as freshly verified.

Hunter, Tavily and the optional model adapter use their fixed official API destinations and separate bounded provider contracts. They are not arbitrary public-page fetches. This document does not claim a passing Snyk scan or complete production security certification.

## Verification

Six new integration tests exercise the curated entry point through the actual shared HTTPS transport: DNS pinning despite a changed resolver answer, hostname TLS checks, safe headers, initial allowlist/URL rejection, legacy fixture rejection without a network request, same-site redirect pinning, cross-company redirect rejection, mixed/reserved DNS rejection, byte/type/deadline limits, inert text and contact footers, and the service's full curated discovery flow with business/approval boundaries. Existing shared-reader tests continue to exercise redirects, IPv4/IPv6 restrictions, response encodings, size limits and lookup deadlines.

No production campaign is refreshed by these tests. Live primary-source compatibility is checked separately without writing to a workspace. Live provider credentials, actual delivery, and Snyk scans remain separate requirements.

All 121 tests pass; production build and npm audit pass. Live Elliott leadership and Altec company pages were reachable through the curated entry point (4,075 and 2,673 retained characters respectively). Those compatibility checks wrote no campaign records and do not validate the semantic accuracy of the companies’ claims.
