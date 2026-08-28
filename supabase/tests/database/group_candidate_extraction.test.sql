begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(51);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.claim_lead_group_extractions(text,text,text,text,integer,integer)',
    'execute'
  ),
  'anonymous role cannot claim group extraction work'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_lead_group_extractions(text,text,text,text,integer,integer)',
    'execute'
  ),
  'authenticated role cannot claim group extraction work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_lead_group_extractions(text,text,text,text,integer,integer)',
    'execute'
  ),
  'service role can claim group extraction work'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.complete_lead_group_extraction(uuid,uuid,text,jsonb,text,text,jsonb,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'anonymous role cannot complete group extraction work'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_lead_group_extraction(uuid,uuid,text,jsonb,text,text,jsonb,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'authenticated role cannot complete group extraction work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_lead_group_extraction(uuid,uuid,text,jsonb,text,text,jsonb,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'service role can complete group extraction work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_lead_group_extraction_outcome(uuid,uuid,text,text,bigint)',
    'execute'
  ),
  'service role can record group extraction outcomes'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.load_lead_group_extraction_verification()',
    'execute'
  ),
  'service role can run protected group verification'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.load_lead_group_extraction_evidence(uuid)',
    'execute'
  ),
  'raw evidence loader remains private'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.lead_group_extraction_fingerprint(uuid,text,text,text,text)',
    'execute'
  ),
  'extraction fingerprint helper remains private'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_lead_group_extractions',
        'complete_lead_group_extraction',
        'record_lead_group_extraction_outcome',
        'load_lead_group_extraction_verification'
      )
      and function_definition.prosecdef
  ),
  4::bigint,
  'all worker-facing group extraction RPCs are security definer'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_lead_group_extractions',
        'complete_lead_group_extraction',
        'record_lead_group_extraction_outcome',
        'load_lead_group_extraction_verification'
      )
      and exists (
        select 1
        from unnest(function_definition.proconfig) as setting(value)
        where setting.value in ('search_path=', 'search_path=""')
      )
  ),
  4::bigint,
  'all worker-facing group extraction RPCs use an empty search path'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.lead_groups', 'update'),
  'service role cannot update extracted groups directly'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.field_evidence', 'insert'),
  'service role cannot insert group field evidence directly'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.processing_jobs', 'update'),
  'service role cannot mutate group jobs directly'
);
select extensions.is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_evidence'
      and column_name = 'lead_id'
  ),
  'YES',
  'field evidence no longer requires a premature canonical lead'
);
select extensions.is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'field_evidence'
      and column_name = 'lead_group_id'
  ),
  'YES',
  'field evidence has the minimal nullable group target'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    join pg_catalog.pg_roles as function_owner
      on function_owner.oid = function_definition.proowner
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_lead_group_extractions',
        'complete_lead_group_extraction',
        'record_lead_group_extraction_outcome',
        'load_lead_group_extraction_verification'
      )
      and function_owner.rolname = 'postgres'
  ),
  4::bigint,
  'postgres owns the worker-facing extraction RPCs'
);

insert into public.teams_messages (
  id,
  source,
  tenant_id,
  team_id,
  channel_id,
  external_message_id,
  author_teams_user_id,
  source_created_at,
  source_last_modified_at,
  body_content,
  source_fingerprint,
  observed_at,
  state,
  grouping_state,
  grouping_algorithm_version,
  grouping_source_fingerprint,
  grouping_reason,
  grouped_at
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    'microsoft_teams',
    'tenant-test',
    'team-test',
    'channel-test',
    'group-a-message',
    'manager-a',
    '2026-08-28T10:00:00Z',
    '2026-08-28T10:00:00Z',
    'Name: SYNTHETIC_A; Phone: +000 000 0000001',
    repeat('a', 64),
    '2026-08-28T10:01:00Z',
    'processed',
    'grouped',
    'v1',
    repeat('1', 64),
    'new_distinct_identity',
    '2026-08-28T10:02:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    'microsoft_teams',
    'tenant-test',
    'team-test',
    'channel-test',
    'ambiguous-message',
    'manager-a',
    '2026-08-28T10:03:00Z',
    '2026-08-28T10:03:00Z',
    'AMBIGUOUS_SYNTHETIC_SOURCE',
    repeat('b', 64),
    '2026-08-28T10:04:00Z',
    'processed',
    'ambiguous',
    'v1',
    repeat('2', 64),
    'ambiguous_unassigned',
    '2026-08-28T10:05:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    'microsoft_teams',
    'tenant-test',
    'team-test',
    'channel-test',
    'group-b-message',
    'manager-b',
    '2026-08-28T10:06:00Z',
    '2026-08-28T10:06:00Z',
    'Name: SYNTHETIC_B; Phone: +000 000 0000002',
    repeat('c', 64),
    '2026-08-28T10:07:00Z',
    'processed',
    'grouped',
    'v1',
    repeat('3', 64),
    'new_distinct_identity',
    '2026-08-28T10:08:00Z'
  );

