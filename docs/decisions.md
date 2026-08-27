# Architecture decisions

This document records decisions that have been confirmed for the test implementation. Details that still require tenant or business validation are not treated as final.

## Confirmed decisions

### Direct Microsoft Graph integration

Microsoft Teams ingestion, attachment access, user lookup, and Teams feedback will use Microsoft Graph directly. This replaces the adapted specification's Power Automate direction after authoritative clarification from the task owner. Microsoft credentials and Graph payload PII remain server-only and must never be logged.

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

Uncertain values stay empty. Partner requires explicit source evidence such as partner, integrator, system integrator, seller, distributor, dealer, or a clear equivalent. Customer is the mandatory fallback, including when the source says client/customer. Natural-language enum values must not be guessed into Bitrix IDs.

### Confirmed lead qualification

A CRM lead requires a reliable full name and at least one reliable phone. Email is optional, and company is extracted when available. Missing required values remain empty and prevent CRM creation rather than being invented.

### Confirmed duplicate and late-content handling

A duplicate contact enriches the existing canonical lead instead of creating another one. Previous evidence remains, new reliable contact/context data is appended, and the latest contributing manager becomes the Bitrix responsible manager. Reliable later information updates the existing canonical lead regardless of arrival time.

### Bitrix outbox is planned

Bitrix side effects will be issued only through the future Bitrix adapter and durable, idempotent outbox. The first remote key to validate is `UF_CRM_TEAMS_GROUP_ID`; `UF_CRM_TEAMS_MESSAGE_IDS` is planned for traceability. Their existence and types must be checked with `crm.lead.userfield.list` before implementation.

### CRM retry authorization

Both user and admin roles may request an idempotent retry of a failed CRM delivery. Integration settings, mappings, and campaign configuration remain admin-only.

## Confirmed campaign policies

- `duplicate_owner_policy = latest_contributor`;
- `lead_without_contacts_policy = require_name_and_phone`;
- `late_update_policy = update_crm`.

The selected MVP test configuration is Hannover Messe 2026, using confirmed Bitrix exhibition value `63` and source `EXHIBITION`. This does not assert that it is already configured in remote Bitrix.

External AI APIs, including OpenAI, are permitted for speech-to-text, vision/OCR, structured extraction, and Russian analytical summaries. Provider abstraction remains, and `OPENAI_API_KEY` is server-only.

The supplied Bitrix webhook is intended for the test but remains an environment-only server secret in `BITRIX_WEBHOOK_BASE_URL`. Microsoft/AAD-to-Bitrix manager mapping must use an exact safe match or explicit mapping; it must never fall back to the Bitrix administrator.

## Phase 2 database foundation

- The MVP uses a reduced 14-table physical schema instead of the original production-oriented 20-table design.
- The unique Teams source identity is the first database ingestion idempotency boundary.
- Multiple conversation groups may reference one canonical lead after deduplication.
- Durable PostgreSQL jobs and outboxes are used instead of Redis.
- Row Level Security is enabled on every public application table.
- The `teams-attachments` Storage bucket is private and has no public object policy.
- Bitrix enum IDs are stored only when confirmed; unknown IDs are never guessed.
- Europe is the only seeded region. Region IDs `51`, `53`, `55`, `57`, `59`, and `61` remain intentionally absent until confirmed.

## Phase 3A Microsoft Graph diagnostics

The supplied client-credentials application successfully authenticated to Microsoft Graph. The live read-only diagnostic found the exact `Kazdream Test WorkSpace` team and the exact private `Test for Askar` channel.

Actual tenant capabilities:

- listing teams and channels succeeds;
- reading the private channel succeeds: eight root messages were returned and pagination completed;
- reading replies succeeds: the verification thread returned one reply, with author identity present and an unambiguous root association;
- the inspected messages expose `id`, `createdDateTime`, `lastModifiedDateTime`, `replyToId`, `messageType`, and `attachments` fields;
- seven of nine inspected root/reply records expose an AAD author identity; `message.from.user.id` is the preferred stable AAD user object ID for Teams-to-Bitrix manager mapping when present;
- in the test tenant, an inline/pasted image is represented as message-body hosted content and is readable as bytes through the `chatMessageHostedContent` endpoint (`image/png`, 2,557,523 bytes);
- in the test tenant, an audio/file attachment is represented as `chatMessageAttachment(reference)`, resolves to a SharePoint/OneDrive DriveItem, and is readable as bytes (`audio/mpeg`, 612,864 bytes);
- `getAllMessages` succeeds with a bounded date-range query, returns a next link, and recovered all seven of seven newly created target-channel verification records;
- a bounded user-directory read succeeds;
- the final verification run returned no Graph permission errors.

Future raw-message ingestion must treat author identity as nullable because `from` may legitimately be absent for system, service, or special messages. It must neither manufacture an author ID nor map a missing author to the Bitrix administrator. Future attachment ingestion must support both observed representations without assuming that every tenant or file type uses the same representation.

The successful bounded catch-up establishes a recovery path after downtime; it does not mean that polling or ingestion scheduling has been implemented.

Normal Teams channel send is not supported for this client-credentials integration. Microsoft documents `ChannelMessage.Send` as delegated; the application permission `Teamwork.Migrate.All` is migration-only and must not be used as a normal feedback workaround. A delegated user flow, Teams bot, or another task-owner-approved mechanism remains an unresolved future decision. The durable `teams_notifications` outbox remains the transport-independent boundary; Phase 3A implements no feedback delivery.
