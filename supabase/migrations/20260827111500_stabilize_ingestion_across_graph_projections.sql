comment on column public.teams_messages.source_fingerprint is
  'SHA-256 of normalized message source fields; attachment projection differences are reconciled separately.';
comment on column public.attachments.is_current is
  'Known source attachment. Absence from a partial Graph projection does not deactivate durable metadata.';

create or replace function public.ingest_teams_message(
  p_message jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns table (
  teams_message_id uuid,
  result text,
  content_revision integer,
  attachments_inserted integer,
  jobs_enqueued integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_tenant_id text;
  v_team_id text;
  v_channel_id text;
  v_external_message_id text;
  v_author_teams_user_id text;
  v_reply_to_external_message_id text;
  v_source_created_at timestamptz;
  v_source_last_modified_at timestamptz;
  v_message_type text;
  v_body_content_type text;
  v_body_content text;
  v_source_web_url text;
  v_source_fingerprint text;
  v_observed_at timestamptz;
  v_is_bot boolean;
  v_is_service_message boolean;
  v_existing public.teams_messages%rowtype;
  v_message_id uuid;
  v_revision integer;
  v_result text;
  v_should_enqueue boolean := false;
  v_source_fields_match boolean;
  v_attachment jsonb;
  v_external_attachment_id text;
  v_attachment_kind text;
  v_attachment_file_name text;
  v_attachment_mime_type text;
  v_attachment_size_bytes bigint;
  v_attachment_source_content_type text;
  v_source_locator jsonb;
  v_attachment_is_new boolean;
  v_attachment_matches boolean;
  v_attachment_changed boolean := false;
  v_attachments_inserted integer := 0;
  v_jobs_enqueued integer := 0;
begin
  if p_message is null or jsonb_typeof(p_message) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'Invalid Teams ingestion message.';
  end if;

  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Invalid Teams ingestion attachments.';
  end if;

  v_source := nullif(p_message ->> 'source', '');
  v_tenant_id := nullif(p_message ->> 'tenant_id', '');
  v_team_id := nullif(p_message ->> 'team_id', '');
  v_channel_id := nullif(p_message ->> 'channel_id', '');
  v_external_message_id := nullif(p_message ->> 'external_message_id', '');
  v_author_teams_user_id := nullif(
    p_message ->> 'author_teams_user_id',
    ''
  );
  v_reply_to_external_message_id := nullif(
    p_message ->> 'reply_to_external_message_id',
    ''
  );
  v_message_type := nullif(p_message ->> 'message_type', '');
  v_body_content_type := nullif(p_message ->> 'body_content_type', '');
  v_body_content := p_message ->> 'body_content';
  v_source_web_url := nullif(p_message ->> 'source_web_url', '');
  v_source_fingerprint := nullif(p_message ->> 'source_fingerprint', '');
  v_is_bot := coalesce((p_message ->> 'is_bot')::boolean, false);
  v_is_service_message := coalesce(
    (p_message ->> 'is_service_message')::boolean,
    false
  );

  if v_source <> 'microsoft_teams'
    or v_tenant_id is null
    or v_team_id is null
    or v_channel_id is null
    or v_external_message_id is null
    or v_source_fingerprint is null
    or v_source_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Teams ingestion message is missing required source identity.';
  end if;

  begin
    v_source_created_at := (p_message ->> 'source_created_at')::timestamptz;
    v_source_last_modified_at :=
      (p_message ->> 'source_last_modified_at')::timestamptz;
    v_observed_at := (p_message ->> 'observed_at')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22007',
        message = 'Teams ingestion message contains an invalid timestamp.';
  end;

  if v_source_created_at is null or v_observed_at is null then
    raise exception using
      errcode = '22007',
      message = 'Teams ingestion message requires created and observed timestamps.';
  end if;

  insert into public.teams_messages (
    source,
    tenant_id,
    team_id,
    channel_id,
    external_message_id,
    author_teams_user_id,
    reply_to_external_message_id,
    source_created_at,
    source_last_modified_at,
    message_type,
    body_content_type,
    body_content,
    source_web_url,
    source_fingerprint,
    observed_at,
    is_bot,
    is_service_message,
    content_revision,
    state
  )
  values (
    v_source,
    v_tenant_id,
    v_team_id,
    v_channel_id,
    v_external_message_id,
    v_author_teams_user_id,
    v_reply_to_external_message_id,
    v_source_created_at,
    v_source_last_modified_at,
    v_message_type,
    v_body_content_type,
    v_body_content,
    v_source_web_url,
    v_source_fingerprint,
    v_observed_at,
    v_is_bot,
    v_is_service_message,
    1,
    'received'
  )
  on conflict on constraint teams_messages_source_identity_key do nothing
  returning id, teams_messages.content_revision
  into v_message_id, v_revision;

  if found then
    v_result := 'inserted';
    v_should_enqueue := true;
  else
    select existing_message.*
    into v_existing
    from public.teams_messages as existing_message
    where existing_message.source = v_source
      and existing_message.tenant_id = v_tenant_id
      and existing_message.team_id = v_team_id
      and existing_message.channel_id = v_channel_id
      and existing_message.external_message_id = v_external_message_id
    for update;

    v_message_id := v_existing.id;
    v_revision := v_existing.content_revision;
    v_source_fields_match :=
      v_existing.author_teams_user_id is not distinct from
        v_author_teams_user_id
      and v_existing.reply_to_external_message_id is not distinct from
        v_reply_to_external_message_id
      and v_existing.source_created_at is not distinct from
        v_source_created_at
      and v_existing.message_type is not distinct from v_message_type
      and v_existing.body_content_type is not distinct from
        v_body_content_type
      and v_existing.body_content is not distinct from v_body_content
      and v_existing.source_web_url is not distinct from v_source_web_url
      and v_existing.is_bot is not distinct from v_is_bot
      and v_existing.is_service_message is not distinct from
        v_is_service_message;

    if v_existing.source_fingerprint is not distinct from
      v_source_fingerprint
      or v_source_fields_match
    then
      update public.teams_messages
      set source_fingerprint = v_source_fingerprint,
          source_last_modified_at = case
            when v_source_last_modified_at is null then source_last_modified_at
            when source_last_modified_at is null then v_source_last_modified_at
            else greatest(source_last_modified_at, v_source_last_modified_at)
          end,
          observed_at = greatest(observed_at, v_observed_at)
      where id = v_message_id;

      v_result := 'unchanged';
    elsif v_existing.source_last_modified_at is not null
      and v_source_last_modified_at is not null
      and v_source_last_modified_at < v_existing.source_last_modified_at
    then
      update public.teams_messages
      set observed_at = greatest(observed_at, v_observed_at)
      where id = v_message_id;

      v_result := 'unchanged';
    else
      v_revision := v_revision + 1;

      update public.teams_messages
      set author_teams_user_id = v_author_teams_user_id,
          reply_to_external_message_id = v_reply_to_external_message_id,
          source_created_at = v_source_created_at,
          source_last_modified_at = v_source_last_modified_at,
          message_type = v_message_type,
          body_content_type = v_body_content_type,
          body_content = v_body_content,
          source_web_url = v_source_web_url,
          source_fingerprint = v_source_fingerprint,
          observed_at = greatest(observed_at, v_observed_at),
          is_bot = v_is_bot,
          is_service_message = v_is_service_message,
          content_revision = v_revision,
          state = 'received'
      where id = v_message_id;

      v_result := 'updated';
      v_should_enqueue := true;
    end if;
  end if;

  for v_attachment in
    select value
    from jsonb_array_elements(p_attachments)
  loop
    if jsonb_typeof(v_attachment) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Invalid Teams attachment metadata.';
    end if;

    v_external_attachment_id := nullif(
      v_attachment ->> 'external_attachment_id',
      ''
    );
    v_attachment_kind := nullif(
      v_attachment ->> 'attachment_kind',
      ''
    );
    v_attachment_file_name := nullif(v_attachment ->> 'file_name', '');
    v_attachment_mime_type := nullif(v_attachment ->> 'mime_type', '');
    v_attachment_size_bytes := (v_attachment ->> 'size_bytes')::bigint;
    v_attachment_source_content_type := nullif(
      v_attachment ->> 'source_content_type',
      ''
    );
    v_source_locator := coalesce(
      v_attachment -> 'source_locator',
      '{}'::jsonb
    );

    if v_external_attachment_id is null
      or v_attachment_kind not in ('hosted_content', 'reference')
      or jsonb_typeof(v_source_locator) <> 'object'
    then
      raise exception using
        errcode = '22023',
        message = 'Teams attachment metadata is missing required identity.';
    end if;

    select
      not exists (
        select 1
        from public.attachments as existing_attachment
        where existing_attachment.teams_message_id = v_message_id
          and existing_attachment.external_attachment_id =
            v_external_attachment_id
      ),
      exists (
        select 1
        from public.attachments as existing_attachment
        where existing_attachment.teams_message_id = v_message_id
          and existing_attachment.external_attachment_id =
            v_external_attachment_id
          and existing_attachment.file_name is not distinct from
            v_attachment_file_name
          and existing_attachment.mime_type is not distinct from
            v_attachment_mime_type
          and existing_attachment.size_bytes is not distinct from
            v_attachment_size_bytes
          and existing_attachment.attachment_kind is not distinct from
            v_attachment_kind
          and existing_attachment.source_content_type is not distinct from
            v_attachment_source_content_type
          and existing_attachment.source_locator is not distinct from
            v_source_locator
      )
    into v_attachment_is_new, v_attachment_matches;

    if v_attachment_is_new or not v_attachment_matches then
      v_attachment_changed := true;
    end if;
  end loop;

  if v_result = 'unchanged' and v_attachment_changed then
    v_revision := v_revision + 1;
    update public.teams_messages
    set content_revision = v_revision,
        state = 'received'
    where id = v_message_id;
    v_result := 'updated';
    v_should_enqueue := true;
  end if;

  if v_should_enqueue then
    for v_attachment in
      select value
      from jsonb_array_elements(p_attachments)
    loop
      v_external_attachment_id := nullif(
        v_attachment ->> 'external_attachment_id',
        ''
      );

      select not exists (
        select 1
        from public.attachments as existing_attachment
        where existing_attachment.teams_message_id = v_message_id
          and existing_attachment.external_attachment_id =
            v_external_attachment_id
      )
      into v_attachment_is_new;

      insert into public.attachments (
        teams_message_id,
        external_attachment_id,
        file_name,
        mime_type,
        size_bytes,
        attachment_kind,
        source_content_type,
        source_locator,
        source_revision,
        is_current
      )
      values (
        v_message_id,
        v_external_attachment_id,
        nullif(v_attachment ->> 'file_name', ''),
        nullif(v_attachment ->> 'mime_type', ''),
        (v_attachment ->> 'size_bytes')::bigint,
        nullif(v_attachment ->> 'attachment_kind', ''),
        nullif(v_attachment ->> 'source_content_type', ''),
        coalesce(v_attachment -> 'source_locator', '{}'::jsonb),
        v_revision,
        true
      )
      on conflict on constraint attachments_message_external_key
      do update set
        file_name = excluded.file_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        attachment_kind = excluded.attachment_kind,
        source_content_type = excluded.source_content_type,
        source_locator = excluded.source_locator,
        source_revision = excluded.source_revision,
        is_current = true;

      if v_attachment_is_new then
        v_attachments_inserted := v_attachments_inserted + 1;
      end if;
    end loop;

    insert into public.processing_jobs (
      job_type,
      aggregate_type,
      aggregate_id,
      content_revision,
      status
    )
    values (
      'process_teams_message',
      'teams_message',
      v_message_id,
      v_revision,
      'pending'
    )
    on conflict on constraint processing_jobs_revision_key do nothing;

    get diagnostics v_jobs_enqueued = row_count;
  end if;

  return query
  select
    v_message_id,
    v_result,
    v_revision,
    v_attachments_inserted,
    v_jobs_enqueued;
end;
$$;

revoke all on function public.ingest_teams_message(jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.ingest_teams_message(jsonb, jsonb)
to service_role;
