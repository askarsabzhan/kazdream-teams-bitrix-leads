begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(66);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.load_conversation_grouping_sources(integer)',
    'execute'
  ),
  'anonymous role cannot load grouping evidence'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.load_conversation_grouping_sources(integer)',
    'execute'
  ),
  'authenticated role cannot load grouping evidence'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.load_conversation_grouping_sources(integer)',
    'execute'
  ),
  'service role can load grouping evidence'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.apply_conversation_grouping(text,jsonb)',
    'execute'
  ),
  'anonymous role cannot persist grouping decisions'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_conversation_grouping(text,jsonb)',
    'execute'
  ),
  'authenticated role cannot persist grouping decisions'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.apply_conversation_grouping(text,jsonb)',
    'execute'
  ),
  'service role can persist grouping decisions'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.conversation_grouping_input_fingerprint(uuid)',
    'execute'
  ),
  'private grouping fingerprint helper is not exposed to service role'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'conversation_grouping_input_fingerprint',
        'load_conversation_grouping_sources',
        'apply_conversation_grouping'
      )
      and function_definition.prosecdef
  ),
  3::bigint,
  'all grouping functions are security definer'
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
        'conversation_grouping_input_fingerprint',
        'load_conversation_grouping_sources',
        'apply_conversation_grouping'
      )
      and function_owner.rolname = 'postgres'
  ),
  3::bigint,
  'postgres owns all grouping functions'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'conversation_grouping_input_fingerprint',
        'load_conversation_grouping_sources',
        'apply_conversation_grouping'
      )
      and exists (
        select 1
        from unnest(function_definition.proconfig) as setting(value)
        where setting.value in ('search_path=', 'search_path=""')
      )
  ),
  3::bigint,
  'all grouping functions use an empty search_path'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.lead_groups', 'update'),
  'service role cannot update conversation groups directly'
);
select extensions.ok(
  not has_table_privilege(
    'service_role',
    'public.lead_group_messages',
    'insert'
  ),
  'service role cannot insert memberships directly'
);
select extensions.is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_groups'
      and column_name = 'lead_id'
  ),
  'YES',
  'conversation groups can exist before canonical leads'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'lead_group_messages'
      and indexname = 'lead_group_messages_one_group_per_message_idx'
  ),
  1::bigint,
  'database has one-primary-group-per-message uniqueness'
);
select extensions.ok(
  (
    select position(
      'pg_advisory_xact_lock' in function_definition.prosrc
    ) > 0
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname = 'apply_conversation_grouping'
  ),
  'grouping persistence serializes concurrent workers with an advisory lock'
);

insert into public.teams_messages (
  id,
  source,
  tenant_id,
  team_id,
  channel_id,
  external_message_id,
  author_teams_user_id,
  reply_to_external_message_id,
  source_created_at,
  source_last_modified_at,
  body_content,
  source_fingerprint,
  observed_at
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'group-root', 'manager-a', null,
    '2026-08-27T12:00:00Z', '2026-08-27T12:00:00Z',
    'ROOT_PLACEHOLDER', repeat('1', 64), '2026-08-27T12:01:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'group-reply', 'manager-b', 'group-root',
    '2026-08-27T12:00:05Z', '2026-08-27T12:00:05Z',
    'REPLY_PLACEHOLDER', repeat('2', 64), '2026-08-27T12:01:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'group-late', 'manager-a', null,
    '2026-08-28T12:00:00Z', '2026-08-28T12:00:00Z',
    'LATE_PLACEHOLDER', repeat('3', 64), '2026-08-28T12:01:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'group-ambiguous', 'manager-a', null,
    '2026-08-27T12:01:00Z', '2026-08-27T12:01:00Z',
    'AMBIGUOUS_PLACEHOLDER', repeat('4', 64), '2026-08-27T12:02:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'group-deferred', 'manager-a', null,
    '2026-08-27T12:02:00Z', '2026-08-27T12:02:00Z',
    'DEFERRED_PLACEHOLDER', repeat('5', 64), '2026-08-27T12:03:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'reassign-source', 'manager-a', null,
    '2026-08-27T12:03:00Z', '2026-08-27T12:03:00Z',
    'REASSIGN_SOURCE_PLACEHOLDER', repeat('6', 64), '2026-08-27T12:04:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000007',
    'microsoft_teams', 'tenant-test', 'team-test', 'channel-test',
    'reassign-target', 'manager-a', null,
    '2026-08-27T12:04:00Z', '2026-08-27T12:04:00Z',
    'REASSIGN_TARGET_PLACEHOLDER', repeat('7', 64), '2026-08-27T12:05:00Z'
  );

