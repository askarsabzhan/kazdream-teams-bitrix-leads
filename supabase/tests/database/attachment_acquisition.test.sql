begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(82);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.claim_teams_attachment_acquisition(integer,integer)',
    'execute'
  ),
  'anonymous role cannot claim attachment acquisition work'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_teams_attachment_acquisition(integer,integer)',
    'execute'
  ),
  'authenticated role cannot claim attachment acquisition work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_teams_attachment_acquisition(integer,integer)',
    'execute'
  ),
  'service role can claim attachment acquisition work'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.complete_teams_attachment_acquisition(uuid,uuid,text,text,bigint,text)',
    'execute'
  ),
  'anonymous role cannot complete attachment acquisition'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_teams_attachment_acquisition(uuid,uuid,text,text,bigint,text)',
    'execute'
  ),
  'authenticated role cannot complete attachment acquisition'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_teams_attachment_acquisition(uuid,uuid,text,text,bigint,text)',
    'execute'
  ),
  'service role can complete attachment acquisition'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.record_teams_attachment_acquisition_outcome(uuid,uuid,text,text)',
    'execute'
  ),
  'anonymous role cannot record attachment acquisition outcomes'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.record_teams_attachment_acquisition_outcome(uuid,uuid,text,text)',
    'execute'
  ),
  'authenticated role cannot record attachment acquisition outcomes'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_teams_attachment_acquisition_outcome(uuid,uuid,text,text)',
    'execute'
  ),
  'service role can record attachment acquisition outcomes'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    cross join lateral pg_catalog.aclexplode(
      function_definition.proacl
    ) as function_acl
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_teams_attachment_acquisition',
        'complete_teams_attachment_acquisition',
        'preserve_fetched_attachment_acquisition_metadata',
        'record_teams_attachment_acquisition_outcome'
      )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no attachment acquisition RPC execution privilege'
);

select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_teams_attachment_acquisition',
        'complete_teams_attachment_acquisition',
        'preserve_fetched_attachment_acquisition_metadata',
        'record_teams_attachment_acquisition_outcome'
      )
      and function_definition.prosecdef
  ),
  3::bigint,
  'all attachment acquisition RPCs are SECURITY DEFINER'
);

select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_teams_attachment_acquisition',
        'complete_teams_attachment_acquisition',
        'preserve_fetched_attachment_acquisition_metadata',
        'record_teams_attachment_acquisition_outcome'
      )
      and exists (
        select 1
        from unnest(function_definition.proconfig) as setting(value)
        where setting.value in ('search_path=', 'search_path=""')
      )
  ),
  4::bigint,
  'all attachment acquisition functions use an explicitly empty search_path'
);

select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.preserve_fetched_attachment_acquisition_metadata()',
    'execute'
  ),
  'service role cannot invoke the private fetched-metadata trigger helper'
);

select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.ingest_teams_message_core(jsonb,jsonb)',
    'execute'
  ),
  'service role cannot invoke the private ingestion core directly'
);

select extensions.ok(
  has_function_privilege(
    'postgres',
    function_definition.oid,
    'execute'
  ),
  format('postgres owner can execute %s', function_definition.proname)
)
from pg_catalog.pg_proc as function_definition
join pg_catalog.pg_namespace as function_schema
  on function_schema.oid = function_definition.pronamespace
where function_schema.nspname = 'public'
  and function_definition.proname in (
    'claim_teams_attachment_acquisition',
    'complete_teams_attachment_acquisition',
    'ingest_teams_message_core',
    'preserve_fetched_attachment_acquisition_metadata',
    'record_teams_attachment_acquisition_outcome'
  );

select extensions.ok(
  not has_table_privilege(
    'service_role',
    'public.attachments',
    'update'
  ),
  'service role retains no direct attachment UPDATE privilege'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.attachments',
    'update'
  ),
  'authenticated role has no direct attachment UPDATE privilege'
);

