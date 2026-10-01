-- Business conflicts must not use serialization_failure (40001).
-- PostgREST 14 retries that state indefinitely, exhausting its connection pool.
-- PT409 preserves conflict semantics without transaction-level retry.
-- Replace only these known raises; retain function bodies, owners and grants.
do $migration$
declare
  signature text;
  target regprocedure;
  original_definition text;
  repaired_definition text;
begin
  foreach signature in array array[
    'public.confirm_department_icon(uuid,uuid)',
    'public.hr_claim_zoom(uuid,uuid,uuid)',
    'public.hr_finish_zoom(uuid,uuid,uuid,text,text)',
    'public.save_company_onboarding_draft(uuid,integer,jsonb)',
    'public.save_department_onboarding_draft(uuid,integer,jsonb)',
    'public.save_workspace_settings_draft(uuid,integer,jsonb)',
    'public.set_department_members(uuid,uuid,uuid,uuid[],integer)',
    'public.workflow_mutate(uuid,uuid,text,uuid,jsonb)'
  ] loop
    target := to_regprocedure(signature);
    if target is null then
      raise exception 'Required function is missing: %', signature;
    end if;
    original_definition := pg_get_functiondef(target);
    repaired_definition := regexp_replace(
      original_definition,
      $pattern$errcode\s*=\s*'40001'$pattern$,
      $replacement$errcode = 'PT409'$replacement$,
      'gi'
    );
    if repaired_definition = original_definition then
      if position('PT409' in original_definition) = 0 then
        raise exception 'Expected conflict guard is missing: %', signature;
      end if;
    else
      execute repaired_definition;
    end if;
  end loop;
end
$migration$;
notify pgrst, 'reload schema';
