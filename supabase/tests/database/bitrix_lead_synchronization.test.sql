begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  has_function_privilege('service_role', 'public.claim_crm_sync_outbox(text,integer,integer)', 'execute'),
  'service role can claim CRM outbox work'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.claim_crm_sync_outbox(text,integer,integer)', 'execute'),
  'anonymous callers cannot claim CRM outbox work'
);

insert into public.leads (
  id,
  campaign_id,
  title,
  assigned_teams_user_id,
  status,
  canonical_payload,
  canonical_source_fingerprint,
  summary_state,
  summary_ru
)
values (
  '91000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000063',
  'Synthetic canonical lead',
  'manager-aad-1',
  'validated',
  '{"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}',
  repeat('1', 64),
  'pending',
  'Синтетическое аналитическое резюме для проверки CRM синхронизации.'
);

insert into public.teams_messages (
  id,
  tenant_id,
  team_id,
  channel_id,
  external_message_id,
  author_teams_user_id,
  source_created_at,
  body_content,
  source_last_modified_at,
  source_fingerprint,
  grouping_state,
  grouping_algorithm_version,
  grouping_source_fingerprint,
  grouping_reason,
  grouped_at
)
values (
  '92000000-0000-4000-8000-000000000001',
  'tenant', 'team', 'channel', 'synthetic-crm-message-1', 'manager-aad-1',
  '2026-08-28T10:00:00Z', 'synthetic manager source', '2026-08-28T10:00:00Z',
  repeat('2', 64), 'grouped', 'v1', repeat('2', 64), 'new_distinct_identity', now()
);

insert into public.lead_groups (
  id,
  owner_teams_user_id,
  lead_id,
  is_primary,
  status,
  grouping_key,
  grouping_revision,
  candidate_payload,
  extraction_state,
  extraction_source_fingerprint,
  extraction_provider,
  extraction_model,
  extraction_prompt_version,
  extraction_schema_version,
  extraction_grouping_revision,
  extraction_revision,
  extraction_target_revision,
  extraction_attempts,
  extraction_completed_at,
  eligibility_state,
  candidate_source_fingerprint,
  canonicalization_state,
  canonicalization_source_fingerprint,
  canonicalized_at
)
values (
  '93000000-0000-4000-8000-000000000001',
  'manager-aad-1',
  '91000000-0000-4000-8000-000000000001',
  true,
  'deduplicated',
  'synthetic-crm-group-1',
  1,
  '{"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"},"eligibility":{"state":"eligible","reasonCode":null}}',
  'extracted', repeat('3', 64), 'openai', 'gpt-4o-mini', 'prompt-v1', 'schema-v2',
  1, 1, 1, 1, now(), 'eligible', repeat('3', 64), 'linked', repeat('3', 64), now()
);

insert into public.lead_group_messages (lead_group_id, teams_message_id, grouping_reason)
values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'new_distinct_identity'
);

update public.leads
set summary_state = 'succeeded', summary_completed_at = now()
where id = '91000000-0000-4000-8000-000000000001';

