# AI-assisted development log

## How AI was used

AI assisted with architecture drafts, TypeScript/SQL implementation, test generation, failure analysis, and delivery documentation. Every phase was constrained by the task-owner specification and followed by focused manual review, local tests, pgTAP assertions, remote capability checks, or controlled production verification. AI output was never treated as proof that an external integration worked.

## What manual verification changed

- The adapted specification suggested Power Automate, but owner clarification and live Microsoft Graph diagnostics established direct Graph integration as the correct architecture.
- Database design suggestions were reduced to a practical modular-monolith schema with PostgreSQL jobs/outboxes instead of adding Kafka, Redis, Kubernetes, or microservices.
- Review found a grouping reassessment defect: fingerprints included irrelevant provider metadata and active attachment states were incomplete. A forward-only correction made grouping depend only on meaningful source/evidence state.
- Review found revision-state and retry-boundary defects in attachment and extraction workflows. Lease fencing, explicit attempt ceilings, and preservation of the last successful candidate were verified with pgTAP tests rather than accepted from generated code.
- Evidence validation was tightened after adversarial examples. Contact values must be present in cited evidence, suspicious `.corn` email spelling is preserved, conflicting names remain conflicted, and uncertain CRM values stay blank.
- The initially intended OpenAI vision model was unavailable to the supplied project. Live compatibility checks verified `gpt-4o-mini`, and the configuration was changed only after that evidence. Audio transcription was independently verified with `gpt-4o-mini-transcribe`.
- Live Graph diagnostics proved inbound roots, replies, catch-up, hosted images, DriveItem audio, and user lookup. They also proved that normal outbound Teams sending is unavailable with the supplied app-only authorization. No migration API workaround was used.
- Bitrix behavior was validated against discovered fields/enums and exact user matching. Controlled production runs proved lookup-before-create, remote read-back, source/summary separation, restart safety, and exact replay.
- Production deployment was verified as two Railway processes. A manually posted synthetic Teams fixture traversed the deployed Worker to one Bitrix lead in 49.704 seconds; the additional polling cycle created no duplicate message, group, summary, CRM action, or Bitrix lead.

## Human verification boundary

The final 60-message evaluation is deterministic and isolated: it uses synthetic pre-derived transcript/OCR evidence and the real grouping, extraction-validation, and canonicalization functions, with no OpenAI judge and no external writes. Its metrics therefore describe deterministic pipeline behavior, not live LLM accuracy. Live AI, Graph, Supabase, private Storage, UI/RBAC, Railway, and Bitrix capabilities were verified separately during their implementation phases.

The final submission relies on both layers: reproducible automated regression/evaluation and bounded real integration evidence. Credentials, source PII, prompt payloads, transcripts, OCR output, and CRM contact values were excluded from logs and documentation.
