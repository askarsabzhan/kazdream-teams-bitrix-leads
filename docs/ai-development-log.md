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

## Entry 6 — durable Teams message ingestion

**Task:**

Persist bounded Microsoft Graph message batches, attachment metadata, and processing jobs idempotently without starting AI or attachment byte processing.

**Schema review:**

The Phase 2 tables and uniqueness constraints were retained. A new migration was required because the applied schema made Teams author mandatory and lacked the source modification/fingerprint fields, attachment representation metadata, and transaction boundary required by the verified Graph payload. The migration makes only the author nullable, adds revision/locator metadata, and exposes one service-role-only ingestion RPC.

**Implementation decision:**

Normalize only processing-relevant Graph fields while preserving `body_content` verbatim. Use a deterministic source fingerprint for replay/edit detection, preserve roots and replies separately, and route both latest and bounded catch-up reads through the same RPC. Attachment records are metadata-only and byte retrieval remains deferred.

**Development finding:**

The first pgTAP execution found an ambiguous PL/pgSQL identifier between the RPC output column and `attachments.teams_message_id`. Table aliases fixed the function before any remote migration was attempted. A clean local database reset, all 36 transactional database assertions, and database lint then passed.

The first remote write persisted all nine messages atomically, but its follow-up verification read failed with PostgreSQL code `42501`: Phase 2 explicit grants did not give `service_role` direct read-back access. A separate migration explicitly granted that role `SELECT` on `teams_messages`, `attachments`, and `processing_jobs`; `anon` and `authenticated` permissions remained unchanged.

Live comparison also showed that `getAllMessages` returned one additional reference attachment and a different body projection for one equal-timestamp message. The first reconciliation attempt exposed a revision ping-pong between latest and catch-up reads. The final rule accepts source-body changes only with a strictly newer Graph `lastModifiedDateTime`, while attachment metadata is a monotonic union by stable attachment ID.

Final remote verification persisted nine message rows (eight roots and one reply), five unique attachment metadata rows, and eleven unique revision jobs accumulated during controlled development verification. Two consecutive final latest ingestions and the final catch-up ingestion each reported nine unchanged messages, zero inserted attachments, and zero enqueued jobs. All duplicate counters were zero, reply relationships were valid, and every current message revision had its job.

A focused pre-commit audit of the actual remote ACL found that `service_role` also retained unnecessary direct table privileges from the database defaults. One new forward-only migration revoked all direct privileges on the three ingestion tables and re-granted only `SELECT`; the four already-applied migrations were not changed. The remote schema now exposes only the guarded wrapper RPC to `service_role`, keeps the core RPC closed, and gives neither `anon` nor `authenticated` RPC execution. Fifty-nine PostgreSQL assertions cover these privilege boundaries in addition to the ingestion invariants. Remote technical counts confirmed nine current-revision jobs, two superseded-revision jobs, and zero duplicate jobs.

## Entry 7 — secure attachment byte acquisition

**Task:**

Acquire the five durable Teams attachment representations into private Supabase Storage with bounded downloads, content validation, deterministic hashes and paths, and restart-safe idempotency, without starting AI, OCR, transcription, Bitrix, or later-phase processing.

**Schema and implementation findings:**

The existing attachment table already had semantically correct state, storage path, MIME, size, and SHA-256 columns. One forward migration added only attempts, leases, safe error codes, and acquisition timestamps plus three service-role-only transition RPCs. A cross-phase audit found that the Phase 3B metadata upsert could otherwise overwrite validated MIME/size after acquisition and then repeatedly enqueue false revisions. The migration therefore preserves acquisition-owned fields for `fetched` rows and updates the private ingestion core comparison; a pgTAP replay regression proves that no new job is created.

The first controlled live command claimed all five rows, stored the hosted PNG, and safely classified four reference attempts as failures. Safe stage diagnostics showed that three direct Graph message-item requests returned HTTP 200 with an empty body, even though a bounded channel collection contained the same three message and attachment identities. The reference resolver was corrected to use a bounded paginated identity fallback on empty/404 item projections, while still ignoring persisted historical `content_url` values. No sensitive URL or content was logged.

The corrective retry claimed three retryable references: two were validated and stored, and one was classified as unsupported. The remaining historical reference was not manually changed because its attachment ID is absent from the current Graph message projection. The next identical acquisition command claimed zero rows and created zero objects.

**Live verification:**

