# AI module

AI provider boundaries are server-only and task-specific. Attachment evidence uses narrow transcription and visible-text providers. Phase 4C group extraction uses the official OpenAI Responses API with a closed Structured Outputs object, `maxRetries: 0`, and a versioned evidence-only prompt.

All model output is untrusted. Group candidate fields are validated against exact allowed evidence references and conservative source-value support before protected persistence. Operational output contains aggregate counts, latency, usage, safe codes, and named PASS/FAIL checks only; source evidence and candidate values are never logged.
