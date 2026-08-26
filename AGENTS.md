<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository instructions

- Follow the current phase and the original test specification. Do not implement later phases early.
- Never expose secrets in source code, documentation, UI, tool output, or logs.
- Do not log HTTP request bodies, Teams text, transcripts, OCR output, names, email addresses, or phone numbers.
- Power Automate is a mandatory thin integration adapter. Do not replace it with a Microsoft Graph webhook listener.
- Grouping and deduplication solve different problems and must remain separate.
- Treat every AI response as untrusted input and validate it before use.
- Leave uncertain CRM values empty rather than guessing.
- Classify a lead as Partner only with explicit source evidence. Otherwise use Customer.
- Keep Bitrix side effects inside the future Bitrix adapter and durable outbox.
- Design idempotency to survive process restarts and repeated event delivery.
- Do not introduce Kafka, Kubernetes, microservices, or similar infrastructure for this test.
- Do not create git commits or push changes unless the user explicitly requests it.
- Prefer targeted tests while developing, followed by the phase validation commands.
