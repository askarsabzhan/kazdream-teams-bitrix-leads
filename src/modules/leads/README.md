# Leads module

Phase 4B implements deterministic, evidence-first pre-lead conversation grouping in `grouping/`. It consumes Teams body text, explicit root/reply structure, and only successfully processed transcript/OCR evidence. Decisions are versioned, PII-safe in operational output, and persisted through a concurrency-safe service-role RPC.

Phase 4C implements group-level structured candidate extraction in `extraction/`. It builds stable evidence references, calls the configured OpenAI text model once per new extraction identity, validates model values against the exact cited source, persists the last successful candidate plus versioned field evidence, derives conflict-aware Partner/Customer and eligibility deterministically, and exposes only aggregate protected checks. Failed reprocessing retains the prior successful candidate and revision; only fenced success advances them.

Phase 4D implements canonical resolution in `canonicalization/`. Only eligible current group candidates participate. Exact normalized phone/email are strong keys; exact supported full name plus company is secondary. A phone-to-A/email-to-B collision is persisted without merge. All linked groups are recomposed so late reliable contacts, interests, and facts enrich the same lead, while conservative conflicts remain explicit and the latest actual Teams contributor becomes responsible.

Canonical revision changes are meaningful-state-only. The database uniqueness boundary and advisory-locked RPC make identity decisions restart- and concurrency-safe. A fenced summary claim produces one Russian evidence-grounded analytical summary for each new source/model/prompt identity; replay is a no-op. CRM mapping/delivery, Bitrix calls, and Teams writes remain intentionally deferred.

`npm run groups:verify` performs the protected read-only checks and reports aggregate PASS/FAIL values without claiming work or constructing an OpenAI provider.

`npm run leads:canonicalize` performs bounded canonical resolution, recomposition, and pending-summary processing and prints aggregate PII-safe metrics only.
