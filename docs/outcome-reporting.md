# Outcome reporting

## Contract and design

Pipeline has a **Record outcome** action. A native dialog captures the account, milestone, occurrence time, required notes, an optional reference URL, and an optional immutable outbound-message link. A separate choice distinguishes actual user-reported outcomes from demo observations. The form requires confirmation and retains one request ID for safe retries.

The server owns the actor, provenance, activity mode, audit ID, message eligibility, and business scope. A message from another account or business cannot be linked. A local dry run can only be linked to a demo observation; a provider-accepted record can only be linked to an actual user-reported outcome. Acceptance does not establish delivery or a verified reply. Unlinked reports remain valid sales history without A/B attribution.

A new report advances the versions of this account’s editable unsent messages, clears their approvals, and records the context change. HITL displays the reported outcomes beside the draft. Old version acknowledgements cannot restore an approval. Already sent/uncertain messages and other accounts remain unchanged; replaying a saved report does not invalidate a subsequent fresh review.

Backdated entries may be added as history. Updating the current stage also requires that the reported event is no older than the latest recorded stage event. Reports cannot create future events. Existing quick stage edits remain separate user-reported entries with no message attribution.

The graph projection retains an account-linked outcome Signal. A `Person → replied_to → Signal` edge is projected only for a reported reply that names both an eligible outbound record and a matching published person from that account. Unknown respondents do not generate invented people. Demo edges and signals carry demo provenance; manual attribution is never represented as provider verification.

SQLite persists the report before the derived graph refresh. A graph failure returns a saved report with pending projection, rather than losing the report or replaying the outcome. Retrying the same payload/request ID or querying the graph can repair the projection. Reports, notes, and source references are not sent to external providers. No credit is charged for recording history.

This provides an explicit human feedback loop. Provider webhook ingestion and independently verified responses remain unconnected.


## Validation

Nine dedicated tests cover acknowledgement, timestamp ordering, stale revisions, cross-account and cross-business references, actual/demo mode matching, respondent identity, retry deduplication, approval/version invalidation, database restart, HTTP schema/session/CSRF controls, and native Kuzu reply edges. A projection failure fixture proves that saving and replay recovery do not create duplicate outcomes or charges. These run with the full 42-test suite.

Browser checks use an isolated SQLite backup. They cover required confirmation, message choices, date editing, inline backdate errors, history-only saves, retained stages, demo analytics attribution, zero live-provider activity, graph inspection, and business isolation. No outcome is entered into the user’s main campaign during validation. Reference URLs are not fetched, and outcome notes are not transmitted to an external model.
