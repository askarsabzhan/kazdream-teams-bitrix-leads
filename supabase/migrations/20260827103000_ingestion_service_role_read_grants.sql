grant select on table
  public.teams_messages,
  public.attachments,
  public.processing_jobs
to service_role;

comment on function public.ingest_teams_message(jsonb, jsonb) is
  'Atomic service-role write boundary; service role has read-only table access for ingestion verification.';
