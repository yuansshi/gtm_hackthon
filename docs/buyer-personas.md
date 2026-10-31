# Buyer title and seniority targets

**Product & ICP → Ideal customers** now has optional **Target job titles** and **Target seniority** inputs alongside the existing broad buyer-role choices. Use comma-separated phrases. Unknowns stay blank; no default titles or ranks are injected into legacy profiles. These fields describe whom to research, not a verified decision-maker or buying authority.

Guided intake supports explicit labels:

```text
Target job titles: Director of Engineering, Procurement Manager
Target seniority: Director, Manager
```

Local extraction preserves the supplied text and requires accept/adjust/dismiss review. Blank labels cannot consume a following line; duplicate conflicting values and values over 600 characters produce questions without truncation. Labeled persona text does not become local buyer geography or company-size criteria. Optional model extraction must preserve the complete supplied value/clause, including exclusions. Source-linked catalog hypotheses can suggest research targets at at most 0.5 confidence; those suggestions do not establish actual job titles or ranks. All model output still requires owner review and explicit project-model processing consent.

Applied changes use the existing full-profile approval binding: research and unsent-message approvals are revoked, and old vendor results remain stale even after the revised profile is approved again. Per-field provenance survives unrelated edits and clears when that exact target value changes. Coverage/confidence remains uncalibrated.

Each new Hunter contact search records these targets locally with the search. Only the company domain goes to Domain Search, and only the selected address goes to Email Verifier. The new criteria are not added to Hunter requests. Owner-authorized intake/draft model context may retain the ICP through the existing processing acknowledgement.

The selected vendor candidate’s inspector shows the **saved search targets**, raw returned title/seniority text and a local phrase comparison. Matching ignores case and punctuation, respects word boundaries and checks any comma-separated phrase. It does not infer aliases, rank equivalence, current employment or authority. Missing/unknown vendor text stays unknown. Negation, boolean expressions, rank ranges and wildcards require review instead of a positive match. A Director title does not turn a vendor’s broad “executive” seniority into a verified Director rank. These hints neither filter candidates automatically nor authorize selection or outreach.

Older searches without a target snapshot show **not recorded**; the UI never fills historical criteria from today’s ICP. Selecting a contact records the comparison with the existing review, preserving the owner’s decision context without changing historical searches. Contact/source review, dated email checks and exact-version message approval remain separate requirements.

Eleven dedicated tests cover literal/local extraction, phrase/unknown/ambiguous comparisons, mixed review and provenance, catalog/explicit model grounding, intercepted real-SDK consent/deduplication/refunds, strict HTTP and legacy hashes, local-only vendor scope, contact decision history, stale/in-flight profile changes and store reopen persistence. The shared HTTP intake test now reviews all 24 Allco fields; the union has 29 fields, with 23 available to Huasheng. The isolated deployment probe verifies persona targets after restart. Main Hunter processing remains disabled at the user’s request, and no live contact-resolution success is claimed.
