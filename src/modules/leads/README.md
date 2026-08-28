# Leads module

Phase 4B implements deterministic, evidence-first pre-lead conversation grouping in `grouping/`. It consumes Teams body text, explicit root/reply structure, and only successfully processed transcript/OCR evidence. Decisions are versioned, PII-safe in operational output, and persisted through a concurrency-safe service-role RPC.

These `lead_groups` are manager-side encounter candidates, not canonical leads. Lead extraction, Partner/Customer classification, priority/region/product calculation, Russian summaries, cross-manager canonical deduplication, and CRM delivery remain intentionally deferred.
