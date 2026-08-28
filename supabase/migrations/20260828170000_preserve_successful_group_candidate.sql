alter table public.lead_groups
  add column candidate_source_fingerprint text;

update public.lead_groups
set candidate_source_fingerprint = extraction_source_fingerprint
where candidate_payload is not null;

alter table public.lead_groups
  add constraint lead_groups_candidate_source_fingerprint_check
    check (
      (
        candidate_payload is null
        and candidate_source_fingerprint is null
      )
      or (
        candidate_payload is not null
        and candidate_source_fingerprint ~ '^[0-9a-f]{64}$'
      )
    );

comment on column public.lead_groups.candidate_source_fingerprint is
  'Extraction identity of the last successfully completed candidate. It remains stable while a newer extraction identity is processing or fails.';

create function public.preserve_successful_group_candidate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.extraction_state = 'processing'
    and old.candidate_payload is not null
  then
    new.candidate_payload := old.candidate_payload;
    new.candidate_source_fingerprint := old.candidate_source_fingerprint;
    new.eligibility_state := old.eligibility_state;
    new.eligibility_reason_code := old.eligibility_reason_code;
    new.extraction_completed_at := old.extraction_completed_at;
    new.extraction_duration_ms := old.extraction_duration_ms;
    new.extraction_input_tokens := old.extraction_input_tokens;
    new.extraction_output_tokens := old.extraction_output_tokens;
    new.extraction_total_tokens := old.extraction_total_tokens;
  end if;

  if new.extraction_state in ('retryable_failed', 'permanent_failed')
    and old.candidate_payload is not null
    and new.candidate_payload is not distinct from old.candidate_payload
  then
    new.candidate_source_fingerprint := old.candidate_source_fingerprint;
    new.eligibility_state := old.eligibility_state;
    new.eligibility_reason_code := old.eligibility_reason_code;
    new.extraction_completed_at := old.extraction_completed_at;
    new.extraction_duration_ms := old.extraction_duration_ms;
    new.extraction_input_tokens := old.extraction_input_tokens;
    new.extraction_output_tokens := old.extraction_output_tokens;
    new.extraction_total_tokens := old.extraction_total_tokens;
  end if;

  if new.extraction_state = 'extracted'
    and new.candidate_payload is not null
    and (
      old.extraction_state is distinct from 'extracted'
      or new.extraction_revision is distinct from old.extraction_revision
      or new.candidate_payload is distinct from old.candidate_payload
    )
  then
    new.candidate_source_fingerprint := new.extraction_source_fingerprint;
  end if;

  return new;
end;
$$;

create trigger lead_groups_preserve_successful_candidate
before update on public.lead_groups
for each row execute function public.preserve_successful_group_candidate();

revoke all on function public.preserve_successful_group_candidate()
from public, anon, authenticated, service_role;
