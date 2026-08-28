# Bitrix module

Phase 5 isolates Bitrix REST access behind server-only adapters and the existing durable `crm_outbox`. `npm run bitrix:sync` always performs read-only portal discovery first, validates required standard/custom fields, expected enumeration IDs, `EXHIBITION`, and user-directory access, and stops before claiming work if discovery fails.

Each successful canonical summary revision creates one unique `sync` outbox row. The worker uses a 600 ms minimum request interval, five durable attempts, lease fencing, safe error codes, and no technical logging of CRM payloads or webhook data. Exact Teams AAD user ID resolves through Graph mail/UPN to one exact Bitrix email; missing or ambiguous mapping blocks delivery with no admin fallback.

Lead creation is protected remotely by the immutable primary `bitrix_source_group_id` stored in `UF_CRM_TEAMS_GROUP_ID`. With no local Bitrix ID, the worker always looks up that field before `crm.lead.add`; one match is recovered and updated, more than one blocks. The Bitrix lead binding is finalized locally before the separate source timeline comment. A deterministic `[KD-SOURCE:<lead-uuid>:r<revision>]` marker limits intentional comment replay, but timeline comments have weaker crash-recovery guarantees because Bitrix exposes no verified external idempotency key for this operation.

`COMMENTS` contains only the Russian analytical summary. Original Teams text, verbatim transcript, and useful OCR remain in the revision-specific timeline source comment and never appear in operational output.
