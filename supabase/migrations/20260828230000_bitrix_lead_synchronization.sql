alter table public.leads
  drop constraint leads_crm_status_check,
  add column bitrix_source_group_id uuid references public.lead_groups (id),
  add column crm_synced_revision integer,
  add column crm_last_error_code text,
  add column crm_synced_at timestamptz,
  add constraint leads_crm_status_check
    check (
      crm_status in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'permanent_failed',
        'blocked'
      )
    ),
  add constraint leads_crm_synced_revision_check
    check (crm_synced_revision is null or crm_synced_revision > 0),
  add constraint leads_crm_error_code_check
    check (
      crm_last_error_code is null
      or crm_last_error_code ~ '^[A-Z0-9_]{1,64}$'
    );

alter table public.crm_outbox
  drop constraint crm_outbox_status_check,
  alter column max_attempts set default 5,
  add column lease_id uuid,
  add column lease_expires_at timestamptz,
  add column bitrix_lead_id bigint,
  add column sync_action text,
  add column crm_completed_at timestamptz,
  add column source_comment_state text not null default 'pending',
  add column source_comment_marker text,
  add column bitrix_timeline_comment_id bigint,
  add column source_comment_completed_at timestamptz,
  add column last_duration_ms bigint,
  add constraint crm_outbox_status_check
    check (
      status in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'reconciling',
        'permanent_failed',
        'blocked'
      )
    ),
  add constraint crm_outbox_bounded_attempts_check
    check (max_attempts between 1 and 5 and attempts <= max_attempts),
  add constraint crm_outbox_lease_check
    check (
      (
        status = 'processing'
        and lease_id is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'processing'
        and lease_id is null
        and lease_expires_at is null
      )
    ),
  add constraint crm_outbox_bitrix_lead_id_check
    check (bitrix_lead_id is null or bitrix_lead_id > 0),
  add constraint crm_outbox_sync_action_check
    check (sync_action is null or sync_action in ('created', 'updated', 'recovered')),
  add constraint crm_outbox_source_comment_state_check
    check (source_comment_state in ('pending', 'succeeded')),
  add constraint crm_outbox_source_comment_marker_check
    check (
      source_comment_marker is null
      or source_comment_marker ~ '^\[KD-SOURCE:[0-9a-f-]{36}:r[1-9][0-9]*\]$'
    ),
  add constraint crm_outbox_timeline_comment_id_check
    check (bitrix_timeline_comment_id is null or bitrix_timeline_comment_id > 0),
  add constraint crm_outbox_duration_check
    check (last_duration_ms is null or last_duration_ms >= 0);

update public.crm_outbox
set max_attempts = least(max_attempts, 5);

create index crm_outbox_lead_status_idx
  on public.crm_outbox (lead_id, status, lead_revision);

create function public.prepare_bitrix_source_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.bitrix_source_group_id is not null
    and new.bitrix_source_group_id is distinct from old.bitrix_source_group_id
  then
    raise exception using
      errcode = '23514',
      message = 'The immutable Bitrix source group cannot be changed.';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.revision is distinct from old.revision
      or new.canonical_payload is distinct from old.canonical_payload
      or new.assigned_teams_user_id is distinct from old.assigned_teams_user_id
    )
  then
    new.crm_status := 'pending';
    new.crm_last_error_code := null;
  end if;

  if new.bitrix_source_group_id is null
    and new.canonical_payload is not null
    and new.summary_state = 'succeeded'
  then
    select linked_group.id
    into new.bitrix_source_group_id
    from public.lead_groups as linked_group
    where linked_group.lead_id = new.id
      and linked_group.canonicalization_state = 'linked'
    order by linked_group.is_primary desc, linked_group.created_at, linked_group.id
    limit 1;
  end if;

  if new.bitrix_source_group_id is not null
    and not exists (
      select 1
      from public.lead_groups as source_group
      where source_group.id = new.bitrix_source_group_id
        and source_group.lead_id = new.id
        and source_group.canonicalization_state = 'linked'
    )
  then
    raise exception using
      errcode = '23514',
      message = 'The Bitrix source group must belong to the canonical lead.';
  end if;

  return new;