insert into public.processing_jobs (
  job_type,
  aggregate_type,
  aggregate_id,
  content_revision
)
select
  'process_teams_message',
  'teams_message',
  source_message.id,
  source_message.content_revision
from public.teams_messages as source_message
where source_message.id::text like '40000000-0000-4000-8000-%';

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  fetch_state,
  processing_state,
  attachment_kind,
  source_locator,
  is_current
)
values (
  '41000000-0000-4000-8000-000000000005',
  '40000000-0000-4000-8000-000000000005',
  'pending-evidence',
  'pending',
  'pending',
  'reference',
  '{"drive_item_id":"PENDING_PLACEHOLDER"}'::jsonb,
  true
);

create function pg_temp.grouping_decision(
  p_message_id uuid,
  p_state text,
  p_group_key text,
  p_owner text,
  p_reason text,
  p_score integer
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'message_id', p_message_id,
    'source_fingerprint',
      public.conversation_grouping_input_fingerprint(p_message_id),
    'state', p_state,
    'group_key', p_group_key,
    'owner_teams_user_id', p_owner,
    'reason', p_reason,
    'score', p_score
  );
$$;

create temporary table grouping_results (
  run integer not null,
  groups_created integer,
  memberships_created integer,
  memberships_removed integer,
  revisions_created integer,
  ambiguous_count integer,
  deferred_count integer,
  unchanged_count integer
);

insert into grouping_results
select 1, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000001',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'new_distinct_identity',
      70
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000002',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'explicit_reply',
      100
    )
  )
) as result;

select extensions.is(
  (select groups_created from grouping_results where run = 1),
  1,
  'first grouping creates one deterministic group'
);
select extensions.is(
  (select memberships_created from grouping_results where run = 1),
  2,
  'first grouping creates root and reply memberships'
);
select extensions.is(
  (select revisions_created from grouping_results where run = 1),
  1,
  'new group creates exactly one group revision'
);
select extensions.is(
  (select count(*) from public.lead_group_messages),
  2::bigint,
  'root and reply have two unique memberships'
);
select extensions.is(
  (
    select count(distinct membership.lead_group_id)
    from public.lead_group_messages as membership
    where membership.teams_message_id in (
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'explicit root and reply resolve to the same group'
);
select extensions.ok(
  (
    select lead_id is null
      and not is_primary
      and grouping_revision = 1
    from public.lead_groups
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000001'
  ),
  'conversation group remains pre-lead with revision one'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where aggregate_id in (
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002'
    )
      and status = 'succeeded'
  ),
  2::bigint,
  'successful grouping completes current message jobs'
);

insert into grouping_results
select 2, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000003',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.is(
  (select groups_created from grouping_results where run = 2),
  0,
  'late strong evidence reuses the existing group'
);
select extensions.is(
  (select memberships_created from grouping_results where run = 2),
  1,
  'late strong evidence creates one membership'
);
select extensions.is(
  (select revisions_created from grouping_results where run = 2),
  1,
  'late membership increments the group revision once'
);
select extensions.ok(
  (
    select grouping_revision = 2
      and (
        select count(*)
        from public.lead_group_messages as membership
        where membership.lead_group_id = conversation_group.id
      ) = 3
    from public.lead_groups as conversation_group
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000001'
  ),
  'late content leaves one group with three memberships and revision two'
);

insert into grouping_results
select 3, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000001',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'new_distinct_identity',
      70
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000002',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'explicit_reply',
      100
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000003',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select groups_created = 0
      and memberships_created = 0
      and memberships_removed = 0
      and revisions_created = 0
    from grouping_results
    where run = 3
  ),
  'identical grouping replay creates no durable work'
);
select extensions.is(
  (select unchanged_count from grouping_results where run = 3),
  3,
  'identical grouping replay reports every message unchanged'
);

