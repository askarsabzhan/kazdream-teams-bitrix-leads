alter function public.ingest_teams_message(jsonb, jsonb)
rename to ingest_teams_message_core;

revoke all on function public.ingest_teams_message_core(jsonb, jsonb)
from public, anon, authenticated, service_role;

create function public.ingest_teams_message(
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
  v_existing_last_modified_at timestamptz;
  v_existing_fingerprint text;
  v_incoming_last_modified_at timestamptz;
begin
  begin
    v_incoming_last_modified_at :=
      (p_message ->> 'source_last_modified_at')::timestamptz;
  exception
    when others then
      v_incoming_last_modified_at := null;
  end;

  select
    existing_message.source_last_modified_at,
    existing_message.source_fingerprint
  into
    v_existing_last_modified_at,
    v_existing_fingerprint
  from public.teams_messages as existing_message
  where existing_message.source = nullif(p_message ->> 'source', '')
    and existing_message.tenant_id = nullif(p_message ->> 'tenant_id', '')
    and existing_message.team_id = nullif(p_message ->> 'team_id', '')
    and existing_message.channel_id = nullif(p_message ->> 'channel_id', '')
    and existing_message.external_message_id = nullif(
      p_message ->> 'external_message_id',
      ''
    );

  if v_existing_last_modified_at is not null
    and v_incoming_last_modified_at is not null
    and v_incoming_last_modified_at <= v_existing_last_modified_at
    and v_existing_fingerprint is not null
  then
    p_message := jsonb_set(
      p_message,
      '{source_fingerprint}',
      to_jsonb(v_existing_fingerprint),
      true
    );
  end if;

  return query
  select *
  from public.ingest_teams_message_core(p_message, p_attachments);
end;
$$;

comment on function public.ingest_teams_message(jsonb, jsonb) is
  'Service-role ingestion boundary. Source fields revise only for a strictly newer Graph modification timestamp; attachment metadata is a monotonic ID-based union.';

revoke all on function public.ingest_teams_message(jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.ingest_teams_message(jsonb, jsonb)
to service_role;