end;
$$;

create trigger leads_prepare_bitrix_source_group
before insert or update on public.leads
for each row execute function public.prepare_bitrix_source_group();

create function public.enqueue_canonical_lead_crm_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.canonical_payload is not null
    and new.summary_state = 'succeeded'
    and new.bitrix_source_group_id is not null
    and new.status in ('validated', 'synced')
  then
    insert into public.crm_outbox (
      lead_id,
      lead_revision,
      operation,
      payload,
      status,
      attempts,
      max_attempts,
      run_at,
      source_comment_marker
    )
    values (
      new.id,
      new.revision,
      'sync',
      null,
      'pending',
      0,
      5,
      clock_timestamp(),
      '[KD-SOURCE:' || new.id::text || ':r' || new.revision::text || ']'
    )
    on conflict (lead_id, lead_revision, operation) do nothing;
  end if;
  return null;
end;
$$;

create trigger leads_enqueue_crm_sync
after insert or update on public.leads
for each row execute function public.enqueue_canonical_lead_crm_sync();

update public.leads as canonical_lead
set bitrix_source_group_id = (
  select linked_group.id
  from public.lead_groups as linked_group
  where linked_group.lead_id = canonical_lead.id
    and linked_group.canonicalization_state = 'linked'
  order by linked_group.is_primary desc, linked_group.created_at, linked_group.id
  limit 1
)
where canonical_lead.canonical_payload is not null
  and canonical_lead.summary_state = 'succeeded'
  and canonical_lead.bitrix_source_group_id is null;

insert into public.crm_outbox (
  lead_id,
  lead_revision,
  operation,
  payload,
  status,
  attempts,
  max_attempts,
  run_at,
  source_comment_marker
)
select
  canonical_lead.id,
  canonical_lead.revision,
  'sync',
  null,
  'pending',
  0,
  5,
  clock_timestamp(),
  '[KD-SOURCE:' || canonical_lead.id::text || ':r' || canonical_lead.revision::text || ']'
from public.leads as canonical_lead
where canonical_lead.canonical_payload is not null
  and canonical_lead.summary_state = 'succeeded'
  and canonical_lead.bitrix_source_group_id is not null
on conflict (lead_id, lead_revision, operation) do nothing;

