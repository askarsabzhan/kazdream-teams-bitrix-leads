# AI module

AI provider boundaries are server-only and task-specific. Attachment evidence uses narrow transcription and visible-text providers. Phase 4C group extraction and Phase 4D canonical Russian summaries use the official OpenAI Responses API with closed Structured Outputs objects, `maxRetries: 0`, and versioned evidence-only prompts.

All model output is untrusted. Group candidate fields are validated against exact allowed evidence references and conservative source-value support before protected persistence. Canonical summary output is schema-validated, fenced to its canonical source identity, and rejected if it exposes evidence identifiers. Operational output contains aggregate counts, latency, usage, safe codes, and named PASS/FAIL checks only; source evidence and candidate values are never logged.
