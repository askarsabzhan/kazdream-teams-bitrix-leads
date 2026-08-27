begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(45);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.claim_attachment_ai_evidence(text,text,text,text,text,integer,integer)',
    'execute'
  ),
  'anonymous role cannot claim AI evidence work'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_attachment_ai_evidence(text,text,text,text,text,integer,integer)',
    'execute'
  ),
  'authenticated role cannot claim AI evidence work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_attachment_ai_evidence(text,text,text,text,text,integer,integer)',
    'execute'
  ),
  'service role can claim AI evidence work'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.complete_attachment_ai_evidence(uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'anonymous role cannot complete AI evidence work'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_attachment_ai_evidence(uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'authenticated role cannot complete AI evidence work'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_attachment_ai_evidence(uuid,uuid,text,text,text,bigint,bigint,bigint,bigint,bigint)',
    'execute'
  ),
  'service role can complete AI evidence work'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.record_attachment_ai_evidence_outcome(uuid,uuid,text,text,bigint)',
    'execute'
  ),
  'anonymous role cannot record AI evidence outcomes'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.record_attachment_ai_evidence_outcome(uuid,uuid,text,text,bigint)',
    'execute'
  ),
  'authenticated role cannot record AI evidence outcomes'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_attachment_ai_evidence_outcome(uuid,uuid,text,text,bigint)',
    'execute'
  ),
  'service role can record AI evidence outcomes'
);

select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_attachment_ai_evidence',
        'complete_attachment_ai_evidence',
        'record_attachment_ai_evidence_outcome'
      )
      and function_definition.prosecdef
  ),
  3::bigint,
  'all AI evidence worker functions are security definer'
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
        'claim_attachment_ai_evidence',
        'complete_attachment_ai_evidence',
        'record_attachment_ai_evidence_outcome'
      )
      and function_owner.rolname = 'postgres'
  ),
  3::bigint,
  'postgres owns all AI evidence worker functions'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname in (
        'claim_attachment_ai_evidence',
        'complete_attachment_ai_evidence',
        'record_attachment_ai_evidence_outcome'
      )
      and exists (
        select 1
        from unnest(function_definition.proconfig) as setting(value)
        where setting.value in ('search_path=', 'search_path=""')
      )
  ),
  3::bigint,
  'all AI evidence worker functions use an empty search_path'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.attachments', 'update'),
  'service role cannot bypass fenced AI evidence RPCs with direct updates'
);

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

create temporary table evidence_claims (
  run integer not null,
  attachment_id uuid,
  lease_id uuid,
  operation_type text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  source_sha256 text,
  provider_name text,
  provider_model text,
  prompt_version text,
  processing_revision integer,
  processing_attempts integer
) on commit drop;

create temporary table evidence_transitions (
  attachment_id uuid,
  processing_state text
) on commit drop;

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  mime_type,
  size_bytes,
  sha256,
  storage_path,
  fetch_state,
  acquired_at,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '11111111-1111-4111-8111-111111111111',
  'reference:audio',
  'reference',
  '{"attachment_id":"audio"}'::jsonb,
  'audio/mpeg',
  3,
  repeat('b', 64),
  'teams/message/audio/' || repeat('b', 64),
  'fetched',
  clock_timestamp(),
  '2026-08-27T10:02:00Z'
);

insert into evidence_claims
select 1, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe',
  'verbatim-v1',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;

select extensions.is(
  (select count(*) from evidence_claims where run = 1),
  1::bigint,
  'one worker claims pending fetched audio evidence'
);
select extensions.ok(
  (
    select processing_state = 'processing'
      and processing_lease_id is not null
      and processing_lease_expires_at > last_processing_attempt_at
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'claim sets a bounded processing lease'
);
select extensions.ok(
  (
    select processing_attempts = 1 and processing_revision = 1
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'first identity claim starts attempt one and evidence revision one'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe',
      'verbatim-v1',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'a concurrent worker cannot claim the active lease'
);

update public.attachments
set processing_lease_expires_at = clock_timestamp() - interval '1 second'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

insert into evidence_claims
select 2, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe',
  'verbatim-v1',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;

select extensions.is(
  (select count(*) from evidence_claims where run = 2),
  1::bigint,
  'an expired evidence lease is reclaimable'
);
select extensions.is(
  (select processing_attempts from evidence_claims where run = 2),
  2,
  'stale lease recovery increments the durable attempt counter'
);
select extensions.isnt(
  (select lease_id from evidence_claims where run = 2),
  (select lease_id from evidence_claims where run = 1),
  'stale lease recovery issues a new fencing token'
);
select extensions.throws_ok(
  $$
    select *
    from public.complete_attachment_ai_evidence(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select lease_id from evidence_claims where run = 1),
      'transcription',
      'stale worker text',
      null,
      10,
      null,
      null,
      null,
      null
    )
  $$,
  'P0001',
  'Attachment AI evidence completion transition was rejected.',
  'a stale worker cannot complete after reclaim'
);
select extensions.throws_ok(
  $$
    select *
    from public.record_attachment_ai_evidence_outcome(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select lease_id from evidence_claims where run = 1),
      'retryable_failed',
      'OPENAI_TIMEOUT',
      10
    )
  $$,
  'P0001',
  'Attachment AI evidence outcome transition was rejected.',
  'a stale worker cannot record a failure after reclaim'
);