create function public.claim_crm_sync_outbox(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  lease_id uuid,
  attempts integer,
  lead_id uuid,
  lead_revision integer,
  local_bitrix_lead_id bigint,
  outbox_bitrix_lead_id bigint,
  sync_action text,
  crm_completed_at timestamptz,
  source_comment_state text,
  source_comment_marker text,
  bitrix_source_group_id uuid,
  assigned_teams_user_id text,
  canonical_payload jsonb,
  summary_ru text,
  group_ids jsonb,
  teams_message_ids jsonb,
  source_evidence jsonb,
  cached_manager_mappings jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$'
    or p_limit not between 1 and 50
    or p_lease_seconds not between 30 and 3600
  then
    raise exception using errcode = '22023', message = 'CRM outbox claim configuration is invalid.';
  end if;

  update public.crm_outbox as stale_outbox
  set status = 'permanent_failed',
      lease_id = null,
      lease_expires_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = 'STALE_CANONICAL_REVISION',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from public.leads as current_lead
  where current_lead.id = stale_outbox.lead_id
    and stale_outbox.status in ('pending', 'retryable_failed', 'processing')
    and stale_outbox.lead_revision <> current_lead.revision;

  update public.crm_outbox as exhausted_outbox
  set status = 'permanent_failed',
      lease_id = null,
      lease_expires_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = 'RETRY_LIMIT_EXCEEDED',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where exhausted_outbox.status = 'processing'
    and exhausted_outbox.lease_expires_at <= clock_timestamp()
    and exhausted_outbox.attempts >= exhausted_outbox.max_attempts;

  return query
  with eligible as materialized (
    select candidate_outbox.id
    from public.crm_outbox as candidate_outbox
    join public.leads as candidate_lead on candidate_lead.id = candidate_outbox.lead_id
    where candidate_outbox.operation = 'sync'
      and candidate_outbox.lead_revision = candidate_lead.revision
      and candidate_lead.canonical_payload is not null
      and candidate_lead.summary_state = 'succeeded'
      and candidate_lead.bitrix_source_group_id is not null
      and candidate_outbox.attempts < candidate_outbox.max_attempts
      and candidate_outbox.run_at <= clock_timestamp()
      and (
        candidate_outbox.status in ('pending', 'retryable_failed')
        or (
          candidate_outbox.status = 'processing'
          and candidate_outbox.lease_expires_at <= clock_timestamp()
        )
      )
      and not exists (
        select 1
        from public.crm_outbox as active_outbox
        where active_outbox.lead_id = candidate_outbox.lead_id
          and active_outbox.id <> candidate_outbox.id
          and active_outbox.status = 'processing'
          and active_outbox.lease_expires_at > clock_timestamp()
      )
    order by candidate_outbox.run_at, candidate_outbox.created_at, candidate_outbox.id
    limit p_limit
    for update of candidate_outbox skip locked
  ),
  claimed as (
    update public.crm_outbox as claimed_outbox
    set status = 'processing',
        attempts = claimed_outbox.attempts + 1,
        lease_id = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        locked_at = clock_timestamp(),
        locked_by = p_worker_id,
        last_error_code = null,
        last_duration_ms = null,
        updated_at = clock_timestamp()
    from eligible as eligible_outbox
    where claimed_outbox.id = eligible_outbox.id
    returning claimed_outbox.*
  ),
  marked_leads as (
    update public.leads as claimed_lead
    set crm_status = 'processing',
        crm_last_error_code = null,
        updated_at = clock_timestamp()
    from claimed as claimed_outbox
    where claimed_lead.id = claimed_outbox.lead_id
    returning claimed_lead.id
  )
  select
    claimed_outbox.id,
    claimed_outbox.lease_id,
    claimed_outbox.attempts,
    canonical_lead.id,
    canonical_lead.revision,
    canonical_lead.bitrix_lead_id,
    claimed_outbox.bitrix_lead_id,
    claimed_outbox.sync_action,
    claimed_outbox.crm_completed_at,
    claimed_outbox.source_comment_state,
    claimed_outbox.source_comment_marker,
    canonical_lead.bitrix_source_group_id,
    canonical_lead.assigned_teams_user_id,
    canonical_lead.canonical_payload,
    canonical_lead.summary_ru,
    (
      select jsonb_agg(linked_group.id order by linked_group.created_at, linked_group.id)
      from public.lead_groups as linked_group
      where linked_group.lead_id = canonical_lead.id
        and linked_group.canonicalization_state = 'linked'
    ),
    (
      select jsonb_agg(source_message.external_message_id order by source_message.source_created_at, source_message.id)
      from public.lead_groups as linked_group
      join public.lead_group_messages as membership on membership.lead_group_id = linked_group.id
      join public.teams_messages as source_message on source_message.id = membership.teams_message_id
      where linked_group.lead_id = canonical_lead.id
        and linked_group.canonicalization_state = 'linked'
    ),
    (
      select jsonb_agg(
        jsonb_build_object(
          'evidence_type', source_evidence.evidence_type,
          'text', source_evidence.evidence_text
        )
        order by linked_group.created_at, linked_group.id, source_evidence.evidence_order
      )
      from public.lead_groups as linked_group
      cross join lateral public.load_lead_group_extraction_evidence(linked_group.id) as source_evidence
      where linked_group.lead_id = canonical_lead.id
        and linked_group.canonicalization_state = 'linked'
    ),
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'bitrix_user_id', manager_mapping.bitrix_user_id,
            'email', manager_mapping.teams_user_principal_name
          )
          order by manager_mapping.campaign_id nulls last, manager_mapping.id
        ),
        '[]'::jsonb
      )
      from public.manager_mappings as manager_mapping
      where manager_mapping.teams_user_id = canonical_lead.assigned_teams_user_id
        and manager_mapping.is_active
        and (
          manager_mapping.campaign_id is null
          or manager_mapping.campaign_id = canonical_lead.campaign_id
        )
    )
  from claimed as claimed_outbox
  join public.leads as canonical_lead on canonical_lead.id = claimed_outbox.lead_id
  join marked_leads on marked_leads.id = canonical_lead.id
  order by claimed_outbox.created_at, claimed_outbox.id;
