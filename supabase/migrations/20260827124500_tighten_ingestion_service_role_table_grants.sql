revoke all privileges on table
  public.teams_messages,
  public.attachments,
  public.processing_jobs
from service_role;

grant select on table
  public.teams_messages,
  public.attachments,
  public.processing_jobs
to service_role;

comment on function public.ingest_teams_message(jsonb, jsonb) is
  'Service-role-only atomic ingestion boundary. Direct table access for service_role is limited to read-only verification.';
