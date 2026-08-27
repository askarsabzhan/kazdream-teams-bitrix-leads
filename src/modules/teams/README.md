# Teams module

Phase 3A provides a server-only, read-only Microsoft Graph authentication and diagnostic foundation under `graph/`.

Configure `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TEAM_NAME`, and `MS_CHANNEL_NAME` in the server environment, then run `npm run graph:diagnose` to produce a sanitized capability matrix. Team and channel IDs are discovered by exact configured names. The command does not persist tokens, print message contents or identifiers, or perform remote writes.

Verified reusable foundations cover private team/channel discovery, bounded pagination, replies, nullable AAD author projection, hosted-content bytes, reference attachment DriveItem bytes, and bounded history catch-up. The observed image and audio representations are test-tenant findings, not universal assumptions.

Production ingestion, polling, and Teams feedback delivery remain intentionally unimplemented. Normal app-only channel send is not supported by the supplied credentials; `Teamwork.Migrate.All` is not a workaround. The durable `teams_notifications` outbox is the boundary for a future approved transport.
