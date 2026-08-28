alter table public.lead_groups
  add column grouping_key text,
  add column grouping_algorithm_version text not null default 'v1',
  add column grouping_revision integer not null default 1,
  add constraint lead_groups_grouping_algorithm_version_check
    check (
      grouping_algorithm_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  add constraint lead_groups_grouping_revision_check
    check (grouping_revision > 0);

update public.lead_groups
set grouping_key = 'legacy:' || id::text
where grouping_key is null;

alter table public.lead_groups
  alter column grouping_key set not null,
  add constraint lead_groups_grouping_key_check
    check (grouping_key ~ '^[a-z0-9][a-z0-9:_-]{0,127}$');

comment on table public.lead_groups is
  'Pre-lead manager-side conversation groups in Phase 4B. A group is not a canonical CRM lead and lead_id remains nullable until later phases.';
comment on column public.lead_groups.grouping_revision is
  'Increments once per transaction when membership or grouping-relevant source identity changes.';

create unique index lead_groups_grouping_key_idx
  on public.lead_groups (grouping_key);

alter table public.lead_group_messages
  add column grouping_algorithm_version text not null default 'v1',
  add column grouping_source_fingerprint text,
  add constraint lead_group_messages_algorithm_version_check
    check (
      grouping_algorithm_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  add constraint lead_group_messages_source_fingerprint_check
    check (
      grouping_source_fingerprint is null
      or grouping_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint lead_group_messages_reason_check
    check (
      grouping_reason is null
      or grouping_reason in (
        'explicit_reply',
        'exact_phone',
        'exact_email',
        'name_company',
        'continuation_to_existing_group',
        'new_distinct_identity'
      )
    ),
  add constraint lead_group_messages_score_check
    check (grouping_score is null or grouping_score between 0 and 100);

create unique index lead_group_messages_one_group_per_message_idx
  on public.lead_group_messages (teams_message_id);

alter table public.teams_messages
  add column grouping_state text not null default 'pending',
  add column grouping_algorithm_version text,
  add column grouping_source_fingerprint text,
  add column grouping_reason text,
  add column grouped_at timestamptz,
  add constraint teams_messages_grouping_state_check
    check (grouping_state in ('pending', 'deferred', 'grouped', 'ambiguous')),
  add constraint teams_messages_grouping_algorithm_version_check
    check (
      grouping_algorithm_version is null
      or grouping_algorithm_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  add constraint teams_messages_grouping_source_fingerprint_check
    check (
      grouping_source_fingerprint is null
      or grouping_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint teams_messages_grouping_reason_check
    check (
      grouping_reason is null
      or grouping_reason in (
        'explicit_reply',
        'exact_phone',
        'exact_email',
        'name_company',
        'continuation_to_existing_group',
        'new_distinct_identity',
        'ambiguous_unassigned',
        'evidence_pending'
      )
    ),
  add constraint teams_messages_grouping_metadata_check
    check (
      (
        grouping_state = 'pending'
        and grouping_algorithm_version is null
        and grouping_source_fingerprint is null
        and grouping_reason is null
        and grouped_at is null
      )
      or (
        grouping_state <> 'pending'
        and grouping_algorithm_version is not null
        and grouping_source_fingerprint is not null
        and grouping_reason is not null
        and grouped_at is not null
      )
    );

create index teams_messages_grouping_state_created_idx
  on public.teams_messages (grouping_state, source_created_at);

create function public.conversation_grouping_input_fingerprint(
  p_message_id uuid
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
        source_message.id::text,
        source_message.content_revision::text,
        coalesce(source_message.source_fingerprint, ''),
        encode(
          extensions.digest(coalesce(source_message.body_content, ''), 'sha256'),
          'hex'
        ),
        coalesce(source_message.author_teams_user_id, ''),
        coalesce(source_message.reply_to_external_message_id, ''),
        coalesce((
          select string_agg(
            concat_ws(
              E'\x1e',
              source_attachment.id::text,
              source_attachment.source_revision::text,
              source_attachment.is_current::text,
              source_attachment.fetch_state,
              source_attachment.processing_state,
              coalesce(source_attachment.processing_operation, ''),
              coalesce(source_attachment.sha256, ''),
              coalesce(source_attachment.processing_source_sha256, ''),
              coalesce(source_attachment.provider_name, ''),
              coalesce(source_attachment.provider_model, ''),
              coalesce(source_attachment.processing_prompt_version, ''),
              source_attachment.processing_revision::text,
              encode(
                extensions.digest(
                  coalesce(source_attachment.transcript_text, ''),
                  'sha256'
                ),
                'hex'
              ),
              encode(
                extensions.digest(
                  coalesce(source_attachment.ocr_text, ''),
                  'sha256'
                ),
                'hex'
              ),
              coalesce(source_attachment.image_document_type, '')
            ),
            E'\x1d'
            order by source_attachment.id
          )
          from public.attachments as source_attachment
          where source_attachment.teams_message_id = source_message.id
            and source_attachment.is_current
        ), '')
      ),
      'sha256'
    ),
    'hex'
  )
  from public.teams_messages as source_message
  where source_message.id = p_message_id;
$$;

comment on function public.conversation_grouping_input_fingerprint(uuid) is
  'Private PII-safe SHA-256 identity over the current Teams source revision and current attachment evidence state/content.';

create function public.load_conversation_grouping_sources(
  p_limit integer default 100
)
returns table (
  message_id uuid,
  campaign_id uuid,
  source text,
  tenant_id text,
  team_id text,
  channel_id text,
  external_message_id text,
  author_teams_user_id text,
  reply_to_external_message_id text,
  source_created_at timestamptz,
  body_content text,
  content_revision integer,
  input_fingerprint text,
  evidence_ready boolean,
  is_bot boolean,
  is_service_message boolean,
  attachments jsonb,
  current_grouping_state text,
  current_algorithm_version text,
  current_grouping_fingerprint text,
  current_grouping_reason text,
  current_group_key text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'Conversation grouping source limit is invalid.';
  end if;

  return query
  with selected_messages as materialized (
    select selected_message.*
    from public.teams_messages as selected_message
    order by selected_message.source_created_at, selected_message.id
    limit p_limit
  )
  select
    selected_message.id,
    selected_message.campaign_id,
    selected_message.source,
    selected_message.tenant_id,
    selected_message.team_id,
    selected_message.channel_id,
    selected_message.external_message_id,
    selected_message.author_teams_user_id,
    selected_message.reply_to_external_message_id,
    selected_message.source_created_at,
    selected_message.body_content,
    selected_message.content_revision,
    public.conversation_grouping_input_fingerprint(selected_message.id),
    not exists (
      select 1
      from public.attachments as blocking_attachment
      where blocking_attachment.teams_message_id = selected_message.id
        and blocking_attachment.is_current
        and (
          blocking_attachment.fetch_state in ('pending', 'retryable_failed')
          or (
            blocking_attachment.fetch_state = 'fetched'
            and blocking_attachment.processing_state in (
              'pending',
              'processing',
              'retryable_failed'
            )
          )
        )
    ),
    selected_message.is_bot,
    selected_message.is_service_message,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fetch_state', source_attachment.fetch_state,
          'processing_state', source_attachment.processing_state,
          'operation', source_attachment.processing_operation,
          'transcript_text', case
            when source_attachment.fetch_state = 'fetched'
              and source_attachment.processing_state = 'processed'
              and source_attachment.processing_operation = 'transcription'
              then source_attachment.transcript_text
            else null
          end,
          'ocr_text', case
            when source_attachment.fetch_state = 'fetched'
              and source_attachment.processing_state = 'processed'
              and source_attachment.processing_operation = 'image_text'
              then source_attachment.ocr_text
            else null
          end
        )
        order by source_attachment.id
      )
      from public.attachments as source_attachment
      where source_attachment.teams_message_id = selected_message.id
        and source_attachment.is_current
    ), '[]'::jsonb),
    selected_message.grouping_state,
    selected_message.grouping_algorithm_version,
    selected_message.grouping_source_fingerprint,
    selected_message.grouping_reason,
    current_group.grouping_key
  from selected_messages as selected_message
  left join public.lead_group_messages as current_membership
    on current_membership.teams_message_id = selected_message.id
  left join public.lead_groups as current_group
    on current_group.id = current_membership.lead_group_id
  order by selected_message.source_created_at, selected_message.id;
