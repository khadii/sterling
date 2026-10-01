-- 'Unknown permission' 400s did not say which permissionId was invalid.
-- Include the offending id in the raised message so the frontend can see
-- exactly which checkbox value is not in the permission catalogue.
do $migration$
declare
  target regprocedure;
  original_definition text;
  repaired_definition text;
begin
  target := to_regprocedure('public.workflow_mutate_without_notifications(uuid,uuid,text,uuid,jsonb)');
  if target is null then
    raise exception 'Required function is missing: workflow_mutate_without_notifications';
  end if;
  original_definition := pg_get_functiondef(target);
  if position('Unknown permission: %' in original_definition) > 0 then
    raise notice 'Unknown permission guard already names the offending id';
    return;
  end if;
  repaired_definition := regexp_replace(
    original_definition,
    $pattern$raise exception 'Unknown permission' using errcode='22023'$pattern$,
    $replacement$raise exception 'Unknown permission: %', (select x from unnest(v_permissions) x where not exists(select 1 from public.permissions where id=x) limit 1) using errcode='22023'$replacement$,
    'g'
  );
  if repaired_definition = original_definition then
    raise exception 'Expected Unknown permission guard is missing';
  end if;
  execute repaired_definition;
end
$migration$;
notify pgrst, 'reload schema';