insert into grouping_results
select 4, result.*
from public.apply_conversation_grouping(
  'v2',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000001',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'new_distinct_identity',
      70
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000002',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'explicit_reply',
      100
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000003',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.is(
  (select revisions_created from grouping_results where run = 4),
  1,
  'algorithm version change triggers one group reassessment revision'
);
select extensions.ok(
  (
    select grouping_revision = 3
      and grouping_algorithm_version = 'v2'
      and not exists (
        select 1
        from public.lead_group_messages as membership
        where membership.lead_group_id = conversation_group.id
          and membership.grouping_algorithm_version <> 'v2'
      )
    from public.lead_groups as conversation_group
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000001'
  ),
  'algorithm reassessment updates group and membership versions atomically'
);

insert into grouping_results
select 5, result.*
from public.apply_conversation_grouping(
  'v2',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000001',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'new_distinct_identity',
      70
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000002',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'explicit_reply',
      100
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000003',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select revisions_created = 0 and unchanged_count = 3
    from grouping_results
    where run = 5
  ),
  'replay under the reassessed algorithm version is a no-op'
);

insert into public.lead_groups (
  owner_teams_user_id,
  grouping_key,
  grouping_algorithm_version,
  grouping_revision
)
values (
  'manager-a',
  'encounter:40000000-0000-4000-8000-000000000099',
  'v2',
  1
);

select extensions.throws_ok(
  $$
    insert into public.lead_group_messages (
      lead_group_id,
      teams_message_id,
      grouping_reason,
      grouping_score,
      grouping_algorithm_version,
      grouping_source_fingerprint
    )
    values (
      (
        select id from public.lead_groups
        where grouping_key =
          'encounter:40000000-0000-4000-8000-000000000099'
      ),
      '40000000-0000-4000-8000-000000000001',
      'exact_email',
      100,
      'v2',
      repeat('9', 64)
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "lead_group_messages_one_group_per_message_idx"',
  'one message cannot be inserted into a second primary group'
);

select extensions.throws_ok(
  $$
    select *
    from public.apply_conversation_grouping(
      'v1',
      jsonb_build_array(
        jsonb_build_object(
          'message_id', '40000000-0000-4000-8000-000000000004',
          'source_fingerprint', repeat('f', 64),
          'state', 'ambiguous',
          'group_key', null,
          'owner_teams_user_id', null,
          'reason', 'ambiguous_unassigned',
          'score', 0
        )
      )
    )
  $$,
  'P0001',
  'Conversation grouping source fingerprint is stale.',
  'stale source fingerprint cannot persist a grouping decision'
);

insert into grouping_results
select 6, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000004',
      'ambiguous', null, null, 'ambiguous_unassigned', 0
    )
  )
) as result;

select extensions.is(
  (select ambiguous_count from grouping_results where run = 6),
  1,
  'insufficient evidence persists an explicit ambiguous decision'
);
select extensions.ok(
  (
    select source_message.grouping_state = 'ambiguous'
      and not exists (
        select 1 from public.lead_group_messages as membership
        where membership.teams_message_id = source_message.id
      )
      and exists (
        select 1 from public.processing_jobs as job
        where job.aggregate_id = source_message.id
          and job.status = 'succeeded'
      )
    from public.teams_messages as source_message
    where source_message.id = '40000000-0000-4000-8000-000000000004'
  ),
  'ambiguous evaluation remains unassigned and completes message processing'
);

insert into grouping_results
select 7, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000004',
      'ambiguous', null, null, 'ambiguous_unassigned', 0
    )
  )
) as result;

select extensions.ok(
  (
    select unchanged_count = 1
      and groups_created = 0
      and revisions_created = 0
    from grouping_results
    where run = 7
  ),
  'ambiguous replay is idempotent'
);

insert into grouping_results
select 8, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000005',
      'deferred', null, null, 'evidence_pending', 0
    )
  )
) as result;