end;
$$;

comment on function public.load_conversation_grouping_sources(integer) is
  'Service-role-only bounded source-evidence loader. It returns original body plus only successful transcript/OCR evidence and never logs content.';

create function public.apply_conversation_grouping(
  p_algorithm_version text,
  p_decisions jsonb
)
returns table (
  groups_created integer,
  memberships_created integer,
  memberships_removed integer,
  revisions_created integer,
  ambiguous_count integer,
  deferred_count integer,
  unchanged_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision jsonb;
  v_message public.teams_messages%rowtype;
  v_message_id uuid;
  v_expected_fingerprint text;
  v_actual_fingerprint text;
  v_decision_state text;
  v_group_key text;
  v_owner_teams_user_id text;
  v_reason text;
  v_score numeric;
  v_evidence_ready boolean;
  v_old_group_id uuid;
  v_old_membership_algorithm text;
  v_old_membership_fingerprint text;
  v_old_membership_reason text;
  v_old_membership_score numeric;
  v_target_group_id uuid;
  v_target_group_owner text;
  v_target_group_campaign_id uuid;
  v_group_created boolean;
  v_exact boolean;
  v_changed_group_ids uuid[] := array[]::uuid[];
  v_created_group_ids uuid[] := array[]::uuid[];
  v_groups_created integer := 0;
  v_memberships_created integer := 0;
  v_memberships_removed integer := 0;
  v_revisions_created integer := 0;
  v_ambiguous integer := 0;
  v_deferred integer := 0;
  v_unchanged integer := 0;
  v_updated integer := 0;
begin
  if p_algorithm_version is null
    or p_algorithm_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_decisions is null
    or jsonb_typeof(p_decisions) <> 'array'
    or jsonb_array_length(p_decisions) > 500
  then
    raise exception using
      errcode = '22023',
      message = 'Conversation grouping batch configuration is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_decisions) as decision(value)
    group by decision.value ->> 'message_id'
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'Conversation grouping batch contains duplicate messages.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('phase4b-conversation-grouping', 0)
  );

  for v_decision in
    select decision.value
    from jsonb_array_elements(p_decisions) as decision(value)
    order by decision.value ->> 'message_id'
  loop
    if jsonb_typeof(v_decision) <> 'object'
      or coalesce(v_decision ->> 'message_id', '')
        !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(v_decision ->> 'source_fingerprint', '')
        !~ '^[0-9a-f]{64}$'
      or coalesce(v_decision ->> 'state', '')
        not in ('grouped', 'ambiguous', 'deferred')
      or coalesce(v_decision ->> 'reason', '')
        not in (
          'explicit_reply',
          'exact_phone',
          'exact_email',
          'name_company',
          'continuation_to_existing_group',
          'new_distinct_identity',
          'ambiguous_unassigned',
          'evidence_pending'
        )
      or coalesce(v_decision ->> 'score', '') !~ '^[0-9]+([.][0-9]+)?$'
    then
      raise exception using
        errcode = '22023',
        message = 'Conversation grouping decision is invalid.';
    end if;

    v_message_id := (v_decision ->> 'message_id')::uuid;
    v_expected_fingerprint := v_decision ->> 'source_fingerprint';
    v_decision_state := v_decision ->> 'state';
    v_group_key := nullif(v_decision ->> 'group_key', '');
    v_owner_teams_user_id := nullif(
      v_decision ->> 'owner_teams_user_id',
      ''
    );
    v_reason := v_decision ->> 'reason';
    v_score := (v_decision ->> 'score')::numeric;

    if v_score < 0 or v_score > 100 then
      raise exception using
        errcode = '22023',
        message = 'Conversation grouping score is invalid.';
    end if;

    select source_message.*
    into strict v_message
    from public.teams_messages as source_message
    where source_message.id = v_message_id
    for update;

    v_actual_fingerprint :=
      public.conversation_grouping_input_fingerprint(v_message_id);
    if v_actual_fingerprint is distinct from v_expected_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'Conversation grouping source fingerprint is stale.';
    end if;

    select not exists (
      select 1
      from public.attachments as blocking_attachment
      where blocking_attachment.teams_message_id = v_message_id
        and blocking_attachment.is_current
        and (
          blocking_attachment.fetch_state in ('pending', 'retryable_failed')
          or (
            blocking_attachment.fetch_state = 'fetched'
            and blocking_attachment.processing_state in (
              'pending',
              'processing',
              'retryable_failed'
            )
          )
        )
    ) into v_evidence_ready;

    if (v_evidence_ready and v_decision_state = 'deferred')
      or (not v_evidence_ready and v_decision_state <> 'deferred')
    then
      raise exception using
        errcode = 'P0001',
        message = 'Conversation grouping evidence readiness changed.';
    end if;

    v_old_group_id := null;
    v_old_membership_algorithm := null;
    v_old_membership_fingerprint := null;
    v_old_membership_reason := null;
    v_old_membership_score := null;
    select
      current_membership.lead_group_id,
      current_membership.grouping_algorithm_version,
      current_membership.grouping_source_fingerprint,
      current_membership.grouping_reason,
      current_membership.grouping_score
    into
      v_old_group_id,
      v_old_membership_algorithm,
      v_old_membership_fingerprint,
      v_old_membership_reason,
      v_old_membership_score
    from public.lead_group_messages as current_membership
    where current_membership.teams_message_id = v_message_id
    for update;

    if v_decision_state = 'grouped' then
      if v_group_key is null
        or v_group_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
        or v_owner_teams_user_id is null
        or length(v_owner_teams_user_id) > 255
        or v_reason not in (
          'explicit_reply',
          'exact_phone',
          'exact_email',
          'name_company',
          'continuation_to_existing_group',
          'new_distinct_identity'
        )
      then
        raise exception using
          errcode = '22023',
          message = 'Grouped conversation decision metadata is invalid.';
      end if;

      v_target_group_id := null;
      insert into public.lead_groups (
        campaign_id,
        owner_teams_user_id,
        lead_id,
        is_primary,
        status,
        grouping_key,
        grouping_algorithm_version,
        grouping_revision
      )
      values (
        v_message.campaign_id,
        v_owner_teams_user_id,
        null,
        false,
        'assembling',
        v_group_key,
        p_algorithm_version,
        1
      )
      on conflict (grouping_key) do nothing
      returning id into v_target_group_id;

      v_group_created := found;
      if v_group_created then
        v_groups_created := v_groups_created + 1;
        v_created_group_ids := array_append(
          v_created_group_ids,
          v_target_group_id
        );
      else
        select
          existing_group.id,
          existing_group.owner_teams_user_id,
          existing_group.campaign_id
        into strict
          v_target_group_id,
          v_target_group_owner,
          v_target_group_campaign_id
        from public.lead_groups as existing_group
        where existing_group.grouping_key = v_group_key
        for update;

        if v_target_group_owner is distinct from v_owner_teams_user_id
          or v_target_group_campaign_id is distinct from v_message.campaign_id
        then
          raise exception using
            errcode = 'P0001',
            message = 'Conversation grouping key boundary mismatch.';
        end if;
      end if;

      v_exact :=
        v_old_group_id is not distinct from v_target_group_id
        and v_message.grouping_state = 'grouped'
        and v_message.grouping_algorithm_version = p_algorithm_version
        and v_message.grouping_source_fingerprint = v_actual_fingerprint
        and v_message.grouping_reason = v_reason
        and v_old_membership_algorithm = p_algorithm_version
        and v_old_membership_fingerprint = v_actual_fingerprint
        and v_old_membership_reason = v_reason
        and v_old_membership_score is not distinct from v_score;

      if v_exact then
        v_unchanged := v_unchanged + 1;
      else
        if v_old_group_id is not null
          and v_old_group_id <> v_target_group_id
        then
          delete from public.lead_group_messages
          where teams_message_id = v_message_id;
          v_memberships_removed := v_memberships_removed + 1;
          if not (v_old_group_id = any(v_changed_group_ids)) then
            v_changed_group_ids := array_append(
              v_changed_group_ids,
              v_old_group_id
            );
          end if;
          v_old_group_id := null;
        end if;

        if v_old_group_id is null then
          insert into public.lead_group_messages (
            lead_group_id,
            teams_message_id,
            grouping_reason,
            grouping_score,
            grouping_algorithm_version,
            grouping_source_fingerprint
          )
          values (
            v_target_group_id,
            v_message_id,
            v_reason,
            v_score,
            p_algorithm_version,
            v_actual_fingerprint
          );
          v_memberships_created := v_memberships_created + 1;
        else
          update public.lead_group_messages
          set grouping_reason = v_reason,
              grouping_score = v_score,
              grouping_algorithm_version = p_algorithm_version,
              grouping_source_fingerprint = v_actual_fingerprint
          where teams_message_id = v_message_id;
        end if;

        if not v_group_created
          and not (v_target_group_id = any(v_changed_group_ids))
        then
          v_changed_group_ids := array_append(
            v_changed_group_ids,
            v_target_group_id
          );
        end if;

        update public.teams_messages
        set grouping_state = 'grouped',
            grouping_algorithm_version = p_algorithm_version,
            grouping_source_fingerprint = v_actual_fingerprint,
            grouping_reason = v_reason,
            grouped_at = clock_timestamp()
        where id = v_message_id;

        update public.processing_jobs
        set status = 'succeeded',
            locked_at = null,
            locked_by = null,
            last_error_code = null,
            updated_at = clock_timestamp()
        where job_type = 'process_teams_message'
          and aggregate_type = 'teams_message'
          and aggregate_id = v_message_id
          and content_revision <= v_message.content_revision
          and status <> 'succeeded';
      end if;
    elsif v_decision_state = 'ambiguous' then
      if v_group_key is not null
        or v_owner_teams_user_id is not null
        or v_reason <> 'ambiguous_unassigned'
        or v_score <> 0
      then
        raise exception using
          errcode = '22023',
          message = 'Ambiguous grouping decision metadata is invalid.';
      end if;

      v_ambiguous := v_ambiguous + 1;
      v_exact :=
        v_old_group_id is null
        and v_message.grouping_state = 'ambiguous'
        and v_message.grouping_algorithm_version = p_algorithm_version
        and v_message.grouping_source_fingerprint = v_actual_fingerprint
        and v_message.grouping_reason = v_reason;

      if v_exact then
        v_unchanged := v_unchanged + 1;
      else
        if v_old_group_id is not null then
          delete from public.lead_group_messages
          where teams_message_id = v_message_id;
          v_memberships_removed := v_memberships_removed + 1;
          if not (v_old_group_id = any(v_changed_group_ids)) then
            v_changed_group_ids := array_append(
              v_changed_group_ids,
              v_old_group_id
            );
          end if;
        end if;

        update public.teams_messages
        set grouping_state = 'ambiguous',
            grouping_algorithm_version = p_algorithm_version,
            grouping_source_fingerprint = v_actual_fingerprint,
            grouping_reason = v_reason,
            grouped_at = clock_timestamp()
        where id = v_message_id;

        update public.processing_jobs
        set status = 'succeeded',
            locked_at = null,
            locked_by = null,
            last_error_code = null,
            updated_at = clock_timestamp()
        where job_type = 'process_teams_message'
          and aggregate_type = 'teams_message'
          and aggregate_id = v_message_id
          and content_revision <= v_message.content_revision
          and status <> 'succeeded';
      end if;
    else
      if v_group_key is not null
        or v_owner_teams_user_id is not null
        or v_reason <> 'evidence_pending'
        or v_score <> 0
      then
        raise exception using
          errcode = '22023',
          message = 'Deferred grouping decision metadata is invalid.';
      end if;

      v_deferred := v_deferred + 1;
      v_exact :=
        v_message.grouping_state = 'deferred'
        and v_message.grouping_algorithm_version = p_algorithm_version
        and v_message.grouping_source_fingerprint = v_actual_fingerprint
        and v_message.grouping_reason = v_reason;

      if v_exact then
        v_unchanged := v_unchanged + 1;
      else
        update public.teams_messages
        set grouping_state = 'deferred',
            grouping_algorithm_version = p_algorithm_version,
            grouping_source_fingerprint = v_actual_fingerprint,
            grouping_reason = v_reason,
            grouped_at = clock_timestamp()
        where id = v_message_id;

        update public.processing_jobs
        set status = 'succeeded',
            locked_at = null,
            locked_by = null,
            last_error_code = null,
            updated_at = clock_timestamp()
        where job_type = 'process_teams_message'
          and aggregate_type = 'teams_message'
          and aggregate_id = v_message_id
          and content_revision < v_message.content_revision
          and status <> 'succeeded';

        update public.processing_jobs
        set attempts = least(attempts + 1, max_attempts),
            status = case
              when attempts + 1 >= max_attempts then 'permanent_failed'
              else 'retryable_failed'
            end,
            run_at = clock_timestamp() + interval '1 minute',
            locked_at = null,
            locked_by = null,
            last_error_code = case
              when attempts + 1 >= max_attempts
                then 'GROUPING_EVIDENCE_RETRY_LIMIT'
              else 'GROUPING_EVIDENCE_PENDING'
            end,
            updated_at = clock_timestamp()
        where job_type = 'process_teams_message'
          and aggregate_type = 'teams_message'
          and aggregate_id = v_message_id
          and content_revision = v_message.content_revision;
      end if;
    end if;
  end loop;

  if cardinality(v_changed_group_ids) > 0 then
    update public.lead_groups as changed_group
    set grouping_revision = changed_group.grouping_revision + 1,
        grouping_algorithm_version = p_algorithm_version,
        updated_at = clock_timestamp()
    where changed_group.id = any(v_changed_group_ids)
      and not (changed_group.id = any(v_created_group_ids));
    get diagnostics v_updated = row_count;
  end if;

  v_revisions_created := v_groups_created + v_updated;

  return query select
    v_groups_created,
    v_memberships_created,
    v_memberships_removed,
    v_revisions_created,
    v_ambiguous,
    v_deferred,
    v_unchanged;
end;
$$;

comment on function public.apply_conversation_grouping(text, jsonb) is
  'Service-role-only advisory-locked persistence boundary for PII-safe deterministic pre-lead grouping decisions.';

revoke all on function
  public.conversation_grouping_input_fingerprint(uuid),
  public.load_conversation_grouping_sources(integer),
  public.apply_conversation_grouping(text, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.load_conversation_grouping_sources(integer),
  public.apply_conversation_grouping(text, jsonb)
to service_role;

revoke all privileges on table
  public.lead_groups,
  public.lead_group_messages
from service_role;

grant select on table
  public.lead_groups,
  public.lead_group_messages
to service_role;
