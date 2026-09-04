begin;
do $$
declare actor uuid := gen_random_uuid(); seeker uuid := gen_random_uuid(); org uuid; icon uuid; upload uuid := gen_random_uuid(); result uuid; duplicate uuid; state public.employer_onboarding;
begin
 insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values (actor,'kadirid9@gmail.com','{"role":"employer"}',now()), (seeker,'seeker@example.com','{"role":"superadmin"}',now());
 if exists (select 1 from public.user_roles where user_id = seeker) then raise exception 'Signup assigned privileged role'; end if;
 begin
  perform public.assign_initial_role(seeker,'admin');
  raise exception 'Privileged self assignment succeeded';
 exception when raise_exception then
  if sqlerrm <> 'Role is not self assignable' then raise; end if;
 end;
 perform public.bootstrap_platform_superadmin(actor,'kadirid9@gmail.com','Kadiri Daniel');
 if not exists (select 1 from public.user_roles where user_id = actor and role_id = 'superadmin') then raise exception 'Bootstrap failed'; end if;
 select id into icon from public.department_icons where builtin_key = 'truck';
 perform public.save_company_onboarding_draft(actor,0,jsonb_build_object('name','Test Organization','industryId',(select id from public.industries limit 1),'size','101_plus'));
 perform public.complete_employer_onboarding_step(actor,1::smallint);
 state := public.save_department_onboarding_draft(actor,0,jsonb_build_array(jsonb_build_object('clientId','logistics','name','Logistics','iconId',icon), jsonb_build_object('clientId','general','name','General')));
 if state.department_drafts->1->>'iconId' is null then raise exception 'Default icon not persisted'; end if;
 update public.department_icons set is_active = false where id = icon;
 -- Existing selection remains legal.
 perform public.save_department_onboarding_draft(actor,1,state.department_drafts);
 begin
  perform public.save_department_onboarding_draft(actor,2,jsonb_build_array(jsonb_build_object('clientId','new','name','New Team','iconId',icon)));
  raise exception 'Inactive icon was selectable';
 exception when invalid_parameter_value then null;
 end;
 perform public.complete_employer_onboarding_step(actor,2::smallint);
 perform public.save_workspace_settings_draft(actor,0,'{"countryCode":"NG","timezone":"Africa/Lagos","locale":"en-NG","weekStartsOn":"monday","dateFormat":"DD/MM/YYYY"}');
 perform public.complete_employer_onboarding_step(actor,3::smallint);
 org := public.provision_employer_workspace(actor);
 if not exists (select 1 from public.departments where organization_id = org and name = 'Logistics' and icon_id = icon) then raise exception 'Provisioning lost icon'; end if;
 if public.provision_employer_workspace(actor) <> org then raise exception 'Provisioning not idempotent'; end if;
 insert into public.department_icon_uploads(id,created_by,name,storage_path,content_type,file_size,expires_at) values(upload,actor,'New Icon','pending/test','image/png',100,now()+interval '1 hour');
 result := public.confirm_department_icon(actor,upload);
 duplicate := public.confirm_department_icon(actor,upload);
 if duplicate <> result then raise exception 'Icon confirmation not idempotent'; end if;
 begin
  perform public.confirm_department_icon(seeker,upload);
  raise exception 'Non-admin confirmed icon';
 exception when insufficient_privilege then null;
 end;
 if has_function_privilege('authenticated','public.bootstrap_platform_superadmin(uuid,text,text)','EXECUTE') then raise exception 'Public bootstrap exposed'; end if;
 if has_function_privilege('authenticated','public.confirm_department_icon(uuid,uuid)','EXECUTE') then raise exception 'Public icon RPC exposed'; end if;
end; $$;
rollback;