insert into evidence_transitions
select *
from public.complete_attachment_ai_evidence(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select lease_id from evidence_claims where run = 2),
  'transcription',
  'verbatim mixed transcript',
  null,
  125,
  10,
  4,
  14,
  null
);

select extensions.is(
  (select processing_state from evidence_transitions),
  'processed',
  'fenced transcription completion returns processed'
);
select extensions.ok(
  (
    select processing_state = 'processed'
      and transcript_text = 'verbatim mixed transcript'
      and ocr_text is null
      and processing_operation = 'transcription'
      and processing_source_sha256 = repeat('b', 64)
      and provider_name = 'openai'
      and provider_model = 'gpt-test-transcribe'
      and processing_prompt_version = 'verbatim-v1'
      and processing_duration_ms = 125
      and processing_total_tokens = 14
      and processed_at is not null
      and processing_lease_id is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'transcription evidence is tied to its source and provider identity'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe',
      'verbatim-v1',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'successful evidence cannot be claimed again for the same identity'
);

update public.attachments
set processing_source_sha256 = repeat('c', 64)
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

insert into evidence_claims
select 3, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe',
  'verbatim-v1',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;

select extensions.is(
  (select count(*) from evidence_claims where run = 3),
  1::bigint,
  'a source SHA identity mismatch allows intentional reprocessing'
);
select extensions.ok(
  (
    select processing_revision = 2
      and processing_attempts = 1
      and transcript_text is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'a new source identity increments revision, resets attempts, and clears stale evidence'
);

truncate evidence_transitions;
insert into evidence_transitions
select *
from public.complete_attachment_ai_evidence(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select lease_id from evidence_claims where run = 3),
  'transcription',
  'new source transcript',
  null,
  100,
  null,
  null,
  null,
  800
);
select extensions.is(
  (select processing_state from evidence_transitions),
  'processed',
  'reprocessed source evidence can complete under its new revision'
);

insert into evidence_claims
select 4, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe-v2',
  'verbatim-v2',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;
select extensions.is(
  (select count(*) from evidence_claims where run = 4),
  1::bigint,
  'an intentional model and contract version change allows reprocessing'
);
select extensions.ok(
  (
    select processing_revision = 3
      and processing_attempts = 1
      and provider_model = 'gpt-test-transcribe-v2'
      and processing_prompt_version = 'verbatim-v2'
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'changed configuration is durably identified as a new evidence revision'
);

truncate evidence_transitions;
insert into evidence_transitions
select *
from public.record_attachment_ai_evidence_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  (select lease_id from evidence_claims where run = 4),
  'permanent_failed',
  'OPENAI_INVALID_REQUEST',
  25
);
select extensions.is(
  (select processing_state from evidence_transitions),
  'permanent_failed',
  'a permanent provider outcome is terminal'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe-v2',
      'verbatim-v2',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'permanent evidence failure cannot be reclaimed for the same identity'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  mime_type,
  size_bytes,
  sha256,
  storage_path,
  fetch_state,
  acquired_at,
  processing_state,
  processing_operation,
  processing_source_sha256,
  provider_name,
  provider_model,
  processing_prompt_version,
  processing_revision,
  processing_attempts,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '11111111-1111-4111-8111-111111111111',
  'hosted:retry-limit',
  'hosted_content',
  '{"hosted_content_id":"retry-limit"}'::jsonb,
  'image/png',
  3,
  repeat('d', 64),
  'teams/message/retry/' || repeat('d', 64),
  'fetched',
  clock_timestamp(),
  'retryable_failed',
  'image_text',
  repeat('d', 64),
  'openai',
  'gpt-test-image',
  'visible-v1',
  1,
  4,
  '2026-08-27T10:03:00Z'
);

insert into evidence_claims
select 5, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe-v2',
  'verbatim-v2',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;
select extensions.is(
  (select count(*) from evidence_claims where run = 5),
  1::bigint,
  'the fifth and final evidence attempt can be claimed'
);
select extensions.is(
  (select processing_attempts from evidence_claims where run = 5),
  5,
  'the evidence attempt counter reaches five'
);

truncate evidence_transitions;
insert into evidence_transitions
select *
from public.record_attachment_ai_evidence_outcome(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  (select lease_id from evidence_claims where run = 5),
  'retryable_failed',
  'OPENAI_RATE_LIMITED',
  20
);
select extensions.is(
  (select processing_state from evidence_transitions),
  'permanent_failed',
  'the fifth retryable provider failure becomes permanent'
);
select extensions.ok(
  (
    select processing_state = 'permanent_failed'
      and processing_error_code = 'RETRY_LIMIT_EXCEEDED'
      and processing_lease_id is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  ),
  'retry exhaustion stores a safe terminal code and releases the lease'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe-v2',
      'verbatim-v2',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'retry-exhausted evidence cannot be claimed again'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  mime_type,
  size_bytes,
  sha256,
  storage_path,
  fetch_state,
  acquired_at,
  processing_state,
  processing_operation,
  processing_source_sha256,
  provider_name,
  provider_model,
  processing_prompt_version,
  processing_revision,
  processing_attempts,
  processing_lease_id,
  processing_lease_expires_at,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  '11111111-1111-4111-8111-111111111111',
  'hosted:stale-five',
  'hosted_content',
  '{"hosted_content_id":"stale-five"}'::jsonb,
  'image/png',
  3,
  repeat('e', 64),
  'teams/message/stale/' || repeat('e', 64),
  'fetched',
  clock_timestamp(),
  'processing',
  'image_text',
  repeat('e', 64),
  'openai',
  'gpt-test-image',
  'visible-v1',
  1,
  5,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  clock_timestamp() - interval '1 second',
  '2026-08-27T10:04:00Z'
);

select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe-v2',
      'verbatim-v2',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'an expired fifth-attempt lease is terminalized instead of reclaimed'
);
select extensions.ok(
  (
    select processing_state = 'permanent_failed'
      and processing_error_code = 'RETRY_LIMIT_EXCEEDED'
      and processing_lease_id is null
      and processing_lease_expires_at is null
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
  ),
  'a crash on attempt five converges to a terminal state'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  mime_type,
  size_bytes,
  sha256,
  storage_path,
  fetch_state,
  acquired_at,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  '11111111-1111-4111-8111-111111111111',
  'hosted:image-success',
  'hosted_content',
  '{"hosted_content_id":"image-success"}'::jsonb,
  'image/png',
  3,
  repeat('f', 64),
  'teams/message/image/' || repeat('f', 64),
  'fetched',
  clock_timestamp(),
  '2026-08-27T10:05:00Z'
);