select extensions.is(
  (select deferred_count from grouping_results where run = 8),
  1,
  'non-terminal attachment evidence defers message grouping'
);
select extensions.ok(
  (
    select source_message.grouping_state = 'deferred'
      and job.status = 'retryable_failed'
      and job.attempts = 1
      and job.last_error_code = 'GROUPING_EVIDENCE_PENDING'
    from public.teams_messages as source_message
    join public.processing_jobs as job
      on job.aggregate_id = source_message.id
    where source_message.id = '40000000-0000-4000-8000-000000000005'
      and job.content_revision = source_message.content_revision
  ),
  'deferred grouping requeues the bounded current processing job'
);

insert into grouping_results
select 9, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000005',
      'deferred', null, null, 'evidence_pending', 0
    )
  )
) as result;

select extensions.is(
  (select unchanged_count from grouping_results where run = 9),
  1,
  'identical deferred replay is unchanged'
);
select extensions.is(
  (
    select attempts
    from public.processing_jobs
    where aggregate_id = '40000000-0000-4000-8000-000000000005'
      and content_revision = 1
  ),
  1,
  'identical deferred replay does not consume another bounded attempt'
);

update public.attachments
set fetch_state = 'downloading',
    fetch_lease_id = '42000000-0000-4000-8000-000000000005',
    fetch_lease_expires_at = clock_timestamp() + interval '5 minutes',
    fetch_attempts = 1
where id = '41000000-0000-4000-8000-000000000005';

select extensions.ok(
  not (
    select evidence_ready
    from public.load_conversation_grouping_sources(100)
    where message_id = '40000000-0000-4000-8000-000000000005'
  ),
  'lease-bound downloading evidence remains deferred'
);

insert into grouping_results
select 10, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000005',
      'deferred', null, null, 'evidence_pending', 0
    )
  )
) as result;

select extensions.ok(
  (
    select unchanged_count = 1 and revisions_created = 0
    from grouping_results
    where run = 10
  ),
  'pending to downloading is the same active grouping evidence state'
);
select extensions.is(
  (
    select attempts
    from public.processing_jobs
    where aggregate_id = '40000000-0000-4000-8000-000000000005'
      and content_revision = 1
  ),
  1,
  'downloading replay does not consume another grouping wait attempt'
);

update public.attachments
set fetch_state = 'permanent_failed',
    fetch_lease_id = null,
    fetch_lease_expires_at = null,
    last_error_code = 'TEST_TERMINAL_UNAVAILABLE'
where id = '41000000-0000-4000-8000-000000000005';

select extensions.ok(
  (
    select evidence_ready
    from public.load_conversation_grouping_sources(100)
    where message_id = '40000000-0000-4000-8000-000000000005'
  ),
  'terminal unavailable evidence no longer defers grouping'
);

insert into grouping_results
select 11, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000005',
      'ambiguous', null, null, 'ambiguous_unassigned', 0
    )
  )
) as result;

select extensions.is(
  (select ambiguous_count from grouping_results where run = 11),
  1,
  'terminal evidence causes deferred grouping to be reconsidered'
);
select extensions.ok(
  (
    select source_message.grouping_state = 'ambiguous'
      and job.status = 'succeeded'
    from public.teams_messages as source_message
    join public.processing_jobs as job
      on job.aggregate_id = source_message.id
      and job.content_revision = source_message.content_revision
    where source_message.id = '40000000-0000-4000-8000-000000000005'
  ),
  'reconsidered terminal evidence reaches a valid current outcome'
);

create temporary table grouping_fingerprint_snapshots (
  label text primary key,
  fingerprint text not null
);

insert into grouping_fingerprint_snapshots
values (
  'ambiguous_before_evidence',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  file_name,
  mime_type,
  size_bytes,
  sha256,
  storage_path,
  fetch_state,
  processing_state,
  transcript_text,
  provider_name,
  provider_model,
  processed_at,
  attachment_kind,
  source_locator,
  is_current,
  acquired_at,
  processing_operation,
  processing_source_sha256,
  processing_prompt_version,
  processing_revision
)
values (
  '41000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000004',
  'processed-evidence',
  'PLACEHOLDER_AUDIO',
  'audio/mpeg',
  1,
  repeat('a', 64),
  'teams/placeholder/processed-evidence',
  'fetched',
  'processed',
  'unit@example.invalid',
  'placeholder-provider',
  'placeholder-model-v1',
  '2026-08-27T12:10:00Z',
  'reference',
  '{"drive_item_id":"PROCESSED_PLACEHOLDER"}'::jsonb,
  true,
  '2026-08-27T12:09:00Z',
  'transcription',
  repeat('a', 64),
  'grouping-test-v1',
  1
);

