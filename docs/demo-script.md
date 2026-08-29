# 3–5 minute demo script

## 0:00–0:30 — Problem and architecture

Explain that exhibition contact evidence arrives in Teams as text, replies, audio, and images. Show the architecture briefly: Teams → Graph → Supabase durable pipeline → evidence/grouping/extraction/canonicalization → Bitrix outbox, with Railway WEB and WORKER.

## 0:30–1:10 — Teams source

Open the synthetic exhibition contact already used for production verification. Point out the manager identity, source timestamp, and any reply/attachment context. Do not post another fixture.

## 1:10–1:40 — Bitrix result

Show the automatically created Bitrix lead. Highlight responsible manager, Customer/Partner type, exhibition/source, contact fields, Russian analytical summary, and the separate timeline source material. Mention the measured 49.704-second Teams → Bitrix latency.

## 1:40–2:40 — Railway Web UI

Log in with the evaluator admin account and open:

- `/leads`: three current canonical leads;
- one `/leads/[id]`: extracted fields and CRM status;
- analytical summary: visually separate from original evidence;
- original Teams text/transcript/OCR;
- private image preview: delivered through the authenticated route, not a public bucket.

If the password is not known, set/reset it manually in Supabase Authentication before recording. Never show credentials on screen.

## 2:40–3:15 — Admin

Open `/admin`. Show the campaign configuration, manager mapping status, integration/queue state, and RBAC boundary. Do not click CRM retry during the demo.

## 3:15–4:00 — Correctness model

Explain:

- replies and evidence form manager encounter groups;
- two managers can create two groups for one visitor;
- exact identity keys merge those groups into one canonical lead;
- reliable late evidence enriches the lead;
- the latest contributor becomes responsible;
- uncertain/conflicting values remain blank;
- durable identities/outboxes make replay safe.

## 4:00–4:30 — Evaluation

Show `docs/evaluation.md` or run `npm run evaluate`. State clearly: 60 synthetic messages, 22 expected/actual canonical leads, 0 false merges/splits, 0 replay duplicates, and 0 OpenAI calls because transcript/OCR evidence is pre-derived.

## 4:30–5:00 — Deployment and limitation

Show Railway WEB and WORKER health. Close with the precise limitation: inbound Teams → service works; outbound feedback needs a legitimate delegated/bot transport because the supplied app-only authorization cannot perform normal channel sending.

`TEAMS_FEEDBACK_STATUS=BLOCKED_BY_APP_ONLY_SEND`