select extensions.is(
  has_table_privilege(
    privilege_expectation.role_name,
    'public.attachments',
    privilege_expectation.privilege_name
  ),
  privilege_expectation.expected,
  format(
    '%s attachment-table %s privilege matches the intended boundary',
    privilege_expectation.role_name,
    privilege_expectation.privilege_name
  )
)
from (
  values
    ('anon', 'SELECT', false),
    ('anon', 'INSERT', false),
    ('anon', 'UPDATE', false),
    ('anon', 'DELETE', false),
    ('anon', 'TRUNCATE', false),
    ('anon', 'REFERENCES', false),
    ('anon', 'TRIGGER', false),
    ('anon', 'MAINTAIN', false),
    ('authenticated', 'SELECT', true),
    ('authenticated', 'INSERT', false),
    ('authenticated', 'UPDATE', false),
    ('authenticated', 'DELETE', false),
    ('authenticated', 'TRUNCATE', false),
    ('authenticated', 'REFERENCES', false),
    ('authenticated', 'TRIGGER', false),
    ('authenticated', 'MAINTAIN', false),
    ('service_role', 'SELECT', true),
    ('service_role', 'INSERT', false),
    ('service_role', 'UPDATE', false),
    ('service_role', 'DELETE', false),
    ('service_role', 'TRUNCATE', false),
    ('service_role', 'REFERENCES', false),
    ('service_role', 'TRIGGER', false),
    ('service_role', 'MAINTAIN', false)
) as privilege_expectation(role_name, privilege_name, expected);

insert into public.teams_messages (
  id,
  source,
  tenant_id,
  team_id,
  channel_id,
  external_message_id,
  source_created_at,
  source_last_modified_at,
  source_fingerprint,
  observed_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  'microsoft_teams',
  'tenant-test',
  'team-test',
  'channel-test',
  'message-test',
  '2026-08-27T10:00:00Z',
  '2026-08-27T10:00:00Z',
  repeat('a', 64),
  '2026-08-27T10:01:00Z'
);

create temporary table acquisition_claims (
  run integer not null,
  attachment_id uuid,
  teams_message_id uuid,
  lease_id uuid,
  tenant_id text,
  team_id text,
  channel_id text,
  external_message_id text,
  root_external_message_id text,
  attachment_kind text,
  source_locator jsonb,
  declared_mime_type text,
  source_size_bytes bigint,
  fetch_attempts integer
) on commit drop;

create temporary table acquisition_transitions (
  attachment_id uuid,
  fetch_state text
) on commit drop;

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '11111111-1111-4111-8111-111111111111',
  'hosted:first',
  'hosted_content',
  '{"hosted_content_id":"first"}'::jsonb,
  '2026-08-27T10:02:00Z'
);

insert into acquisition_claims
select 1, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 1),
  1::bigint,
  'one worker claims the pending attachment'
);
select extensions.ok(
  (
    select fetch_state = 'downloading'
      and fetch_lease_id is not null
      and fetch_lease_expires_at > last_fetch_attempt_at
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'claim sets a bounded downloading lease'
);
select extensions.is(
  (
    select fetch_attempts
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  1,
  'first claim increments acquisition attempts'
);
select extensions.is(
  (
    select count(*)
    from public.claim_teams_attachment_acquisition(1, 300)
  ),
  0::bigint,
  'a concurrent worker cannot claim the leased attachment'
);

insert into acquisition_transitions
select *
from public.complete_teams_attachment_acquisition(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select lease_id from acquisition_claims where run = 1),
  'teams/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/'
    || repeat('b', 64),
  repeat('b', 64),
  68,
  'image/png'
);

select extensions.is(
  (select fetch_state from acquisition_transitions),
  'fetched',
  'success RPC returns the fetched state'
);
select extensions.ok(
  (
    select fetch_state = 'fetched'
      and sha256 = repeat('b', 64)
      and size_bytes = 68
      and mime_type = 'image/png'
      and acquired_at is not null
      and fetch_lease_id is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'success transition persists validated storage metadata and releases lease'
);

update public.attachments
set mime_type = null,
    size_bytes = 999
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select extensions.ok(
  (
    select mime_type = 'image/png'
      and size_bytes = 68
      and sha256 = repeat('b', 64)
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'later source metadata cannot overwrite validated fetched-byte metadata'
);

create temporary table acquisition_ingestion_replay (
  teams_message_id uuid,
  result text,
  content_revision integer,
  attachments_inserted integer,
  jobs_enqueued integer
) on commit drop;

insert into acquisition_ingestion_replay
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'message-test',
    'source_created_at', '2026-08-27T10:00:00Z',
    'source_last_modified_at', '2026-08-27T10:00:00Z',
    'source_fingerprint', repeat('f', 64),
    'observed_at', '2026-08-27T10:10:00Z'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'hosted:first',
      'attachment_kind', 'hosted_content',
      'source_locator', jsonb_build_object('hosted_content_id', 'first')
    )
  )
);

select extensions.is(
  (select result from acquisition_ingestion_replay),
  'unchanged',
  'Phase 3B replay stays unchanged after validated bytes are acquired'
);
select extensions.is(
  (select jobs_enqueued from acquisition_ingestion_replay),
  0,
  'Phase 3B replay does not enqueue work for acquisition-owned metadata'
);

