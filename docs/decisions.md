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

## Phase 3B durable Teams message ingestion

Raw Microsoft Teams messages are persisted before any AI or lead interpretation. `body_content` keeps the manager's source body verbatim; the durable row stores only processing-relevant Graph fields rather than the complete Graph response. `message.from.user.id` is stored when present and remains null when Graph omits the author.

The existing `(source, tenant_id, team_id, channel_id, external_message_id)` uniqueness constraint is the replay boundary. Roots and replies are separate `teams_messages` rows, and replies retain the explicit Graph root external message ID without timing heuristics.

A deterministic SHA-256 source fingerprint distinguishes an unchanged replay from changed source content. Source fields revise only when Graph provides a strictly newer `lastModifiedDateTime`, preventing equal-timestamp endpoint projection differences from causing revision ping-pong. A real newer edit increments `content_revision` and creates the corresponding revision job; an older observation cannot overwrite a newer stored revision.

Phase 3B stores attachment metadata only. Hosted-content IDs and reference attachment IDs plus non-temporary retrieval locator metadata are durable; no attachment bytes, signed download URLs, transcript, or OCR data are fetched or persisted. Attachment metadata is reconciled as a monotonic ID-based union because Graph endpoints may return different partial attachment projections for the same message timestamp.

One service-role-only PostgreSQL RPC atomically persists a message revision, synchronizes its attachment metadata, and inserts the unique `process_teams_message` job. `anon` and `authenticated` cannot execute the RPC, and user-facing RLS is unchanged. Latest ingestion and bounded date-range catch-up use the same normalization and transactional persistence path. No polling scheduler or job processor is implemented in this phase.

The first four Phase 3B migrations are forward-only records of live integration discoveries and are immutable after remote application: the initial ingestion boundary, verification read access, attachment-projection stabilization, and the strictly-newer source-revision guard. A later focused privilege audit found pre-existing unnecessary direct `service_role` table privileges alongside the requested read access, so a fifth forward-only migration revokes them and re-grants only `SELECT`; no applied migration was rewritten or squashed.

Every current message revision has exactly one processing job. Jobs for superseded revisions remain as durable history, while the database uniqueness constraint prevents two jobs for the same job type, aggregate, and revision. The live change from four to five attachment rows was an additional stable reference attachment returned by the catch-up Graph projection; the attachment uniqueness boundary confirmed it was enrichment rather than a duplicate.

## Phase 3C secure attachment byte acquisition

Attachment bytes are acquired only after Teams message and attachment metadata are durable. The existing `fetch_state`, `storage_path`, `mime_type`, `size_bytes`, and `sha256` columns remain the canonical acquisition fields; the Phase 3C migration adds only lease, attempt, safe error-code, and acquisition timestamp metadata. In this schema, `fetched` means that validated bytes are stored in the private bucket and the database success transition is complete.

Workers claim rows through service-role-only `SECURITY DEFINER` RPCs using `FOR UPDATE SKIP LOCKED` and a bounded lease. The explicit states are `pending`, `downloading`, `fetched`, `unsupported`, `retryable_failed`, and `permanent_failed`. Retryable failures and expired `downloading` leases can be reclaimed while `fetch_attempts < 5`; a fifth retryable failure, or an expired lease after the fifth attempt, becomes terminal `permanent_failed` with safe code `RETRY_LIMIT_EXCEEDED`. `fetched`, `unsupported`, and `permanent_failed` are terminal and are not claimable. Direct `service_role` table updates remain prohibited.

Hosted images are downloaded through the persisted hosted-content ID. Reference attachments never use the persisted historical `content_url` for byte acquisition: the worker re-fetches the source Teams attachment by tenant/team/channel/message/attachment identity, resolves a fresh DriveItem reference in memory, and discards the temporary URL. The live tenant returned an empty successful body for three direct message-item reads even though the messages remained in the channel collection, so reference resolution includes a bounded, paginated identity fallback over that collection.

Graph downloads enforce `Content-Length` before body consumption when available and a streaming byte counter in every case. Images are limited to 10 MiB and audio to 25 MiB. Magic-byte detection is authoritative for the supported PNG/JPEG/WebP and MPEG/MP4/M4A/WAV/WebM media set; a material declared/detected MIME conflict is a terminal failure. SVG and other unsupported formats are terminal `unsupported` outcomes rather than endlessly retried failures.

