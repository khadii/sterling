-- Disposable local database only: fixtures and all writes are rolled back.
begin;
do $$
#variable_conflict use_variable
declare
 actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); org uuid; foreign_org uuid;
 owner_role uuid; policy uuid; foreign_policy uuid; job uuid; foreign_job uuid; stage uuid; foreign_stage uuid;
 email_rule uuid; result jsonb; prior jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at)
 values(actor,'leave-owner@test.invalid',now()),(member,'leave-member@test.invalid',now());
 insert into organizations(name,industry_id,company_size,created_by)
 values('Leave setup',(select id from industries limit 1),'1_10',actor) returning id into org;
 insert into organizations(name,industry_id,company_size,created_by)
 values('Other workspace',(select id from industries limit 1),'1_10',actor) returning id into foreign_org;
 insert into organization_members(organization_id,user_id) values(org,actor),(org,member);
 insert into organization_roles(organization_id,key,name,description)
 values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 insert into organization_role_permissions select owner_role,id from permissions on conflict do nothing;
 insert into leave_policies(organization_id,name,leave_type,created_by)
 values(foreign_org,'Private policy','annual',actor) returning id into foreign_policy;
 set local role service_role;

 result:=leave_settings_get(actor,org);
 if result->>'isConfigured'<>'false' or result->>'accrue_by_hours'<>'true' or result->>'leave_year_start_month'<>'1'
   or result->'carry_forward_start_month'<>'null'::jsonb then raise exception 'Unsaved defaults missing'; end if;
 if exists(select 1 from leave_settings where organization_id=org) then raise exception 'GET created a row'; end if;
 result:=leave_settings_save(actor,org,'{"leave_year_start_month":4,"leave_year_start_day":1,"leave_year_end_month":3,"leave_year_end_day":31,"pro_rate_new_starters":true,"accrue_by_hours":true,"track_public_holidays":true,"manager_notifications":true,"carry_forward_enabled":true,"carry_forward_start_month":12,"carry_forward_start_day":1,"carry_forward_end_month":3,"carry_forward_end_day":31}');
 if result->>'isConfigured'<>'true' or result->>'carry_forward_start_month'<>'12' then raise exception 'Full setup save failed'; end if;
 result:=leave_settings_save(actor,org,'{"manager_notifications":false}');
 if result->>'manager_notifications'<>'false' or result->>'accrue_by_hours'<>'true'
   or result->>'leave_year_start_month'<>'4' or result->>'carry_forward_start_month'<>'12' then raise exception 'Partial save reset omitted settings'; end if;
 prior:=result;
 begin
   perform leave_settings_save(actor,org,'{"leave_year_start_month":2,"leave_year_start_day":30}');
   raise exception 'February 30 accepted';
 exception when check_violation then null; end;
 result:=leave_settings_get(actor,org);
 if result->>'leave_year_start_month'<>'4' then raise exception 'Invalid save was not rolled back'; end if;
 begin
   perform leave_settings_save(actor,org,'{"carry_forward_end_month":4,"carry_forward_end_day":31}');
   raise exception 'April 31 accepted';
 exception when check_violation then null; end;
 result:=leave_settings_save(actor,org,'{"carry_forward_start_month":null,"carry_forward_start_day":null,"carry_forward_end_month":null,"carry_forward_end_day":null,"carry_forward_enabled":false}');
 if result->'carry_forward_end_month'<>'null'::jsonb then raise exception 'Cannot clear carry dates'; end if;
 begin
   perform leave_settings_save(actor,org,'{"carry_forward_start_month":1}');
   raise exception 'Incomplete carry window accepted';
 exception when check_violation then null; end;
 perform leave_settings_save(actor,org,'{"carry_forward_start_month":2,"carry_forward_start_day":29,"carry_forward_end_month":3,"carry_forward_end_day":31}');
 begin
   perform leave_settings_get(member,org);
   raise exception 'Member read privileged settings';
 exception when insufficient_privilege then null; end;
 begin
   perform leave_settings_save(member,org,'{"manager_notifications":true}');
   raise exception 'Member changed settings';
 exception when insufficient_privilege then null; end;
 begin
   perform leave_settings_save(actor,org,'{"unknown_toggle":true}');
   raise exception 'Unknown setting accepted';
 exception when sqlstate '22023' then null; end;

 result:=leave_mutate(actor,org,'policy.save',null,'{"name":"Zero allowance","leave_type":"annual","days_per_year":0,"max_carryover":0,"approval_chain":[{"level":1,"approverRole":"Direct Manager","action":"approval_required"}]}');
 policy:=(result->>'id')::uuid;
 result:=leave_policy_detail(actor,org,policy);
 if (result->>'days_per_year')::numeric<>0 or (result->>'max_carryover')::numeric<>0
   or result->>'allow_negative_balance'<>'false' or jsonb_array_length(result->'approval_chain')<>1 then raise exception 'Policy detail lost config/zero'; end if;
 begin
   perform leave_policy_detail(actor,org,foreign_policy);
   raise exception 'Foreign policy leaked';
 exception when sqlstate 'P0002' then null; end;
 begin
   perform leave_policy_detail(member,org,policy);
   raise exception 'Member read policy without permission';
 exception when insufficient_privilege then null; end;

 result:=recruitment_mutate(actor,org,'job.save',null,'{"title":"Discovery test","stages":[{"name":"Screening"}]}');
 job:=(result->>'id')::uuid;
 select id into stage from job_pipeline_stages where job_id=job;
 result:=recruitment_pipeline_manage(actor,org,job,'automation.create',stage,null,'{"kind":"email","label":"Acknowledgement","isEnabled":true,"config":{"recipient":"candidate","subject":"Received"}}');
 email_rule:=(result->>'automationId')::uuid;
 perform recruitment_pipeline_manage(actor,org,job,'automation.create',stage,null,'{"kind":"calendar","label":"Disabled interview","isEnabled":false,"config":{"delayHours":0,"durationMinutes":60}}');
 perform recruitment_pipeline_manage(actor,org,job,'automation.create',stage,null,'{"kind":"ai_evaluation","label":"Deferred AI","isEnabled":true,"config":{}}');
 -- Service role fixtures for a different workspace must never appear in the list.
 insert into jobs(organization_id,title,created_by) values(foreign_org,'Private job',actor) returning id into foreign_job;
 insert into job_pipeline_stages(organization_id,job_id,display_order,name) values(foreign_org,foreign_job,0,'Private stage') returning id into foreign_stage;
 insert into job_stage_automations(organization_id,stage_id,kind,label,is_enabled,config)
 values(foreign_org,foreign_stage,'email','Private rule',true,'{}');
 result:=recruitment_automation_list(actor,org);
 if result->>'total'<>'3' or jsonb_array_length(result->'items')<>3 or result->'limit'<>'null'::jsonb then raise exception 'All-list count or tenant isolation failed'; end if;
 if not exists(select 1 from jsonb_array_elements(result->'items') x
   where x->>'id'=email_rule::text and x#>>'{config,subject}'='Received' and x->>'job_title'='Discovery test' and x->>'stage_name'='Screening') then raise exception 'List missing job/stage/config'; end if;
 result:=recruitment_automation_list(actor,org,true);
 if result->>'total'<>'2' or exists(select 1 from jsonb_array_elements(result->'items') x where x->>'is_enabled'='false') then raise exception 'Enabled filter failed'; end if;
 result:=recruitment_automation_list(actor,org,false);
 if result->>'total'<>'1' or result#>>'{items,0,config,delayHours}'<>'0' then raise exception 'Disabled/zero filter failed'; end if;
 result:=recruitment_automation_list(actor,org,null,job,stage,'email',1,0);
 if result->>'total'<>'1' or result#>>'{items,0,id}'<>email_rule::text then raise exception 'Combined filters failed'; end if;
 result:=recruitment_automation_list(actor,org,null,foreign_job);
 if result->>'total'<>'0' or result->'items'<>'[]'::jsonb then raise exception 'Foreign job filter leaked data'; end if;
 result:=recruitment_automation_list(actor,org,null,null,null,null,1,1);
 if result->>'total'<>'3' or jsonb_array_length(result->'items')<>1 then raise exception 'Pagination failed'; end if;
 begin
   perform recruitment_automation_list(member,org);
   raise exception 'Member read automations without permission';
 exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.leave_settings_save(uuid,uuid,jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.leave_policy_detail(uuid,uuid,uuid)','EXECUTE')
   or has_function_privilege('anon','public.recruitment_automation_list(uuid,uuid,boolean,uuid,uuid,text,int,int)','EXECUTE') then raise exception 'RPC privilege leak'; end if;
 raise notice 'PASS leave setup, policy lookup, automation discovery, filters, dates, zero values and permissions';
end $$;
rollback;
