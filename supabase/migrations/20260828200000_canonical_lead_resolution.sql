create unique index campaigns_exhibition_key_unique
  on public.campaigns (exhibition_key)
  where exhibition_key is not null;

insert into public.campaigns (
  id,
  name,
  source_id,
  exhibition_key,
  exhibition_bitrix_id,
  is_active
)
values (
  '63000000-0000-4000-8000-000000000063',
  'Hannover Messe 2026',
  'EXHIBITION',
  'hannover_messe_2026',
  63,
  true
)
on conflict (exhibition_key) where exhibition_key is not null do nothing;

alter table public.leads
  alter column assigned_teams_user_id drop not null,
  add column canonical_payload jsonb,
  add column canonical_source_fingerprint text,
  add column canonical_name_key text,
  add column canonical_company_key text,
  add column summary_state text not null default 'pending',
  add column summary_source_fingerprint text,
  add column summary_target_fingerprint text,
  add column summary_provider text,
  add column summary_model text,
  add column summary_prompt_version text,
  add column summary_attempts integer not null default 0,
  add column summary_lease_id uuid,
  add column summary_lease_expires_at timestamptz,
  add column summary_error_code text,
  add column summary_duration_ms bigint,
  add column summary_input_tokens bigint,
  add column summary_output_tokens bigint,
  add column summary_total_tokens bigint,
  add column summary_completed_at timestamptz,
  add constraint leads_canonical_payload_check
    check (canonical_payload is null or jsonb_typeof(canonical_payload) = 'object'),
  add constraint leads_canonical_source_fingerprint_check
    check (
      canonical_source_fingerprint is null
      or canonical_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint leads_summary_state_check
    check (
      summary_state in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  add constraint leads_summary_fingerprint_check
    check (
      (summary_source_fingerprint is null or summary_source_fingerprint ~ '^[0-9a-f]{64}$')
      and (summary_target_fingerprint is null or summary_target_fingerprint ~ '^[0-9a-f]{64}$')
    ),
  add constraint leads_summary_attempts_check
    check (summary_attempts >= 0),
  add constraint leads_summary_lease_check
    check (
      (
        summary_state = 'processing'
        and summary_lease_id is not null
        and summary_lease_expires_at is not null
      )
      or (
        summary_state <> 'processing'
        and summary_lease_id is null
        and summary_lease_expires_at is null
      )
    ),
  add constraint leads_summary_error_check
    check (
      summary_error_code is null
      or summary_error_code ~ '^[A-Z0-9_]{1,64}$'
    ),
  add constraint leads_summary_metrics_check
    check (
      (summary_duration_ms is null or summary_duration_ms >= 0)
      and (summary_input_tokens is null or summary_input_tokens >= 0)
      and (summary_output_tokens is null or summary_output_tokens >= 0)
      and (summary_total_tokens is null or summary_total_tokens >= 0)
    );

alter table public.lead_groups
  add column canonicalization_state text not null default 'pending',
  add column canonicalization_source_fingerprint text,
  add column canonicalization_reason_code text,
  add column canonicalized_at timestamptz,
  add constraint lead_groups_canonicalization_state_check
    check (canonicalization_state in ('pending', 'linked', 'identity_conflict')),
  add constraint lead_groups_canonicalization_fingerprint_check
    check (
      canonicalization_source_fingerprint is null
      or canonicalization_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint lead_groups_canonicalization_reason_check
    check (
      canonicalization_reason_code is null
      or canonicalization_reason_code in (
        'MULTIPLE_STRONG_IDENTITIES',
        'STRONG_SECONDARY_CONFLICT',
        'AMBIGUOUS_NAME_COMPANY',
        'LINKED_IDENTITY_COLLISION'
      )
    );

create table public.lead_identity_keys (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  constraint lead_identity_keys_kind_check check (kind in ('phone', 'email')),
  constraint lead_identity_keys_value_check
    check (
      (kind = 'phone' and normalized_value ~ '^\+?[0-9]{7,15}$')
      or (
        kind = 'email'
        and normalized_value = lower(btrim(normalized_value))
        and normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  constraint lead_identity_keys_identity_unique unique (kind, normalized_value)
);

create index lead_identity_keys_lead_idx
  on public.lead_identity_keys (lead_id);
create index leads_canonical_name_company_idx
  on public.leads (canonical_name_key, canonical_company_key)
  where canonical_name_key is not null and canonical_company_key is not null;

alter table public.lead_identity_keys enable row level security;
revoke all privileges on table public.lead_identity_keys
from public, anon, authenticated, service_role;

create function public.load_eligible_canonicalization_groups()
returns table (
  lead_group_id uuid,
  lead_id uuid,
  candidate_source_fingerprint text,
  candidate_payload jsonb,
  contributors jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    candidate_group.id,
    candidate_group.lead_id,
    candidate_group.candidate_source_fingerprint,
    candidate_group.candidate_payload,
    (
      select jsonb_agg(
        jsonb_build_object(
          'teams_message_id', source_message.id,
          'author_teams_user_id', source_message.author_teams_user_id,
          'source_created_at', source_message.source_created_at
        )
        order by source_message.source_created_at, source_message.id
      )
      from public.lead_group_messages as membership
      join public.teams_messages as source_message
        on source_message.id = membership.teams_message_id
      where membership.lead_group_id = candidate_group.id
    )
  from public.lead_groups as candidate_group
  where candidate_group.extraction_state = 'extracted'
    and candidate_group.eligibility_state = 'eligible'
    and candidate_group.candidate_payload is not null
    and candidate_group.candidate_source_fingerprint is not null
    and candidate_group.extraction_grouping_revision = candidate_group.grouping_revision
  order by candidate_group.created_at, candidate_group.id;
$$;

create function public.resolve_canonical_lead_group(
  p_lead_group_id uuid,
  p_candidate_source_fingerprint text,
  p_identity_keys jsonb,
  p_name_key text,
  p_company_key text
)
returns table (
  lead_group_id uuid,
  lead_id uuid,
  resolution_state text,
  lead_created boolean,
  group_linked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.lead_groups%rowtype;
  v_key jsonb;
  v_strong_ids uuid[];
  v_secondary_ids uuid[];
  v_target_lead_id uuid;
  v_campaign_id uuid;
  v_reason text;
  v_created boolean := false;
  v_linked boolean := false;
begin
  if p_lead_group_id is null
    or p_candidate_source_fingerprint is null
    or p_candidate_source_fingerprint !~ '^[0-9a-f]{64}$'
    or p_identity_keys is null
    or jsonb_typeof(p_identity_keys) <> 'array'
    or jsonb_array_length(p_identity_keys) < 1
    or jsonb_array_length(p_identity_keys) > 64
    or (p_name_key is not null and length(p_name_key) not between 2 and 240)
    or (p_company_key is not null and length(p_company_key) not between 2 and 240)
  then
    raise exception using
      errcode = '22023',
      message = 'Canonical resolution input is invalid.';
  end if;

  for v_key in select value from jsonb_array_elements(p_identity_keys)
  loop
    if jsonb_typeof(v_key) <> 'object'
      or v_key ->> 'kind' not in ('phone', 'email')
      or nullif(v_key ->> 'normalized_value', '') is null
      or (
        v_key ->> 'kind' = 'phone'
        and v_key ->> 'normalized_value' !~ '^\+?[0-9]{7,15}$'
      )
      or (
        v_key ->> 'kind' = 'email'
        and (
          v_key ->> 'normalized_value' <> lower(btrim(v_key ->> 'normalized_value'))
          or v_key ->> 'normalized_value' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      )
    then
      raise exception using
        errcode = '22023',
        message = 'Canonical identity key is invalid.';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('phase4d-canonicalization', 0));

  select * into v_group
  from public.lead_groups as candidate_group
  where candidate_group.id = p_lead_group_id
    and candidate_group.extraction_state = 'extracted'
    and candidate_group.eligibility_state = 'eligible'
    and candidate_group.candidate_source_fingerprint = p_candidate_source_fingerprint
    and candidate_group.extraction_grouping_revision = candidate_group.grouping_revision
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Canonical group resolution transition was rejected.';
  end if;

  if v_group.canonicalization_source_fingerprint = p_candidate_source_fingerprint
    and v_group.canonicalization_state in ('linked', 'identity_conflict')
  then
    return query select
      v_group.id,
      v_group.lead_id,
      v_group.canonicalization_state,
      false,
      false;
    return;
  end if;

  select array_agg(distinct identity_key.lead_id order by identity_key.lead_id)
  into v_strong_ids
  from jsonb_array_elements(p_identity_keys) as candidate_key(value)
  join public.lead_identity_keys as identity_key
    on identity_key.kind = candidate_key.value ->> 'kind'
    and identity_key.normalized_value = candidate_key.value ->> 'normalized_value';

  if p_name_key is not null and p_company_key is not null then
    select array_agg(candidate_lead.id order by candidate_lead.id)
    into v_secondary_ids
    from public.leads as candidate_lead
    where candidate_lead.canonical_name_key = p_name_key
      and candidate_lead.canonical_company_key = p_company_key;
  end if;

  if v_group.lead_id is not null then
    if exists (
      select 1
      from unnest(coalesce(v_strong_ids, '{}'::uuid[])) as matched_lead(id)
      where matched_lead.id <> v_group.lead_id
    )
    then
      update public.lead_groups as conflicted_group
      set canonicalization_state = 'identity_conflict',
          canonicalization_source_fingerprint = p_candidate_source_fingerprint,
          canonicalization_reason_code = 'LINKED_IDENTITY_COLLISION',
          canonicalized_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where conflicted_group.id = v_group.id;
      return query select v_group.id, v_group.lead_id, 'identity_conflict'::text, false, false;
      return;
    end if;
    v_target_lead_id := v_group.lead_id;
  elsif coalesce(cardinality(v_strong_ids), 0) > 1 then
    v_reason := 'MULTIPLE_STRONG_IDENTITIES';
  elsif coalesce(cardinality(v_secondary_ids), 0) > 1 then
    v_reason := 'AMBIGUOUS_NAME_COMPANY';
  elsif coalesce(cardinality(v_strong_ids), 0) = 1
    and coalesce(cardinality(v_secondary_ids), 0) = 1
    and v_strong_ids[1] <> v_secondary_ids[1]
  then
    v_reason := 'STRONG_SECONDARY_CONFLICT';
  elsif coalesce(cardinality(v_strong_ids), 0) = 1 then
    v_target_lead_id := v_strong_ids[1];
  elsif coalesce(cardinality(v_secondary_ids), 0) = 1 then
    v_target_lead_id := v_secondary_ids[1];
  end if;

  if v_reason is not null then
    update public.lead_groups as conflicted_group
    set canonicalization_state = 'identity_conflict',
        canonicalization_source_fingerprint = p_candidate_source_fingerprint,
        canonicalization_reason_code = v_reason,
        canonicalized_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where conflicted_group.id = v_group.id;
    return query select v_group.id, null::uuid, 'identity_conflict'::text, false, false;
    return;
  end if;

  if v_target_lead_id is null then
    select configured_campaign.id into strict v_campaign_id
    from public.campaigns as configured_campaign
    where configured_campaign.exhibition_key = 'hannover_messe_2026'
      and configured_campaign.exhibition_bitrix_id = 63
      and configured_campaign.source_id = 'EXHIBITION';

    insert into public.leads (
      campaign_id,
      title,
      assigned_teams_user_id,
      canonical_name_key,
      canonical_company_key,
      status
    )
    values (
      v_campaign_id,
      'Canonical lead',
      null,
      p_name_key,
      p_company_key,
      'draft'
    )
    returning id into v_target_lead_id;
    v_created := true;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_identity_keys) as candidate_key(value)
    join public.lead_identity_keys as existing_key
      on existing_key.kind = candidate_key.value ->> 'kind'
      and existing_key.normalized_value = candidate_key.value ->> 'normalized_value'
    where existing_key.lead_id <> v_target_lead_id
  )
  then
    raise exception using
      errcode = '23505',
      message = 'Canonical identity key belongs to another lead.';
  end if;

  insert into public.lead_identity_keys (lead_id, kind, normalized_value)
  select distinct
    v_target_lead_id,
    candidate_key.value ->> 'kind',
    candidate_key.value ->> 'normalized_value'
  from jsonb_array_elements(p_identity_keys) as candidate_key(value)
  on conflict (kind, normalized_value) do nothing;

  update public.lead_groups as linked_group
  set lead_id = v_target_lead_id,
      is_primary = case when v_created then true else linked_group.is_primary end,
      status = 'deduplicated',
      canonicalization_state = 'linked',
      canonicalization_source_fingerprint = p_candidate_source_fingerprint,
      canonicalization_reason_code = null,
      canonicalized_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where linked_group.id = v_group.id;
  v_linked := v_group.lead_id is null;

  return query select v_group.id, v_target_lead_id, 'linked'::text, v_created, v_linked;
end;
$$;

create function public.complete_canonical_lead_composition(
  p_lead_id uuid,
  p_canonical_payload jsonb,
  p_identity_keys jsonb,
  p_name_key text,
  p_company_key text
)
returns table (
  lead_id uuid,
  canonical_updated boolean,
  canonical_revision integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_campaign_id uuid;
  v_source_fingerprint text;
  v_latest_author text;
  v_changed boolean;
  v_revision integer;
  v_phones jsonb;
  v_emails jsonb;
  v_products text[];
begin
  if p_lead_id is null
    or p_canonical_payload is null
    or jsonb_typeof(p_canonical_payload) <> 'object'
    or p_canonical_payload #>> '{campaign,exhibition}' <> 'Hannover Messe 2026'
    or p_canonical_payload #>> '{campaign,exhibitionBitrixId}' <> '63'
    or p_canonical_payload #>> '{campaign,source}' <> 'EXHIBITION'
    or p_identity_keys is null
    or jsonb_typeof(p_identity_keys) <> 'array'
    or jsonb_array_length(p_identity_keys) < 1
  then
    raise exception using
      errcode = '22023',
      message = 'Canonical composition input is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('phase4d-canonicalization', 0));

  select * into v_lead
  from public.leads as canonical_lead
  where canonical_lead.id = p_lead_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Canonical lead was not found.';
  end if;

  if not exists (
    select 1
    from public.lead_groups as linked_group
    where linked_group.lead_id = p_lead_id
      and linked_group.canonicalization_state = 'linked'
      and linked_group.extraction_state = 'extracted'
      and linked_group.eligibility_state = 'eligible'
      and linked_group.extraction_grouping_revision = linked_group.grouping_revision
  )
  then
    raise exception using errcode = 'P0001', message = 'Canonical lead has no eligible linked groups.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_identity_keys) as candidate_key(value)
    join public.lead_identity_keys as existing_key
      on existing_key.kind = candidate_key.value ->> 'kind'
      and existing_key.normalized_value = candidate_key.value ->> 'normalized_value'
    where existing_key.lead_id <> p_lead_id
  )
  then
    raise exception using errcode = '23505', message = 'Canonical composition identity collision.';
  end if;

  insert into public.lead_identity_keys (lead_id, kind, normalized_value)
  select distinct
    p_lead_id,
    candidate_key.value ->> 'kind',
    candidate_key.value ->> 'normalized_value'
  from jsonb_array_elements(p_identity_keys) as candidate_key(value)
  on conflict (kind, normalized_value) do nothing;

  select encode(
    extensions.digest(
      string_agg(
        linked_group.id::text || ':' || linked_group.candidate_source_fingerprint,
        '|' order by linked_group.id
      ),
      'sha256'
    ),
    'hex'
  ) into v_source_fingerprint
  from public.lead_groups as linked_group
  where linked_group.lead_id = p_lead_id
    and linked_group.canonicalization_state = 'linked'
    and linked_group.extraction_state = 'extracted'
    and linked_group.eligibility_state = 'eligible'
    and linked_group.extraction_grouping_revision = linked_group.grouping_revision;

  select source_message.author_teams_user_id
  into v_latest_author
  from public.lead_groups as linked_group
  join public.lead_group_messages as membership
    on membership.lead_group_id = linked_group.id
  join public.teams_messages as source_message
    on source_message.id = membership.teams_message_id
  where linked_group.lead_id = p_lead_id
    and linked_group.canonicalization_state = 'linked'
  order by source_message.source_created_at desc, source_message.id desc
  limit 1;

  select configured_campaign.id into strict v_campaign_id
  from public.campaigns as configured_campaign
  where configured_campaign.exhibition_key = 'hannover_messe_2026'
    and configured_campaign.exhibition_bitrix_id = 63
    and configured_campaign.source_id = 'EXHIBITION';

  select coalesce(jsonb_agg(to_jsonb(item.value ->> 'value')), '[]'::jsonb)
  into v_phones
  from jsonb_array_elements(p_canonical_payload -> 'phones') as item(value);
  select coalesce(jsonb_agg(to_jsonb(item.value ->> 'value')), '[]'::jsonb)
  into v_emails
  from jsonb_array_elements(p_canonical_payload -> 'emails') as item(value);
  select coalesce(array_agg(
    case item.value ->> 'value'
      when 'Platform/Core' then 'platform_core'
      when 'Analytics' then 'analytics'
      when 'Integration Services' then 'integration_services'
      when 'Support & SLA' then 'support_sla'
      when 'Training' then 'training'
      when 'OEM/White label' then 'oem_white_label'
    end
    order by item.value ->> 'value'
  ), '{}'::text[])
  into v_products
  from jsonb_array_elements(p_canonical_payload -> 'productInterests') as item(value);

  v_changed := v_lead.canonical_payload is distinct from p_canonical_payload
    or v_lead.assigned_teams_user_id is distinct from v_latest_author
    or v_lead.campaign_id is distinct from v_campaign_id;
  v_revision := case
    when not v_changed then v_lead.revision
    when v_lead.canonical_payload is null then v_lead.revision
    else v_lead.revision + 1
  end;

  update public.leads as canonical_lead
  set campaign_id = v_campaign_id,
      title = coalesce(p_canonical_payload #>> '{person,fullName,value}', 'Canonical lead'),
      full_name = p_canonical_payload #>> '{person,fullName,value}',
      company_name = p_canonical_payload #>> '{person,company,value}',
      job_title = p_canonical_payload #>> '{person,jobTitle,value}',
      phones = v_phones,
      emails = v_emails,
      region_key = case when p_canonical_payload #>> '{region,value}' = 'Europe' then 'europe' end,
      product_interest_keys = v_products,
      priority_key = lower(p_canonical_payload #>> '{priority,value}'),
      lead_type = lower(p_canonical_payload #>> '{leadType,value}'),
      assigned_teams_user_id = v_latest_author,
      canonical_payload = p_canonical_payload,
      canonical_source_fingerprint = v_source_fingerprint,
      canonical_name_key = p_name_key,
      canonical_company_key = p_company_key,
      revision = v_revision,
      status = 'validated',
      summary_state = case when v_changed then 'pending' else canonical_lead.summary_state end,
      summary_lease_id = case when v_changed then null else canonical_lead.summary_lease_id end,
      summary_lease_expires_at = case when v_changed then null else canonical_lead.summary_lease_expires_at end,
      summary_error_code = case when v_changed then null else canonical_lead.summary_error_code end,
      updated_at = case when v_changed then clock_timestamp() else canonical_lead.updated_at end
  where canonical_lead.id = p_lead_id;

  return query select p_lead_id, v_changed, v_revision;
end;
$$;

create function public.canonical_lead_summary_fingerprint(
  p_lead_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text
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
        canonical_lead.id::text,
        canonical_lead.revision::text,
        canonical_lead.canonical_source_fingerprint,
        encode(extensions.digest(canonical_lead.canonical_payload::text, 'sha256'), 'hex'),
        p_provider,
        p_model,
        p_prompt_version
      ),
      'sha256'
    ),
    'hex'
  )
  from public.leads as canonical_lead
  where canonical_lead.id = p_lead_id
    and canonical_lead.canonical_payload is not null
    and canonical_lead.canonical_source_fingerprint is not null;
$$;

create function public.claim_canonical_lead_summaries(
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  lead_id uuid,
  lease_id uuid,
  source_fingerprint text,
  canonical_revision integer,
  summary_attempts integer,
  summary_provider text,
  summary_model text,
  summary_prompt_version text,
  candidate_payload jsonb,
  evidence_items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
    or p_prompt_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_limit not between 1 and 100
    or p_lease_seconds not between 30 and 3600
  then
    raise exception using errcode = '22023', message = 'Canonical summary claim configuration is invalid.';
  end if;

  update public.leads as exhausted_lead
  set summary_state = 'permanent_failed',
      summary_error_code = 'RETRY_LIMIT_EXCEEDED',
      summary_lease_id = null,
      summary_lease_expires_at = null,
      updated_at = clock_timestamp()
  where exhausted_lead.summary_state = 'processing'
    and exhausted_lead.summary_lease_expires_at <= clock_timestamp()
    and exhausted_lead.summary_attempts >= 5;

  return query
  with configured as materialized (
    select
      canonical_lead.id,
      public.canonical_lead_summary_fingerprint(
        canonical_lead.id,
        p_provider,
        p_model,
        p_prompt_version
      ) as target_fingerprint
    from public.leads as canonical_lead
    where canonical_lead.canonical_payload is not null
      and canonical_lead.status = 'validated'
  ),
  eligible as materialized (
    select configured_lead.*,
      coalesce(canonical_lead.summary_target_fingerprint = configured_lead.target_fingerprint, false) as identity_matches
    from configured as configured_lead
    join public.leads as canonical_lead on canonical_lead.id = configured_lead.id
    where (
      (
        canonical_lead.summary_target_fingerprint = configured_lead.target_fingerprint
        and canonical_lead.summary_attempts < 5
        and (
          canonical_lead.summary_state in ('pending', 'retryable_failed')
          or (
            canonical_lead.summary_state = 'processing'
            and canonical_lead.summary_lease_expires_at <= clock_timestamp()
          )
        )
      )
      or (
        canonical_lead.summary_target_fingerprint is distinct from configured_lead.target_fingerprint
        and (
          canonical_lead.summary_state <> 'processing'
          or canonical_lead.summary_lease_expires_at <= clock_timestamp()
        )
      )
    )
    order by canonical_lead.updated_at, canonical_lead.id
    limit p_limit
    for update of canonical_lead skip locked
  ),
  claimed as (
    update public.leads as claimed_lead
    set summary_state = 'processing',
        summary_target_fingerprint = eligible_lead.target_fingerprint,
        summary_provider = p_provider,
        summary_model = p_model,
        summary_prompt_version = p_prompt_version,
        summary_attempts = case when eligible_lead.identity_matches then claimed_lead.summary_attempts + 1 else 1 end,
        summary_lease_id = gen_random_uuid(),
        summary_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        summary_error_code = null,
        summary_duration_ms = null,
        summary_input_tokens = null,
        summary_output_tokens = null,
        summary_total_tokens = null,
        updated_at = clock_timestamp()
    from eligible as eligible_lead
    where claimed_lead.id = eligible_lead.id
    returning claimed_lead.*
  )
  select
    claimed_lead.id,
    claimed_lead.summary_lease_id,
    claimed_lead.summary_target_fingerprint,
    claimed_lead.revision,
    claimed_lead.summary_attempts,
    claimed_lead.summary_provider,
    claimed_lead.summary_model,
    claimed_lead.summary_prompt_version,
    claimed_lead.canonical_payload,
    (
      select jsonb_agg(
        jsonb_build_object(
          'group_ref', linked_group.id,
          'evidence_ref', group_evidence.evidence_id,
          'evidence_type', group_evidence.evidence_type,
          'text', group_evidence.evidence_text
        )
        order by linked_group.id, group_evidence.evidence_order
      )
      from public.lead_groups as linked_group
      cross join lateral public.load_lead_group_extraction_evidence(linked_group.id) as group_evidence
      where linked_group.lead_id = claimed_lead.id
        and linked_group.canonicalization_state = 'linked'
        and linked_group.extraction_state = 'extracted'
        and linked_group.eligibility_state = 'eligible'
        and linked_group.extraction_grouping_revision = linked_group.grouping_revision
    )
  from claimed as claimed_lead
  order by claimed_lead.id;
end;
$$;

create function public.complete_canonical_lead_summary(
  p_lead_id uuid,
  p_lease_id uuid,
  p_source_fingerprint text,
  p_summary_ru text,
  p_duration_ms bigint,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
begin
  if p_summary_ru is null
    or length(btrim(p_summary_ru)) not between 20 and 4000
    or p_summary_ru !~ '[А-Яа-яЁё]'
    or p_summary_ru ~ '(msg:[0-9]+:text|att:[0-9]+:(transcript|ocr))'
    or p_duration_ms is null
    or p_duration_ms < 0
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (p_total_tokens is not null and p_total_tokens < 0)
  then
    raise exception using errcode = '22023', message = 'Canonical summary result is invalid.';
  end if;

  select * into v_lead
  from public.leads as claimed_lead
  where claimed_lead.id = p_lead_id
    and claimed_lead.summary_state = 'processing'
    and claimed_lead.summary_lease_id = p_lease_id
    and claimed_lead.summary_target_fingerprint = p_source_fingerprint
  for update;
  if not found
    or public.canonical_lead_summary_fingerprint(
      v_lead.id,
      v_lead.summary_provider,
      v_lead.summary_model,
      v_lead.summary_prompt_version
    ) <> p_source_fingerprint
  then
    raise exception using errcode = 'P0001', message = 'Canonical summary completion transition was rejected.';
  end if;

  update public.leads as completed_lead
  set summary_ru = p_summary_ru,
      summary_state = 'succeeded',
      summary_source_fingerprint = p_source_fingerprint,
      summary_lease_id = null,
      summary_lease_expires_at = null,
      summary_error_code = null,
      summary_duration_ms = p_duration_ms,
      summary_input_tokens = p_input_tokens,
      summary_output_tokens = p_output_tokens,
      summary_total_tokens = p_total_tokens,
      summary_completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where completed_lead.id = p_lead_id;
end;
$$;

create function public.record_canonical_lead_summary_outcome(
  p_lead_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_error_code text,
  p_duration_ms bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_state text;
  v_code text;
begin
  if p_outcome not in ('retryable_failed', 'permanent_failed')
    or p_error_code !~ '^[A-Z0-9_]{1,64}$'
    or p_duration_ms is null
    or p_duration_ms < 0
  then
    raise exception using errcode = '22023', message = 'Canonical summary outcome is invalid.';
  end if;
  select * into v_lead
  from public.leads as claimed_lead
  where claimed_lead.id = p_lead_id
    and claimed_lead.summary_state = 'processing'
    and claimed_lead.summary_lease_id = p_lease_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Canonical summary outcome transition was rejected.';
  end if;
  v_state := case when p_outcome = 'retryable_failed' and v_lead.summary_attempts >= 5 then 'permanent_failed' else p_outcome end;
  v_code := case when p_outcome = 'retryable_failed' and v_lead.summary_attempts >= 5 then 'RETRY_LIMIT_EXCEEDED' else p_error_code end;
  update public.leads as failed_lead
  set summary_state = v_state,
      summary_lease_id = null,
      summary_lease_expires_at = null,
      summary_error_code = v_code,
      summary_duration_ms = p_duration_ms,
      updated_at = clock_timestamp()
  where failed_lead.id = p_lead_id;
  return v_state;
end;
$$;

revoke all on function
  public.load_eligible_canonicalization_groups(),
  public.resolve_canonical_lead_group(uuid, text, jsonb, text, text),
  public.complete_canonical_lead_composition(uuid, jsonb, jsonb, text, text),
  public.canonical_lead_summary_fingerprint(uuid, text, text, text),
  public.claim_canonical_lead_summaries(text, text, text, integer, integer),
  public.complete_canonical_lead_summary(uuid, uuid, text, text, bigint, bigint, bigint, bigint),
  public.record_canonical_lead_summary_outcome(uuid, uuid, text, text, bigint)
from public, anon, authenticated, service_role;

grant execute on function
  public.load_eligible_canonicalization_groups(),
  public.resolve_canonical_lead_group(uuid, text, jsonb, text, text),
  public.complete_canonical_lead_composition(uuid, jsonb, jsonb, text, text),
  public.claim_canonical_lead_summaries(text, text, text, integer, integer),
  public.complete_canonical_lead_summary(uuid, uuid, text, text, bigint, bigint, bigint, bigint),
  public.record_canonical_lead_summary_outcome(uuid, uuid, text, text, bigint)
to service_role;
