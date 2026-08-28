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

## Entry 10 — deterministic evidence-first conversation grouping

**Task:**

Group Teams roots/replies and available transcript/OCR evidence into versioned pre-lead encounter groups without lead extraction, canonical deduplication, OpenAI, Teams writes, or Bitrix calls.

**Schema and implementation:**

The existing `lead_groups` and `lead_group_messages` tables were structurally suitable: `lead_id` was already nullable and the membership table can represent roots and replies. One forward-only migration added deterministic group keys, algorithm/revision metadata, grouping states and source fingerprints, a unique one-group-per-message boundary, a bounded evidence loader, and an advisory-locked service-role mutation RPC. No parallel conversation table or group-level extraction job was introduced.

The pure TypeScript `v1` engine uses explicit replies first, exact email/phone next, and conservatively labeled name/company pairs only as secondary evidence. Independent manager encounters remain separate. Unfinished attachment evidence defers processing; terminal unavailable evidence does not block the available source document. Replays are persisted as no-ops and no OpenAI provider is imported or called.

**Live verification finding:**

The first live persistence run correctly created two groups and five memberships from nine synthetic messages, leaving four messages ambiguous. Its distinct-contact protected check initially failed because the verifier required the remote fixture to contain three strong-identity roots inside an arbitrary 40-second window; that exact fixture shape was not present, although the required three-contacts-in-40-seconds algorithm case already passed in unit tests. The verifier was corrected to test the actual live invariant pairwise: same-manager independent roots with different explicit strong identities must not share a group. No database row was manually changed. The identical replay then reported nine unchanged messages, zero new groups, memberships, or revisions, and all three protected checks passed with zero OpenAI requests.

## Entry 11 — Phase 4B focused reassessment audit

**Audit findings:**

Remote catalog inspection confirmed that all three grouping functions are owned by `postgres`, are `SECURITY DEFINER`, use an empty `search_path`, and deny execution to PUBLIC, `anon`, and `authenticated`. Only the bounded loader and mutation RPC are executable by `service_role`; the fingerprint helper remains private. Direct table mutation is unavailable to `service_role`, `authenticated`, and `anon`.

The audit found three connected SQL defects in the already-applied Phase 4B migration. Lease-bound attachment `downloading` was omitted from active evidence, the grouping fingerprint included provider/model and other metadata that cannot change deterministic signals, and reassignment could retain an empty pre-lead source group. The applied migration was not edited. One forward-only correction makes active acquisition/processing states explicit, fingerprints only grouping-relevant source/evidence state and successful evidence content, and removes empty pre-lead groups inside the locked transaction before incrementing surviving group revisions.

New database regressions prove that newly processed evidence changes the fingerprint and can move a previously ambiguous message into a compatible group even though its old message job already succeeded. They also prove that provider metadata with unchanged evidence text is a no-op, a newer source revision has its own unique processing job, terminal unavailable evidence reopens a deferred decision, and reassignment removes the empty source group while incrementing the target once. The corrected migration was applied remotely, one controlled reassessment updated the two existing group fingerprints/revisions without changing memberships, and the identical replay was a zero-revision no-op. No source content or PII was printed, and no OpenAI request occurred.

## Entry 12 — evidence-grounded group candidate extraction

**Task:**

Convert complete Phase 4B conversation groups into current structured candidates and field-level provenance without canonical deduplication, canonical lead creation, Russian summaries, Bitrix, Teams writes, or deployment.

**Schema and implementation:**

The existing `field_evidence` table was reusable but required a nullable `lead_group_id` target because it previously required `lead_id`. One forward-only migration adds that minimal target plus extraction state/identity/revision fields and current candidate JSON on `lead_groups`. The existing `processing_jobs` uniqueness boundary is reused for `process_lead_group`; a trigger handles new group revisions and the migration backfills current groups.

The worker receives one ordered group-only evidence package from a fenced service-role RPC. The official OpenAI SDK uses `gpt-4o-mini`, a closed Structured Outputs object, a versioned extraction prompt, and no SDK retries. Application code revalidates every evidence ID and conservatively checks source support for names, companies, phones, and emails; it retains suspicious spelling and rejects unsupported enum values at field scope. Partner/Customer, campaign/source, and name-plus-phone eligibility are deterministic post-processing, not free model classifications.

**Development findings:**

The first new pgTAP run exposed a test sequencing issue: a set-returning claim RPC performs its lease transition before an outer SQL `WHERE` filters returned rows. The test was corrected to release every claimed group and to use one consistent identity during bounded-retry verification. This reinforced the worker rule that claims are batch operations and must never be treated as a target-by-ID precheck. A schema-lint warning about a record variable used only for `FOUND` was removed by using `PERFORM`. No remote migration or provider request had occurred at either point.

**Live verification:**

The single Phase 4C migration applied remotely after clean local reset and local/linked database lint. The final suite has 125 passing unit tests and 301 passing pgTAP assertions. The migration backfilled exactly two pending current-revision group jobs for the two existing groups, with no duplicate job identities.

The bounded first extraction saw and processed two groups with two OpenAI requests, zero failures, two candidate updates, 31 new field-evidence rows, and two completed jobs. Aggregate provider latency was 9,576 ms with 2,206 input, 552 output, and 2,758 total tokens. All five protected checks passed without printing candidate/source data. The exact repeated command saw zero groups, made zero OpenAI requests, and created zero candidate, evidence, or job changes while all checks remained PASS.

The final protected remote audit found two current extracted candidates at extraction revision one and attempt one, both eligible, with one deterministic Partner and one Customer fallback. Both candidates carry the configured Hannover Messe 2026 / 63 / EXHIBITION values. All 31 provenance rows are accepted, unique, source-linked or valid system defaults, and contain no copied evidence text. Both current group jobs are succeeded, no group references a canonical lead, and Phase 4C contains no canonical-lead creation path.

