begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(25);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.resolve_canonical_lead_group(uuid,text,jsonb,text,text)',
    'execute'
  ),
  'service role can resolve canonical groups'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.resolve_canonical_lead_group(uuid,text,jsonb,text,text)',
    'execute'
  ),
  'anonymous role cannot resolve canonical groups'
);
select extensions.is(
  (select count(*) from public.campaigns where exhibition_key = 'hannover_messe_2026'),
  1::bigint,
  'the single authoritative test campaign exists'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_constraint as identity_constraint
    join pg_catalog.pg_class as identity_table
      on identity_table.oid = identity_constraint.conrelid
    join pg_catalog.pg_namespace as identity_schema
      on identity_schema.oid = identity_table.relnamespace
    where identity_schema.nspname = 'public'
      and identity_table.relname = 'lead_identity_keys'
      and identity_constraint.conname = 'lead_identity_keys_identity_unique'
      and identity_constraint.contype = 'u'
  ),
  1::bigint,
  'database uniqueness serializes competing claims for one normalized identity'
);
select extensions.ok(
  (
    select position('pg_advisory_xact_lock' in resolution_function.prosrc) > 0
    from pg_catalog.pg_proc as resolution_function
    join pg_catalog.pg_namespace as resolution_schema
      on resolution_schema.oid = resolution_function.pronamespace
    where resolution_schema.nspname = 'public'
      and resolution_function.proname = 'resolve_canonical_lead_group'
  ),
  'canonical resolution serializes concurrent workers before selecting or creating'
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
values
  ('81000000-0000-4000-8000-000000000001','tenant','team','channel','canonical-1','manager-a','2026-08-28T10:00:00Z','synthetic evidence 1','2026-08-28T10:00:00Z',repeat('1',64),'grouped','v1',repeat('1',64),'new_distinct_identity',now()),
  ('81000000-0000-4000-8000-000000000002','tenant','team','channel','canonical-2','manager-b','2026-08-28T10:05:00Z','synthetic evidence 2','2026-08-28T10:05:00Z',repeat('2',64),'grouped','v1',repeat('2',64),'new_distinct_identity',now()),
  ('81000000-0000-4000-8000-000000000003','tenant','team','channel','canonical-3','manager-c','2026-08-28T10:10:00Z','synthetic evidence 3','2026-08-28T10:10:00Z',repeat('3',64),'grouped','v1',repeat('3',64),'new_distinct_identity',now()),
  ('81000000-0000-4000-8000-000000000004','tenant','team','channel','canonical-4','manager-d','2026-08-28T10:15:00Z','synthetic evidence 4','2026-08-28T10:15:00Z',repeat('4',64),'grouped','v1',repeat('4',64),'new_distinct_identity',now()),
  ('81000000-0000-4000-8000-000000000005','tenant','team','channel','canonical-5','manager-e','2026-08-28T10:20:00Z','synthetic evidence 5','2026-08-28T10:20:00Z',repeat('5',64),'grouped','v1',repeat('5',64),'new_distinct_identity',now()),
  ('81000000-0000-4000-8000-000000000006','tenant','team','channel','canonical-6','manager-f','2026-08-28T10:25:00Z','synthetic evidence 6','2026-08-28T10:25:00Z',repeat('6',64),'grouped','v1',repeat('6',64),'new_distinct_identity',now());

insert into public.lead_groups (
  id,
  owner_teams_user_id,
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
  candidate_source_fingerprint
)
select
  ('82000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  'manager-' || number,
  'canonical-test-' || number,
  1,
  jsonb_build_object(
    'campaign', jsonb_build_object(
      'exhibition', 'Hannover Messe 2026',
      'exhibitionBitrixId', 63,
      'source', 'EXHIBITION'
    ),
    'eligibility', jsonb_build_object('state', 'eligible', 'reasonCode', null)
  ),
  'extracted',
  repeat(number::text, 64),
  'openai',
  'gpt-4o-mini',
  'group-candidate-v1',
  'group-candidate-schema-v1',
  1,
  1,
  1,
  1,
  now(),
  'eligible',
  repeat(number::text, 64)
from generate_series(1, 6) as series(number);

insert into public.lead_group_messages (lead_group_id, teams_message_id)
select
  ('82000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  ('81000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid
from generate_series(1, 6) as series(number);

create temporary table resolution_one as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000001',
  repeat('1',64),
  '[{"kind":"phone","normalized_value":"+495111000001"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);

select extensions.ok(
  (select lead_created and group_linked and resolution_state = 'linked' from resolution_one),
  'first eligible group creates and links one canonical lead'
);
select extensions.is((select count(*) from public.leads), 1::bigint, 'one canonical lead exists');
select extensions.is((select count(*) from public.lead_identity_keys), 1::bigint, 'first strong identity key is durable');

create temporary table composition_one as
select * from public.complete_canonical_lead_composition(
  (select lead_id from resolution_one),
  '{"person":{"fullName":{"value":"Synthetic Person"},"company":{"value":"Synthetic Company"},"jobTitle":{"value":null}},"phones":[{"value":"+49 511 1000001"}],"emails":[],"productInterests":[],"region":{"value":null},"priority":{"value":null},"leadType":{"value":"Customer"},"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}'::jsonb,
  '[{"kind":"phone","normalized_value":"+495111000001"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);

select extensions.ok(
  (select canonical_updated and canonical_revision = 1 from composition_one),
  'first composition populates canonical revision one'
);
select extensions.is(
  (select assigned_teams_user_id from public.leads where id = (select lead_id from resolution_one)),
  'manager-a',
  'first source author owns the lead'
);

create temporary table resolution_two as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000002',
  repeat('2',64),
  '[{"kind":"phone","normalized_value":"+495111000001"},{"kind":"phone","normalized_value":"+495112000002"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);

select extensions.ok(
  (
    select not lead_created
      and group_linked
      and lead_id = (select lead_id from resolution_one)
    from resolution_two
  ),
  'different manager with exact phone links to the same canonical lead'
);

create temporary table composition_two as
select * from public.complete_canonical_lead_composition(
  (select lead_id from resolution_one),
  '{"person":{"fullName":{"value":"Synthetic Person"},"company":{"value":"Synthetic Company"},"jobTitle":{"value":null}},"phones":[{"value":"+49 511 1000001"},{"value":"+49 511 2000002"}],"emails":[],"productInterests":[],"region":{"value":null},"priority":{"value":null},"leadType":{"value":"Customer"},"facts":[{"text":"new supported fact"}],"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}'::jsonb,
  '[{"kind":"phone","normalized_value":"+495111000001"},{"kind":"phone","normalized_value":"+495112000002"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);

select extensions.ok(
  (select canonical_updated and canonical_revision = 2 from composition_two),
  'second linked group enriches and increments canonical revision once'
);
select extensions.is(
  (select assigned_teams_user_id from public.leads where id = (select lead_id from resolution_one)),
  'manager-b',
  'latest actual source contributor becomes responsible'
);
select extensions.is(
  (select jsonb_array_length(phones) from public.leads where id = (select lead_id from resolution_one)),
  2,
  'multiple reliable phones remain preserved'
);

select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000002',
  repeat('2',64),
  '[{"kind":"phone","normalized_value":"+495111000001"},{"kind":"phone","normalized_value":"+495112000002"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);
create temporary table composition_replay as
select * from public.complete_canonical_lead_composition(
  (select lead_id from resolution_one),
  '{"person":{"fullName":{"value":"Synthetic Person"},"company":{"value":"Synthetic Company"},"jobTitle":{"value":null}},"phones":[{"value":"+49 511 1000001"},{"value":"+49 511 2000002"}],"emails":[],"productInterests":[],"region":{"value":null},"priority":{"value":null},"leadType":{"value":"Customer"},"facts":[{"text":"new supported fact"}],"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}'::jsonb,
  '[{"kind":"phone","normalized_value":"+495111000001"},{"kind":"phone","normalized_value":"+495112000002"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);
select extensions.ok(
  (select not canonical_updated and canonical_revision = 2 from composition_replay),
  'exact canonical replay is a revision no-op'
);
select extensions.is(
  (select count(*) from public.leads),
  1::bigint,
  'replay creates no duplicate canonical lead'
);

create temporary table resolution_three as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000003',
  repeat('3',64),
  '[{"kind":"phone","normalized_value":"+495113000003"},{"kind":"email","normalized_value":"person@example.corn"}]'::jsonb,
  'other person',
  'other company'
);
select * from public.complete_canonical_lead_composition(
  (select lead_id from resolution_three),
  '{"person":{"fullName":{"value":"Other Person"},"company":{"value":"Other Company"},"jobTitle":{"value":null}},"phones":[{"value":"+49 511 3000003"}],"emails":[{"value":"Person@Example.corn"}],"productInterests":[],"region":{"value":null},"priority":{"value":null},"leadType":{"value":"Partner"},"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}'::jsonb,
  '[{"kind":"phone","normalized_value":"+495113000003"},{"kind":"email","normalized_value":"person@example.corn"}]'::jsonb,
  'other person',
  'other company'
);
select extensions.is((select count(*) from public.leads), 2::bigint, 'distinct strong identity creates a second lead');

create temporary table collision_result as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000004',
  repeat('4',64),
  '[{"kind":"phone","normalized_value":"+495111000001"},{"kind":"email","normalized_value":"person@example.corn"}]'::jsonb,
  'collision person',
  'collision company'
);
select extensions.ok(
  (select resolution_state = 'identity_conflict' and lead_id is null from collision_result),
  'phone-to-A and email-to-B collision does not merge leads'
);
select extensions.is((select count(*) from public.leads), 2::bigint, 'identity collision creates no third lead');

create temporary table secondary_result as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000005',
  repeat('5',64),
  '[{"kind":"phone","normalized_value":"+495115000005"}]'::jsonb,
  'synthetic person',
  'synthetic company'
);
select extensions.is(
  (select lead_id from secondary_result),
  (select lead_id from resolution_one),
  'exact supported name and company provide a secondary match'
);

create temporary table email_result as
select * from public.resolve_canonical_lead_group(
  '82000000-0000-4000-8000-000000000006',
  repeat('6',64),
  '[{"kind":"phone","normalized_value":"+495116000006"},{"kind":"email","normalized_value":"person@example.corn"}]'::jsonb,
  'other person',
  'other company'
);
select extensions.is(
  (select lead_id from email_result),
  (select lead_id from resolution_three),
  'exact normalized email links to the existing lead without domain repair'
);

create temporary table summary_claims as
select * from public.claim_canonical_lead_summaries(
  'openai', 'gpt-4o-mini', 'canonical-summary-ru-v1', 10, 300
);
select extensions.is((select count(*) from summary_claims), 2::bigint, 'one summary is claimed per changed canonical lead');

select public.complete_canonical_lead_summary(
  lead_id,
  lease_id,
  source_fingerprint,
  'Краткий аналитический итог основан только на подтверждённых данных.',
  1,
  1,
  1,
  2
)
from summary_claims;

select extensions.is(
  (
    select count(*)
    from public.claim_canonical_lead_summaries(
      'openai', 'gpt-4o-mini', 'canonical-summary-ru-v1', 10, 300
    )
  ),
  0::bigint,
  'successful summary identity is not requested again'
);
select extensions.is(
  (
    select count(*)
    from (
      select kind, normalized_value
      from public.lead_identity_keys
      group by kind, normalized_value
      having count(*) > 1
    ) as duplicate_keys
  ),
  0::bigint,
  'database identity boundary contains no duplicate keys'
);
select extensions.is(
  (select count(*) from public.lead_groups where lead_id is not null),
  5::bigint,
  'five non-conflicting groups are linked to canonical leads'
);

select extensions.finish();

rollback;
