# Internal commercial planning

Module 1 → **Capabilities → Internal commercial plan** accepts three optional owner inputs: monetization model, pricing framework and target contract value. Leave unknowns blank. Include currency and the per-order/program basis when known. These fields describe internal planning; they do not establish Allco or Huasheng prices, validated unit economics, customer budget or approved quotes. Buyer-company revenue criteria remain a separate ICP field.

Guided intake recognizes explicit labels at the start of a line or after a semicolon:

```text
Monetization model: Custom manufacturing per order
Pricing framework: Quoted per drawing after qualification
Target contract value: USD 25,000–50,000 per order
```

Those are synthetic examples, not supplier pricing. Local extraction preserves the supplied currency, range and units. It does not infer economics from the website or industry. Conflicting duplicate labels and values over 600 characters produce questions instead of silently selecting or truncating a value.

Suggestions remain unapplied until each is accepted, adjusted or dismissed and the owner confirms review. The optional project model uses the same gate and typed `commercial.*` fields. It must quote the supplied value literally; catalog-based economic guesses and rewritten amounts are rejected. Model mode requires external-processing acknowledgement and sends the owner’s intake context to the designated project model. Main project model processing remains disabled and live verification is outstanding.

Accepted values retain business-scoped review provenance in SQLite. Editing that exact value clears its provenance; unrelated ICP edits preserve it. Confidence labels describe coverage and review provenance, not calibrated economic probabilities. Full profile changes revoke research and unsent-message approvals. Existing profiles without the three optional keys retain their original object shape and approval hash; viewing the form never injects defaults.

Owner research-brief exports intentionally retain the planning inputs. Outreach model context removes both the fields and their duplicated confidence rows. Prospect-search plans, native graph context/facts and Band packets exclude these internal targets. The complete profile still participates in approval binding. These boundaries protect structured planning fields; free-form message text remains subject to human review.

Validation includes 12 dedicated tests covering literal extraction, review, stale and foreign proposals, strict HTTP schemas including all 15 fields, mocked real-SDK contracts/refunds, outward-payload exclusions, legacy hash compatibility and store reopen persistence. The isolated deployment probe also reviews and checks synthetic commercial inputs across process restart and native graph storage inspection. No live provider or customer-price validation is claimed.