insert into grouping_fingerprint_snapshots
values (
  'ambiguous_after_evidence',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

select extensions.isnt(
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'ambiguous_before_evidence'
  ),
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'ambiguous_after_evidence'
  ),
  'newly available processed evidence changes the grouping fingerprint'
);
select extensions.ok(
  (
    select evidence_ready
      and attachments -> 0 ->> 'transcript_text' is not null
    from public.load_conversation_grouping_sources(100)
    where message_id = '40000000-0000-4000-8000-000000000004'
  ),
  'source loader exposes only the newly successful transcript evidence'
);
select extensions.ok(
  (
    select status = 'succeeded'
    from public.processing_jobs
    where aggregate_id = '40000000-0000-4000-8000-000000000004'
      and content_revision = 1
  ),
  'the old ambiguous processing job is already complete before reassessment'
);

insert into grouping_results
select 12, result.*
from public.apply_conversation_grouping(
  'v2',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000004',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select memberships_created = 1 and revisions_created = 1
    from grouping_results
    where run = 12
  ),
  'new evidence reassigns a formerly ambiguous message exactly once'
);
select extensions.ok(
  (
    select source_message.grouping_state = 'grouped'
      and conversation_group.grouping_revision = 4
      and job.status = 'succeeded'
    from public.teams_messages as source_message
    join public.lead_group_messages as membership
      on membership.teams_message_id = source_message.id
    join public.lead_groups as conversation_group
      on conversation_group.id = membership.lead_group_id
    join public.processing_jobs as job
      on job.aggregate_id = source_message.id
      and job.content_revision = source_message.content_revision
    where source_message.id = '40000000-0000-4000-8000-000000000004'
  ),
  'completed old job does not block ambiguous evidence reassessment'
);

insert into grouping_fingerprint_snapshots
values (
  'before_irrelevant_provider_metadata',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

update public.attachments
set provider_model = 'placeholder-model-v2'
where id = '41000000-0000-4000-8000-000000000004';

insert into grouping_fingerprint_snapshots
values (
  'after_irrelevant_provider_metadata',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

select extensions.is(
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'before_irrelevant_provider_metadata'
  ),
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'after_irrelevant_provider_metadata'
  ),
  'provider metadata without evidence-text change is grouping-irrelevant'
);

insert into grouping_results
select 13, result.*
from public.apply_conversation_grouping(
  'v2',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000004',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select unchanged_count = 1 and revisions_created = 0
    from grouping_results
    where run = 13
  ),
  'irrelevant provider metadata creates no group revision'
);

insert into grouping_fingerprint_snapshots
values (
  'before_source_revision',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

update public.teams_messages
set content_revision = 2,
    source_last_modified_at = source_last_modified_at + interval '1 minute'
where id = '40000000-0000-4000-8000-000000000004';

insert into public.processing_jobs (
  job_type,
  aggregate_type,
  aggregate_id,
  content_revision
)
values (
  'process_teams_message',
  'teams_message',
  '40000000-0000-4000-8000-000000000004',
  2
);

insert into grouping_fingerprint_snapshots
values (
  'after_source_revision',
  public.conversation_grouping_input_fingerprint(
    '40000000-0000-4000-8000-000000000004'
  )
);

select extensions.isnt(
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'before_source_revision'
  ),
  (
    select fingerprint from grouping_fingerprint_snapshots
    where label = 'after_source_revision'
  ),
  'new Teams source revision changes the grouping fingerprint'
);
select extensions.ok(
  (
    select count(*) = 2
      and count(*) filter (where status = 'succeeded') = 1
      and count(*) filter (where status = 'pending') = 1
    from public.processing_jobs
    where aggregate_id = '40000000-0000-4000-8000-000000000004'
  ),
  'new source revision has one fresh job beside completed history'
);

