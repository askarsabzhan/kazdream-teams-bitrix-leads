alter table public.lead_groups
  add column candidate_payload jsonb,
  add column extraction_state text not null default 'pending',
  add column extraction_source_fingerprint text,
  add column extraction_provider text,
  add column extraction_model text,
  add column extraction_prompt_version text,
  add column extraction_schema_version text,
  add column extraction_grouping_revision integer,
  add column extraction_revision integer not null default 0,
  add column extraction_target_revision integer,
  add column extraction_attempts integer not null default 0,
  add column extraction_lease_id uuid,
  add column extraction_lease_expires_at timestamptz,
  add column last_extraction_attempt_at timestamptz,
  add column extraction_error_code text,
  add column extraction_completed_at timestamptz,
  add column eligibility_state text,
  add column eligibility_reason_code text,
  add column extraction_duration_ms bigint,
  add column extraction_input_tokens bigint,
  add column extraction_output_tokens bigint,
  add column extraction_total_tokens bigint,
  add constraint lead_groups_candidate_payload_object_check
    check (candidate_payload is null or jsonb_typeof(candidate_payload) = 'object'),
  add constraint lead_groups_extraction_state_check
    check (
      extraction_state in (
        'pending',
        'processing',
        'extracted',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  add constraint lead_groups_extraction_fingerprint_check
    check (
      extraction_source_fingerprint is null
      or extraction_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint lead_groups_extraction_versions_check
    check (
      (
        extraction_source_fingerprint is null
        and extraction_provider is null
        and extraction_model is null
        and extraction_prompt_version is null
        and extraction_schema_version is null
        and extraction_grouping_revision is null
        and extraction_target_revision is null
      )
      or (
        extraction_source_fingerprint is not null
        and extraction_provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        and extraction_model ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
        and extraction_prompt_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        and extraction_schema_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        and extraction_grouping_revision > 0
        and extraction_target_revision > 0
      )
    ),
  add constraint lead_groups_extraction_revision_check
    check (
      extraction_revision >= 0
      and extraction_attempts >= 0
      and (
        extraction_target_revision is null
        or extraction_target_revision >= extraction_revision
      )
    ),
  add constraint lead_groups_extraction_lease_check
    check (
      (
        extraction_state = 'processing'
        and extraction_lease_id is not null
        and extraction_lease_expires_at is not null
      )
      or (
        extraction_state <> 'processing'
        and extraction_lease_id is null
        and extraction_lease_expires_at is null
      )
    ),
  add constraint lead_groups_extraction_error_check
    check (
      extraction_error_code is null
      or extraction_error_code ~ '^[A-Z0-9_]{1,64}$'
    ),
  add constraint lead_groups_extraction_metrics_check
    check (
      (extraction_duration_ms is null or extraction_duration_ms >= 0)
      and (extraction_input_tokens is null or extraction_input_tokens >= 0)
      and (extraction_output_tokens is null or extraction_output_tokens >= 0)
      and (extraction_total_tokens is null or extraction_total_tokens >= 0)
    ),
  add constraint lead_groups_eligibility_check
    check (
      (eligibility_state is null and eligibility_reason_code is null)
      or (
        eligibility_state = 'eligible'
        and eligibility_reason_code is null
      )
      or (
        eligibility_state = 'not_eligible'
        and eligibility_reason_code in (
          'MISSING_FULL_NAME',
          'MISSING_PHONE',
          'CONFLICTED_FULL_NAME'
        )
      )
    ),
  add constraint lead_groups_extracted_payload_check
    check (
      extraction_state <> 'extracted'
      or (
        candidate_payload is not null
        and eligibility_state is not null
        and extraction_completed_at is not null
        and extraction_revision = extraction_target_revision
        and extraction_error_code is null
      )
    );

comment on column public.lead_groups.candidate_payload is
  'Current validated group-level candidate only; Phase 4C does not create a canonical lead and does not archive historical candidate payloads.';
comment on column public.lead_groups.extraction_source_fingerprint is
  'SHA-256 over group identity/revision, ordered evidence hashes, provider, model, prompt version, and schema version.';
comment on column public.lead_groups.extraction_revision is
  'Last successfully completed candidate revision; advances only on fenced successful completion of a new extraction identity.';

alter table public.field_evidence
  add column lead_group_id uuid references public.lead_groups (id) on delete cascade,
  add column extraction_revision integer,
  add column evidence_ref_id text,
  alter column lead_id drop not null,
  add constraint field_evidence_exactly_one_target_check
    check ((lead_id is null) <> (lead_group_id is null)),
  add constraint field_evidence_group_metadata_check
    check (
      (
        lead_group_id is null
        and extraction_revision is null
        and evidence_ref_id is null
      )
      or (
        lead_group_id is not null
        and extraction_revision > 0
        and evidence_ref_id is not null
        and evidence_ref_id ~ '^(msg:[0-9]+:text|att:[0-9]+:(transcript|ocr)|system:(customer-default|campaign))$'
        and normalized_value is not null
        and evidence_text is null
      )
    );

create unique index field_evidence_group_revision_value_source_idx
  on public.field_evidence (
    lead_group_id,
    extraction_revision,
    field_name,
    evidence_ref_id,
    normalized_value,
    validation_status
  )
  where lead_group_id is not null;

create index field_evidence_group_revision_idx
  on public.field_evidence (lead_group_id, extraction_revision);

create function public.enqueue_process_lead_group_job()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or new.grouping_revision is distinct from old.grouping_revision
  then
    insert into public.processing_jobs (
      job_type,
      aggregate_type,
      aggregate_id,
      content_revision
    )
    values (
      'process_lead_group',
      'lead_group',
      new.id,
      new.grouping_revision
    )
    on conflict (
      job_type,
      aggregate_type,
      aggregate_id,
      content_revision
    ) do nothing;
  end if;
  return new;
end;
$$;

create trigger lead_groups_enqueue_processing_job
after insert or update of grouping_revision on public.lead_groups
for each row execute function public.enqueue_process_lead_group_job();

insert into public.processing_jobs (
  job_type,
  aggregate_type,
  aggregate_id,
  content_revision
)
select
  'process_lead_group',
  'lead_group',
  conversation_group.id,
  conversation_group.grouping_revision
from public.lead_groups as conversation_group
on conflict (
  job_type,
  aggregate_type,
  aggregate_id,
  content_revision
) do nothing;

create function public.load_lead_group_extraction_evidence(
  p_lead_group_id uuid
)
returns table (
  evidence_order bigint,
  evidence_id text,
  evidence_type text,
  teams_message_id uuid,
  attachment_id uuid,
  evidence_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  with group_messages as materialized (
    select
      source_message.*,
      row_number() over (
        order by source_message.source_created_at, source_message.id
      ) as message_ordinal
    from public.lead_group_messages as membership
    join public.teams_messages as source_message
      on source_message.id = membership.teams_message_id
    where membership.lead_group_id = p_lead_group_id
      and source_message.grouping_state = 'grouped'
  ),
  successful_attachments as materialized (
    select
      group_message.source_created_at,
      group_message.id as message_id,
      source_attachment.id as source_attachment_id,
      source_attachment.processing_operation,
      case
        when source_attachment.processing_operation = 'transcription'
          then source_attachment.transcript_text
        when source_attachment.processing_operation = 'image_text'
          then source_attachment.ocr_text
      end as source_text,
      row_number() over (
        order by
          group_message.source_created_at,
          group_message.id,
          source_attachment.id
      ) as attachment_ordinal
    from group_messages as group_message
    join public.attachments as source_attachment
      on source_attachment.teams_message_id = group_message.id
    where source_attachment.is_current
      and source_attachment.fetch_state = 'fetched'
      and source_attachment.processing_state = 'processed'
      and (
        (
          source_attachment.processing_operation = 'transcription'
          and nullif(btrim(source_attachment.transcript_text), '') is not null
        )
        or (
          source_attachment.processing_operation = 'image_text'
          and nullif(btrim(source_attachment.ocr_text), '') is not null
        )
      )
  ),
  evidence as (
    select
      group_message.source_created_at,
      group_message.id as message_sort_id,
      0 as kind_order,
      null::uuid as attachment_sort_id,
      'msg:' || group_message.message_ordinal::text || ':text' as evidence_id,
      case
        when group_message.reply_to_external_message_id is null
          then 'teams_text'
        else 'reply_text'
      end as evidence_type,
      group_message.id as teams_message_id,
      null::uuid as attachment_id,
      group_message.body_content as evidence_text
    from group_messages as group_message
    where nullif(btrim(group_message.body_content), '') is not null

    union all

    select
      source_attachment.source_created_at,
      source_attachment.message_id,
      1,
      source_attachment.source_attachment_id,
      'att:' || source_attachment.attachment_ordinal::text || ':' ||
        case
          when source_attachment.processing_operation = 'transcription'
            then 'transcript'
          else 'ocr'
        end,
      case
        when source_attachment.processing_operation = 'transcription'
          then 'transcript'
        else 'ocr'
      end,
      source_attachment.message_id,
      source_attachment.source_attachment_id,
      source_attachment.source_text
    from successful_attachments as source_attachment
  )
  select
    row_number() over (
      order by
        evidence.source_created_at,
        evidence.message_sort_id,
        evidence.kind_order,
        evidence.attachment_sort_id nulls first,
        evidence.evidence_id
    ),
    evidence.evidence_id,
    evidence.evidence_type,
    evidence.teams_message_id,
    evidence.attachment_id,
    evidence.evidence_text
  from evidence
  order by 1;
$$;

create function public.lead_group_extraction_fingerprint(
  p_lead_group_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat_ws(
        E'\x1f',
        conversation_group.id::text,
        conversation_group.grouping_revision::text,
        conversation_group.grouping_algorithm_version,
        p_provider,
        p_model,
        p_prompt_version,
        p_schema_version,
        coalesce((
          select string_agg(
            concat_ws(
              E'\x1e',
              group_evidence.evidence_id,
              group_evidence.evidence_type,
              encode(
                extensions.digest(group_evidence.evidence_text, 'sha256'),
                'hex'
              )
            ),
            E'\x1d'
            order by group_evidence.evidence_order
          )
          from public.load_lead_group_extraction_evidence(
            conversation_group.id
          ) as group_evidence
        ), '')
      ),
      'sha256'
    ),
    'hex'
  )
  from public.lead_groups as conversation_group
  where conversation_group.id = p_lead_group_id;
$$;

create function public.claim_lead_group_extractions(
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  lead_group_id uuid,
  campaign_id uuid,
  lease_id uuid,
  grouping_revision integer,
  grouping_algorithm_version text,
  extraction_source_fingerprint text,
  extraction_revision integer,
  extraction_attempts integer,
  extraction_provider text,
  extraction_model text,
  extraction_prompt_version text,
  extraction_schema_version text,
  evidence_items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider is null
    or p_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_model is null
    or p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
    or p_prompt_version is null
    or p_prompt_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_schema_version is null
    or p_schema_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 3600
  then
    raise exception using
      errcode = '22023',
      message = 'Lead group extraction claim configuration is invalid.';
  end if;

  update public.lead_groups as exhausted_group
  set extraction_state = 'permanent_failed',
      extraction_error_code = 'RETRY_LIMIT_EXCEEDED',
      extraction_lease_id = null,
      extraction_lease_expires_at = null,
      updated_at = clock_timestamp()
  where exhausted_group.extraction_state = 'processing'
    and exhausted_group.extraction_lease_expires_at <= clock_timestamp()
    and exhausted_group.extraction_attempts >= 5;

  update public.processing_jobs as exhausted_job
  set status = 'permanent_failed',
      attempts = max_attempts,
      locked_at = null,
      locked_by = null,
      last_error_code = 'RETRY_LIMIT_EXCEEDED',
      updated_at = clock_timestamp()
  from public.lead_groups as exhausted_group
  where exhausted_group.id = exhausted_job.aggregate_id
    and exhausted_job.job_type = 'process_lead_group'
    and exhausted_job.aggregate_type = 'lead_group'
    and exhausted_job.content_revision = exhausted_group.extraction_grouping_revision
    and exhausted_group.extraction_state = 'permanent_failed'
    and exhausted_group.extraction_error_code = 'RETRY_LIMIT_EXCEEDED'
    and exhausted_job.status = 'processing';

  return query
  with configured as materialized (
    select
      candidate_group.id,
      candidate_job.run_at as job_run_at,
      public.lead_group_extraction_fingerprint(
        candidate_group.id,
        p_provider,
        p_model,
        p_prompt_version,
        p_schema_version
      ) as target_fingerprint
    from public.lead_groups as candidate_group
    join public.processing_jobs as candidate_job
      on candidate_job.job_type = 'process_lead_group'
      and candidate_job.aggregate_type = 'lead_group'
      and candidate_job.aggregate_id = candidate_group.id
      and candidate_job.content_revision = candidate_group.grouping_revision
    where exists (
      select 1
      from public.load_lead_group_extraction_evidence(candidate_group.id)
    )
  ),
  eligible as materialized (
    select
      candidate_group.id,
      configured_group.target_fingerprint,
      coalesce(
        candidate_group.extraction_source_fingerprint =
          configured_group.target_fingerprint,
        false
      ) as identity_matches
    from public.lead_groups as candidate_group
    join configured as configured_group on configured_group.id = candidate_group.id
    where (
      (
        candidate_group.extraction_source_fingerprint = configured_group.target_fingerprint
        and candidate_group.extraction_attempts < 5
        and configured_group.job_run_at <= clock_timestamp()
        and (
          candidate_group.extraction_state in ('pending', 'retryable_failed')
          or (
            candidate_group.extraction_state = 'processing'
            and candidate_group.extraction_lease_expires_at <= clock_timestamp()
          )
        )
      )
      or (
        candidate_group.extraction_source_fingerprint is distinct from
          configured_group.target_fingerprint
        and (
          candidate_group.extraction_state <> 'processing'
          or candidate_group.extraction_lease_expires_at <= clock_timestamp()
        )
      )
    )
    order by
      candidate_group.extraction_lease_expires_at nulls first,
      candidate_group.created_at,
      candidate_group.id
    limit p_limit
    for update of candidate_group skip locked
  ),
  claimed as (
    update public.lead_groups as claimed_group
    set extraction_state = 'processing',
        extraction_source_fingerprint = eligible_group.target_fingerprint,
        extraction_provider = p_provider,
        extraction_model = p_model,
        extraction_prompt_version = p_prompt_version,
        extraction_schema_version = p_schema_version,
        extraction_grouping_revision = claimed_group.grouping_revision,
        extraction_target_revision = case
          when eligible_group.identity_matches
            then coalesce(
              claimed_group.extraction_target_revision,
              claimed_group.extraction_revision + 1
            )
          else claimed_group.extraction_revision + 1
        end,
        extraction_attempts = case
          when eligible_group.identity_matches
            then claimed_group.extraction_attempts + 1
          else 1
        end,
        extraction_lease_id = gen_random_uuid(),
        extraction_lease_expires_at = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        last_extraction_attempt_at = clock_timestamp(),
        extraction_error_code = null,
        candidate_payload = case
          when eligible_group.identity_matches then claimed_group.candidate_payload
          else null
        end,
        eligibility_state = case
          when eligible_group.identity_matches then claimed_group.eligibility_state
          else null
        end,
        eligibility_reason_code = case
          when eligible_group.identity_matches then claimed_group.eligibility_reason_code
          else null
        end,
        extraction_completed_at = case
          when eligible_group.identity_matches then claimed_group.extraction_completed_at
          else null
        end,
        extraction_duration_ms = null,
        extraction_input_tokens = null,
        extraction_output_tokens = null,
        extraction_total_tokens = null,
        updated_at = clock_timestamp()
    from eligible as eligible_group
    where claimed_group.id = eligible_group.id
    returning claimed_group.*
  ),
  claimed_jobs as (
    update public.processing_jobs as claimed_job
    set status = 'processing',
        attempts = claimed_group.extraction_attempts,
        locked_at = clock_timestamp(),
        locked_by = claimed_group.extraction_lease_id::text,
        last_error_code = null,
        updated_at = clock_timestamp()
    from claimed as claimed_group
    where claimed_job.job_type = 'process_lead_group'
      and claimed_job.aggregate_type = 'lead_group'
      and claimed_job.aggregate_id = claimed_group.id
      and claimed_job.content_revision = claimed_group.grouping_revision
    returning claimed_job.aggregate_id
  )
  select
    claimed_group.id,
    claimed_group.campaign_id,
    claimed_group.extraction_lease_id,
    claimed_group.grouping_revision,
    claimed_group.grouping_algorithm_version,
    claimed_group.extraction_source_fingerprint,
    claimed_group.extraction_target_revision,
    claimed_group.extraction_attempts,
    claimed_group.extraction_provider,
    claimed_group.extraction_model,
    claimed_group.extraction_prompt_version,
    claimed_group.extraction_schema_version,
    (
      select jsonb_agg(
        jsonb_build_object(
          'evidence_id', group_evidence.evidence_id,
          'evidence_type', group_evidence.evidence_type,
          'teams_message_id', group_evidence.teams_message_id,
          'attachment_id', group_evidence.attachment_id,
          'evidence_text', group_evidence.evidence_text
        )
        order by group_evidence.evidence_order
      )
      from public.load_lead_group_extraction_evidence(
        claimed_group.id
      ) as group_evidence
    )
  from claimed as claimed_group
  join claimed_jobs on claimed_jobs.aggregate_id = claimed_group.id
  order by claimed_group.created_at, claimed_group.id;
end;
$$;

create function public.complete_lead_group_extraction(
  p_lead_group_id uuid,
  p_lease_id uuid,
  p_source_fingerprint text,
  p_candidate_payload jsonb,
  p_eligibility_state text,
  p_eligibility_reason_code text,
  p_field_evidence jsonb,
  p_duration_ms bigint,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint
)
returns table (
  lead_group_id uuid,
  extraction_state text,
  field_evidence_inserted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.lead_groups%rowtype;
  v_row jsonb;
  v_inserted integer := 0;
begin
  if p_lead_group_id is null
    or p_lease_id is null
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[0-9a-f]{64}$'
    or p_candidate_payload is null
    or jsonb_typeof(p_candidate_payload) <> 'object'
    or p_candidate_payload #>> '{campaign,exhibition}' <> 'Hannover Messe 2026'
    or p_candidate_payload #>> '{campaign,exhibitionBitrixId}' <> '63'
    or p_candidate_payload #>> '{campaign,source}' <> 'EXHIBITION'
    or p_eligibility_state is null
    or p_eligibility_state not in ('eligible', 'not_eligible')
    or (
      p_eligibility_state = 'eligible'
      and p_eligibility_reason_code is not null
    )
    or (
      p_eligibility_state = 'not_eligible'
      and p_eligibility_reason_code not in (
        'MISSING_FULL_NAME',
        'MISSING_PHONE',
        'CONFLICTED_FULL_NAME'
      )
    )
    or p_field_evidence is null
    or jsonb_typeof(p_field_evidence) <> 'array'
    or jsonb_array_length(p_field_evidence) > 500
    or p_duration_ms is null
    or p_duration_ms < 0
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (p_total_tokens is not null and p_total_tokens < 0)
  then
    raise exception using
      errcode = '22023',
      message = 'Lead group extraction completion metadata is invalid.';
  end if;

  select * into v_group
  from public.lead_groups as claimed_group
  where claimed_group.id = p_lead_group_id
  for update;

  if not found
    or v_group.extraction_state <> 'processing'
    or v_group.extraction_lease_id <> p_lease_id
    or v_group.extraction_source_fingerprint <> p_source_fingerprint
    or v_group.extraction_grouping_revision <> v_group.grouping_revision
    or public.lead_group_extraction_fingerprint(
      v_group.id,
      v_group.extraction_provider,
      v_group.extraction_model,
      v_group.extraction_prompt_version,
      v_group.extraction_schema_version
    ) <> p_source_fingerprint
  then
    raise exception using
      errcode = 'P0001',
      message = 'Lead group extraction completion transition was rejected.';
  end if;

  delete from public.field_evidence as old_evidence
  where old_evidence.lead_group_id = v_group.id
    and old_evidence.extraction_revision = v_group.extraction_target_revision;

  for v_row in select value from jsonb_array_elements(p_field_evidence)
  loop
    if jsonb_typeof(v_row) <> 'object'
      or coalesce(v_row ->> 'field_name', '') !~ '^[a-z][a-z0-9_.]{0,127}$'
      or not (v_row ? 'value_json')
      or coalesce(v_row ->> 'normalized_value', '') = ''
      or coalesce(v_row ->> 'evidence_ref_id', '') !~
        '^(msg:[0-9]+:text|att:[0-9]+:(transcript|ocr)|system:(customer-default|campaign))$'
      or coalesce(v_row ->> 'method', '') not in (
        'teams_text',
        'reply_text',
        'transcript',
        'ocr',
        'system_default'
      )
      or coalesce(v_row ->> 'validation_status', '') not in (
        'accepted',
        'conflicted'
      )
    then
      raise exception using
        errcode = '22023',
        message = 'Lead group field evidence row is invalid.';
    end if;

    if v_row ->> 'evidence_ref_id' like 'system:%' then
      if v_row ->> 'method' <> 'system_default'
        or v_row ->> 'evidence_ref_id' not in (
          'system:customer-default',
          'system:campaign'
        )
        or nullif(v_row ->> 'teams_message_id', '') is not null
        or nullif(v_row ->> 'attachment_id', '') is not null
      then
        raise exception using
          errcode = '22023',
          message = 'System-default evidence row is invalid.';
      end if;
    else
      perform 1
      from public.load_lead_group_extraction_evidence(v_group.id) as source_evidence
      where source_evidence.evidence_id = v_row ->> 'evidence_ref_id'
        and source_evidence.evidence_type = v_row ->> 'method'
        and source_evidence.teams_message_id =
          (v_row ->> 'teams_message_id')::uuid
        and source_evidence.attachment_id is not distinct from
          nullif(v_row ->> 'attachment_id', '')::uuid;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'Field evidence reference is not in the claimed source package.';
      end if;
    end if;

    insert into public.field_evidence (
      lead_id,
      lead_group_id,
      extraction_revision,
      field_name,
      value_json,
      normalized_value,
      evidence_ref_id,
      teams_message_id,
      attachment_id,
      method,
      evidence_text,
      validation_status
    )
    values (
      null,
      v_group.id,
      v_group.extraction_target_revision,
      v_row ->> 'field_name',
      v_row -> 'value_json',
      v_row ->> 'normalized_value',
      v_row ->> 'evidence_ref_id',
      nullif(v_row ->> 'teams_message_id', '')::uuid,
      nullif(v_row ->> 'attachment_id', '')::uuid,
      v_row ->> 'method',
      null,
      v_row ->> 'validation_status'
    );
    v_inserted := v_inserted + 1;
  end loop;

  update public.lead_groups as completed_group
  set extraction_state = 'extracted',
      candidate_payload = p_candidate_payload,
      extraction_revision = completed_group.extraction_target_revision,
      extraction_attempts = completed_group.extraction_attempts,
      extraction_lease_id = null,
      extraction_lease_expires_at = null,
      extraction_error_code = null,
      extraction_completed_at = clock_timestamp(),
      eligibility_state = p_eligibility_state,
      eligibility_reason_code = p_eligibility_reason_code,
      extraction_duration_ms = p_duration_ms,
      extraction_input_tokens = p_input_tokens,
      extraction_output_tokens = p_output_tokens,
      extraction_total_tokens = p_total_tokens,
      updated_at = clock_timestamp()
  where completed_group.id = v_group.id;

  update public.processing_jobs as completed_job
  set status = 'succeeded',
      attempts = v_group.extraction_attempts,
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      updated_at = clock_timestamp()
  where completed_job.job_type = 'process_lead_group'
    and completed_job.aggregate_type = 'lead_group'
    and completed_job.aggregate_id = v_group.id
    and completed_job.content_revision = v_group.extraction_grouping_revision;

  return query select v_group.id, 'extracted'::text, v_inserted;
end;
$$;

create function public.record_lead_group_extraction_outcome(
  p_lead_group_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text,
  p_duration_ms bigint
)
returns table (
  lead_group_id uuid,
  extraction_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.lead_groups%rowtype;
  v_state text;
  v_code text;
begin
  if p_lead_group_id is null
    or p_lease_id is null
    or p_outcome is null
    or p_outcome not in ('retryable_failed', 'permanent_failed')
    or p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{1,64}$'
    or p_duration_ms is null
    or p_duration_ms < 0
  then
    raise exception using
      errcode = '22023',
      message = 'Lead group extraction outcome is invalid.';
  end if;

  select * into v_group
  from public.lead_groups as claimed_group
  where claimed_group.id = p_lead_group_id
    and claimed_group.extraction_state = 'processing'
    and claimed_group.extraction_lease_id = p_lease_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Lead group extraction outcome transition was rejected.';
  end if;

  v_state := case
    when p_outcome = 'retryable_failed' and v_group.extraction_attempts >= 5
      then 'permanent_failed'
    else p_outcome
  end;
  v_code := case
    when p_outcome = 'retryable_failed' and v_group.extraction_attempts >= 5
      then 'RETRY_LIMIT_EXCEEDED'
    else p_error_code
  end;

  update public.lead_groups as failed_group
  set extraction_state = v_state,
      extraction_lease_id = null,
      extraction_lease_expires_at = null,
      extraction_error_code = v_code,
      extraction_duration_ms = p_duration_ms,
      updated_at = clock_timestamp()
  where failed_group.id = v_group.id;

  update public.processing_jobs as failed_job
  set status = v_state,
      attempts = v_group.extraction_attempts,
      run_at = case
        when v_state = 'retryable_failed'
          then clock_timestamp() + interval '1 minute'
        else failed_job.run_at
      end,
      locked_at = null,
      locked_by = null,
      last_error_code = v_code,
      updated_at = clock_timestamp()
  where failed_job.job_type = 'process_lead_group'
    and failed_job.aggregate_type = 'lead_group'
    and failed_job.aggregate_id = v_group.id
    and failed_job.content_revision = v_group.extraction_grouping_revision;

  return query select v_group.id, v_state;
end;
$$;

create function public.load_lead_group_extraction_verification()
returns table (
  lead_group_id uuid,
  candidate_payload jsonb,
  evidence_items jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation_group.id,
    conversation_group.candidate_payload,
    (
      select jsonb_agg(
        jsonb_build_object(
          'evidence_id', group_evidence.evidence_id,
          'evidence_type', group_evidence.evidence_type,
          'teams_message_id', group_evidence.teams_message_id,
          'attachment_id', group_evidence.attachment_id,
          'evidence_text', group_evidence.evidence_text
        )
        order by group_evidence.evidence_order
      )
      from public.load_lead_group_extraction_evidence(
        conversation_group.id
      ) as group_evidence
    )
  from public.lead_groups as conversation_group
  where conversation_group.extraction_state = 'extracted'
    and conversation_group.candidate_payload is not null
    and conversation_group.extraction_grouping_revision =
      conversation_group.grouping_revision
  order by conversation_group.id;
$$;

comment on function public.claim_lead_group_extractions(
  text,
  text,
  text,
  text,
  integer,
  integer
) is
  'Service-role-only SKIP LOCKED group extraction claim. Returns only grouped source evidence with stable synthetic references and a five-attempt fenced lease.';
comment on function public.complete_lead_group_extraction(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  jsonb,
  bigint,
  bigint,
  bigint,
  bigint
) is
  'Service-role-only fenced transaction for the current group candidate and group-target field evidence; it never creates a canonical lead.';
comment on function public.load_lead_group_extraction_verification() is
  'Service-role-only protected verification read; callers must not log the returned candidate or evidence text.';

revoke all on function
  public.enqueue_process_lead_group_job(),
  public.load_lead_group_extraction_evidence(uuid),
  public.lead_group_extraction_fingerprint(uuid, text, text, text, text),
  public.claim_lead_group_extractions(text, text, text, text, integer, integer),
  public.complete_lead_group_extraction(
    uuid,
    uuid,
    text,
    jsonb,
    text,
    text,
    jsonb,
    bigint,
    bigint,
    bigint,
    bigint
  ),
  public.record_lead_group_extraction_outcome(uuid, uuid, text, text, bigint),
  public.load_lead_group_extraction_verification()
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_lead_group_extractions(text, text, text, text, integer, integer),
  public.complete_lead_group_extraction(
    uuid,
    uuid,
    text,
    jsonb,
    text,
    text,
    jsonb,
    bigint,
    bigint,
    bigint,
    bigint
  ),
  public.record_lead_group_extraction_outcome(uuid, uuid, text, text, bigint),
  public.load_lead_group_extraction_verification()
to service_role;

revoke all privileges on table
  public.lead_groups,
  public.field_evidence,
  public.processing_jobs
from service_role;

grant select on table
  public.lead_groups,
  public.field_evidence,
  public.processing_jobs
to service_role;
