# KazDream Teams → Bitrix Leads

## Project purpose

This project will process exhibition lead messages from Microsoft Teams and deliver validated contacts and leads to Bitrix24. Phase 1 contains only the application bootstrap and reusable foundations; integrations and business processing are not implemented yet.

## Architecture overview

The planned architecture is a TypeScript modular monolith with a Next.js App Router web/API process, a background worker, and durable PostgreSQL state. Power Automate remains the mandatory thin adapter between Microsoft Teams and the application.

Confirmed decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Local development

Requirements:

- an active Node.js LTS release;
- npm.

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

## Power Automate

Power Automate is mandatory and will be implemented as a thin Teams/SharePoint transport adapter in a later phase. No flow is included in Phase 1.

## Supabase

Phase 1 includes lazy browser and server client factories. It does not connect to a Supabase project and contains no migrations, tables, RLS policies, or Auth UI.

## Bitrix24

The Bitrix24 adapter and durable outbox are planned for a later phase. Phase 1 performs no Bitrix REST calls.

## Evaluation

The ground-truth dataset and evaluation runner will be added in a later phase.

## Deployment

Railway deployment is planned but is not configured in Phase 1.

## Security baseline

Application logs must not contain HTTP request bodies, Teams text, transcripts, OCR output, visitor PII, or secrets. No general-purpose logger is introduced during bootstrap because the application does not log operational events yet.