select extensions.throws_ok(
  $$
    select *
    from public.complete_teams_attachment_acquisition(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '33333333-3333-4333-8333-333333333333',
      'teams/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/'
        || repeat('b', 64),
      repeat('b', 64),
      68,
      'image/png'
    )
  $$,
  'P0001',
  'Attachment acquisition completion transition was rejected.',
  'stored acquisition cannot be completed twice'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '11111111-1111-4111-8111-111111111111',
  'reference:retry',
  'reference',
  '{"attachment_id":"retry"}'::jsonb,
  '2026-08-27T10:03:00Z'
);

insert into acquisition_claims
select 2, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 2),
  1::bigint,
  'retry fixture is claimed once'
);

truncate acquisition_transitions;
insert into acquisition_transitions
select *
from public.record_teams_attachment_acquisition_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  (select lease_id from acquisition_claims where run = 2),
  'retryable_failed',
  'GRAPH_TEMPORARY_FAILURE'
);

select extensions.is(
  (select fetch_state from acquisition_transitions),
  'retryable_failed',
  'safe retryable failure transition is recorded'
);
select extensions.ok(
  (
    select fetch_state = 'retryable_failed'
      and last_error_code = 'GRAPH_TEMPORARY_FAILURE'
      and fetch_lease_id is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  ),
  'retryable failure releases the lease and stores only a safe code'
);

insert into acquisition_claims
select 3, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 3),
  1::bigint,
  'retryable failure can be claimed again'
);
select extensions.is(
  (select fetch_attempts from acquisition_claims where run = 3),
  2,
  'retry increments the durable attempt count'
);
select extensions.isnt(
  (select lease_id from acquisition_claims where run = 3),
  (select lease_id from acquisition_claims where run = 2),
  'retry receives a new lease token'
);

truncate acquisition_transitions;
insert into acquisition_transitions
select *
from public.record_teams_attachment_acquisition_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  (select lease_id from acquisition_claims where run = 3),
  'permanent_failed',
  'TEST_COMPLETE'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  '11111111-1111-4111-8111-111111111111',
  'reference:unsupported',
  'reference',
  '{"attachment_id":"unsupported"}'::jsonb,
  '2026-08-27T10:04:00Z'
);

insert into acquisition_claims
select 4, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 4),
  1::bigint,
  'unsupported fixture is claimed'
);

truncate acquisition_transitions;
insert into acquisition_transitions
select *
from public.record_teams_attachment_acquisition_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  (select lease_id from acquisition_claims where run = 4),
  'unsupported',
  'UNSUPPORTED_MIME'
);

select extensions.is(
  (select fetch_state from acquisition_transitions),
  'unsupported',
  'unsupported is a terminal non-retry state'
);
select extensions.is(
  (
    select count(*)
    from public.claim_teams_attachment_acquisition(1, 300)
  ),
  0::bigint,
  'unsupported attachment is not claimed forever'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  '11111111-1111-4111-8111-111111111111',
  'hosted:stale',
  'hosted_content',
  '{"hosted_content_id":"stale"}'::jsonb,
  '2026-08-27T10:05:00Z'
);

insert into acquisition_claims
select 5, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 5),
  1::bigint,
  'stale-lease fixture is initially claimed'
);

update public.attachments
set fetch_lease_expires_at = clock_timestamp() - interval '1 second'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

insert into acquisition_claims
select 6, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 6),
  1::bigint,
  'expired downloading lease is reclaimable'
);
select extensions.is(
  (select fetch_attempts from acquisition_claims where run = 6),
  2,
  'stale lease recovery increments attempts'
);
select extensions.isnt(
  (select lease_id from acquisition_claims where run = 6),
  (select lease_id from acquisition_claims where run = 5),
  'stale lease recovery invalidates the old worker token'
);

select extensions.throws_ok(
  $$
    select *
    from public.complete_teams_attachment_acquisition(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      (select lease_id from acquisition_claims where run = 5),
      'teams/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4/'
        || repeat('d', 64),
      repeat('d', 64),
      68,
      'image/png'
    )
  $$,
  'P0001',
  'Attachment acquisition completion transition was rejected.',
  'stale worker cannot complete after a new lease is issued'
);

select extensions.throws_ok(
  $$
    select *
    from public.record_teams_attachment_acquisition_outcome(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      (select lease_id from acquisition_claims where run = 5),
      'retryable_failed',
      'STALE_WORKER_FAILURE'
    )
  $$,
  'P0001',
  'Attachment acquisition outcome transition was rejected.',
  'stale worker cannot record failure after a new lease is issued'
);