SHA-256 is calculated over the exact downloaded bytes and stored as lowercase hexadecimal without replacing the durable Graph attachment identity. Object paths use only internal UUIDs and the hash: `teams/{teams_message_uuid}/{attachment_uuid}/{sha256}`. Original filenames, source URLs, tokens, and user data are excluded. The `teams-attachments` bucket remains private, uploads use `upsert: false`, and an existing deterministic object is accepted only after size and downloaded-byte hash verification.

PostgreSQL and Storage are deliberately treated as a recoverable, non-transactional boundary: claim, download, validate, hash, upload, then finalize the database row. A crash after upload leaves the deterministic private object in place; retry verifies and reuses it before finalization. A future evidence-loading worker must also verify that a `fetched` object's private path still exists and matches its recorded size/hash; a missing or corrupt object is detected as unavailable evidence and surfaced for reconciliation rather than silently trusted. No reconciliation scheduler is implemented in Phase 3C. Phase 3B reconciliation ignores acquisition-owned MIME and size after `fetched`, preventing a later Graph projection from corrupting validated metadata or creating a false content revision.

An unavailable or unsupported attachment does not invalidate its entire Teams message. Future processing uses all available evidence: source text and every `fetched` attachment remain usable, while `unsupported` and `permanent_failed` rows remain visible as missing evidence and do not block forever. The selected Phase 4 orchestration contract is for the existing `process_teams_message` worker to inspect attachment states before processing: it requeues the existing bounded job while any current attachment is `pending`, `downloading`, or `retryable_failed`; once no acquisition-active state remains, it processes available text/fetched evidence and records terminal missing evidence. Attachment completion does not create a new AI job or message revision in Phase 3C.

The installed `file-type@22.0.2` package requires Node.js `>=22`. The repository and future Railway runtime therefore use the minimum compatible engine constraint `node >=22`; Node 24 is not required.

The five live metadata rows resolved to three stored objects, one unsupported reference, and one historical reference whose attachment ID is no longer present in the current Graph message projection. All three stored objects matched fresh Graph bytes by size, MIME, and SHA-256. Distinct stored attachment IDs produced no identical-content hash group; source rows were not collapsed or deleted.

## Phase 4A derived attachment evidence

Fetched attachment bytes remain immutable source artifacts. Transcript and image visible text are AI-derived evidence stored only in the existing protected `attachments.transcript_text` and `attachments.ocr_text` columns; Teams body, Graph identity, private Storage path, validated MIME/size, and source SHA-256 are never replaced by AI output. Phase 4A stops at this evidence boundary and does not extract, classify, group, deduplicate, or deliver leads.

The existing processing state, transcript/OCR, provider/model, and `processed_at` fields were reused. One forward-only migration adds the missing operation, processed-source SHA, prompt/schema version, evidence revision, attempt/lease fencing, safe error code, image document type, and provider usage/latency fields. A changed source SHA, operation, provider/model, or prompt/schema version creates an explicit new evidence revision, resets its attempts, and clears the stale derived result before processing. Retries of the same identity retain the revision. A successful or terminal result for an unchanged identity is not claimed again.

Retaining only the active AI-derived text is an intentional MVP/test-task tradeoff. The immutable original artifact is preserved, and the current evidence remains unambiguously reproducible from its source bytes and SHA-256 plus the stored operation, provider, model, and prompt/schema identity. Previous successful AI text revisions are not retained. If production audit requirements need every historical AI output, the extension is a separate versioned evidence table rather than parallel text fields on the attachment row.

AI claims use service-role-only `SECURITY DEFINER` RPCs with an empty `search_path`, `SKIP LOCKED`, a bounded lease, stale-worker fencing, and at most five durable attempts. SDK-internal retries are disabled so one durable attempt maps to one provider request. Timeouts, connection failures, 429, and transient 5xx responses are retryable; invalid source requests and authorization/model availability failures are permanent. Only safe codes are persisted.

Before any provider call, the worker reads the private `teams-attachments` object and verifies object existence, database byte size, magic-byte MIME, exact byte count, and SHA-256. The bucket remains private, no public or signed URL is generated, and image bytes are sent as an in-memory data URL that is never logged or persisted.