insert into public.lead_groups (
  id,
  owner_teams_user_id,
  grouping_key,
  grouping_algorithm_version,
  grouping_revision
)
values
  (
    '51000000-0000-4000-8000-000000000001',
    'manager-a',
    'encounter:50000000-0000-4000-8000-000000000001',
    'v1',
    1
  ),
  (
    '51000000-0000-4000-8000-000000000002',
    'manager-b',
    'encounter:50000000-0000-4000-8000-000000000003',
    'v1',
    1
  );

insert into public.lead_group_messages (
  lead_group_id,
  teams_message_id,
  grouping_reason,
  grouping_score,
  grouping_algorithm_version,
  grouping_source_fingerprint
)
values
  (
    '51000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'new_distinct_identity',
    70,
    'v1',
    repeat('1', 64)
  ),
  (
    '51000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    'new_distinct_identity',
    70,
    'v1',
    repeat('3', 64)
  );

select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id in (
        '51000000-0000-4000-8000-000000000001',
        '51000000-0000-4000-8000-000000000002'
      )
  ),
  2::bigint,
  'each current group revision has exactly one backfill-equivalent job'
);

update public.lead_groups
set grouping_revision = grouping_revision
where id = '51000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000001'
      and content_revision = 1
  ),
  1::bigint,
  'grouping replay cannot duplicate the current group job'
);

select extensions.is(
  public.lead_group_extraction_fingerprint(
    '51000000-0000-4000-8000-000000000001',
    'openai',
    'gpt-4o-mini',
    'group-candidate-v1',
    'group-candidate-schema-v1'
  ),
  public.lead_group_extraction_fingerprint(
    '51000000-0000-4000-8000-000000000001',
    'openai',
    'gpt-4o-mini',
    'group-candidate-v1',
    'group-candidate-schema-v1'
  ),
  'same group evidence and versions produce the same extraction fingerprint'
);
select extensions.isnt(
  public.lead_group_extraction_fingerprint(
    '51000000-0000-4000-8000-000000000001',
    'openai',
    'gpt-4o-mini',
    'group-candidate-v1',
    'group-candidate-schema-v1'
  ),
  public.lead_group_extraction_fingerprint(
    '51000000-0000-4000-8000-000000000001',
    'openai',
    'gpt-4o-mini',
    'group-candidate-v2',
    'group-candidate-schema-v1'
  ),
  'prompt version changes the extraction fingerprint'
);

create temporary table extraction_claims as
select *
from public.claim_lead_group_extractions(
  'openai',
  'gpt-4o-mini',
  'group-candidate-v1',
  'group-candidate-schema-v1',
  1,
  300
);

