begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  has_function_privilege('authenticated', 'public.retry_current_crm_sync(uuid)', 'execute'),
  'authenticated users can request a current CRM retry'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.retry_current_crm_sync(uuid)', 'execute'),
  'anonymous callers cannot request CRM retry'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.load_lead_manager_labels(uuid[])', 'execute'),
  'authenticated users can load narrow manager labels'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.set_app_profile_role(uuid,text)', 'execute'),
  'authenticated users cannot promote profiles'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.set_app_profile_role(uuid,text)', 'execute'),
  'service role can use the explicit profile promotion boundary'
);
select extensions.is(
  to_regprocedure('public.retry_current_crm_sync(uuid,jsonb)'),
  null::regprocedure,
  'CRM retry has no arbitrary payload overload'
);

insert into public.leads (
  id,
  campaign_id,
  title,
  assigned_teams_user_id,
  status,
  canonical_payload,
  canonical_source_fingerprint,
  summary_state,
  summary_ru
)
values (
  '96000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000063',
  'Synthetic Phase 6 lead',
  'phase6-manager',
  'validated',
  '{"campaign":{"exhibition":"Hannover Messe 2026","exhibitionBitrixId":63,"source":"EXHIBITION"}}',
  repeat('6', 64),
  'pending',
  'Synthetic summary.'
);

insert into public.lead_groups (
  id,
  owner_teams_user_id,
  lead_id,
  is_primary,
  status,
  grouping_key,
  grouping_revision,
  canonicalization_state,
  canonicalization_source_fingerprint,
  canonicalized_at
)
values (
  '96000000-0000-4000-8000-000000000002',
  'phase6-manager',
  '96000000-0000-4000-8000-000000000001',
  true,
  'deduplicated',
  'phase6-ui-group',
  1,
  'linked',
  repeat('7', 64),
  now()
);

update public.leads
set summary_state = 'succeeded', summary_completed_at = now()
where id = '96000000-0000-4000-8000-000000000001';

insert into public.manager_mappings (
  teams_user_id,
  teams_display_name,
  teams_user_principal_name,
  bitrix_user_id,
  is_active
)
values ('phase6-manager', 'Phase 6 Manager', 'phase6-manager@example.test', 606, true);

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000099', true);

select extensions.is(
  (
    select manager_label
    from public.load_lead_manager_labels(array['96000000-0000-4000-8000-000000000001'::uuid])
  ),
  'Phase 6 Manager',
  'manager representation uses the exact active mapping'
);

update public.crm_outbox
set status = 'retryable_failed',
    attempts = 1,
    last_error_code = 'BITRIX_RATE_OR_TRANSIENT'
where lead_id = '96000000-0000-4000-8000-000000000001';

select extensions.is(
  (select outcome from public.retry_current_crm_sync('96000000-0000-4000-8000-000000000001')),
  'queued',
  'retryable current sync is requeued'
);
select extensions.is(
  (select attempts from public.crm_outbox where lead_id = '96000000-0000-4000-8000-000000000001'),
  1,
  'requesting retry never resets durable attempts'
);
select extensions.is(
  (select outcome from public.retry_current_crm_sync('96000000-0000-4000-8000-000000000001')),
  'already_queued',
  'replaying a retry request is idempotent'
);
select extensions.is(
  (select count(*) from public.crm_outbox where lead_id = '96000000-0000-4000-8000-000000000001'),
  1::bigint,
  'retry replay creates no duplicate outbox operation'
);

update public.crm_outbox
set status = 'succeeded', completed_at = now()
where lead_id = '96000000-0000-4000-8000-000000000001';
select extensions.is(
  (select outcome from public.retry_current_crm_sync('96000000-0000-4000-8000-000000000001')),
  'already_succeeded',
  'a succeeded current sync is a safe no-op'
);

update public.crm_outbox
set status = 'permanent_failed', attempts = 5, completed_at = now()
where lead_id = '96000000-0000-4000-8000-000000000001';
select extensions.is(
  (select outcome from public.retry_current_crm_sync('96000000-0000-4000-8000-000000000001')),
  'retry_limit_reached',
  'an exhausted sync cannot be reset from the UI'
);
select extensions.is(
  (select attempts from public.crm_outbox where lead_id = '96000000-0000-4000-8000-000000000001'),
  5,
  'exhausted retry count remains durable'
);

select extensions.finish();
rollback;
