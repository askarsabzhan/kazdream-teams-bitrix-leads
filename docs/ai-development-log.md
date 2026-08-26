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