select extensions.is(
  (select bitrix_source_group_id from public.leads where id = '91000000-0000-4000-8000-000000000001'),
  '93000000-0000-4000-8000-000000000001'::uuid,
  'the first linked source group becomes the immutable remote identity'
);
select extensions.is(
  (select count(*) from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint,
  'successful canonical summary enqueues one CRM sync operation'
);
select extensions.is(
  (select max_attempts from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001'),
  5,
  'CRM delivery is bounded to five durable attempts'
);

update public.leads
set summary_completed_at = summary_completed_at
where id = '91000000-0000-4000-8000-000000000001';
select extensions.is(
  (select count(*) from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint,
  'replaying the same canonical revision creates no duplicate outbox row'
);

select extensions.throws_ok(
  $$
    update public.leads
    set bitrix_source_group_id = '93000000-0000-4000-8000-000000000099'
    where id = '91000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'The immutable Bitrix source group cannot be changed.',
  'the remote creation identity cannot change after selection'
);

set local role service_role;
create temporary table first_claim as
select * from public.claim_crm_sync_outbox('phase5-test-worker', 10, 300);
reset role;

select extensions.is((select count(*) from first_claim), 1::bigint, 'one current outbox row is claimed');
select extensions.is((select attempts from first_claim), 1, 'claim increments the durable attempt exactly once');

set local role service_role;
create temporary table concurrent_claim as
select * from public.claim_crm_sync_outbox('phase5-concurrent-worker', 10, 300);
reset role;
select extensions.is((select count(*) from concurrent_claim), 0::bigint, 'an active fenced lease cannot be claimed concurrently');

select public.persist_crm_manager_mapping('manager-aad-1', 'manager@example.test', 501);
select public.persist_crm_manager_mapping('manager-aad-1', 'manager@example.test', 501);
select extensions.is(
  (select count(*) from public.manager_mappings where teams_user_id = 'manager-aad-1' and is_active),
  1::bigint,
  'exact manager mapping is persisted and replay-safe'
);

select public.complete_crm_lead_delivery(
  (select outbox_id from first_claim),
  (select lease_id from first_claim),
  901,
  'created'
);
select extensions.is(
  (select bitrix_lead_id from public.leads where id = '91000000-0000-4000-8000-000000000001'),
  901::bigint,
  'Bitrix lead ID is durably bound before source comment completion'
);

select public.complete_crm_sync_outbox(
  (select outbox_id from first_claim),
  (select lease_id from first_claim),
  1001,
  25
);
select extensions.is(
  (select crm_status from public.leads where id = '91000000-0000-4000-8000-000000000001'),
  'succeeded',
  'fenced completion marks the canonical lead synced'
);
select extensions.is(
  (select source_comment_state from public.crm_outbox where id = (select outbox_id from first_claim)),
  'succeeded',
  'source timeline comment confirmation is durable and separate'
);

set local role service_role;
create temporary table synced_replay_claim as
select * from public.claim_crm_sync_outbox('phase5-replay-worker', 10, 300);
reset role;
select extensions.is(
  (select count(*) from synced_replay_claim),
  0::bigint,
  'a synced lead and source comment are not intentionally delivered again'
);

update public.leads
set revision = 2,
    canonical_payload = canonical_payload || '{"late":"supported"}'::jsonb,
    summary_state = 'pending'
where id = '91000000-0000-4000-8000-000000000001';
update public.leads
set summary_state = 'succeeded',
    summary_completed_at = now()
where id = '91000000-0000-4000-8000-000000000001';

select extensions.is(
  (select count(*) from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001'),
  2::bigint,
  'a meaningful new canonical revision creates one new CRM sync operation'
);

set local role service_role;
create temporary table second_claim as
select * from public.claim_crm_sync_outbox('phase5-block-worker', 10, 300);
reset role;
select public.record_crm_sync_outcome(
  (select outbox_id from second_claim),
  (select lease_id from second_claim),
  'blocked',
  'MANAGER_MAPPING_MISSING',
  10,
  60
);
select extensions.is(
  (select status from public.crm_outbox where id = (select outbox_id from second_claim)),
  'blocked',
  'missing manager mapping blocks rather than assigning a fallback user'
);
select extensions.is(
  (select crm_status from public.leads where id = '91000000-0000-4000-8000-000000000001'),
  'blocked',
  'blocked manager mapping is reflected on local CRM sync state'
);

update public.leads
set revision = 3,
    canonical_payload = canonical_payload || '{"later":"supported"}'::jsonb,
    summary_state = 'pending'
where id = '91000000-0000-4000-8000-000000000001';
update public.leads
set summary_state = 'succeeded',
    summary_completed_at = now()
where id = '91000000-0000-4000-8000-000000000001';

do $$
declare
  claimed record;
  attempt_number integer;
begin
  for attempt_number in 1..5 loop
    select * into claimed
    from public.claim_crm_sync_outbox('phase5-retry-worker', 1, 300);
    perform public.record_crm_sync_outcome(
      claimed.outbox_id,
      claimed.lease_id,
      'retryable_failed',
      'BITRIX_RATE_OR_TRANSIENT',
      5,
      1
    );
    update public.crm_outbox
    set run_at = clock_timestamp()
    where id = claimed.outbox_id;
  end loop;
end;
$$;

select extensions.is(
  (select attempts from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001' and lead_revision = 3),
  5,
  'retry accounting stops at five durable attempts'
);
select extensions.is(
  (select status from public.crm_outbox where lead_id = '91000000-0000-4000-8000-000000000001' and lead_revision = 3),
  'permanent_failed',
  'the fifth retryable failure becomes terminal'
);

select extensions.finish();
rollback;
