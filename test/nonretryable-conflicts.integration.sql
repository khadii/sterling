-- Run only against the disposable database after all migrations.
begin;
do $test$
declare
 actor uuid := gen_random_uuid();
 upload uuid := gen_random_uuid();
 result public.employer_onboarding;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'conflict@test.invalid',now());
 insert into public.user_roles(user_id,role_id) values(actor,'employer'),(actor,'superadmin');
 perform public.ensure_employer_onboarding(actor);
 begin
   perform public.save_company_onboarding_draft(actor,99,'{"name":"Should not save"}');
   raise exception 'Stale company draft accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.save_department_onboarding_draft(actor,99,'[]');
   raise exception 'Stale department draft accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.save_workspace_settings_draft(actor,99,'{"timezone":"UTC"}');
   raise exception 'Stale workspace settings accepted';
 exception when sqlstate 'PT409' then null; end;
 select * into result from public.employer_onboarding where user_id=actor;
 if result.company_revision<>0 or result.departments_revision<>0 or result.settings_revision<>0 or result.company_name is not null then
   raise exception 'Rejected draft changed saved state';
 end if;
 insert into public.department_icon_uploads(id,created_by,name,storage_path,content_type,file_size,expires_at)
 values(upload,actor,'Expired icon',upload::text||'.png','image/png',100,now()-interval '1 minute');
 begin
   perform public.confirm_department_icon(actor,upload);
   raise exception 'Expired icon accepted';
 exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from public.department_icon_uploads where id=upload and icon_id is not null) then
   raise exception 'Expired upload was published';
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc like '%40001%') then
   raise exception 'Retryable business conflict remains';
 end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc like '%PT409%') <> 8 then
   raise exception 'Expected eight repaired functions';
 end if;
 raise notice 'PASS: stale onboarding drafts and expired icons return PT409 without side effects; all eight guards repaired';
end
$test$;
rollback;
