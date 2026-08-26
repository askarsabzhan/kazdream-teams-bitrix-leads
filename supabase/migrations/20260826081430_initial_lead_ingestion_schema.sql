create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('user', 'admin'))
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_id text,
  exhibition_key text,
  exhibition_bitrix_id bigint,
  teams_tenant_id text,
  teams_team_id text,
  teams_channel_id text,
  starts_at timestamptz,
  ends_at timestamptz,
  duplicate_owner_policy text not null default 'latest_contributor',
  lead_without_contacts_policy text not null default 'require_name_and_phone',
  late_update_policy text not null default 'update_crm',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_duplicate_owner_policy_check
    check (duplicate_owner_policy in ('latest_contributor')),
  constraint campaigns_lead_without_contacts_policy_check
    check (lead_without_contacts_policy in ('require_name_and_phone')),
  constraint campaigns_late_update_policy_check
    check (late_update_policy in ('update_crm')),
  constraint campaigns_date_range_check
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

comment on column public.campaigns.duplicate_owner_policy is
  'Confirmed: enrich the canonical lead and assign the latest contributing manager.';
comment on column public.campaigns.lead_without_contacts_policy is
  'Confirmed: CRM creation requires a reliable full name and at least one reliable phone.';
comment on column public.campaigns.late_update_policy is
  'Confirmed: later reliable information updates the existing CRM lead.';

create table public.manager_mappings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id),
  teams_user_id text not null,
  teams_user_principal_name text,
  teams_display_name text,
  bitrix_user_id bigint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reference_mappings (
  id uuid primary key default gen_random_uuid(),
  field_type text not null,
  canonical_key text not null,
  display_label text not null,
  bitrix_value_id bigint not null,
  is_active boolean not null default true,
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_mappings_field_type_check
    check (
      field_type in (
        'lead_type',
        'region',
        'exhibition',
        'product_interest',
        'priority'
      )
    ),
  constraint reference_mappings_field_key_unique
    unique (field_type, canonical_key)
);

create table public.teams_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id),
  source text not null default 'teams',
  tenant_id text not null,
  team_id text not null,
  channel_id text not null,
  external_message_id text not null,
  author_teams_user_id text not null,
  reply_to_external_message_id text,
  source_created_at timestamptz not null,
  body_content_type text,
  body_content text,
  typed_text text,
  is_bot boolean not null default false,
  is_service_message boolean not null default false,
  content_revision integer not null default 1,
  state text not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_messages_content_revision_check
    check (content_revision > 0),
  constraint teams_messages_state_check
    check (
      state in (
        'received',
        'waiting_attachment',
        'ready',
        'processing',
        'processed',
        'ignored',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  constraint teams_messages_source_identity_key
    unique (source, tenant_id, team_id, channel_id, external_message_id)
);

comment on constraint teams_messages_source_identity_key on public.teams_messages is
  'The durable Teams ingestion idempotency boundary.';

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  teams_message_id uuid not null references public.teams_messages (id) on delete cascade,
  external_attachment_id text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  storage_path text,
  fetch_state text not null default 'pending',
  processing_state text not null default 'pending',
  transcript_text text,
  ocr_text text,
  provider_name text,
  provider_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint attachments_size_bytes_check
    check (size_bytes is null or size_bytes >= 0),
  constraint attachments_fetch_state_check
    check (
      fetch_state in (
        'pending',
        'fetched',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  constraint attachments_processing_state_check
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
  constraint attachments_message_external_key
    unique (teams_message_id, external_attachment_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id),
  title text not null,
  full_name text,
  company_name text,
  job_title text,
  phones jsonb not null default '[]'::jsonb,
  emails jsonb not null default '[]'::jsonb,
  country text,
  region_key text,
  product_interest_keys text[] not null default '{}'::text[],
  priority_key text,
  lead_type text not null default 'customer',
  summary_ru text,
  notes_text text,
  assigned_teams_user_id text not null,
  revision integer not null default 1,
  status text not null default 'draft',
  crm_status text not null default 'pending',
  bitrix_lead_id bigint,
  bitrix_contact_id bigint,
  bitrix_company_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_phones_array_check
    check (jsonb_typeof(phones) = 'array'),
  constraint leads_emails_array_check
    check (jsonb_typeof(emails) = 'array'),
  constraint leads_revision_check
    check (revision > 0),
  constraint leads_lead_type_check
    check (lead_type in ('partner', 'customer')),
  constraint leads_status_check
    check (
      status in (
        'draft',
        'validated',
        'duplicate',
        'crm_pending',
        'synced',
        'failed'
      )
    ),
  constraint leads_crm_status_check
    check (
      crm_status in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'permanent_failed'
      )
    )
);

comment on column public.leads.summary_ru is
  'Russian analytical summary, stored separately from verbatim notes.';
comment on column public.leads.notes_text is
  'Future exact typed text and verbatim transcription, separate from summary.';

create table public.lead_groups (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id),
  owner_teams_user_id text not null,
  lead_id uuid references public.leads (id) on delete set null,
  is_primary boolean not null default false,
  status text not null default 'assembling',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_groups_primary_requires_lead_check
    check (not is_primary or lead_id is not null),
  constraint lead_groups_status_check
    check (
      status in (
        'assembling',
        'evaluating',
        'non_lead',
        'extracting',
        'validated',
        'deduplicated',
        'crm_pending',
        'synced',
        'failed'
      )
    )
);