insert into grouping_results
select 14, result.*
from public.apply_conversation_grouping(
  'v2',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000004',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000001',
      'manager-a',
      'exact_email',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select revisions_created = 1
      and (
        select status = 'succeeded'
        from public.processing_jobs
        where aggregate_id = '40000000-0000-4000-8000-000000000004'
          and content_revision = 2
      )
    from grouping_results
    where run = 14
  ),
  'source revision reassessment completes its fresh job exactly once'
);
select extensions.is(
  (
    select grouping_revision
    from public.lead_groups
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000001'
  ),
  5,
  'source revision changes the persisted group revision once'
);

insert into grouping_results
select 15, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000006',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000006',
      'manager-a',
      'new_distinct_identity',
      70
    ),
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000007',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000007',
      'manager-a',
      'new_distinct_identity',
      70
    )
  )
) as result;

select extensions.ok(
  (
    select groups_created = 2
      and memberships_created = 2
      and revisions_created = 2
      and (
        select count(*)
        from public.lead_groups
        where grouping_key in (
          'encounter:40000000-0000-4000-8000-000000000006',
          'encounter:40000000-0000-4000-8000-000000000007'
        )
          and grouping_revision = 1
      ) = 2
    from grouping_results
    where run = 15
  ),
  'new singleton groups each start at revision one'
);

insert into grouping_results
select 16, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000006',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000007',
      'manager-a',
      'exact_phone',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select groups_created = 0
      and memberships_created = 1
      and memberships_removed = 1
      and revisions_created = 1
    from grouping_results
    where run = 16
  ),
  'reassignment changes target revision exactly once'
);
select extensions.is(
  (
    select count(*)
    from public.lead_groups
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'reassignment removes the now-empty pre-lead source group'
);
select extensions.ok(
  (
    select grouping_revision = 2
      and owner_teams_user_id = 'manager-a'
      and (
        select count(*)
        from public.lead_group_messages as membership
        where membership.lead_group_id = conversation_group.id
      ) = 2
    from public.lead_groups as conversation_group
    where grouping_key =
      'encounter:40000000-0000-4000-8000-000000000007'
  ),
  'reassignment leaves one owner-consistent target at revision two'
);

insert into grouping_results
select 17, result.*
from public.apply_conversation_grouping(
  'v1',
  jsonb_build_array(
    pg_temp.grouping_decision(
      '40000000-0000-4000-8000-000000000006',
      'grouped',
      'encounter:40000000-0000-4000-8000-000000000007',
      'manager-a',
      'exact_phone',
      100
    )
  )
) as result;

select extensions.ok(
  (
    select unchanged_count = 1 and revisions_created = 0
    from grouping_results
    where run = 17
  ),
  'reassignment replay is a revision no-op'
);
select extensions.ok(
  not exists (
    select 1
    from public.lead_group_messages as membership
    join public.lead_groups as conversation_group
      on conversation_group.id = membership.lead_group_id
    join public.teams_messages as source_message
      on source_message.id = membership.teams_message_id
    where source_message.reply_to_external_message_id is null
      and source_message.author_teams_user_id
        is distinct from conversation_group.owner_teams_user_id
  ),
  'independent root memberships remain owner-consistent'
);

select extensions.throws_ok(
  $$
    select *
    from public.apply_conversation_grouping(
      'v1',
      jsonb_build_array(
        pg_temp.grouping_decision(
          '40000000-0000-4000-8000-000000000004',
          'ambiguous', null, null, 'ambiguous_unassigned', 0
        ),
        pg_temp.grouping_decision(
          '40000000-0000-4000-8000-000000000004',
          'ambiguous', null, null, 'ambiguous_unassigned', 0
        )
      )
    )
  $$,
  '22023',
  'Conversation grouping batch contains duplicate messages.',
  'one transaction rejects duplicate decisions for the same message'
);

select extensions.is(
  (select count(*) from public.load_conversation_grouping_sources(100)),
  7::bigint,
  'source loader returns the bounded seven-message fixture'
);
select extensions.ok(
  (
    select evidence_ready
    from public.load_conversation_grouping_sources(100)
    where message_id = '40000000-0000-4000-8000-000000000005'
  ),
  'source loader does not leave terminal unavailable evidence deferred'
);

select extensions.finish();

rollback;