truncate acquisition_transitions;
insert into acquisition_transitions
select *
from public.record_teams_attachment_acquisition_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  (select lease_id from acquisition_claims where run = 6),
  'permanent_failed',
  'TEST_COMPLETE'
);

select extensions.is(
  (
    select count(*)
    from public.claim_teams_attachment_acquisition(5, 300)
  ),
  0::bigint,
  'fetched, unsupported, and permanent failure states are all terminal'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  fetch_state,
  fetch_attempts,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
  '11111111-1111-4111-8111-111111111111',
  'reference:retry-limit',
  'reference',
  '{"attachment_id":"retry-limit"}'::jsonb,
  'retryable_failed',
  4,
  '2026-08-27T10:05:30Z'
);

insert into acquisition_claims
select 7, claimed.*
from public.claim_teams_attachment_acquisition(1, 300) as claimed;

select extensions.is(
  (select count(*) from acquisition_claims where run = 7),
  1::bigint,
  'the fifth and final acquisition attempt can be claimed'
);
select extensions.is(
  (select fetch_attempts from acquisition_claims where run = 7),
  5,
  'the durable attempt counter reaches the configured maximum'
);

truncate acquisition_transitions;
insert into acquisition_transitions
select *
from public.record_teams_attachment_acquisition_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
  (select lease_id from acquisition_claims where run = 7),
  'retryable_failed',
  'GRAPH_TEMPORARY_FAILURE'
);

select extensions.is(
  (select fetch_state from acquisition_transitions),
  'permanent_failed',
  'the fifth retryable failure becomes permanent'
);
select extensions.ok(
  (
    select fetch_state = 'permanent_failed'
      and last_error_code = 'RETRY_LIMIT_EXCEEDED'
      and fetch_lease_id is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'
  ),
  'retry exhaustion persists a safe terminal code and releases the lease'
);
select extensions.is(
  (
    select count(*)
    from public.claim_teams_attachment_acquisition(1, 300)
  ),
  0::bigint,
  'retry-exhausted attachment cannot be claimed again'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  fetch_state,
  fetch_attempts,
  fetch_lease_id,
  fetch_lease_expires_at,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
  '11111111-1111-4111-8111-111111111111',
  'hosted:retry-limit-stale',
  'hosted_content',
  '{"hosted_content_id":"retry-limit-stale"}'::jsonb,
  'downloading',
  5,
  '88888888-8888-4888-8888-888888888888',
  clock_timestamp() - interval '1 second',
  '2026-08-27T10:05:45Z'
);

select extensions.is(
  (
    select count(*)
    from public.claim_teams_attachment_acquisition(1, 300)
  ),
  0::bigint,
  'an expired fifth-attempt lease is terminalized instead of reclaimed'
);
select extensions.ok(
  (
    select fetch_state = 'permanent_failed'
      and last_error_code = 'RETRY_LIMIT_EXCEEDED'
      and fetch_lease_id is null
      and fetch_lease_expires_at is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'
  ),
  'crash on the fifth attempt converges to a safe terminal state'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  '11111111-1111-4111-8111-111111111111',
  'hosted:invalid',
  'hosted_content',
  '{"hosted_content_id":"invalid"}'::jsonb,
  '2026-08-27T10:06:00Z'
);

select extensions.throws_ok(
  $$
    select *
    from public.complete_teams_attachment_acquisition(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      '55555555-5555-4555-8555-555555555555',
      'teams/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5/'
        || repeat('c', 64),
      repeat('c', 64),
      68,
      'image/png'
    )
  $$,
  'P0001',
  'Attachment acquisition completion transition was rejected.',
  'completion rejects a row that was not claimed'
);

select extensions.throws_ok(
  $$
    select *
    from public.record_teams_attachment_acquisition_outcome(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      '55555555-5555-4555-8555-555555555555',
      'retryable_failed',
      'unsafe-code'
    )
  $$,
  '22023',
  'Attachment acquisition outcome is invalid.',
  'outcome rejects an unsafe error code'
);

select extensions.throws_ok(
  $$
    update public.attachments
    set fetch_state = 'downloading'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
  $$,
  '23514',
  null,
  'downloading state cannot exist without a lease'
);

select extensions.throws_ok(
  $$
    insert into public.attachments (
      id,
      teams_message_id,
      external_attachment_id,
      attachment_kind,
      source_locator,
      storage_path
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      '11111111-1111-4111-8111-111111111111',
      'hosted:path-collision',
      'hosted_content',
      '{"hosted_content_id":"path-collision"}'::jsonb,
      'teams/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/'
        || repeat('b', 64)
    )
  $$,
  '23505',
  null,
  'deterministic storage path cannot be assigned to two rows'
);

select * from extensions.finish();

rollback;
