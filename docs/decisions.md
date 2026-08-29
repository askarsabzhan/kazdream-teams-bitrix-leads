# Core engineering decisions

## 1. Direct Microsoft Graph, not Power Automate

The service authenticates directly with the supplied Microsoft Entra application and reads Teams through Microsoft Graph. This keeps ingestion, catch-up, replies, attachment acquisition, retry behavior, and diagnostics in one testable codebase. Microsoft credentials and Graph payloads remain server-only.

## 2. Durable ingestion and idempotency

Raw Teams messages are stored before AI or CRM work. Stable source identities, content revisions, fingerprints, PostgreSQL constraints, leases, and fencing make repeated delivery and process restarts safe. Roots and replies remain separate source records with explicit reply linkage.

## 3. Evidence-first deterministic grouping

Conversation grouping uses explicit replies first, then exact phone/email signals, and only conservative labeled name/company hints. It does not call an LLM. Unfinished evidence defers a decision; terminal unsupported evidence does not permanently poison otherwise usable source text.

## 4. Conversation group is not a canonical lead

A group represents one manager-side encounter. Independent encounters remain separate even when they describe the same visitor. Canonical deduplication is a later concern and may link several groups to one lead.

## 5. LLMs only where useful

OpenAI is used for speech transcription, visible-text extraction, structured group extraction, and the Russian analytical summary. Grouping, eligibility, lead type, deduplication, ownership, retries, and CRM idempotency are deterministic. Every AI response is schema-validated and treated as untrusted input.

## 6. Source validation and uncertain blanks

Extracted fields must cite source evidence. Contact values are checked against the cited Teams text, transcript, or OCR material. Suspicious source spelling is preserved; unsupported or conflicting values remain empty instead of being guessed or silently repaired.

## 7. Deterministic Partner/Customer

`Partner` requires explicit evidence such as partner, integrator, seller, distributor, or dealer. An explicit Customer statement remains Customer, and the mandatory fallback is Customer. CRM enum IDs are fixed only after Bitrix discovery confirms them.

## 8. Full name plus phone eligibility

CRM creation requires a reliable full name and at least one reliable phone. Email and company are optional. Missing or conflicted required values produce a visible non-eligible result, never invented CRM data.

## 9. Deterministic canonical deduplication

Exact normalized phones/emails are strong keys. Exact supported full name plus company is a secondary key; fuzzy and AI-based merging are intentionally excluded. Conflicting identities are retained for review rather than merged unsafely. Reliable late information recomposes and enriches the existing canonical lead.

## 10. Latest contributor owns the lead

When several manager encounters contribute to one canonical lead, the latest real Teams contributor becomes the responsible manager. Teams AAD identity resolves through Graph mail/UPN to one exact Bitrix user; there is no administrator fallback.

## 11. Durable Bitrix outbox and remote idempotency

Bitrix writes occur only in the server-side adapter through a revision-aware outbox. The worker first searches the immutable Teams source-group identity, then creates, recovers, or updates. Lease fencing, bounded attempts, durable lead binding, and revision-specific source comments protect replay windows, including a remote success followed by a local crash.

## 12. Analytical summary is separate from verbatim source

The Russian analytical summary is stored in the Bitrix lead comments. Original Teams text, transcripts, and OCR material are placed separately in a deterministic timeline comment. This avoids presenting AI analysis as source evidence.

## 13. Railway Web plus one Worker

The modular monolith is deployed as a Next.js Web service and a single continuously running Worker on Railway, backed by Supabase/PostgreSQL, Auth, and private Storage. One worker replica is sufficient for this take-home; Kubernetes, Kafka, and microservices would add complexity without solving a current requirement.

## 14. Known outbound Teams limitation

Inbound Teams → service processing works with app-only Graph authentication. Standard outbound channel feedback does not: the supplied client-credentials permissions do not provide a legitimate normal-send transport. A delegated flow, Teams bot, or supervisor-approved supported alternative is required. Migration APIs are explicitly rejected as a workaround.

`TEAMS_FEEDBACK_STATUS=BLOCKED_BY_APP_ONLY_SEND`
