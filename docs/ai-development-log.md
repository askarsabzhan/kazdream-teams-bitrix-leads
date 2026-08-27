# AI-assisted development log

## Entry 1 — architecture design

**Task:**  
Architecture design for Teams → Bitrix lead ingestion.

**AI proposal:**  
Production-oriented design with extensive normalized evidence/outbox tables and ORIGIN_* remote idempotency.

**Manual review findings:**

- design was too broad for two-day implementation;
- different phone/email cannot be unconditional grouping hard negatives;
- final lead detection must happen after grouping;
- provided `UF_CRM_TEAMS_GROUP_ID` should be checked before inventing another remote key;
- scheduled flow must remain recovery, while normal CRM delivery targets approximately one minute.

**Decision:**  
Keep architecture principles, reduce MVP implementation scope and validate assumptions incrementally.

## Entry 2 — MVP database foundation

**Task:**

Design MVP Supabase/PostgreSQL schema.

**AI proposal from previous architecture:**

Large normalized production schema with separate `ai_runs`, assertions, selections, `identity_keys`, CRM operation steps and entities.

**Manual decision:**

Reduce physical schema for the two-day task while retaining required guarantees: idempotent messages, evidence, durable jobs, canonical leads, CRM outbox and notification outbox.

**Validation result:**

The migration applied without SQL errors on its first local database execution; a clean database reset and database lint also passed. Manual review found that the notification outbox lacked its own durable idempotency boundary, so Phase 2 added a required unique `dedupe_key` without introducing key-generation or delivery logic.

## Entry 3 — architecture refinement after business clarification

**Task:**

Refine architecture after business clarification.

**Previous implementation assumption:**

The adapted written specification required Power Automate, and duplicate ownership was provisionally first-touch.

**Business clarification:**

The task owner confirmed that direct Microsoft API integration should be used, Power Automate is not required, a lead requires a reliable full name and phone, duplicate contacts enrich the canonical lead, and the latest contributing manager becomes responsible.

**Decision:**

Update the existing initial schema and architecture before the Phase 2 commit because the migration has not been applied remotely.

This was not an AI failure. It was an authoritative business clarification overriding an outdated part of the adapted specification.

## Entry 4 — Microsoft Graph capability diagnostics

**Task:**

Build a server-only, read-only Microsoft Graph diagnostic and verify the supplied application against the test tenant without starting ingestion or writing remote data.

**Implementation:**

Added client-credentials authentication with an expiry-aware memory-only token cache, a native-fetch Graph client with timeouts and sanitized errors, bounded pagination, metadata-only message inspection, attachment classification, and the `graph:diagnose` command. Unit tests cover token parsing, Graph error sanitization, diagnostic secret redaction, and pagination without calling Microsoft Graph.

**Live findings:**

- authentication, team discovery, private-channel discovery, root-message read, reply read, history catch-up, and bounded user-directory read passed;
- two root messages were available and the tested thread contained no replies;
- neither sampled message included a `from` identity, so author AAD resolution failed for the available sample;
- no file/reference attachment or hosted content was present, leaving those read capabilities untested;
- the history endpoint accepted a bounded date range and returned a next link;
- normal app-only channel feedback is not supported by the documented permission model and no write was attempted.

The initial live query shape exposed two sanitized `400 BadRequest` responses: channel listing does not accept `$top`, and the history endpoint requires a `gt`/`lt` date range rather than `ge`. The command was corrected to the documented endpoint-specific query forms; the corrected run returned no permission errors. These were diagnostic implementation corrections, not Microsoft platform or AI failures.

These findings describe the initial sample only. The final verification in Entry 5 supersedes the initial capability gaps while preserving the failed-attempt history.

## Entry 5 — synthetic Graph fixture recheck

**Task:**

Re-run the read-only Graph diagnostic once after synthetic normal-user, reply, image/file, and audio/voice fixtures were added to the private channel.

**Observed result:**

After Graph propagation, the target channel returned eight root records plus one synthetic reply. Seven of the nine inspected records exposed AAD author identity. The reply included author identity and could be associated with its root thread.

The inline image was returned as message-body hosted content and read as `image/png` through `chatMessageHostedContent`. The audio was returned as a reference attachment backed by a SharePoint/OneDrive DriveItem and read as `audio/mpeg`. Bytes were counted and discarded without persistence. These are observed test-tenant representations rather than universal attachment assumptions. The bounded history query matched all seven newly created target-channel verification records.

**Decision:**

Treat author AAD resolution, reply verification, image read, audio read, hosted-content read, and 7/7 new-message catch-up visibility as confirmed capabilities. Prefer `message.from.user.id` as the future stable manager-mapping identifier when present, but keep raw author nullable and never manufacture or administrator-fallback a missing identity. Catch-up is a verified recovery primitive, not an implemented polling strategy. Normal app-only feedback remains unresolved; `Teamwork.Migrate.All` is prohibited as a workaround, and the existing `teams_notifications` outbox remains the future transport boundary. Do not start ingestion.