select extensions.is(
  (select count(*) from extraction_claims),
  1::bigint,
  'one bounded claim leases one group'
);
select extensions.is(
  (
    select count(*)
    from public.claim_lead_group_extractions(
      'openai',
      'gpt-4o-mini',
      'group-candidate-v1',
      'group-candidate-schema-v1',
      1,
      300
    )
    where lead_group_id = '51000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a concurrent claim cannot lease the already processing group'
);

do $$
begin
  perform public.record_lead_group_extraction_outcome(
    '51000000-0000-4000-8000-000000000002',
    (
      select extraction_lease_id
      from public.lead_groups
      where id = '51000000-0000-4000-8000-000000000002'
    ),
    'retryable_failed',
    'OPENAI_TIMEOUT',
    1
  );
end;
$$;
select extensions.ok(
  (
    select jsonb_array_length(evidence_items) = 1
      and evidence_items -> 0 ->> 'evidence_id' = 'msg:1:text'
      and evidence_items -> 0 ->> 'teams_message_id' =
        '50000000-0000-4000-8000-000000000001'
    from extraction_claims
  ),
  'claim contains deterministic group-only evidence references'
);
select extensions.ok(
  not exists (
    select 1
    from public.load_lead_group_extraction_evidence(
      '51000000-0000-4000-8000-000000000001'
    )
    where teams_message_id = '50000000-0000-4000-8000-000000000002'
  ),
  'ambiguous raw messages are excluded from group extraction'
);

select extensions.throws_ok(
  $$
    select *
    from public.complete_lead_group_extraction(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000099',
      (select extraction_source_fingerprint from extraction_claims),
      jsonb_build_object(
        'campaign', jsonb_build_object(
          'exhibition', 'Hannover Messe 2026',
          'exhibitionBitrixId', 63,
          'source', 'EXHIBITION'
        )
      ),
      'eligible',
      null,
      '[]'::jsonb,
      1,
      1,
      1,
      2
    )
  $$,
  'P0001',
  'Lead group extraction completion transition was rejected.',
  'a wrong lease cannot complete group extraction'
);

create temporary table extraction_completions as
select *
from public.complete_lead_group_extraction(
  '51000000-0000-4000-8000-000000000001',
  (select lease_id from extraction_claims),
  (select extraction_source_fingerprint from extraction_claims),
  jsonb_build_object(
    'campaign', jsonb_build_object(
      'exhibition', 'Hannover Messe 2026',
      'exhibitionBitrixId', 63,
      'source', 'EXHIBITION'
    ),
    'eligibility', jsonb_build_object('state', 'eligible', 'reasonCode', null)
  ),
  'eligible',
  null,
  jsonb_build_array(
    jsonb_build_object(
      'field_name', 'phones',
      'value_json', jsonb_build_object('value', '+000 000 0000001'),
      'normalized_value', '+0000000000001',
      'evidence_ref_id', 'msg:1:text',
      'teams_message_id', '50000000-0000-4000-8000-000000000001',
      'attachment_id', null,
      'method', 'teams_text',
      'validation_status', 'accepted'
    )
  ),
  10,
  20,
  10,
  30
);

select extensions.ok(
  (
    select extraction_state = 'extracted' and field_evidence_inserted = 1
    from extraction_completions
  ),
  'fenced completion persists the candidate and evidence atomically'
);
select extensions.ok(
  (
    select extraction_state = 'extracted'
      and extraction_revision = 1
      and candidate_payload is not null
      and eligibility_state = 'eligible'
    from public.lead_groups
    where id = '51000000-0000-4000-8000-000000000001'
  ),
  'successful extraction persists current candidate metadata'
);
select extensions.ok(
  (
    select count(*) = 1
      and bool_and(evidence_text is null)
      and bool_and(teams_message_id = '50000000-0000-4000-8000-000000000001')
    from public.field_evidence
    where lead_group_id = '51000000-0000-4000-8000-000000000001'
      and extraction_revision = 1
  ),
  'group field evidence stores provenance without duplicating evidence text'
);
select extensions.is(
  (
    select status
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000001'
      and content_revision = 1
  ),
  'succeeded',
  'successful completion finishes the matching group job'
);
select extensions.is(
  (
    select count(*)
    from public.claim_lead_group_extractions(
      'openai',
      'gpt-4o-mini',
      'group-candidate-v1',
      'group-candidate-schema-v1',
      1,
      300
    )
    where lead_group_id = '51000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'same successful extraction identity is a no-op'
);

create temporary table duplicate_claims as
select *
from public.claim_lead_group_extractions(
  'openai',
  'gpt-4o-mini',
  'group-candidate-v2',
  'group-candidate-schema-v1',
  1,
  300
)
where lead_group_id = '51000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
    select *
    from public.complete_lead_group_extraction(
      '51000000-0000-4000-8000-000000000001',
      (select lease_id from duplicate_claims),
      (select extraction_source_fingerprint from duplicate_claims),
      jsonb_build_object(
        'campaign', jsonb_build_object(
          'exhibition', 'Hannover Messe 2026',
          'exhibitionBitrixId', 63,
          'source', 'EXHIBITION'
        )
      ),
      'eligible',
      null,
      jsonb_build_array(
        jsonb_build_object(
          'field_name', 'phones',
          'value_json', jsonb_build_object('value', '+000 000 0000001'),
          'normalized_value', '+0000000000001',
          'evidence_ref_id', 'msg:1:text',
          'teams_message_id', '50000000-0000-4000-8000-000000000001',
          'attachment_id', null,
          'method', 'teams_text',
          'validation_status', 'accepted'
        ),
        jsonb_build_object(
          'field_name', 'phones',
          'value_json', jsonb_build_object('value', '+000 000 0000001'),
          'normalized_value', '+0000000000001',
          'evidence_ref_id', 'msg:1:text',
          'teams_message_id', '50000000-0000-4000-8000-000000000001',
          'attachment_id', null,
          'method', 'teams_text',
          'validation_status', 'accepted'
        )
      ),
      1,
      null,
      null,
      null
    )
  $$,
  '23505',
  null,
  'database uniqueness rejects duplicate group evidence rows'
);

select *
from public.record_lead_group_extraction_outcome(
  '51000000-0000-4000-8000-000000000001',
  (select lease_id from duplicate_claims),
  'permanent_failed',
  'TEST_DUPLICATE_REJECTED',
  1
);

select extensions.ok(
  (
    select failed_group.extraction_state = 'permanent_failed'
      and failed_group.candidate_payload is not null
      and failed_group.extraction_revision = 1
      and failed_group.extraction_target_revision = 2
      and failed_group.candidate_source_fingerprint =
        (select extraction_source_fingerprint from extraction_claims)
      and failed_group.extraction_source_fingerprint =
        (select extraction_source_fingerprint from duplicate_claims)
      and failed_group.extraction_completed_at is not null
    from public.lead_groups as failed_group
    where failed_group.id = '51000000-0000-4000-8000-000000000001'
  ),
  'a failed new identity preserves the last successful candidate and its identity'
);

create temporary table second_claims as
select *
from public.claim_lead_group_extractions(
  'openai',
  'gpt-4o-mini',
  'group-candidate-v3',
  'group-candidate-schema-v1',
  1,
  300
)
where lead_group_id = '51000000-0000-4000-8000-000000000001';

select *
from public.complete_lead_group_extraction(
  '51000000-0000-4000-8000-000000000001',
  (select lease_id from second_claims),
  (select extraction_source_fingerprint from second_claims),
  jsonb_build_object(
    'campaign', jsonb_build_object(
      'exhibition', 'Hannover Messe 2026',
      'exhibitionBitrixId', 63,
      'source', 'EXHIBITION'
    )
  ),
  'eligible',
  null,
  '[]'::jsonb,
  1,
  null,
  null,
  null
);

select extensions.ok(
  (
    select extraction_revision = 2
      and extraction_state = 'extracted'
      and extraction_attempts = 1
    from public.lead_groups
    where id = '51000000-0000-4000-8000-000000000001'
  ),
  'controlled prompt reprocessing advances revision only after success'
);
select extensions.is(
  (
    select count(*)
    from public.field_evidence
    where lead_group_id = '51000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'historical evidence remains while an empty new evidence revision adds no duplicates'
);

do $$
declare
  v_claim record;
  v_iteration integer;
begin
  for v_iteration in 1..5 loop
    update public.processing_jobs
    set run_at = clock_timestamp()
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000002';

    select * into strict v_claim
    from public.claim_lead_group_extractions(
      'openai',
      'gpt-4o-mini',
      'group-candidate-v3',
      'group-candidate-schema-v1',
      10,
      300
    )
    where lead_group_id = '51000000-0000-4000-8000-000000000002';

    perform public.record_lead_group_extraction_outcome(
      v_claim.lead_group_id,
      v_claim.lease_id,
      'retryable_failed',
      'OPENAI_TIMEOUT',
      1
    );
  end loop;
end;
$$;

select extensions.ok(
  (
    select extraction_state = 'permanent_failed'
      and extraction_error_code = 'RETRY_LIMIT_EXCEEDED'
    from public.lead_groups
    where id = '51000000-0000-4000-8000-000000000002'
  ),
  'fifth retryable provider failure becomes terminal'
);
select extensions.is(
  (
    select extraction_attempts
    from public.lead_groups
    where id = '51000000-0000-4000-8000-000000000002'
  ),
  5,
  'durable group extraction attempts are bounded at five'
);
select extensions.is(
  (
    select count(*)
    from public.claim_lead_group_extractions(
      'openai',
      'gpt-4o-mini',
      'group-candidate-v3',
      'group-candidate-schema-v1',
      10,
      300
    )
    where lead_group_id = '51000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'terminal fifth-attempt identity cannot be claimed a sixth time'
);
select extensions.is(
  (
    select status
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000002'
      and content_revision = 1
  ),
  'permanent_failed',
  'retry exhaustion is reflected in the durable group job'
);

update public.lead_groups
set grouping_revision = grouping_revision + 1
where id = '51000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'a meaningful new group revision creates one historical-plus-current job pair'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where job_type = 'process_lead_group'
      and aggregate_id = '51000000-0000-4000-8000-000000000001'
      and content_revision = 2
  ),
  1::bigint,
  'new group revision has exactly one current job'
);

create temporary table revision_claims as
select *
from public.claim_lead_group_extractions(
  'openai',
  'gpt-4o-mini',
  'group-candidate-v3',
  'group-candidate-schema-v1',
  10,
  300
)
where lead_group_id = '51000000-0000-4000-8000-000000000001';

select extensions.ok(
  (
    select grouping_revision = 2
      and extraction_revision = 3
      and extraction_attempts = 1
    from revision_claims
  ),
  'new group revision creates a fresh extraction opportunity'
);
select extensions.isnt(
  (select extraction_source_fingerprint from revision_claims),
  (select extraction_source_fingerprint from second_claims),
  'group revision participates in extraction identity'
);

select *
from public.record_lead_group_extraction_outcome(
  '51000000-0000-4000-8000-000000000001',
  (select lease_id from revision_claims),
  'permanent_failed',
  'TEST_CLEANUP',
  1
);

select extensions.ok(
  (
    select failed_group.extraction_state = 'permanent_failed'
      and failed_group.candidate_payload is not null
      and failed_group.extraction_revision = 2
      and failed_group.extraction_target_revision = 3
      and failed_group.candidate_source_fingerprint =
        (select extraction_source_fingerprint from second_claims)
      and failed_group.extraction_source_fingerprint =
        (select extraction_source_fingerprint from revision_claims)
    from public.lead_groups as failed_group
    where failed_group.id = '51000000-0000-4000-8000-000000000001'
  ),
  'a failed grouping reassessment also preserves the last successful candidate revision'
);

select extensions.is(
  (select count(*) from public.leads),
  0::bigint,
  'Phase 4C extraction creates no canonical leads'
);
select extensions.ok(
  not exists (
    select 1
    from public.field_evidence
    where lead_group_id is not null
      and evidence_text is not null
  ),
  'group evidence never copies source text into provenance rows'
);
select extensions.ok(
  not exists (
    select 1
    from public.field_evidence
    where lead_group_id is not null
      and validation_status not in ('accepted', 'conflicted')
  ),
  'persisted group evidence uses only validated group statuses'
);
select extensions.is(
  (
    select count(*)
    from public.load_lead_group_extraction_verification()
  ),
  0::bigint,
  'verification excludes stale or failed extraction revisions'
);
select extensions.ok(
  (
    select candidate_payload is null
      and extraction_revision = 0
      and extraction_target_revision = 1
    from public.lead_groups
    where id = '51000000-0000-4000-8000-000000000002'
  ),
  'failed-only extraction does not advance the successful candidate revision'
);
select extensions.ok(
  (
    select count(*) = count(distinct (
      job_type,
      aggregate_type,
      aggregate_id,
      content_revision
    ))
    from public.processing_jobs
    where job_type = 'process_lead_group'
  ),
  'database uniqueness protects every group job identity'
);

select extensions.finish();

rollback;
