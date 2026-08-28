create function public.load_lead_manager_labels(p_lead_ids uuid[])
returns table (
  lead_id uuid,
  manager_label text,
  bitrix_user_id bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or p_lead_ids is null
    or cardinality(p_lead_ids) > 100
    or array_position(p_lead_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'Manager label request is invalid.';
  end if;

  return query
  select
    canonical_lead.id,
    coalesce(
      nullif(btrim(manager_mapping.teams_display_name), ''),
      nullif(btrim(manager_mapping.teams_user_principal_name), '')
    ),
    manager_mapping.bitrix_user_id
  from public.leads as canonical_lead
  left join lateral (
    select mapping.*
    from public.manager_mappings as mapping
    where mapping.teams_user_id = canonical_lead.assigned_teams_user_id
      and mapping.is_active
      and (
        mapping.campaign_id is null
        or mapping.campaign_id = canonical_lead.campaign_id
      )
    order by mapping.campaign_id nulls last, mapping.id
    limit 1
  ) as manager_mapping on true
  where canonical_lead.id = any(p_lead_ids);
end;
$$;

create function public.retry_current_crm_sync(p_lead_id uuid)
returns table (
  outcome text,
  crm_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_outbox public.crm_outbox%rowtype;
begin
  if auth.uid() is null or p_lead_id is null then
    raise exception using errcode = '22023', message = 'CRM retry request is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('phase6-crm-retry:' || p_lead_id::text, 0));

  select * into v_lead
  from public.leads as canonical_lead
  where canonical_lead.id = p_lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Lead was not found.';
  end if;

  if v_lead.canonical_payload is null
    or v_lead.summary_state <> 'succeeded'
    or v_lead.bitrix_source_group_id is null
    or v_lead.status not in ('validated', 'synced', 'crm_pending', 'failed')
  then
    return query select 'not_eligible'::text, v_lead.crm_status;
    return;
  end if;

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
    v_lead.id,
    v_lead.revision,
    'sync',
    null,
    'pending',
    0,
    5,
    clock_timestamp(),
    '[KD-SOURCE:' || v_lead.id::text || ':r' || v_lead.revision::text || ']'
  )
  on conflict (lead_id, lead_revision, operation) do nothing;

  select * into v_outbox
  from public.crm_outbox as current_outbox
  where current_outbox.lead_id = v_lead.id
    and current_outbox.lead_revision = v_lead.revision
    and current_outbox.operation = 'sync'
  for update;

  if v_outbox.status = 'succeeded' then
    return query select 'already_succeeded'::text, v_lead.crm_status;
    return;
  end if;

  if v_outbox.status = 'pending' then
    return query select 'already_queued'::text, v_lead.crm_status;
    return;
  end if;

  if v_outbox.status = 'processing'
    and v_outbox.lease_expires_at > clock_timestamp()
  then
    return query select 'already_processing'::text, v_lead.crm_status;
    return;
  end if;

  if v_outbox.attempts >= v_outbox.max_attempts then
    return query select 'retry_limit_reached'::text, v_lead.crm_status;
    return;
  end if;

  update public.crm_outbox as current_outbox
  set status = 'pending',
      run_at = clock_timestamp(),
      lease_id = null,
      lease_expires_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      completed_at = null,
      updated_at = clock_timestamp()
  where current_outbox.id = v_outbox.id;

  update public.leads as canonical_lead
  set crm_status = 'pending',
      crm_last_error_code = null,
      status = case when canonical_lead.status = 'failed' then 'crm_pending' else canonical_lead.status end,
      updated_at = clock_timestamp()
  where canonical_lead.id = v_lead.id;

  return query select 'queued'::text, 'pending'::text;
end;
$$;

create function public.set_app_profile_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_role not in ('user', 'admin') then
    raise exception using errcode = '22023', message = 'Profile role request is invalid.';
  end if;

  update public.profiles
  set role = p_role,
      updated_at = clock_timestamp()
  where id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Profile was not found.';
  end if;
end;
$$;

revoke all on function
  public.load_lead_manager_labels(uuid[]),
  public.retry_current_crm_sync(uuid),
  public.set_app_profile_role(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.load_lead_manager_labels(uuid[]),
  public.retry_current_crm_sync(uuid)
to authenticated;

grant execute on function public.set_app_profile_role(uuid, text)
to service_role;

comment on function public.retry_current_crm_sync(uuid) is
  'Authenticated, payload-free request to requeue only the current durable Bitrix sync operation.';