The transcription implementation uses the official OpenAI Node SDK and `gpt-4o-mini-transcribe`. Its returned `text` is persisted exactly as returned, without trim, rewriting, correction, translation, or normalization. The image implementation uses the Responses API with strict Structured Outputs limited to `document_type` (`business_card`, `other`, or `unknown`) and `visible_text`. Its versioned prompt allows only visible text, preserves suspicious contact spelling, and prohibits correction, inference, translation, and summarization.

`gpt-5-mini` was the intended vision default, but the supplied OpenAI project returned the safe API result `404 / model_not_found` during bounded live verification. The smallest compatible correction is `gpt-4o-mini`: official OpenAI documentation confirms image input, Responses API, and Structured Outputs support, and the same project completed both fixtures with it. The configured/default Phase 4A vision model is therefore `gpt-4o-mini`; this change is explicit in environment configuration and is not a silent fallback.

Operational output contains only aggregate counts, provider/model, duration, and usage values. Transcript text, visible text, names, phone numbers, email addresses, request payloads, base64 input, authorization headers, and full provider responses are excluded from console output and operational metadata.

## Phase 4B deterministic conversation grouping

`lead_groups` is retained as the pre-lead conversation-group table because it already supports nullable `lead_id`, manager ownership, status, and root/reply membership through `lead_group_messages`. In Phase 4B a conversation group is one manager-side encounter candidate, not a canonical lead or CRM entity. Lead extraction, cross-manager visitor deduplication, CRM ownership, and Bitrix delivery remain later-phase concerns.

Grouping algorithm `v1` constructs a source document from the original Teams body and only successfully processed transcript/OCR evidence. Unsupported, permanently failed, or unfinished attachment content is never invented or included. An explicit Teams reply relationship is resolved first and keeps the reply in its root group, including an authorized reply by a different manager. For independent roots, exact normalized email and phone are strong deterministic matches. Normalization is comparison-only: email casing and phone formatting are normalized, while suspicious domains, missing country codes, and the original evidence are not corrected.

Conservatively labeled person-name and company hints are secondary signals. Author identity and time are weak context only; time is never sufficient to merge messages and never permanently closes a group. Generic exhibition, product, industry, client, or partner wording does not establish identity. Independent encounters from different managers remain separate groups even when contact identity matches, leaving future canonical deduplication to reconcile them.

When evidence is insufficient, the message remains explicitly `ambiguous`; this is reassessable state, not a permanent terminal classification. Unfinished acquisition or AI evidence, including a lease-bound download/processing attempt, produces bounded `deferred` processing. Once active evidence becomes successful or terminally unavailable, the message is reconsidered; unsupported or permanently failed evidence cannot leave it deferred forever. A false merge is considered more damaging than a temporary false split.

The persisted reassessment identity is the pair `(grouping_algorithm_version, grouping_source_fingerprint)`. The fingerprint covers message/campaign/source scope, source revision, original body hash, author, reply/root relationship, bot/service flags, active-evidence state, and the content hash of successful transcript/OCR evidence. Provider/model/usage metadata and the broader Graph ingestion fingerprint are excluded because they do not change grouping input. Thus new source or derived evidence can reopen an ambiguous/grouped decision, while reprocessing identical evidence with different provider metadata is a no-op.

A later strong identity match may attach to an existing group regardless of elapsed time and increments the group revision once. Reassignment removes an empty pre-lead source group and increments the surviving changed group once. Changing the algorithm version with identical membership intentionally increments once because the persisted decision provenance changed; an exact replay does not. Completed `process_teams_message` jobs are revision-specific history: ingestion creates one unique job for each newer source revision, while the bounded grouping scan also reassesses changed evidence fingerprints independently of an older job's succeeded status. Group-level `process_lead_group` jobs remain deferred to Phase 4C because Phase 4B performs no lead extraction.

Persistence currently uses one transaction-scoped advisory lock with the fixed `phase4b-conversation-grouping` key, so grouping writes are globally serialized. This is acceptable for the bounded single-channel test workload and makes the idempotency proof simple, but limits horizontal throughput. A future production extension may scope locks by tenant/team/channel after defining cross-channel grouping boundaries; Phase 4B does not add distributed locking prematurely.
