# Product and technical intake

Guided intake can propose a product description and the selected business’s existing capability values. Expand **Product input format** for the current labels. Separate supplied values with a new line or semicolon. For example:

```text
Product description: Synthetic custom cylinders for material handling, subject to engineering review
Bore & rod diameter range: 50–100 mm bore, rod dimensions pending
Rated working pressure: Up to 250 bar, subject to seal and duty-cycle review
```

These are synthetic examples, not Allco specifications. Huasheng exposes its casting-specific labels instead. Local extraction preserves literal wording, units, ranges, negations and uncertainty. Blank labels stay blank and cannot consume the following line. Conflicting duplicates and values above 3,000 characters produce questions without partial extraction. Unlabeled descriptions still need the structured form or optional model proposal. Product and commercial labeled statements are excluded from the local buyer-criteria parser, so supplier location or workforce wording cannot silently become buyer geography/headcount.

Each suggestion requires accept, adjust or dismiss review. Applying a capability value always sets its evidence status to **Unconfirmed**, including replacement of a previously internally reviewed value. Dismissal preserves the existing value and status. Intake cannot set website/reviewed status, switch product families or edit business identity. A separate capability-status review is still needed; research approval never establishes engineering compatibility.

The optional project model receives a typed whitelist covering both businesses. Runtime checks restrict capability fields to the current business and require the complete explicitly labeled value or a complete unlabeled source clause as both value and quote; catalog specification guesses, converted units, invented qualification language and changed unit case are rejected. The whitelist has 29 unique fields; a single business permits 24 for Allco or 23 for Huasheng, including the existing ICP and commercial fields. Strict HTTP review rejects extra properties, excessive decision lists, foreign proposal IDs, partial/stale reviews and unsupported values. External-processing consent, request deduplication and token/local-credit accounting remain unchanged. Live project model verification remains outstanding.

Field provenance is persisted per description/capability value. Exact value changes clear that field’s provenance; unrelated ICP edits preserve it. **Product & capability inputs** in the confidence panel discloses coverage and reviewed extraction provenance. Confidence describes extraction/coverage, not technical accuracy. No new profile defaults are injected, so existing approval hashes remain compatible. Applied changes invalidate research and unsent-message approvals through the existing full-profile binding.

Owner exports and subsequent approved drafting retain product/capability context, with capability status still explicit. The model is instructed to qualify unreviewed technical statements; this is guidance, not independent fact verification. Graph context changes with these values. Exact HITL remains mandatory. Internal commercial targets continue to be removed from outbound model context, including duplicate confidence rows.

Ten dedicated tests cover business-scoped/literal extraction, blank labels and buyer-criteria separation, mixed review and status reset, provenance and legacy compatibility, invalid/stale/scoped input, model-output rejection, intercepted real-SDK consent/deduplication/refunds, all-24-field HTTP review, store reopen persistence and the unconfirmed-context drafting handoff. The isolated deployment probe also verifies synthetic description/pressure values and status after shutdown/restart. No live API, external message or supplier-specification verification is claimed.
