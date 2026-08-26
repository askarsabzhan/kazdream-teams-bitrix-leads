# Architecture decisions

This document records decisions that have been confirmed for the test implementation. Details that still require tenant or business validation are not treated as final.

## Confirmed decisions

### Power Automate is mandatory

Power Automate will be a thin Teams and SharePoint transport adapter. It will not be replaced by a custom Microsoft Graph webhook listener, and business processing will remain in the application.

### Modular monolith

The application will remain one TypeScript codebase with explicit domain modules. A web/API process and a worker may use different entry points without becoming separate services or repositories.

### PostgreSQL durable state

Processing and retry state must survive restarts and repeated delivery. The minimal physical model will be introduced incrementally rather than implementing a production-sized schema up front.

### Grouping and deduplication are different

Grouping determines which message fragments belong to one conversation. Deduplication determines whether independently grouped conversations describe the same visitor.

Before grouping, only deterministic obvious noise may be filtered. Final lead/non-lead classification happens after grouping. Different email addresses or phone numbers are not unconditional grouping hard negatives.

### Evidence-first extraction

Extracted values must retain source evidence. AI output is untrusted and cannot directly become CRM data.

### Conservative field validation

Uncertain values stay empty. Partner requires explicit evidence; Customer is the fallback. Natural-language enum values must not be guessed into Bitrix IDs.

### Bitrix outbox is planned

Bitrix side effects will be issued only through the future Bitrix adapter and durable, idempotent outbox. The first remote key to validate is `UF_CRM_TEAMS_GROUP_ID`; `UF_CRM_TEAMS_MESSAGE_IDS` is planned for traceability. Their existence and types must be checked with `crm.lead.userfield.list` before implementation.

### Scheduled reconciliation is planned

A scheduled Power Automate flow will recover missed messages and unavailable attachments. It is not the normal waiting path: healthy event processing targets Teams message to CRM lead latency of approximately 60 seconds or less.

### CRM retry authorization

Both user and admin roles may request an idempotent retry of a failed CRM delivery. Integration settings, mappings, and campaign configuration remain admin-only.

## Provisional business policies

- `duplicate_owner_policy = first_touch` until the business owner answers the duplicate ownership question.

Provisional policies must remain configurable and must not be embedded deeply in domain logic.
