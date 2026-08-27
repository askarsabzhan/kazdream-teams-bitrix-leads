# Teams module

Phase 3A provides a server-only, read-only Microsoft Graph authentication and diagnostic foundation under `graph/`.

Configure `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TEAM_NAME`, and `MS_CHANNEL_NAME` in the server environment, then run `npm run graph:diagnose` to produce a sanitized capability matrix. Team and channel IDs are discovered by exact configured names. The command does not persist tokens, print message contents or identifiers, or perform remote writes.

Verified reusable foundations cover private team/channel discovery, bounded pagination, replies, nullable AAD author projection, hosted-content bytes, reference attachment DriveItem bytes, and bounded history catch-up. The observed image and audio representations are test-tenant findings, not universal assumptions.

Phase 3B adds bounded durable ingestion:

- `npm run teams:ingest -- --dry-run` reads and normalizes the latest configured channel messages without database writes;
- `npm run teams:ingest -- --verify` persists the latest bounded batch and prints PII-safe database invariants;
- `npm run teams:ingest -- --verify-only` reads only PII-safe persistence invariants;
- `npm run teams:ingest -- --mode=catch-up --since=<ISO> --until=<ISO>` uses the verified bounded history path.

Both modes resolve team/channel IDs from the configured names and share the same idempotent transactional RPC. Raw message bodies are stored for later evidence but never printed. Attachment metadata is persisted without byte downloads.

Polling, job execution, AI, attachment byte processing, and Teams feedback delivery remain intentionally unimplemented. Normal app-only channel send is not supported by the supplied credentials; `Teamwork.Migrate.All` is not a workaround. The durable `teams_notifications` outbox is the boundary for a future approved transport.
