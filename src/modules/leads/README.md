# Leads module

Phase 4B implements deterministic, evidence-first pre-lead conversation grouping in `grouping/`. It consumes Teams body text, explicit root/reply structure, and only successfully processed transcript/OCR evidence. Decisions are versioned, PII-safe in operational output, and persisted through a concurrency-safe service-role RPC.

Phase 4C implements group-level structured candidate extraction in `extraction/`. It builds stable evidence references, calls the configured OpenAI text model once per new extraction identity, validates model values against the exact cited source, persists the last successful candidate plus versioned field evidence, derives conflict-aware Partner/Customer and eligibility deterministically, and exposes only aggregate protected checks. Failed reprocessing retains the prior successful candidate and revision; only fenced success advances them.

These `lead_groups` are manager-side encounter candidates, not canonical leads. Cross-manager canonical deduplication, Russian summaries, CRM mapping/delivery, Bitrix calls, and Teams writes remain intentionally deferred.

`npm run groups:verify` performs the protected read-only checks and reports aggregate PASS/FAIL values without claiming work or constructing an OpenAI provider.
