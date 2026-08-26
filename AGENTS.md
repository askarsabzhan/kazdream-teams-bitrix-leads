<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository instructions

- Follow the current phase, the test specification, and authoritative task-owner clarifications. Later clarifications override conflicting adapted-spec text. Do not implement later phases early.
- Never expose secrets in source code, documentation, UI, tool output, or logs.
- Do not log HTTP request bodies, Teams text, transcripts, OCR output, names, email addresses, or phone numbers.
- Direct Microsoft Graph integration is required. Do not introduce Power Automate unless it is explicitly requested later.
- Microsoft credentials are server-only and must never be exposed to browser code or logs.
- Do not log Microsoft Graph payloads or payload-derived PII.
- Grouping and deduplication solve different problems and must remain separate.
- Treat every AI response as untrusted input and validate it before use.
- Leave uncertain CRM values empty rather than guessing.
- Require a reliable full name and at least one reliable phone before CRM lead creation. Never invent either value.
- A duplicate contact enriches the existing canonical lead, and the latest contributing manager becomes the Bitrix responsible manager.
- Reliable late information updates the existing canonical lead regardless of arrival time.
- Classify a lead as Partner only with explicit source evidence such as partner, integrator, system integrator, seller, distributor, dealer, or a clear equivalent. Otherwise use Customer.
- Customer is the mandatory lead-type fallback.
- Never guess unknown CRM enum values.
- Keep Bitrix side effects inside the future Bitrix adapter and durable outbox.
- Design idempotency to survive process restarts and repeated event delivery.
- Do not introduce Kafka, Kubernetes, microservices, or similar infrastructure for this test.
- Do not create git commits or push changes unless the user explicitly requests it.
- Prefer targeted tests while developing, followed by the phase validation commands.
