create or replace function public.claim_teams_attachment_acquisition(
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
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
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception using
      errcode = '22023',
      message = 'Attachment acquisition claim limit is invalid.';
  end if;

  if p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception using
      errcode = '22023',
      message = 'Attachment acquisition lease duration is invalid.';
  end if;

  -- The attempt count is durable. A fifth retryable failure is terminalized by
  -- the outcome RPC; a worker crash during attempt five is terminalized here
  -- after its lease expires, so no row can remain downloading forever.
  update public.attachments as exhausted_attachment
  set fetch_state = 'permanent_failed',
      last_error_code = 'RETRY_LIMIT_EXCEEDED',
      fetch_lease_id = null,
      fetch_lease_expires_at = null
  where exhausted_attachment.is_current
    and exhausted_attachment.fetch_attempts >= 5
    and (
      exhausted_attachment.fetch_state = 'retryable_failed'
      or (
        exhausted_attachment.fetch_state = 'downloading'
        and exhausted_attachment.fetch_lease_expires_at <= clock_timestamp()
      )
    );

  return query
  with candidates as materialized (
    select candidate_attachment.id
    from public.attachments as candidate_attachment
    where candidate_attachment.is_current
      and candidate_attachment.fetch_attempts < 5
      and (
        candidate_attachment.fetch_state in (
          'pending',
          'retryable_failed'
        )
        or (
          candidate_attachment.fetch_state = 'downloading'
          and candidate_attachment.fetch_lease_expires_at <=
            clock_timestamp()
        )
      )
    order by
      candidate_attachment.fetch_lease_expires_at nulls first,
      candidate_attachment.created_at,
      candidate_attachment.id
    limit p_limit
    for update of candidate_attachment skip locked
  ),
  claimed as (
    update public.attachments as claimed_attachment
    set fetch_state = 'downloading',
        fetch_attempts = claimed_attachment.fetch_attempts + 1,
        fetch_lease_id = gen_random_uuid(),
        fetch_lease_expires_at = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        last_fetch_attempt_at = clock_timestamp(),
        last_error_code = null
    from candidates
    where claimed_attachment.id = candidates.id
    returning claimed_attachment.*
  )
  select
    claimed.id,
    claimed.teams_message_id,
    claimed.fetch_lease_id,
    source_message.tenant_id,
    source_message.team_id,
    source_message.channel_id,
    source_message.external_message_id,
    source_message.reply_to_external_message_id,
    claimed.attachment_kind,
    claimed.source_locator,
    claimed.mime_type,
    claimed.size_bytes,
    claimed.fetch_attempts
  from claimed
  join public.teams_messages as source_message
    on source_message.id = claimed.teams_message_id
  order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.record_teams_attachment_acquisition_outcome(
  p_attachment_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text
)
returns table (
  attachment_id uuid,
  fetch_state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attachment_id is null
    or p_lease_id is null
    or p_outcome not in (
      'unsupported',
      'retryable_failed',
      'permanent_failed'
    )
    or p_error_code !~ '^[A-Z0-9_]{1,64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Attachment acquisition outcome is invalid.';
  end if;

  return query
  update public.attachments as failed_attachment
  set fetch_state = case
        when p_outcome = 'retryable_failed'
          and failed_attachment.fetch_attempts >= 5
          then 'permanent_failed'
        else p_outcome
      end,
      last_error_code = case
        when p_outcome = 'retryable_failed'
          and failed_attachment.fetch_attempts >= 5
          then 'RETRY_LIMIT_EXCEEDED'
        else p_error_code
      end,
      fetch_lease_id = null,
      fetch_lease_expires_at = null
  where failed_attachment.id = p_attachment_id
    and failed_attachment.fetch_state = 'downloading'
    and failed_attachment.fetch_lease_id = p_lease_id
  returning failed_attachment.id, failed_attachment.fetch_state;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Attachment acquisition outcome transition was rejected.';
  end if;
end;
$$;

comment on function public.claim_teams_attachment_acquisition(integer, integer)
is 'Service-role-only SKIP LOCKED claim with a bounded lease and a durable maximum of five acquisition attempts.';
comment on function public.record_teams_attachment_acquisition_outcome(uuid, uuid, text, text)
is 'Service-role-only safe outcome transition; a fifth retryable failure becomes permanent with RETRY_LIMIT_EXCEEDED.';

revoke all on function
  public.claim_teams_attachment_acquisition(integer, integer),
  public.record_teams_attachment_acquisition_outcome(uuid, uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.claim_teams_attachment_acquisition(integer, integer),
  public.record_teams_attachment_acquisition_outcome(uuid, uuid, text, text)
to service_role;