The private bucket contains exactly three objects for three `fetched` rows. All paths match the internal UUID/SHA-only pattern, and private downloads verified 3/3 byte sizes and 3/3 hashes. A fresh Graph read independently matched all three stored rows by size, detected MIME, and SHA-256. The stored hashes are all distinct, so the five source metadata rows produced zero identical-content groups among stored supported representations. Final terminal counts are three fetched, one unsupported, and one permanent failure.

## Entry 8 — Phase 3C pre-commit security and state-machine audit

**Audit finding:**

Catalog inspection confirmed that the three acquisition worker functions are `SECURITY DEFINER`, owned by `postgres`, use an empty `search_path`, and are executable only by `service_role` plus the owner. The trigger helper and ingestion core remain unavailable to `service_role`. On `attachments`, `service_role` and `authenticated` have only direct `SELECT`; neither has `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, or `MAINTAIN`, and `anon` has none of these privileges. Lease IDs fence both success and failure transitions, and new regression tests prove that an old worker cannot act after a stale lease is reclaimed.

The audit found one actual state-machine defect: `retryable_failed` had no durable attempt ceiling even though `fetch_attempts` already existed. Because the original Phase 3C migration was already remote-applied, it was not edited. One forward-only correction migration limits acquisition to five attempts. The fifth retryable failure becomes `permanent_failed / RETRY_LIMIT_EXCEEDED`; if a worker crashes on attempt five, the next claim call terminalizes the expired lease instead of leaving it stuck or reclaiming it indefinitely. The repository accepts this intentional server-side terminal transition.

The live audit performed no acquisition claim. It reconfirmed five rows with final counts three fetched, one unsupported, and one `GRAPH_ATTACHMENT_NOT_FOUND`; three private objects; zero duplicate attachment identities; zero duplicate paths; and 3/3 object size, MIME, and SHA matches. The historical source message still exists, but its current Graph projection exposes no attachment matching the durable external identity, so the terminal evidence row remains accurate and independent of the three stored artifacts.

The local installed metadata, rather than remembered documentation, showed `file-type@22.0.2` requires Node.js `>=22`. `package.json` and the README now state that minimum without requiring Node 24. The future processing contract was also made explicit: active acquisition states cause the existing bounded processing job to requeue, while unsupported/permanent evidence remains visible but does not poison an otherwise usable message.

## Entry 9 — AI-derived attachment evidence

**Task:**

Produce only derived evidence for the three fetched synthetic attachments: exact speech transcription for audio and visible-text extraction for images. Do not start lead extraction, grouping, deduplication, Bitrix, Teams feedback, or deployment.

**Schema and implementation:**

The initial attachment schema already contained the correct transcript, OCR, processing state, provider/model, and completion fields. One migration added only the missing durable identity, revision, lease/fencing, bounded-attempt, safe-error, image-type, and usage/latency metadata plus three service-role-only RPCs. The worker verifies the private Storage object by size, magic-byte MIME, and SHA-256 before calling narrow transcription or image providers. The official `openai@7.7.0` SDK handles multipart transcription and Responses Structured Outputs; SDK retries are disabled in favor of the five-attempt database state machine.

The first pgTAP run found a real SQL three-valued-logic defect: a new row's empty processing identity compared as `NULL`, so it was not eligible for its first claim. The identity comparison was changed to explicit `false` before any remote migration. A clean local reset then applied all migrations, all 186 database assertions passed, and local and linked-remote database lint reported no schema errors.

**Live compatibility finding:**

The configured `gpt-4o-mini-transcribe` call succeeded. Both initial `gpt-5-mini` vision calls returned the safe provider result `404 / model_not_found` for the supplied OpenAI project; no source content or provider message was logged. Official OpenAI documentation confirms `gpt-4o-mini` supports image inputs, Responses, and Structured Outputs, so the configured vision model was explicitly corrected to `gpt-4o-mini`. The model change created evidence revision 2 for the two images and reset their per-identity attempts to one.

Initial bounded run safe metrics were one audio seen/transcribed, two images seen, zero OCR completions, two failures, and three provider requests. The corrective run processed only the two outdated image identities: two images seen, two OCR completions, zero failures, and two provider requests. Its aggregate vision latency was 9,045 ms with 74,014 input, 93 output, and 74,107 total tokens. The successful transcription row recorded 4,033 ms with 191 input, 49 output, and 240 total tokens. The exact repeated command then saw no candidates and made zero provider requests.

Protected checks returned only `TRANSCRIPT_FIXTURE_CHECK = PASS` and `IMAGE_FIXTURE_CHECK = PASS`. No derived text or fixture contact data was printed or added to documentation.