end;
$$;

create function public.persist_crm_manager_mapping(
  p_teams_user_id text,
  p_email text,
  p_bitrix_user_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.manager_mappings%rowtype;
  v_mapping_id uuid;
begin
  if nullif(btrim(p_teams_user_id), '') is null
    or length(p_teams_user_id) > 255
    or p_email is null
    or p_email <> lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_bitrix_user_id is null
    or p_bitrix_user_id <= 0
  then
    raise exception using errcode = '22023', message = 'CRM manager mapping input is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('phase5-manager-mapping:' || p_teams_user_id, 0));
  select * into v_existing
  from public.manager_mappings as existing_mapping
  where existing_mapping.campaign_id is null
    and existing_mapping.teams_user_id = p_teams_user_id
  for update;

  if found and v_existing.bitrix_user_id <> p_bitrix_user_id then
    raise exception using errcode = '23505', message = 'CRM manager mapping conflict.';
  end if;

  if found then
    update public.manager_mappings as existing_mapping
    set teams_user_principal_name = p_email,
        is_active = true,
        updated_at = clock_timestamp()
    where existing_mapping.id = v_existing.id
    returning existing_mapping.id into v_mapping_id;
  else
    insert into public.manager_mappings (
      campaign_id,
      teams_user_id,
      teams_user_principal_name,
      teams_display_name,
      bitrix_user_id,
      is_active
    )
    values (null, p_teams_user_id, p_email, null, p_bitrix_user_id, true)
    returning id into v_mapping_id;
  end if;
  return v_mapping_id;
end;
$$;

create function public.complete_crm_lead_delivery(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_bitrix_lead_id bigint,
  p_sync_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.crm_outbox%rowtype;
  v_lead public.leads%rowtype;
begin
  if p_bitrix_lead_id is null
    or p_bitrix_lead_id <= 0
    or p_sync_action not in ('created', 'updated', 'recovered')
  then
    raise exception using errcode = '22023', message = 'CRM delivery result is invalid.';
  end if;

  select * into v_outbox
  from public.crm_outbox as claimed_outbox
  where claimed_outbox.id = p_outbox_id
    and claimed_outbox.status = 'processing'
    and claimed_outbox.lease_id = p_lease_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CRM delivery transition was rejected.';
  end if;

  select * into v_lead
  from public.leads as canonical_lead
  where canonical_lead.id = v_outbox.lead_id
    and canonical_lead.revision = v_outbox.lead_revision
    and canonical_lead.summary_state = 'succeeded'
  for update;
  if not found
    or (v_lead.bitrix_lead_id is not null and v_lead.bitrix_lead_id <> p_bitrix_lead_id)
  then
    raise exception using errcode = 'P0001', message = 'CRM lead binding transition was rejected.';
  end if;

  update public.leads as canonical_lead
  set bitrix_lead_id = p_bitrix_lead_id,
      crm_status = 'processing',
      crm_last_error_code = null,
      updated_at = clock_timestamp()
  where canonical_lead.id = v_outbox.lead_id;

  update public.crm_outbox as claimed_outbox
  set bitrix_lead_id = p_bitrix_lead_id,
      sync_action = p_sync_action,
      crm_completed_at = coalesce(claimed_outbox.crm_completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where claimed_outbox.id = p_outbox_id;
end;
$$;

create function public.complete_crm_sync_outbox(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_timeline_comment_id bigint,
  p_duration_ms bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.crm_outbox%rowtype;
  v_lead public.leads%rowtype;
begin
  if p_timeline_comment_id is null
    or p_timeline_comment_id <= 0
    or p_duration_ms is null
    or p_duration_ms < 0
  then
    raise exception using errcode = '22023', message = 'CRM completion result is invalid.';
  end if;

  select * into v_outbox
  from public.crm_outbox as claimed_outbox
  where claimed_outbox.id = p_outbox_id
    and claimed_outbox.status = 'processing'
    and claimed_outbox.lease_id = p_lease_id
    and claimed_outbox.crm_completed_at is not null
    and claimed_outbox.bitrix_lead_id is not null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CRM completion transition was rejected.';
  end if;

  select * into v_lead
  from public.leads as canonical_lead
  where canonical_lead.id = v_outbox.lead_id
    and canonical_lead.revision = v_outbox.lead_revision
    and canonical_lead.bitrix_lead_id = v_outbox.bitrix_lead_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CRM completion lead fence was rejected.';
  end if;

  update public.crm_outbox as completed_outbox
  set status = 'succeeded',
      source_comment_state = 'succeeded',
      bitrix_timeline_comment_id = p_timeline_comment_id,
      source_comment_completed_at = clock_timestamp(),
      lease_id = null,
      lease_expires_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      last_duration_ms = p_duration_ms,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where completed_outbox.id = p_outbox_id;

  update public.leads as completed_lead
  set crm_status = 'succeeded',
      crm_synced_revision = v_outbox.lead_revision,
      crm_last_error_code = null,
      crm_synced_at = clock_timestamp(),
      status = 'synced',
      updated_at = clock_timestamp()
  where completed_lead.id = v_outbox.lead_id;

  update public.lead_groups as completed_group
  set status = 'synced',
      updated_at = clock_timestamp()
  where completed_group.lead_id = v_outbox.lead_id
    and completed_group.canonicalization_state = 'linked';
end;
$$;

create function public.record_crm_sync_outcome(
  p_outbox_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text,
  p_duration_ms bigint,
  p_retry_delay_seconds integer default 60
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.crm_outbox%rowtype;
  v_state text;
  v_code text;
begin
  if p_outcome not in ('retryable_failed', 'permanent_failed', 'blocked')
    or p_error_code !~ '^[A-Z0-9_]{1,64}$'
    or p_duration_ms is null
    or p_duration_ms < 0
    or p_retry_delay_seconds not between 1 and 86400
  then
    raise exception using errcode = '22023', message = 'CRM failure outcome is invalid.';
  end if;

  select * into v_outbox
  from public.crm_outbox as claimed_outbox
  where claimed_outbox.id = p_outbox_id
    and claimed_outbox.status = 'processing'
    and claimed_outbox.lease_id = p_lease_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CRM failure transition was rejected.';
  end if;

  v_state := case
    when p_outcome = 'retryable_failed' and v_outbox.attempts >= v_outbox.max_attempts
      then 'permanent_failed'
    else p_outcome
  end;
  v_code := case
    when p_outcome = 'retryable_failed' and v_outbox.attempts >= v_outbox.max_attempts
      then 'RETRY_LIMIT_EXCEEDED'
    else p_error_code
  end;

  update public.crm_outbox as failed_outbox
  set status = v_state,
      lease_id = null,
      lease_expires_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = v_code,
      last_duration_ms = p_duration_ms,
      run_at = case
        when v_state = 'retryable_failed'
          then clock_timestamp() + make_interval(secs => p_retry_delay_seconds)
        else failed_outbox.run_at
      end,
      completed_at = case when v_state in ('permanent_failed', 'blocked') then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where failed_outbox.id = p_outbox_id;

  update public.leads as failed_lead
  set crm_status = v_state,
      crm_last_error_code = v_code,
      updated_at = clock_timestamp()
  where failed_lead.id = v_outbox.lead_id;
  return v_state;
end;
$$;

create function public.load_crm_sync_verification_targets()
returns table (
  lead_id uuid,
  lead_revision integer,
  bitrix_lead_id bigint,
  bitrix_source_group_id uuid,
  assigned_bitrix_user_id bigint,
  assigned_manager_email text,
  canonical_payload jsonb,
  summary_ru text,
  group_ids jsonb,
  teams_message_ids jsonb,
  source_comment_confirmed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    canonical_lead.id,
    canonical_lead.revision,
    canonical_lead.bitrix_lead_id,
    canonical_lead.bitrix_source_group_id,
    (
      select manager_mapping.bitrix_user_id
      from public.manager_mappings as manager_mapping
      where manager_mapping.teams_user_id = canonical_lead.assigned_teams_user_id
        and manager_mapping.is_active
        and (manager_mapping.campaign_id is null or manager_mapping.campaign_id = canonical_lead.campaign_id)
      order by manager_mapping.campaign_id nulls last, manager_mapping.id
      limit 1
    ),
    (
      select manager_mapping.teams_user_principal_name
      from public.manager_mappings as manager_mapping
      where manager_mapping.teams_user_id = canonical_lead.assigned_teams_user_id
        and manager_mapping.is_active
        and (manager_mapping.campaign_id is null or manager_mapping.campaign_id = canonical_lead.campaign_id)
      order by manager_mapping.campaign_id nulls last, manager_mapping.id
      limit 1
    ),
    canonical_lead.canonical_payload,
    canonical_lead.summary_ru,
    (
      select jsonb_agg(linked_group.id order by linked_group.created_at, linked_group.id)
      from public.lead_groups as linked_group
      where linked_group.lead_id = canonical_lead.id
        and linked_group.canonicalization_state = 'linked'
    ),
    (
      select jsonb_agg(source_message.external_message_id order by source_message.source_created_at, source_message.id)
      from public.lead_groups as linked_group
      join public.lead_group_messages as membership on membership.lead_group_id = linked_group.id
      join public.teams_messages as source_message on source_message.id = membership.teams_message_id
      where linked_group.lead_id = canonical_lead.id
        and linked_group.canonicalization_state = 'linked'
    ),
    current_outbox.source_comment_state = 'succeeded'
      and current_outbox.bitrix_timeline_comment_id is not null
  from public.leads as canonical_lead
  join public.crm_outbox as current_outbox
    on current_outbox.lead_id = canonical_lead.id
    and current_outbox.lead_revision = canonical_lead.revision
    and current_outbox.operation = 'sync'
    and current_outbox.status = 'succeeded'
  where canonical_lead.crm_status = 'succeeded'
    and canonical_lead.bitrix_lead_id is not null
  order by canonical_lead.created_at, canonical_lead.id;
$$;

revoke insert, update, delete on table
  public.leads,
  public.lead_groups,
  public.crm_outbox,
  public.manager_mappings
from service_role;

revoke all on function
  public.prepare_bitrix_source_group(),
  public.enqueue_canonical_lead_crm_sync(),
  public.claim_crm_sync_outbox(text, integer, integer),
  public.persist_crm_manager_mapping(text, text, bigint),
  public.complete_crm_lead_delivery(uuid, uuid, bigint, text),
  public.complete_crm_sync_outbox(uuid, uuid, bigint, bigint),
  public.record_crm_sync_outcome(uuid, uuid, text, text, bigint, integer),
  public.load_crm_sync_verification_targets()
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_crm_sync_outbox(text, integer, integer),
  public.persist_crm_manager_mapping(text, text, bigint),
  public.complete_crm_lead_delivery(uuid, uuid, bigint, text),
  public.complete_crm_sync_outbox(uuid, uuid, bigint, bigint),
  public.record_crm_sync_outcome(uuid, uuid, text, text, bigint, integer),
  public.load_crm_sync_verification_targets()
to service_role;

comment on column public.leads.bitrix_source_group_id is
  'Immutable primary conversation-group identity used for remote Bitrix lead creation lookup.';
comment on column public.crm_outbox.crm_completed_at is
  'Durable boundary after Bitrix lead add/update/recovery and before the separate source timeline comment.';
comment on column public.crm_outbox.source_comment_marker is
  'PII-free deterministic marker; timeline comments have weaker remote replay guarantees than lead creation.';
