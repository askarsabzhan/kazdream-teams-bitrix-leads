begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(59);

select extensions.is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teams_messages'
      and column_name = 'author_teams_user_id'
  ),
  'YES',
  'raw Teams author is nullable'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.ingest_teams_message(jsonb,jsonb)',
    'execute'
  ),
  'anonymous role cannot execute ingestion RPC'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.ingest_teams_message(jsonb,jsonb)',
    'execute'
  ),
  'authenticated role cannot execute ingestion RPC'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.ingest_teams_message(jsonb,jsonb)',
    'execute'
  ),
  'service role can execute ingestion RPC'
);

select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.ingest_teams_message_core(jsonb,jsonb)',
    'execute'
  ),
  'service role cannot bypass the timestamp guard through the core RPC'
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
        'ingest_teams_message',
        'ingest_teams_message_core'
      )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no ingestion function execution privilege'
);

select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'ingest_teams_message',
        'ingest_teams_message_core'
      )
      and function_definition.prosecdef
  ),
  2::bigint,
  'both ingestion functions are SECURITY DEFINER'
);

select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'ingest_teams_message',
        'ingest_teams_message_core'
      )
      and exists (
        select 1
        from unnest(function_definition.proconfig) as setting(value)
        where setting.value in ('search_path=', 'search_path=""')
      )
  ),
  2::bigint,
  'both ingestion functions use an explicitly empty search_path'
);

select extensions.ok(
  has_table_privilege('service_role', 'public.teams_messages', 'select'),
  'service role can verify persisted Teams messages'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.attachments', 'select'),
  'service role can verify persisted attachment metadata'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.processing_jobs', 'select'),
  'service role can verify persisted processing jobs'
);

select extensions.ok(
  not exists (
    select 1
    from (
      values
        ('public.teams_messages'),
        ('public.attachments'),
        ('public.processing_jobs')
    ) as protected_table(name)
    cross join (
      values
        ('insert'),
        ('update'),
        ('delete'),
        ('truncate'),
        ('references'),
        ('trigger'),
        ('maintain')
    ) as unnecessary_privilege(name)
    where has_table_privilege(
      'service_role',
      protected_table.name,
      unnecessary_privilege.name
    )
  ),
  'service role has no direct ingestion-table privilege beyond SELECT'
);

select extensions.ok(
  not exists (
    select 1
    from (
      values
        ('public.teams_messages'),
        ('public.attachments'),
        ('public.processing_jobs')
    ) as protected_table(name)
    cross join (
      values
        ('select'),
        ('insert'),
        ('update'),
        ('delete'),
        ('truncate'),
        ('references'),
        ('trigger'),
        ('maintain')
    ) as table_privilege(name)
    where has_table_privilege(
      'anon',
      protected_table.name,
      table_privilege.name
    )
  ),
  'anonymous role has no direct ingestion-table access'
);

select extensions.ok(
  not exists (
    select 1
    from (
      values
        ('public.teams_messages'),
        ('public.attachments'),
        ('public.processing_jobs')
    ) as protected_table(name)
    cross join (
      values
        ('insert'),
        ('update'),
        ('delete'),
        ('truncate'),
        ('references'),
        ('trigger'),
        ('maintain')
    ) as write_privilege(name)
    where has_table_privilege(
      'authenticated',
      protected_table.name,
      write_privilege.name
    )
  ),
  'authenticated role has no direct ingestion-table write privilege'
);

