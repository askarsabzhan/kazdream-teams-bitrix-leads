# Synthetic evaluation

## Dataset and isolation

The evaluation contains exactly **60 synthetic Teams message events** representing **28 encounter groups** and **22 expected canonical leads**. Two messages are intentionally ambiguous, and three grouped encounters are intentionally ineligible. All names, contact values, tenant/channel identifiers, transcript text, and OCR text are synthetic.

The runner calls the production deterministic grouping engine, extraction-output validator, eligibility/Partner-Customer rules, and canonical matching/composition functions. Transcript and OCR inputs are pre-derived fixtures, so no Whisper/Vision calls are repeated. Persistence replay is modeled with the same durable identity boundaries but does not connect to Supabase or any external system.

Ground truth is evaluator-only and is never inserted into an extraction prompt. The evaluation makes **0 OpenAI requests**, sends **0 Teams messages**, and creates **0 Bitrix leads**.

## Included edge cases

The 24 measured checks cover normal text, root/reply threads, contact pieces across replies, three contacts within 40 seconds, one visitor encountered by two managers, multiple phones/emails, suspicious `.corn`, no-email eligibility, both missing-contact rejection cases, explicit Partner, Customer fallback, explicit Customer, conflicting names, late enrichment, a late explicit reply, bot/service noise, weak context, terminal unsupported attachment state, transcript evidence, OCR evidence, latest-contributor ownership, and exact replay/restart safety.

## Command

```bash
npm run evaluate
```

One command performs the evaluation pass and one exact replay, then prints aggregate metrics only.

## Measured deterministic pipeline metrics

| Metric | Result |
| --- | ---: |
| MESSAGE_COUNT | 60 |
| EXPECTED_CANONICAL_LEADS | 22 |
| ACTUAL_CANONICAL_LEADS | 22 |
| LEAD_COUNT_ACCURACY | 100% |
| FALSE_MERGES | 0 |
| FALSE_SPLITS | 0 |
| DUPLICATE_CANONICAL_LEADS | 0 |
| ELIGIBILITY_ACCURACY | 100% |
| PARTNER_CUSTOMER_ACCURACY | 100% |
| RESPONSIBLE_MANAGER_ACCURACY | 100% |
| REQUIRED_CONTACT_FIELD_ACCURACY | 100% |
| HALLUCINATED_CONTACT_VALUES | 0 |
| AMBIGUOUS_CASE_ACCURACY | 100% |
| Identity precision | 100% |
| Identity recall | 100% |
| Identity F1 | 100% |
| Edge-case checks | 24/24 |

The perfect deterministic score is a measured result of the fixed synthetic ground truth against deterministic rules; it is not presented as an AI extraction score.

## Replay/idempotency

The exact second pass produced:

- duplicate messages: 0;
- duplicate memberships: 0;
- duplicate groups: 0;
- duplicate canonical leads: 0;
- duplicate CRM-intent equivalents: 0.

No evaluation CRM operation was sent to Bitrix.

## Live production facts (separate from evaluation)

The accepted production fixture was manually posted once to Teams. Railway Worker automatically detected it, grouped and extracted it, created an eligible canonical lead, generated the Russian summary, and synchronized one Bitrix lead. Teams source timestamp → successful Bitrix synchronization was **49.704 seconds**. Bitrix read-back and the additional polling-cycle idempotency check passed.

## Limitations

- These evaluation metrics cover deterministic behavior around fixed pre-derived evidence; they do not estimate general LLM accuracy.
- Outbound Teams feedback is blocked by supplied app-only authorization: `TEAMS_FEEDBACK_STATUS=BLOCKED_BY_APP_ONLY_SEND`.
- GitHub auto-deploy and the stale unapplied Railway UI patch remain optional operational cleanup; current WEB and WORKER runtime is healthy.
