# KazDream Teams → Bitrix Leads

## Project purpose

This project processes exhibition lead evidence from Microsoft Teams into validated Bitrix24 leads. It includes durable Teams ingestion, secure attachment acquisition, derived transcript/OCR evidence, deterministic conversation grouping and extraction, canonical lead resolution, a durable Bitrix synchronization worker, and an authenticated lead-management UI.

## Architecture overview

The production architecture is a TypeScript modular monolith deployed as two Railway services from the same repository: a Next.js Web process and one continuously running Worker process. Both use the linked Supabase PostgreSQL project as durable state. Microsoft Teams data enters directly through Microsoft Graph and reaches Bitrix24 through durable jobs and outboxes.

The adapted written specification contained a Power Automate section. The task owner later clarified that this candidate implementation should use the supplied Microsoft API credentials and integrate directly through Microsoft Graph.

Confirmed decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Local development

Requirements:

- Node.js 22 or newer (`file-type@22` requires Node.js `>=22`);
- npm;
- Docker Desktop with the Docker engine running for local Supabase commands.

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

The application is available at `http://localhost:3000`. Open `/login` to use the authenticated lead workspace. The liveness endpoint is `GET /api/health/live`.

Run one bounded production-pipeline iteration locally with `npm run worker:once`. Run the continuous worker with `npm run worker`.

## Environment variables

Copy `.env.example` to `.env.local` and add values only for the feature being exercised. Empty integration variables do not prevent a normal build.

Never commit `.env`, `.env.local`, access tokens, webhook URLs, or service-role keys. Server-only values must not be imported into browser code.

Production uses these variable names:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- Microsoft Graph: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TEAM_NAME`, `MS_CHANNEL_NAME`;
- OpenAI: `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_EXTRACTION_MODEL`, `OPENAI_SUMMARY_MODEL`;
- Bitrix24: `BITRIX_WEBHOOK_BASE_URL`;
- worker runtime: `WORKER_POLL_INTERVAL_MS` (default `10000`, accepted range `5000`–`15000`).

### Evaluator accounts

There is no public registration UI. New Supabase Auth users still default to the `user` role. After applying all migrations, an operator with the local server environment can create or refresh one normal evaluator and one admin without committing passwords:

```powershell
$env:DEMO_USER_EMAIL = '<normal-user-email>'
$env:DEMO_USER_PASSWORD = '<temporary-password-at-least-12-characters>'
$env:DEMO_ADMIN_EMAIL = '<admin-email>'
$env:DEMO_ADMIN_PASSWORD = '<temporary-password-at-least-12-characters>'
npm.cmd run demo-users:create
Remove-Item Env:DEMO_USER_EMAIL, Env:DEMO_USER_PASSWORD, Env:DEMO_ADMIN_EMAIL, Env:DEMO_ADMIN_PASSWORD
```

The command uses Supabase Admin Auth only on the server, promotes only the selected admin through a service-role-only database function, and prints aggregate status without identities or credentials.

## Testing

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run test:watch` for focused development.

## Conversation grouping

`npm run group:conversations -- --limit=100` deterministically groups the bounded current Teams source set using explicit reply structure, exact normalized email/phone signals, and conservative labeled name/company hints. Only successful transcript/OCR evidence is included; unfinished evidence is deferred and terminal unavailable evidence is ignored. The command prints aggregate counts and protected PASS/FAIL assertions without source text or contact values.

Grouping algorithm `v1` creates pre-lead manager-side encounter groups. It does not call OpenAI, extract canonical lead fields, deduplicate visitors across managers, create Bitrix records, or send Teams feedback. Repeating the command against unchanged source state is a persistence no-op.

## Group candidate extraction

`npm run groups:extract -- --limit 10 --lease-seconds 300` consumes only current `process_lead_group` jobs and performs one evidence-grounded Structured Outputs request for each claimed group identity. The command prints only aggregate counts, provider latency/usage, and protected PASS/FAIL checks. It never prints Teams text, transcripts, OCR, candidate values, names, phones, or emails.

`OPENAI_EXTRACTION_MODEL` is server-only and defaults to `gpt-4o-mini`. Candidate extraction preserves source contact spelling, rejects invented evidence references and unsupported contact values, derives Partner/Customer and full-name-plus-phone eligibility deterministically, and stores campaign/source as configuration. It does not merge groups, create canonical leads, generate the final Russian summary, call Bitrix, or write Teams.

## Canonical lead resolution

`npm run leads:canonicalize` processes only eligible current group candidates. It uses exact normalized phone/email matches, with exact supported full-name-plus-company as a secondary key, and persists identity collisions without merging. Linked groups are recomposed into one canonical lead; reliable late evidence enriches union fields and the latest actual Teams contributor becomes responsible. A changed canonical revision receives one evidence-grounded Russian analytical summary through the fenced durable summary state machine. Exact replay creates no lead or revision and makes no OpenAI request.