insert into evidence_claims
select 6, claimed.*
from public.claim_attachment_ai_evidence(
  'openai',
  'gpt-test-transcribe-v2',
  'verbatim-v2',
  'gpt-test-image',
  'visible-v1',
  1,
  300
) as claimed;
select extensions.is(
  (select count(*) from evidence_claims where run = 6),
  1::bigint,
  'fetched image evidence can be claimed'
);

truncate evidence_transitions;
insert into evidence_transitions
select *
from public.complete_attachment_ai_evidence(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  (select lease_id from evidence_claims where run = 6),
  'image_text',
  'visible image text',
  'business_card',
  75,
  20,
  5,
  25,
  null
);
select extensions.is(
  (select processing_state from evidence_transitions),
  'processed',
  'fenced image evidence completion returns processed'
);
select extensions.ok(
  (
    select processing_state = 'processed'
      and ocr_text = 'visible image text'
      and transcript_text is null
      and image_document_type = 'business_card'
      and processing_operation = 'image_text'
      and processing_total_tokens = 25
    from public.attachments
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
  ),
  'image completion stores only visible-text evidence and document type'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe-v2',
      'verbatim-v2',
      'gpt-test-image',
      'visible-v1',
      1,
      300
    )
  ),
  0::bigint,
  'successful image evidence cannot be claimed again'
);

insert into public.attachments (
  id,
  teams_message_id,
  external_attachment_id,
  attachment_kind,
  source_locator,
  fetch_state,
  created_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  '11111111-1111-4111-8111-111111111111',
  'reference:unsupported',
  'reference',
  '{"attachment_id":"unsupported"}'::jsonb,
  'unsupported',
  '2026-08-27T10:06:00Z'
);
select extensions.is(
  (
    select count(*)
    from public.claim_attachment_ai_evidence(
      'openai',
      'gpt-test-transcribe-v2',
      'verbatim-v2',
      'gpt-test-image',
      'visible-v1',
      5,
      300
    )
  ),
  0::bigint,
  'unsupported acquisition evidence is never sent to AI'
);
select extensions.throws_ok(
  $$
    select *
    from public.record_attachment_ai_evidence_outcome(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      '55555555-5555-4555-8555-555555555555',
      'retryable_failed',
      'unsafe-code',
      1
    )
  $$,
  '22023',
  'Attachment AI evidence outcome is invalid.',
  'AI evidence outcome rejects unsafe error codes'
);

select * from extensions.finish();

rollback;