comment on column public.lead_groups.lead_id is
  'Multiple preserved conversation groups may reference one canonical lead.';

create table public.lead_group_messages (
  lead_group_id uuid not null references public.lead_groups (id) on delete cascade,
  teams_message_id uuid not null references public.teams_messages (id) on delete cascade,
  grouping_reason text,
  grouping_score numeric,
  created_at timestamptz not null default now(),
  primary key (lead_group_id, teams_message_id)
);

create table public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  field_name text not null,
  value_json jsonb not null,
  normalized_value text,
  teams_message_id uuid references public.teams_messages (id) on delete set null,
  attachment_id uuid references public.attachments (id) on delete set null,
  method text not null,
  evidence_text text,
  confidence numeric,
  validation_status text not null,
  created_at timestamptz not null default now(),
  constraint field_evidence_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint field_evidence_validation_status_check
    check (validation_status in ('accepted', 'rejected', 'conflicted'))
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  content_revision integer not null default 1,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_jobs_content_revision_check
    check (content_revision > 0),
  constraint processing_jobs_status_check
    check (
      status in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  constraint processing_jobs_attempts_check
    check (attempts >= 0),
  constraint processing_jobs_max_attempts_check
    check (max_attempts > 0),
  constraint processing_jobs_revision_key
    unique (job_type, aggregate_type, aggregate_id, content_revision)
);

create table public.crm_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  lead_revision integer not null,
  operation text not null default 'sync',
  payload jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint crm_outbox_lead_revision_check
    check (lead_revision > 0),
  constraint crm_outbox_status_check
    check (
      status in (
        'pending',
        'processing',
        'succeeded',
        'retryable_failed',
        'reconciling',
        'permanent_failed'
      )
    ),
  constraint crm_outbox_attempts_check
    check (attempts >= 0),
  constraint crm_outbox_max_attempts_check
    check (max_attempts > 0),
  constraint crm_outbox_lead_revision_operation_key
    unique (lead_id, lead_revision, operation)
);

comment on constraint crm_outbox_lead_revision_operation_key on public.crm_outbox is
  'Prevents duplicate delivery operations for the same lead revision.';