## Entry 13 — Phase 4C focused pre-commit audit

**Audit finding:**

Remote catalog inspection confirmed that the four worker-facing extraction RPCs are owned by `postgres`, are `SECURITY DEFINER`, have an empty `search_path`, and are executable by `service_role` but not PUBLIC, `anon`, or `authenticated`. The three internal helpers are closed to all application roles. `service_role` has read-only access to groups, group field evidence, and processing jobs and has no direct privilege on canonical `leads`; all application roles lack direct mutation privileges on the audited tables.

The audit found one real revision-state defect in the already-remote migration: claiming a changed extraction identity cleared the last successful candidate before the replacement succeeded. The applied migration was not edited. One forward-only correction adds `candidate_source_fingerprint` and a database guard that preserves the successful payload, eligibility, completion metadata, usage metrics, and successful revision through processing and failed retries; only fenced completion replaces them. New pgTAP regressions cover both prompt-identity failure and grouping-revision failure.

Deterministic validation was also tightened without provider calls. Negated Partner terms remain Customer, explicit Customer language carries source provenance, and simultaneous positive Customer/Partner evidence becomes an explicit conflict with the safe Customer fallback. Labeled company contradictions now follow the same null-plus-conflicted-evidence policy as names. Protected aggregate output now additionally verifies eligibility derivation, Customer-default provenance, and the exact campaign configuration/evidence rows.

The candidate payload remains the single Phase 4D source for Hannover Messe 2026 / Bitrix value 63 / EXHIBITION; no unrelated campaign row or `campaign_id` is attached in Phase 4C. The audit performed no OpenAI call and did not print source text or candidate PII.

## Entry 14 — deterministic canonical lead resolution and enrichment

**Task:**

Resolve only eligible current group candidates into restart-safe canonical leads, enrich them from every linked group, assign the latest real Teams contributor, and generate one evidence-grounded Russian analytical summary per canonical source identity. Bitrix, Teams writes, deployment, and fuzzy/AI deduplication remain outside Phase 4D.

**Schema and implementation:**

One forward-only migration reuses `leads`, `lead_groups.lead_id`, and group field evidence, and adds a unique `(kind, normalized_value)` identity-key boundary plus canonical payload/source and fenced summary state. Advisory-locked service-role RPCs perform deterministic resolution and recomposition. Exact normalized phone/email are strong keys; exact supported full name plus company is secondary. Conflicting strong keys persist a safe identity conflict without merging. Canonical list fields are stable unions, scalar disagreements remain null/conflicted, Customer default cannot override explicit Partner evidence, and only meaningful payload/owner/campaign changes advance canonical revision.

The summary adapter uses the official OpenAI Responses API with a closed Russian-summary schema, `gpt-4o-mini` by default, a versioned evidence-only prompt, and SDK retries disabled. Its durable identity includes canonical source/revision plus provider/model/prompt, and lease fencing prevents stale completion. Operational output and verification remain aggregate-only.

**Focused and live verification:**

Ten Phase 4D unit assertions and 25 targeted pgTAP assertions passed. They cover strong and secondary matching, no fuzzy merge, cross-manager duplicate resolution, late enrichment/revision, multiple contacts, ownership chronology, identity collision safety, concurrent identity boundaries, Partner precedence, exact replay, and summary idempotency. Local and linked database lint found no schema errors.

The bounded first remote run saw two existing distinct eligible groups, created two canonical leads, linked both groups, made exactly two summary requests, completed both, and reported zero conflicts or failures. Aggregate usage was 2,207 input, 147 output, and 2,354 total tokens. The exact replay created and updated zero leads, linked zero groups, made zero summary requests, and reported zero failures. A protected aggregate database query confirmed two linked groups, two canonical leads at revision one, zero duplicate identity sets, and two succeeded summaries; no source or candidate PII was printed.

## Entry 15 — durable Bitrix lead synchronization

**Task:**

Map successful canonical revisions to Bitrix through a durable outbox, exact manager mapping, remote creation idempotency, separate analytical/source storage, and local sync state without UI, Teams feedback, or deployment.

**Implementation:**

One forward-only migration reuses `crm_outbox`, `manager_mappings`, and canonical leads. It adds five-attempt lease fencing, an immutable primary source-group key, durable CRM/comment stages, blocked state, revision-aware enqueueing, and service-role-only transition RPCs. The server-only adapter uses native fetch with a 600 ms minimum interval and safe error classification. Exact AAD→Graph email/UPN→Bitrix email mapping has no fallback. Remote lookup by `UF_CRM_TEAMS_GROUP_ID` always precedes add, while existing/recovered leads use update. Summary remains in `COMMENTS`; revision-marked original source goes to a separate timeline comment.

Eleven focused unit tests and 20 focused pgTAP assertions pass. They cover payload/enums/null omission, manager exact/missing/ambiguous behavior, lookup-before-add, remote recovery, the add-success/local-finalization replay window, existing-ID update, latest ownership, source/summary separation, retry classification, safe output, outbox uniqueness, fencing, five attempts, blocked state, durable Bitrix binding, synced completion, comment replay suppression, and new-revision enqueueing.

**Current live gate:**

The only supplied webhook value was found consistently in the original user attachments and used in memory without printing or persisting it. The first read-only `crm.lead.fields` discovery request returned the safe Bitrix code `INVALID_CREDENTIALS`. No CRM mutation, remote migration, manager discovery, or live sync was attempted. A current valid `BITRIX_WEBHOOK_BASE_URL` is required before the mandated discovery PASS checks and single controlled live synchronization can proceed.
