# KazDream Teams → Bitrix Leads

## Project purpose

This project processes exhibition lead evidence from Microsoft Teams toward validated Bitrix24 leads. The current implementation includes durable Teams ingestion, secure attachment acquisition, derived transcript/OCR evidence, and deterministic pre-lead conversation grouping. Canonical lead extraction, deduplication, and CRM delivery are not implemented yet.

## Architecture overview

The planned architecture is a TypeScript modular monolith with a Next.js App Router web/API process, a background worker, and durable PostgreSQL state. Microsoft Teams data enters directly through Microsoft Graph, is processed and validated by the application, and is delivered to Bitrix24 through durable jobs and outboxes. Feedback to Teams also uses Microsoft Graph.

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

The application is available at `http://localhost:3000`. The liveness endpoint is `GET /api/health/live`.

## Environment variables

Copy `.env.example` to `.env.local` and add values only for the feature being exercised. Empty integration variables do not prevent a normal build.

Never commit `.env`, `.env.local`, access tokens, webhook URLs, or service-role keys. Server-only values must not be imported into browser code.

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

## AI-derived attachment evidence

`npm run ai:evidence -- --limit=3` processes only current, fetched, supported private attachment artifacts whose derived evidence identity is missing or outdated. Audio is transcribed with the configured OpenAI transcription model; images produce only strict visible-text evidence and a small document-type classification. The command prints aggregate PII-safe metrics and never prints transcript or image text.

`OPENAI_API_KEY` is server-only. The configured defaults are `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe` and `OPENAI_VISION_MODEL=gpt-4o-mini`. The latter is the tested compatible replacement for the originally intended `gpt-5-mini`, which was unavailable to the supplied OpenAI project.

Phase 4A intentionally retains only the active AI-derived transcript/OCR revision. Original private attachment bytes and their SHA-256 remain immutable, while provider, model, operation, and prompt/schema metadata make the current result reproducible and unambiguous. Previous AI text revisions are not archived in this MVP; a separate versioned evidence table is the production extension if full AI-output history becomes required.

## Microsoft Graph

Direct Microsoft Graph integration is planned for a later phase and is not implemented in Phase 2. `MS_TENANT_ID`, `MS_CLIENT_ID`, and `MS_CLIENT_SECRET` are server-only; no Microsoft credential may use a `NEXT_PUBLIC_` variable.

## Selected test campaign

The selected MVP test configuration is Hannover Messe 2026 with source `EXHIBITION` and the confirmed Bitrix exhibition value `63`. This records the intended test configuration only; it does not claim that a remote Bitrix campaign has already been configured or verified.

## Supabase

The repository contains a local Supabase configuration and timestamped PostgreSQL migrations under `supabase/migrations/`. It is not linked to a remote Supabase project, and no remote database credentials are configured.

With Docker running, start the local services and recreate the schema from migrations with:

```bash
npx supabase start
npx supabase db reset
```

New Auth users receive the `user` application role automatically, including users whose sign-up metadata asks for a different role. After the intended demo Auth users exist, an authorized database operator or existing administrator must explicitly promote the selected profile by setting `public.profiles.role` to `admin`. There is no public role-changing endpoint and no frontend role assignment.

After an explicit future remote link and review, pending migrations can be applied with `npx supabase db push`. Neither linking nor pushing is part of Phase 2.

## Bitrix24

The Bitrix24 adapter is planned for a later phase. No Bitrix REST calls are implemented.

## Evaluation

The ground-truth dataset and evaluation runner will be added in a later phase.

## Deployment

Railway deployment is planned but is not configured yet. Its future runtime
must be pinned to Node.js 22 or newer before deployment.

## Security baseline

Application logs must not contain HTTP request bodies, Teams text, transcripts, OCR output, visitor PII, or secrets. No general-purpose logger is introduced during bootstrap because the application does not log operational events yet.