create table public.teams_notifications (
  id uuid primary key default gen_random_uuid(),
  teams_message_id uuid references public.teams_messages (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  dedupe_key text not null,
  notification_kind text not null,
  message_text text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint teams_notifications_kind_check
    check (
      notification_kind in (
        'accepted',
        'created',
        'updated',
        'not_lead',
        'retrying',
        'failed'
      )
    ),
  constraint teams_notifications_status_check
    check (
      status in (
        'pending',
        'processing',
        'sent',
        'retryable_failed',
        'permanent_failed'
      )
    ),
  constraint teams_notifications_attempts_check
    check (attempts >= 0),
  constraint teams_notifications_dedupe_key_key
    unique (dedupe_key)
);

comment on constraint teams_notifications_dedupe_key_key on public.teams_notifications is
  'Prevents repeated delivery of the same logical Teams notification.';

create table public.processing_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint processing_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index manager_mappings_campaign_user_key
  on public.manager_mappings (campaign_id, teams_user_id)
  where campaign_id is not null;

create unique index manager_mappings_global_user_key
  on public.manager_mappings (teams_user_id)
  where campaign_id is null;

create index teams_messages_campaign_created_idx
  on public.teams_messages (campaign_id, source_created_at);
create index teams_messages_author_created_idx
  on public.teams_messages (author_teams_user_id, source_created_at);
create index teams_messages_state_created_idx
  on public.teams_messages (state, created_at);

create index attachments_fetch_state_created_idx
  on public.attachments (fetch_state, created_at);
create index attachments_processing_state_created_idx
  on public.attachments (processing_state, created_at);

create index leads_campaign_created_idx
  on public.leads (campaign_id, created_at);
create index leads_status_created_idx
  on public.leads (status, created_at);
create index leads_crm_status_created_idx
  on public.leads (crm_status, created_at);

create index lead_groups_campaign_status_idx
  on public.lead_groups (campaign_id, status);
create index lead_groups_owner_created_idx
  on public.lead_groups (owner_teams_user_id, created_at);
create index lead_groups_lead_idx
  on public.lead_groups (lead_id)
  where lead_id is not null;
create unique index lead_groups_one_primary_per_lead_idx
  on public.lead_groups (lead_id)
  where lead_id is not null and is_primary;

create index lead_group_messages_message_idx
  on public.lead_group_messages (teams_message_id);

create index field_evidence_lead_field_idx
  on public.field_evidence (lead_id, field_name);

create index processing_jobs_status_run_at_idx
  on public.processing_jobs (status, run_at);

create index crm_outbox_status_run_at_idx
  on public.crm_outbox (status, run_at);

create index teams_notifications_status_run_at_idx
  on public.teams_notifications (status, run_at);

create index processing_events_aggregate_created_idx
  on public.processing_events (aggregate_type, aggregate_id, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create trigger manager_mappings_set_updated_at
before update on public.manager_mappings
for each row execute function public.set_updated_at();

create trigger reference_mappings_set_updated_at
before update on public.reference_mappings
for each row execute function public.set_updated_at();

create trigger teams_messages_set_updated_at
before update on public.teams_messages
for each row execute function public.set_updated_at();

create trigger attachments_set_updated_at
before update on public.attachments
for each row execute function public.set_updated_at();

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

create trigger lead_groups_set_updated_at
before update on public.lead_groups
for each row execute function public.set_updated_at();

create trigger processing_jobs_set_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

create trigger crm_outbox_set_updated_at
before update on public.crm_outbox
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

insert into public.reference_mappings (
  field_type,
  canonical_key,
  display_label,
  bitrix_value_id
)
values
  ('lead_type', 'partner', 'Partner', 45),
  ('lead_type', 'customer', 'Customer', 47),
  ('region', 'europe', 'Europe', 49),
  ('exhibition', 'hannover_messe_2026', 'Hannover Messe 2026', 63),
  ('exhibition', 'gitex_global_2026', 'GITEX Global 2026', 65),
  ('exhibition', 'innoprom_2026', 'Innoprom 2026', 67),
  ('exhibition', 'adipec_2026', 'ADIPEC 2026', 69),
  ('product_interest', 'platform_core', 'Platform / Core', 71),
  ('product_interest', 'analytics', 'Analytics', 73),
  ('product_interest', 'integration_services', 'Integration Services', 75),
  ('product_interest', 'support_sla', 'Support & SLA', 77),
  ('product_interest', 'training', 'Training', 79),
  ('product_interest', 'oem_white_label', 'OEM / White label', 81),
  ('priority', 'high', 'High', 83),
  ('priority', 'medium', 'Medium', 85),
  ('priority', 'low', 'Low', 87);

insert into storage.buckets (id, name, public)
values ('teams-attachments', 'teams-attachments', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.manager_mappings enable row level security;
alter table public.reference_mappings enable row level security;
alter table public.teams_messages enable row level security;
alter table public.attachments enable row level security;
alter table public.leads enable row level security;
alter table public.lead_groups enable row level security;
alter table public.lead_group_messages enable row level security;
alter table public.field_evidence enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.crm_outbox enable row level security;
alter table public.teams_notifications enable row level security;
alter table public.processing_events enable row level security;

revoke all on table
  public.profiles,
  public.campaigns,
  public.manager_mappings,
  public.reference_mappings,
  public.teams_messages,
  public.attachments,
  public.leads,
  public.lead_groups,
  public.lead_group_messages,
  public.field_evidence,
  public.processing_jobs,
  public.crm_outbox,
  public.teams_notifications,
  public.processing_events
from anon, authenticated;

grant select on table public.profiles to authenticated;

grant select on table
  public.leads,
  public.lead_groups,
  public.lead_group_messages,
  public.teams_messages,
  public.attachments,
  public.field_evidence,
  public.processing_events
to authenticated;

grant select, insert, update, delete on table
  public.campaigns,
  public.manager_mappings,
  public.reference_mappings
to authenticated;

grant select on table
  public.processing_jobs,
  public.crm_outbox,
  public.teams_notifications
to authenticated;

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

create policy campaigns_admin_all
on public.campaigns
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy manager_mappings_admin_all
on public.manager_mappings
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy reference_mappings_admin_all
on public.reference_mappings
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy leads_authenticated_read
on public.leads
for select
to authenticated
using (true);

create policy lead_groups_authenticated_read
on public.lead_groups
for select
to authenticated
using (true);

create policy lead_group_messages_authenticated_read
on public.lead_group_messages
for select
to authenticated
using (true);

create policy teams_messages_authenticated_read
on public.teams_messages
for select
to authenticated
using (true);

create policy attachments_authenticated_read
on public.attachments
for select
to authenticated
using (true);

create policy field_evidence_authenticated_read
on public.field_evidence
for select
to authenticated
using (true);

create policy processing_events_authenticated_read
on public.processing_events
for select
to authenticated
using (true);

create policy processing_jobs_admin_read
on public.processing_jobs
for select
to authenticated
using ((select public.is_admin()));

create policy crm_outbox_admin_read
on public.crm_outbox
for select
to authenticated
using ((select public.is_admin()));

create policy teams_notifications_admin_read
on public.teams_notifications
for select
to authenticated
using ((select public.is_admin()));