create temporary table test_ingestion_result (
  teams_message_id uuid,
  result text,
  content_revision integer,
  attachments_inserted integer,
  jobs_enqueued integer
) on commit drop;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'root-message',
    'author_teams_user_id', 'author-test',
    'reply_to_external_message_id', null,
    'source_created_at', '2026-08-27T07:00:00Z',
    'source_last_modified_at', '2026-08-27T07:01:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'verbatim source',
    'source_web_url', null,
    'source_fingerprint', repeat('a', 64),
    'observed_at', '2026-08-27T08:00:00Z',
    'is_bot', false,
    'is_service_message', false
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'hosted:one',
      'attachment_kind', 'hosted_content',
      'source_content_type', 'chatMessageHostedContent',
      'source_locator', jsonb_build_object('hosted_content_id', 'one')
    ),
    jsonb_build_object(
      'external_attachment_id', 'reference:two',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'file_name', 'fixture.bin',
      'source_locator', jsonb_build_object('attachment_id', 'two')
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'inserted',
  'first observation inserts the message'
);
select extensions.is(
  (select content_revision from test_ingestion_result),
  1,
  'first observation starts at revision one'
);
select extensions.is(
  (select attachments_inserted from test_ingestion_result),
  2,
  'first observation inserts attachment metadata'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  1,
  'first observation enqueues one processing job'
);
select extensions.is(
  (
    select count(*)
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  1::bigint,
  'source identity has one durable message row'
);
select extensions.is(
  (
    select body_content
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  'verbatim source',
  'source body remains verbatim'
);
select extensions.is(
  (
    select count(*)
    from public.attachments
    where teams_message_id = (
      select id
      from public.teams_messages
      where external_message_id = 'root-message'
    )
      and is_current
  ),
  2::bigint,
  'both current attachment representations are durable'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where aggregate_id = (
      select id
      from public.teams_messages
      where external_message_id = 'root-message'
    )
  ),
  1::bigint,
  'one revision job exists after first observation'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'root-message',
    'author_teams_user_id', 'author-test',
    'reply_to_external_message_id', null,
    'source_created_at', '2026-08-27T07:00:00Z',
    'source_last_modified_at', '2026-08-27T07:01:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'verbatim source',
    'source_web_url', null,
    'source_fingerprint', repeat('a', 64),
    'observed_at', '2026-08-27T08:05:00Z',
    'is_bot', false,
    'is_service_message', false
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'hosted:one',
      'attachment_kind', 'hosted_content',
      'source_content_type', 'chatMessageHostedContent',
      'source_locator', jsonb_build_object('hosted_content_id', 'one')
    ),
    jsonb_build_object(
      'external_attachment_id', 'reference:two',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'file_name', 'fixture.bin',
      'source_locator', jsonb_build_object('attachment_id', 'two')
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'unchanged',
  'identical replay is unchanged'
);
select extensions.is(
  (select attachments_inserted from test_ingestion_result),
  0,
  'identical replay inserts no attachment metadata'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  0,
  'identical replay enqueues no job'
);
select extensions.is(
  (
    select count(*)
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  1::bigint,
  'identical replay keeps one message row'
);
select extensions.is(
  (
    select count(*)
    from public.attachments
    where teams_message_id = (
      select id
      from public.teams_messages
      where external_message_id = 'root-message'
    )
  ),
  2::bigint,
  'identical replay keeps two attachment rows'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where aggregate_id = (
      select id
      from public.teams_messages
      where external_message_id = 'root-message'
    )
  ),
  1::bigint,
  'identical replay keeps one job'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'root-message',
    'author_teams_user_id', 'author-test',
    'reply_to_external_message_id', null,
    'source_created_at', '2026-08-27T07:00:00Z',
    'source_last_modified_at', '2026-08-27T07:02:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'edited source',
    'source_web_url', null,
    'source_fingerprint', repeat('b', 64),
    'observed_at', '2026-08-27T08:10:00Z',
    'is_bot', false,
    'is_service_message', false
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'hosted:one',
      'attachment_kind', 'hosted_content',
      'source_content_type', 'chatMessageHostedContent',
      'source_locator', jsonb_build_object('hosted_content_id', 'one')
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'updated',
  'changed newer source updates the message'
);
select extensions.is(
  (select content_revision from test_ingestion_result),
  2,
  'changed newer source increments revision'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  1,
  'changed source enqueues a revision job'
);
select extensions.is(
  (
    select count(*)
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  1::bigint,
  'changed source still has one message row'
);
select extensions.is(
  (
    select body_content
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  'edited source',
  'changed source replaces the current verbatim body'
);
select extensions.is(
  (
    select content_revision
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  2,
  'durable message stores revision two'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where aggregate_id = (
      select id
      from public.teams_messages
      where external_message_id = 'root-message'
    )
  ),
  2::bigint,
  'both deterministic revision jobs are preserved'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'root-message',
    'author_teams_user_id', 'author-test',
    'reply_to_external_message_id', null,
    'source_created_at', '2026-08-27T07:00:00Z',
    'source_last_modified_at', '2026-08-27T07:01:30Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'stale source',
    'source_web_url', null,
    'source_fingerprint', repeat('c', 64),
    'observed_at', '2026-08-27T08:15:00Z',
    'is_bot', false,
    'is_service_message', false
  ),
  '[]'::jsonb
);

select extensions.is(
  (select result from test_ingestion_result),
  'unchanged',
  'older changed observation cannot downgrade the source'
);
select extensions.is(
  (
    select body_content
    from public.teams_messages
    where external_message_id = 'root-message'
  ),
  'edited source',
  'stale replay leaves the newest body intact'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'system-message',
    'author_teams_user_id', null,
    'reply_to_external_message_id', null,
    'source_created_at', '2026-08-27T07:10:00Z',
    'source_last_modified_at', '2026-08-27T07:10:00Z',
    'message_type', 'systemEventMessage',
    'body_content_type', 'text',
    'body_content', 'service source',
    'source_fingerprint', repeat('d', 64),
    'observed_at', '2026-08-27T08:20:00Z',
    'is_bot', false,
    'is_service_message', true
  ),
  '[]'::jsonb
);

select extensions.is(
  (select result from test_ingestion_result),
  'inserted',
  'authorless system message is accepted'
);
select extensions.is(
  (
    select author_teams_user_id
    from public.teams_messages
    where external_message_id = 'system-message'
  ),
  null,
  'authorless message persists null author'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'reply-message',
    'author_teams_user_id', null,
    'reply_to_external_message_id', 'root-message',
    'source_created_at', '2026-08-27T07:20:00Z',
    'source_last_modified_at', '2026-08-27T07:20:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'reply source',
    'source_fingerprint', repeat('e', 64),
    'observed_at', '2026-08-27T08:25:00Z',
    'is_bot', false,
    'is_service_message', false
  ),
  '[]'::jsonb
);

