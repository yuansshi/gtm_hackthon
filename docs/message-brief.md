# Persona, tone, length and call to action

Module 4’s composer saves a message brief with each new desktop draft: audience (engineering/sourcing team, engineering, procurement, operations or leadership), tone (consultative, direct or technical), maximum body words (80/120/180/240) and one selected call to action. These choices guide copy rather than establish the recipient’s identity, role, authority or consent. Current contact/source evidence and exact human review remain mandatory.

## Desktop flow

1. Open **HITL review → Prepare a new draft**. Choose the account, channel, variant and sequence step, then set the message brief. Source templates stay free; configured model generation retains its existing processing acknowledgement and two-credit cost.
2. Prepare the draft. Role-specific greetings and review focus, tone variants, cited company application/supplier context, technical qualification and the exact selected CTA are visible in the copy. Follow-up templates describe additional qualification context without claiming prior contact. Accepted public-event categories, dates and citations can inform the template; complete original reviewed quotes remain in evidence inspection.
3. Check **Saved message brief** above the recipient. Its counter excludes source URLs and bracketed citation numbers. The separately appended live-email postal/unsubscribe footer is also excluded; this is a portal body budget, not a platform character-limit claim.
4. Edit copy, or expand **Edit message brief** to change saved choices. Both create unsaved edits. Save to advance the message version and revoke prior approval. Changing the brief does not silently rewrite the body; update its CTA/copy or explicitly prepare a fresh template with the desired brief.
5. Approval is blocked if the body exceeds its limit, the subject exceeds 120 characters or the selected CTA is missing/repeated. That CTA must appear exactly once, unchanged. The review panel shows the specific problem. Audience suitability, tone, claims and source semantics still require a person’s review.

## Enforcement and compatibility

The shared typed option set is used by the UI and server HTTP schema. Strict inputs reject unknown values and extra fields. Direct service calls also validate the complete brief. Source templates retain application/source/qualification context rather than silently truncate it to fit; an impossible brief returns an error without replacing an existing draft or spending credits. Choose a larger limit or revise the copy.

Model requests receive the bounded canonical brief alongside the existing approved supplier and public account context. System instructions request audience focus/tone, exact CTA and word/subject limits. Returned output is checked in the service before a draft is persisted. Noncompliant output creates no draft and refunds local credits once; reported provider usage remains recorded, and a local refund does not imply a provider refund. Request fingerprints include the brief, so a completed request ID cannot generate a different audience, tone, limit or CTA.

Every brief field is part of the exact-message approval hash for dry run and live email. Send paths recheck objective constraints. Brief changes never restore approval, bypass account/contact restrictions, select a recipient, authorize spending or transmit a message. Dispatched and unknown-delivery records remain immutable. Live attempt history retains the original reviewed brief even after campaign reset. A prepared unsent source template is reused only when brief/source context match; changing the brief regenerates that variant as a new version requiring review. A dispatched existing variant remains its original receipt.

Existing drafts retain their original copy, hash and approval behavior. They are labeled as having no saved brief; no new policy is retroactively asserted. New desktop drafts use an explicit default brief. Legacy API calls may omit the optional field, and omitted input preserves a current source template’s saved brief. No provider is enabled by this feature.

## Verification

All 275 tests and the production build pass. Thirteen focused brief tests cover all five audiences and three tones across both businesses, Email/LinkedIn, A/B and three sequence steps; exact CTAs, Unicode/URL word counting, subject/body limits, strict inputs, source/event retention, regeneration/revocation, legacy compatibility, hash binding, dry-run accounting, model failure/refund/usage and real SDK request/replay under intercepted HTTP, plus authenticated/scoped HTTP editing. The delivery webhook/reset test also verifies retention of the reviewed live brief.

Desktop QA uses an isolated labeled synthetic workspace with providers disabled. It checks sourcing/direct copy, brief edits clearing approval, CTA/length blocking, corrected-copy review, locked recorded briefs and business isolation. No live model request or external outreach is made by these checks.
