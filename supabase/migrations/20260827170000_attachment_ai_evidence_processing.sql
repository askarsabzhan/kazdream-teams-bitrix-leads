alter table public.attachments
  drop constraint attachments_processing_state_check;

alter table public.attachments
  add column processing_operation text,
  add column processing_source_sha256 text,
  add column processing_prompt_version text,
  add column processing_revision integer not null default 0,
  add column processing_attempts integer not null default 0,
  add column processing_lease_id uuid,
  add column processing_lease_expires_at timestamptz,
  add column last_processing_attempt_at timestamptz,
  add column processing_error_code text,
  add column image_document_type text,
  add column processing_duration_ms bigint,
  add column processing_input_tokens bigint,
  add column processing_output_tokens bigint,
  add column processing_total_tokens bigint,
  add column processing_audio_duration_ms bigint,
  add constraint attachments_processing_state_check
    check (
      processing_state in (
        'pending',
        'processing',
        'processed',
        'unsupported',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  add constraint attachments_processing_operation_check
    check (
      processing_operation is null
      or processing_operation in ('transcription', 'image_text')
    ),
  add constraint attachments_processing_source_sha256_check
    check (
      processing_source_sha256 is null
      or processing_source_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint attachments_processing_prompt_version_check
    check (
      processing_prompt_version is null
      or processing_prompt_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  add constraint attachments_processing_revision_check
    check (processing_revision >= 0),
  add constraint attachments_processing_attempts_check
    check (processing_attempts >= 0),
  add constraint attachments_processing_lease_check
    check (
      (
        processing_state = 'processing'
        and processing_lease_id is not null
        and processing_lease_expires_at is not null
      )
      or (
        processing_state <> 'processing'
        and processing_lease_id is null
        and processing_lease_expires_at is null
      )
    ),
  add constraint attachments_processing_error_code_check
    check (
      processing_error_code is null
      or processing_error_code ~ '^[A-Z0-9_]{1,64}$'
    ),
  add constraint attachments_image_document_type_check
    check (
      image_document_type is null
      or image_document_type in ('business_card', 'other', 'unknown')
    ),
  add constraint attachments_processing_metrics_check
    check (
      (processing_duration_ms is null or processing_duration_ms >= 0)
      and (
        processing_input_tokens is null
        or processing_input_tokens >= 0
      )
      and (
        processing_output_tokens is null
        or processing_output_tokens >= 0
      )
      and (
        processing_total_tokens is null
        or processing_total_tokens >= 0
      )
      and (
        processing_audio_duration_ms is null
        or processing_audio_duration_ms >= 0
      )
    ),
  add constraint attachments_processing_identity_check
    check (
      processing_revision = 0
      or (
        processing_operation is not null
        and processing_source_sha256 is not null
        and provider_name is not null
        and provider_model is not null
        and processing_prompt_version is not null
      )
    ),
  add constraint attachments_processed_evidence_check
    check (
      processing_state <> 'processed'
      or (
        processed_at is not null
        and processing_revision > 0
        and (
          (
            processing_operation = 'transcription'
            and transcript_text is not null
            and ocr_text is null
            and image_document_type is null
          )
          or (
            processing_operation = 'image_text'
            and ocr_text is not null
            and transcript_text is null
            and image_document_type is not null
          )
        )
      )
    );

create index attachments_ai_evidence_claim_idx
  on public.attachments (
    processing_state,
    processing_lease_expires_at,
    created_at
  )
  where is_current and fetch_state = 'fetched';

comment on column public.attachments.transcript_text is
  'Protected AI-derived verbatim transcription. It is not original Teams content and is valid only with the row processing identity.';
comment on column public.attachments.ocr_text is
  'Protected AI-derived visible image text. It is not original Teams content and is valid only with the row processing identity.';
comment on column public.attachments.processing_revision is
  'Increments only when source SHA, operation, provider, model, or prompt/schema version changes; retries retain the same revision.';
comment on column public.attachments.processing_prompt_version is
  'Version of the transcription contract or image prompt and Structured Output schema.';

create function public.claim_attachment_ai_evidence(
  p_provider text,
  p_transcription_model text,
  p_transcription_version text,
  p_image_model text,
  p_image_version text,
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
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
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider is null
    or p_provider !~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    or p_transcription_model is null
    or p_transcription_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_image_model is null
    or p_image_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_transcription_version is null
    or p_transcription_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_image_version is null
    or p_image_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_limit is null
    or p_limit < 1
    or p_limit > 25
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception using
      errcode = '22023',
      message = 'Attachment AI evidence claim configuration is invalid.';
  end if;

  with configured as materialized (
    select
      candidate_attachment.id,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then 'transcription'
        else 'image_text'
      end as target_operation,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then p_transcription_model
        else p_image_model
      end as target_model,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then p_transcription_version
        else p_image_version
      end as target_version
    from public.attachments as candidate_attachment
    where candidate_attachment.is_current
      and candidate_attachment.fetch_state = 'fetched'
      and candidate_attachment.mime_type in (
        'image/png',
        'image/jpeg',
        'image/webp',
        'audio/mpeg',
        'audio/mp4',
        'audio/x-m4a',
        'audio/wav',
        'audio/x-wav',
        'audio/webm'
      )
  ),
  exhausted as (
    select configured_attachment.id
    from configured as configured_attachment
    join public.attachments as exhausted_attachment
      on exhausted_attachment.id = configured_attachment.id
    where exhausted_attachment.processing_attempts >= 5
      and exhausted_attachment.processing_source_sha256 =
        exhausted_attachment.sha256
      and exhausted_attachment.processing_operation =
        configured_attachment.target_operation
      and exhausted_attachment.provider_name = p_provider
      and exhausted_attachment.provider_model =
        configured_attachment.target_model
      and exhausted_attachment.processing_prompt_version =
        configured_attachment.target_version
      and (
        exhausted_attachment.processing_state = 'retryable_failed'
        or (
          exhausted_attachment.processing_state = 'processing'
          and exhausted_attachment.processing_lease_expires_at <=
            clock_timestamp()
        )
      )
  )
  update public.attachments as exhausted_attachment
  set processing_state = 'permanent_failed',
      processing_error_code = 'RETRY_LIMIT_EXCEEDED',
      processing_lease_id = null,
      processing_lease_expires_at = null
  from exhausted
  where exhausted_attachment.id = exhausted.id;

  return query
  with configured as materialized (
    select
      candidate_attachment.id,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then 'transcription'
        else 'image_text'
      end as target_operation,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then p_transcription_model
        else p_image_model
      end as target_model,
      case
        when candidate_attachment.mime_type like 'audio/%'
          then p_transcription_version
        else p_image_version
      end as target_version
    from public.attachments as candidate_attachment
    where candidate_attachment.is_current
      and candidate_attachment.fetch_state = 'fetched'
      and candidate_attachment.mime_type in (
        'image/png',
        'image/jpeg',
        'image/webp',
        'audio/mpeg',
        'audio/mp4',
        'audio/x-m4a',
        'audio/wav',
        'audio/x-wav',
        'audio/webm'
      )
  ),
  eligible as materialized (
    select
      configured_attachment.*,
      coalesce((
        source_attachment.processing_source_sha256 = source_attachment.sha256
        and source_attachment.processing_operation =
          configured_attachment.target_operation
        and source_attachment.provider_name = p_provider
        and source_attachment.provider_model =
          configured_attachment.target_model
        and source_attachment.processing_prompt_version =
          configured_attachment.target_version
      ), false) as identity_matches
    from configured as configured_attachment
    join public.attachments as source_attachment
      on source_attachment.id = configured_attachment.id
  ),
  candidates as materialized (
    select
      candidate_attachment.id,
      eligible_attachment.target_operation,
      eligible_attachment.target_model,
      eligible_attachment.target_version,
      eligible_attachment.identity_matches
    from public.attachments as candidate_attachment
    join eligible as eligible_attachment
      on eligible_attachment.id = candidate_attachment.id
    where (
        eligible_attachment.identity_matches
        and candidate_attachment.processing_attempts < 5
        and (
          candidate_attachment.processing_state in (
            'pending',
            'retryable_failed'
          )
          or (
            candidate_attachment.processing_state = 'processing'
            and candidate_attachment.processing_lease_expires_at <=
              clock_timestamp()
          )
        )
      )
      or (
        not eligible_attachment.identity_matches
        and (
          candidate_attachment.processing_state <> 'processing'
          or candidate_attachment.processing_lease_expires_at <=
            clock_timestamp()
        )
      )
    order by
      candidate_attachment.processing_lease_expires_at nulls first,
      candidate_attachment.created_at,
      candidate_attachment.id
    limit p_limit
    for update of candidate_attachment skip locked
  ),
  claimed as (
    update public.attachments as claimed_attachment
    set processing_state = 'processing',
        processing_operation = candidates.target_operation,
        processing_source_sha256 = claimed_attachment.sha256,
        provider_name = p_provider,
        provider_model = candidates.target_model,
        processing_prompt_version = candidates.target_version,
        processing_revision = case
          when candidates.identity_matches
            then greatest(claimed_attachment.processing_revision, 1)
          else claimed_attachment.processing_revision + 1
        end,
        processing_attempts = case
          when candidates.identity_matches
            then claimed_attachment.processing_attempts + 1
          else 1
        end,
        processing_lease_id = gen_random_uuid(),
        processing_lease_expires_at = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        last_processing_attempt_at = clock_timestamp(),
        processing_error_code = null,
        processed_at = case
          when candidates.identity_matches
            then claimed_attachment.processed_at
          else null
        end,
        transcript_text = case
          when candidates.identity_matches
            then claimed_attachment.transcript_text
          else null
        end,
        ocr_text = case
          when candidates.identity_matches
            then claimed_attachment.ocr_text
          else null
        end,
        image_document_type = case
          when candidates.identity_matches
            then claimed_attachment.image_document_type
          else null
        end,
        processing_duration_ms = null,
        processing_input_tokens = null,
        processing_output_tokens = null,
        processing_total_tokens = null,
        processing_audio_duration_ms = null
    from candidates
    where claimed_attachment.id = candidates.id
    returning claimed_attachment.*
  )
  select
    claimed.id,
    claimed.processing_lease_id,
    claimed.processing_operation,
    claimed.storage_path,
    claimed.mime_type,
    claimed.size_bytes,
    claimed.sha256,
    claimed.provider_name,
    claimed.provider_model,
    claimed.processing_prompt_version,
    claimed.processing_revision,
    claimed.processing_attempts
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

create function public.complete_attachment_ai_evidence(
  p_attachment_id uuid,
  p_lease_id uuid,
  p_operation text,
  p_evidence_text text,
  p_document_type text,
  p_duration_ms bigint,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_audio_duration_ms bigint
)
returns table (
  attachment_id uuid,
  processing_state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attachment_id is null
    or p_lease_id is null
    or p_operation is null
    or p_operation not in ('transcription', 'image_text')
    or p_evidence_text is null
    or (
      p_operation = 'transcription'
      and p_document_type is not null
    )
    or (
      p_operation = 'image_text'
      and (
        p_document_type is null
        or p_document_type not in ('business_card', 'other', 'unknown')
      )
    )
    or p_duration_ms is null
    or p_duration_ms < 0
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (p_total_tokens is not null and p_total_tokens < 0)
    or (
      p_audio_duration_ms is not null
      and p_audio_duration_ms < 0
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Attachment AI evidence completion metadata is invalid.';
  end if;

  return query
  update public.attachments as completed_attachment
  set processing_state = 'processed',
      transcript_text = case
        when p_operation = 'transcription' then p_evidence_text
        else null
      end,
      ocr_text = case
        when p_operation = 'image_text' then p_evidence_text
        else null
      end,
      image_document_type = case
        when p_operation = 'image_text' then p_document_type
        else null
      end,
      processed_at = clock_timestamp(),
      processing_error_code = null,
      processing_lease_id = null,
      processing_lease_expires_at = null,
      processing_duration_ms = p_duration_ms,
      processing_input_tokens = p_input_tokens,
      processing_output_tokens = p_output_tokens,
      processing_total_tokens = p_total_tokens,
      processing_audio_duration_ms = p_audio_duration_ms
  where completed_attachment.id = p_attachment_id
    and completed_attachment.fetch_state = 'fetched'
    and completed_attachment.processing_state = 'processing'
    and completed_attachment.processing_lease_id = p_lease_id
    and completed_attachment.processing_operation = p_operation
    and completed_attachment.processing_source_sha256 =
      completed_attachment.sha256
  returning completed_attachment.id, completed_attachment.processing_state;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Attachment AI evidence completion transition was rejected.';
  end if;
end;
$$;

create function public.record_attachment_ai_evidence_outcome(
  p_attachment_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text,
  p_duration_ms bigint
)
returns table (
  attachment_id uuid,
  processing_state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attachment_id is null
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
      message = 'Attachment AI evidence outcome is invalid.';
  end if;

  return query
  update public.attachments as failed_attachment
  set processing_state = case
        when p_outcome = 'retryable_failed'
          and failed_attachment.processing_attempts >= 5
          then 'permanent_failed'
        else p_outcome
      end,
      processing_error_code = case
        when p_outcome = 'retryable_failed'
          and failed_attachment.processing_attempts >= 5
          then 'RETRY_LIMIT_EXCEEDED'
        else p_error_code
      end,
      processing_lease_id = null,
      processing_lease_expires_at = null,
      processing_duration_ms = p_duration_ms
  where failed_attachment.id = p_attachment_id
    and failed_attachment.processing_state = 'processing'
    and failed_attachment.processing_lease_id = p_lease_id
  returning failed_attachment.id, failed_attachment.processing_state;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Attachment AI evidence outcome transition was rejected.';
  end if;
end;
$$;

comment on function public.claim_attachment_ai_evidence(
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) is
  'Service-role-only SKIP LOCKED claim for current fetched attachment evidence, fenced by a bounded lease and a five-attempt limit per source/provider/model/version identity.';
comment on function public.complete_attachment_ai_evidence(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint
) is
  'Service-role-only fenced completion that stores derived evidence separately from immutable Teams source fields.';
comment on function public.record_attachment_ai_evidence_outcome(
  uuid,
  uuid,
  text,
  text,
  bigint
) is
  'Service-role-only fenced failure transition storing only a safe error code and bounded operational latency.';

revoke all on function
  public.claim_attachment_ai_evidence(
    text,
    text,
    text,
    text,
    text,
    integer,
    integer
  ),
  public.complete_attachment_ai_evidence(
    uuid,
    uuid,
    text,
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint
  ),
  public.record_attachment_ai_evidence_outcome(
    uuid,
    uuid,
    text,
    text,
    bigint
  )
from public, anon, authenticated;

grant execute on function
  public.claim_attachment_ai_evidence(
    text,
    text,
    text,
    text,
    text,
    integer,
    integer
  ),
  public.complete_attachment_ai_evidence(
    uuid,
    uuid,
    text,
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint
  ),
  public.record_attachment_ai_evidence_outcome(
    uuid,
    uuid,
    text,
    text,
    bigint
  )
to service_role;
