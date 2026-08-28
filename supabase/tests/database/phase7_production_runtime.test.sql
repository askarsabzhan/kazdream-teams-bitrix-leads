begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.load_eligible_canonicalization_groups_bounded(integer)',
    'execute'
  ),
  'service role can load a bounded canonicalization batch'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.load_eligible_canonicalization_groups_bounded(integer)',
    'execute'
  ),
  'authenticated users cannot invoke the worker batch boundary'
);

select extensions.throws_ok(
  $$ select * from public.load_eligible_canonicalization_groups_bounded(0) $$,
  '22023',
  'Canonicalization batch limit is invalid.',
  'zero batch size is rejected'
);

select extensions.throws_ok(
  $$ select * from public.load_eligible_canonicalization_groups_bounded(51) $$,
  '22023',
  'Canonicalization batch limit is invalid.',
  'unbounded batch size is rejected'
);

select extensions.ok(
  (select count(*) <= 1 from public.load_eligible_canonicalization_groups_bounded(1)),
  'the returned candidate batch respects the requested limit'
);

select extensions.finish();
rollback;