select extensions.is(
  (select result from test_ingestion_result),
  'inserted',
  'reply is persisted as its own message'
);
select extensions.is(
  (
    select reply_to_external_message_id
    from public.teams_messages
    where external_message_id = 'reply-message'
  ),
  'root-message',
  'reply preserves explicit root external message ID'
);
select extensions.is(
  (
    select count(*)
    from public.teams_messages
    where external_message_id in ('root-message', 'reply-message')
  ),
  2::bigint,
  'root and reply remain separate rows'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
  ),
  (
    select count(*)
    from (
      select distinct
        job_type,
        aggregate_type,
        aggregate_id,
        content_revision
      from public.processing_jobs
    ) distinct_jobs
  ),
  'processing job revision identities are unique'
);
select extensions.is(
  (
    select count(*)
    from public.attachments
  ),
  (
    select count(*)
    from (
      select distinct teams_message_id, external_attachment_id
      from public.attachments
    ) distinct_attachments
  ),
  'attachment identities are unique per message'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'projection-message',
    'source_created_at', '2026-08-27T07:25:00Z',
    'source_last_modified_at', '2026-08-27T07:25:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'projection source',
    'source_fingerprint', repeat('9', 64),
    'observed_at', '2026-08-27T08:25:00Z'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'reference:projection-one',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'source_locator', jsonb_build_object(
        'attachment_id',
        'projection-one'
      )
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'inserted',
  'first Graph projection inserts its message'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'projection-message',
    'source_created_at', '2026-08-27T07:25:00Z',
    'source_last_modified_at', '2026-08-27T07:25:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'projection source',
    'source_fingerprint', repeat('9', 64),
    'observed_at', '2026-08-27T08:26:00Z'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'reference:projection-one',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'source_locator', jsonb_build_object(
        'attachment_id',
        'projection-one'
      )
    ),
    jsonb_build_object(
      'external_attachment_id', 'reference:projection-two',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'source_locator', jsonb_build_object(
        'attachment_id',
        'projection-two'
      )
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'updated',
  'richer Graph projection creates one source revision'
);
select extensions.is(
  (select content_revision from test_ingestion_result),
  2,
  'richer Graph projection increments revision'
);
select extensions.is(
  (select attachments_inserted from test_ingestion_result),
  1,
  'richer Graph projection inserts only its new attachment'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  1,
  'richer Graph projection enqueues one revision job'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'projection-message',
    'source_created_at', '2026-08-27T07:25:00Z',
    'source_last_modified_at', '2026-08-27T07:25:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'projection source',
    'source_fingerprint', repeat('9', 64),
    'observed_at', '2026-08-27T08:27:00Z'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'external_attachment_id', 'reference:projection-one',
      'attachment_kind', 'reference',
      'source_content_type', 'reference',
      'source_locator', jsonb_build_object(
        'attachment_id',
        'projection-one'
      )
    )
  )
);

