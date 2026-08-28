create function public.load_eligible_canonicalization_groups_bounded(p_limit integer)
returns table (
  lead_group_id uuid,
  lead_id uuid,
  candidate_source_fingerprint text,
  candidate_payload jsonb,
  contributors jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using
      errcode = '22023',
      message = 'Canonicalization batch limit is invalid.';
  end if;

  return query
  select eligible.*
  from public.load_eligible_canonicalization_groups() as eligible
  limit p_limit;
end;
$$;

revoke all on function public.load_eligible_canonicalization_groups_bounded(integer)
from public, anon, authenticated, service_role;

grant execute on function public.load_eligible_canonicalization_groups_bounded(integer)
to service_role;

comment on function public.load_eligible_canonicalization_groups_bounded(integer) is
  'Production worker boundary that limits canonicalization candidates per iteration.';
