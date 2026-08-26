# KazDream Teams → Bitrix Leads

## Project purpose

This project will process exhibition lead messages from Microsoft Teams and deliver validated contacts and leads to Bitrix24. The current implementation contains the application bootstrap and local database foundation; integrations and business processing are not implemented yet.

## Architecture overview

The planned architecture is a TypeScript modular monolith with a Next.js App Router web/API process, a background worker, and durable PostgreSQL state. Microsoft Teams data enters directly through Microsoft Graph, is processed and validated by the application, and is delivered to Bitrix24 through durable jobs and outboxes. Feedback to Teams also uses Microsoft Graph.

The adapted written specification contained a Power Automate section. The task owner later clarified that this candidate implementation should use the supplied Microsoft API credentials and integrate directly through Microsoft Graph.

Confirmed decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Local development

Requirements:

- an active Node.js LTS release;
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

Railway deployment is planned but is not configured in Phase 1.

## Security baseline

Application logs must not contain HTTP request bodies, Teams text, transcripts, OCR output, visitor PII, or secrets. No general-purpose logger is introduced during bootstrap because the application does not log operational events yet.