`OPENAI_SUMMARY_MODEL` is server-only and defaults to `gpt-4o-mini`. Operational output is aggregate and excludes source evidence, candidate values, names, phones, and emails. Phase 4D does not call Bitrix or write to Teams.

## Bitrix synchronization

`npm run bitrix:sync` performs read-only Bitrix discovery before claiming the durable CRM outbox. It validates the actual standard/custom fields, confirmed enumeration IDs, `EXHIBITION` source, Teams provenance fields, and user-directory access. If discovery differs from the confirmed contract, the command stops before CRM writes.

The worker maps the latest Teams contributor through Microsoft Graph mail/UPN to one exact Bitrix user email, then performs remote idempotency lookup by an immutable primary conversation-group ID before add. Existing or recovered leads are updated, and `COMMENTS` receives the current Russian analytical summary. Original manager source remains separate in a deterministic revision-specific timeline comment. Output contains only discovery PASS/FAIL checks and aggregate created/updated/recovered/blocked/failed counts.

## AI-derived attachment evidence

`npm run ai:evidence -- --limit=3` processes only current, fetched, supported private attachment artifacts whose derived evidence identity is missing or outdated. Audio is transcribed with the configured OpenAI transcription model; images produce only strict visible-text evidence and a small document-type classification. The command prints aggregate PII-safe metrics and never prints transcript or image text.

`OPENAI_API_KEY` is server-only. The configured defaults are `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`, `OPENAI_VISION_MODEL=gpt-4o-mini`, `OPENAI_EXTRACTION_MODEL=gpt-4o-mini`, and `OPENAI_SUMMARY_MODEL=gpt-4o-mini`. The vision default is the tested compatible replacement for the originally intended `gpt-5-mini`, which was unavailable to the supplied OpenAI project.

Phase 4A intentionally retains only the active AI-derived transcript/OCR revision. Original private attachment bytes and their SHA-256 remain immutable, while provider, model, operation, and prompt/schema metadata make the current result reproducible and unambiguous. Previous AI text revisions are not archived in this MVP; a separate versioned evidence table is the production extension if full AI-output history becomes required.

## Microsoft Graph

Direct Microsoft Graph integration is used by the ingestion and attachment workflows. `MS_TENANT_ID`, `MS_CLIENT_ID`, and `MS_CLIENT_SECRET` are server-only; no Microsoft credential may use a `NEXT_PUBLIC_` variable.

## Selected test campaign

The selected MVP test configuration is Hannover Messe 2026 with source `EXHIBITION` and the confirmed Bitrix exhibition value `63`. This records the intended test configuration only; it does not claim that a remote Bitrix campaign has already been configured or verified.

## Supabase

The repository contains local Supabase configuration and timestamped PostgreSQL migrations under `supabase/migrations/`. Link and migration credentials remain operator-local and must never be committed.

With Docker running, start the local services and recreate the schema from migrations with:

```bash
npx supabase start
npx supabase db reset
```

New Auth users receive the `user` application role automatically, including users whose sign-up metadata asks for a different role. The documented demo-user command can promote only its selected admin through a service-role-only function. There is no public role-changing endpoint and no frontend role assignment.

After explicit remote linking and review, an operator can inspect pending migrations with `npx supabase db push --dry-run` before applying them.

## Bitrix24

The Bitrix24 adapter is server-only and writes exclusively through the durable CRM outbox worker. Browser requests never receive the webhook or call Bitrix synchronously.

## Evaluation

The ground-truth dataset and evaluation runner will be added in a later phase.

## Production runtime

Railway runs two services from this repository on Node.js 22 or newer:

- Web starts with `npm run start`, exposes the authenticated UI and `GET /api/health/live`, and requires only the server variables used by web routes;
- Worker starts with `npm run worker`, has all integration variables, and has no public domain;
- Supabase provides authoritative PostgreSQL state, Auth, and private attachment storage.

Each bounded worker iteration reuses the existing workers in this order:

`Teams → attachments → AI evidence → grouping → extraction → canonicalization → Bitrix`

The worker catches up recent Teams history at startup, then polls every `WORKER_POLL_INTERVAL_MS`. Durable database identities, leases, constraints, and outboxes make replay safe. The take-home deployment intentionally runs exactly one Worker replica; horizontal worker coordination is outside this MVP.

One-shot diagnostics remain available through the existing commands such as `npm run graph:diagnose`, `npm run teams:ingest`, and `npm run worker:once`.

Standard Microsoft Graph channel-message sending is unavailable to the current app-only client-credentials setup. No migration API or unsupported send workaround is used. `TEAMS_FEEDBACK_STATUS=BLOCKED_BY_APP_ONLY_SEND` until a legitimate delegated or otherwise supported send transport is supplied.

## Security baseline

Application logs must not contain HTTP request bodies, Teams text, transcripts, OCR output, visitor PII, or secrets. Production worker logs contain only stage names, aggregate numeric counts, durations, and allow-listed safe error codes.