select extensions.is(
  (select result from test_ingestion_result),
  'unchanged',
  'narrower Graph projection does not remove durable metadata'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  0,
  'narrower Graph projection enqueues no job'
);
select extensions.is(
  (select attachments_inserted from test_ingestion_result),
  0,
  'narrower Graph projection inserts no attachment'
);
select extensions.is(
  (
    select count(*)
    from public.attachments
    where teams_message_id = (
      select id
      from public.teams_messages
      where external_message_id = 'projection-message'
    )
  ),
  2::bigint,
  'attachment metadata is a stable union across Graph projections'
);
select extensions.is(
  (
    select count(*)
    from public.processing_jobs
    where aggregate_id = (
      select id
      from public.teams_messages
      where external_message_id = 'projection-message'
    )
  ),
  2::bigint,
  'projection enrichment has exactly two revision jobs'
);

truncate test_ingestion_result;

insert into test_ingestion_result
select *
from public.ingest_teams_message(
  jsonb_build_object(
    'source', 'microsoft_teams',
    'tenant_id', 'tenant-test',
    'team_id', 'team-test',
    'channel_id', 'channel-test',
    'external_message_id', 'projection-message',
    'source_created_at', '2026-08-27T07:25:00Z',
    'source_last_modified_at', '2026-08-27T07:25:00Z',
    'message_type', 'message',
    'body_content_type', 'text',
    'body_content', 'alternate endpoint projection',
    'source_fingerprint', repeat('8', 64),
    'observed_at', '2026-08-27T08:28:00Z'
  ),
  '[]'::jsonb
);

select extensions.is(
  (select result from test_ingestion_result),
  'unchanged',
  'same-timestamp endpoint body variation is not an edit'
);
select extensions.is(
  (select jobs_enqueued from test_ingestion_result),
  0,
  'same-timestamp endpoint variation enqueues no job'
);
select extensions.is(
  (
    select body_content
    from public.teams_messages
    where external_message_id = 'projection-message'
  ),
  'projection source',
  'same-timestamp endpoint variation leaves canonical body intact'
);

select extensions.throws_ok(
  $$
    select *
    from public.ingest_teams_message(
      jsonb_build_object(
        'source', 'microsoft_teams',
        'tenant_id', 'tenant-test',
        'team_id', 'team-test',
        'channel_id', 'channel-test',
        'external_message_id', 'transaction-failure-message',
        'source_created_at', '2026-08-27T07:30:00Z',
        'source_last_modified_at', '2026-08-27T07:30:00Z',
        'source_fingerprint', repeat('f', 64),
        'observed_at', '2026-08-27T08:30:00Z'
      ),
      jsonb_build_array(
        jsonb_build_object('attachment_kind', 'reference')
      )
    )
  $$,
  '22023',
  'Teams attachment metadata is missing required identity.',
  'invalid attachment aborts the transactional RPC'
);
select extensions.is(
  (
    select count(*)
    from public.teams_messages
    where external_message_id = 'transaction-failure-message'
  ),
  0::bigint,
  'failed attachment metadata rolls back its message row'
);

select * from extensions.finish();

rollback;
