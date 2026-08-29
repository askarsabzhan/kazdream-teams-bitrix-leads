# KazDream Teams → Bitrix Leads

## Project overview

Microsoft Teams → Bitrix24 exhibition lead processing service. It discovers Teams channel history through Microsoft Graph, stores source evidence durably, processes private attachments, groups encounter conversations, extracts and validates lead data, deduplicates canonical visitors, generates a Russian analytical summary, and synchronizes eligible leads to Bitrix24.

Production UI: https://web-production-633b2.up.railway.app

## Architecture

```text
Teams → Microsoft Graph → ingestion → attachment processing → AI evidence
      → deterministic grouping → structured extraction → canonicalization
      → durable Bitrix outbox → Bitrix24

Railway WEB    → Next.js UI/API
Railway WORKER → bounded polling pipeline
Supabase       → PostgreSQL, Auth, private Storage
```

The TypeScript modular monolith has separate Web and Worker entry points but one repository and one authoritative PostgreSQL state. Durable identities, leases, constraints, revision fingerprints, and outboxes make repeated Graph delivery and process restarts safe. A conversation group represents one manager encounter; a canonical lead may combine several encounters for the same visitor.

See [engineering decisions](docs/decisions.md), [evaluation results](docs/evaluation.md), [AI development log](docs/ai-development-log.md), [demo script](docs/demo-script.md), and the [delivery checklist](docs/final-checklist.md).

## Local setup

Requirements:

- Node.js 22 or newer;
- npm;
- Docker Desktop for local Supabase and pgTAP tests.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The local app is available at `http://localhost:3000`; the liveness endpoint is `GET /api/health/live`.

## Environment variable names

Keep values only in `.env.local` or the deployment platform. Never commit credentials.

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- Microsoft Graph: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TEAM_NAME`, `MS_CHANNEL_NAME`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_EXTRACTION_MODEL`, `OPENAI_SUMMARY_MODEL`
- Bitrix24: `BITRIX_WEBHOOK_BASE_URL`
- Worker: `WORKER_POLL_INTERVAL_MS`

Only the two `NEXT_PUBLIC_SUPABASE_*` values are browser-readable. Microsoft, OpenAI, Bitrix, database, and Supabase server credentials are server-only.

## Supabase setup and migrations

```bash
npx supabase start
npx supabase db reset
npm run test:db
```

To use the linked project:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked
npx supabase db push --dry-run
```

Apply remote migrations only after reviewing the dry run. Do not edit already-applied migrations or commit Supabase credentials.

## Worker

Run one bounded iteration or the continuous loop:

```bash
npm run worker:once
npm run worker
```

The production order is Teams ingestion, attachment acquisition, transcript/OCR evidence, grouping, extraction, canonicalization, and Bitrix synchronization. Worker logs contain only allow-listed event names, stages, numeric counts, durations, and safe error codes.

## Useful commands

```bash
npm run graph:diagnose
npm run teams:ingest
npm run attachments:acquire
npm run ai:evidence
npm run group:conversations
npm run groups:extract
npm run groups:verify
npm run leads:canonicalize
npm run bitrix:discover
npm run bitrix:sync
```

These are operational/debug commands. Do not run local processing commands against production merely to advance the deployed workflow; the Railway Worker owns normal processing.

## Authentication and RBAC

The Web application uses Supabase Auth. Authenticated `user` and `admin` roles can view leads and private evidence; `/admin` is admin-only. Public registration is not required. New users default safely to `user`; admin promotion is available only through the trusted server-side mechanism.

The persistent evaluator admin account is intentionally retained for the demonstration. Set/reset the evaluator password manually in Supabase Authentication before demo.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
git diff --check
npx supabase db lint --local
npx supabase db lint --linked
```

## Synthetic evaluation

The isolated evaluator uses exactly 60 synthetic message events and ground truth for 22 expected canonical leads. It calls the production deterministic grouping, extraction-validation, and canonicalization functions with synthetic pre-derived transcript/OCR evidence. It does not call OpenAI, Supabase, Teams, Railway, or Bitrix.

```bash
npm run evaluate
```

The runner performs one evaluation pass and one exact replay, then prints aggregate metrics only. It never sends evaluation CRM intents to Bitrix. See [docs/evaluation.md](docs/evaluation.md) for metric definitions and measured results.

## Production

Railway runs:

- `WEB`: `npm run start`, authenticated UI and liveness endpoint;
- `WORKER`: `npm run worker`, one replica with integration credentials;
- Supabase: linked PostgreSQL, Auth, and private attachment Storage.

The production Teams → Bitrix fixture completed automatically in **49.704 seconds**. Inbound ingestion, grouping, extraction, eligibility, canonicalization, Russian summary, Bitrix synchronization, and replay idempotency passed. Current manual deployment works; GitHub auto-deploy and the stale unapplied Railway UI patch are optional operational follow-ups, not correctness failures.

## Teams integration status

- Inbound Teams processing: **SUPPORTED**.
- Teams → service → Bitrix: **SUPPORTED AND VERIFIED IN PRODUCTION**.
- Production Teams → Bitrix latency: **49.704 seconds**.
- Outbound service → Teams confirmation: **BLOCKED_BY_ENTRA_APP_PERMISSIONS**.

Inbound Teams integration is operational. Outbound Teams feedback is architecturally planned, but it cannot be activated until an owner or administrator updates the Microsoft Entra App Registration with delegated Microsoft Graph `ChannelMessage.Send` and the Web redirect URI `https://web-production-633b2.up.railway.app/admin/integrations/teams/callback`. The currently supplied app-only transport does not support ordinary channel-message sending.

Broad or unsupported permissions, migration APIs, and migration-only application permissions were intentionally not used as workarounds.

`TEAMS_FEEDBACK_STATUS=BLOCKED_BY_ENTRA_APP_PERMISSIONS`
