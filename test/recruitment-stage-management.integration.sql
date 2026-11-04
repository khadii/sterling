-- Run against a disposable database with all repository migrations applied.
begin;
do $$
#variable_conflict use_variable
declare
 actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); org uuid; owner_role uuid;
 job uuid; other_job uuid; stage_one uuid; stage_two uuid; auto uuid; cand uuid;
 result jsonb; before_revision int; n int;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'stage-owner@test.invalid',now()),(member,'stage-member@test.invalid',now());
 insert into organizations(name,industry_id,company_size,created_by)
 values('Stage management',(select id from industries limit 1),'1_10',actor) returning id into org;
 insert into organization_settings(organization_id,country_code,timezone,locale,week_starts_on,date_format)
 values(org,'NG','Africa/Lagos','en','monday','DD/MM/YYYY');
 insert into organization_members(organization_id,user_id) values(org,actor),(org,member);
 insert into organization_roles(organization_id,key,name,description)
 values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 insert into organization_role_permissions select owner_role,id from permissions on conflict do nothing;
 set local role service_role;
 result:=recruitment_mutate(actor,org,'job.save',null,'{"title":"Stage testing","stages":[]}');
 job:=(result->>'id')::uuid;
 result:=recruitment_mutate(actor,org,'job.save',null,'{"title":"Other job","stages":[]}');
 other_job:=(result->>'id')::uuid;
 result:=recruitment_pipeline_manage(actor,org,job,'stages.list');
 if result->>'total'<>'0' or result->'items'<>'[]'::jsonb then raise exception 'Zero list broken'; end if;
 result:=recruitment_pipeline_manage(actor,org,job,'stage.create',null,null,'{"name":"Screening"}');
 stage_one:=(result->>'stageId')::uuid;
 result:=recruitment_pipeline_manage(actor,org,job,'stage.create',null,null,'{"name":"Interview","category":"interview"}');
 stage_two:=(result->>'stageId')::uuid;
 result:=recruitment_pipeline_manage(actor,org,job,'stages.reorder',null,null,jsonb_build_object('stageIds',jsonb_build_array(stage_two,stage_one)));
 if result#>>'{items,0,id}'<>stage_two::text then raise exception 'Reorder failed'; end if;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'stages.reorder',null,null,jsonb_build_object('stageIds',jsonb_build_array(stage_two,stage_two)));
   raise exception 'Duplicate reorder accepted';
 exception when sqlstate '22023' then null; end;
 begin
   perform recruitment_pipeline_manage(actor,org,other_job,'stage.update',stage_one,null,'{"name":"Stolen"}');
   raise exception 'Cross-job mutation accepted';
 exception when sqlstate 'P0002' then null; end;
 begin
   perform recruitment_pipeline_manage(member,org,job,'stage.create',null,null,'{"name":"Unauthorized"}');
   raise exception 'Unauthorized mutation accepted';
 exception when insufficient_privilege then null; end;
 result:=recruitment_pipeline_manage(actor,org,job,'automation.create',stage_two,null,
   '{"kind":"email","label":"Interview invitation","isEnabled":false,"config":{"subject":"Interview invitation"}}');
 auto:=(result->>'automationId')::uuid;
 result:=recruitment_pipeline_manage(actor,org,job,'automation.update',stage_two,auto,'{"isEnabled":true}');
 if result#>>'{items,0,is_enabled}'<>'true' then raise exception 'Toggle failed'; end if;
 result:=recruitment_pipeline_manage(actor,org,job,'automations.replace',stage_two,null,
   jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',auto,'kind','email','label','Interview invitation','isEnabled',true,'config',jsonb_build_object('subject','Saved invitation')))));
 if result#>>'{items,0,id}'<>auto::text or result#>>'{items,0,config,subject}'<>'Saved invitation' then raise exception 'Bulk save lost identity or config'; end if;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'automations.replace',stage_two,null,
     jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',auto,'kind','email','label','Partial save'),jsonb_build_object('kind','invalid','label','Invalid'))));
   raise exception 'Invalid bulk save accepted';
 exception when check_violation then null; end;
 result:=recruitment_pipeline_manage(actor,org,job,'automations.list',stage_two);
 if result#>>'{items,0,label}'<>'Interview invitation' then raise exception 'Bulk failure did not roll back'; end if;
 result:=recruitment_mutate(actor,org,'candidate.save',null,jsonb_build_object('jobId',job,'stageId',stage_one,'fullName','Candidate','email','candidate@test.invalid'));
 cand:=(result->>'id')::uuid;
 result:=recruitment_mutate(actor,org,'candidate.advance',cand,jsonb_build_object('stageId',stage_two));
 if jsonb_array_length(result->'automations')<>1 then raise exception 'New automation did not execute'; end if;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'automations.replace',stage_two,null,'{"items":[]}');
   raise exception 'Bulk save erased history';
 exception when sqlstate '22023' then null; end;
 result:=recruitment_pipeline_manage(actor,org,job,'stage.update',stage_two,null,'{"name":"Technical interview"}');
 if not exists(select 1 from candidates where id=cand and stage_id=stage_two) then raise exception 'Candidate assignment lost'; end if;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'automation.delete',stage_two,auto);
   raise exception 'Execution history deleted';
 exception when sqlstate '22023' then null; end;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'stage.delete',stage_two);
   raise exception 'Occupied stage deleted';
 exception when sqlstate '22023' then null; end;
 result:=recruitment_pipeline_manage(actor,org,job,'automation.update',stage_two,auto,'{"isEnabled":false}');
 if result#>>'{items,0,is_enabled}'<>'false' then raise exception 'Disable failed'; end if;
 result:=recruitment_pipeline_manage(actor,org,other_job,'stage.create',null,null,'{"name":"Unused"}');
 result:=recruitment_pipeline_manage(actor,org,other_job,'stage.delete',(result->>'stageId')::uuid);
 if result->>'total'<>'0' then raise exception 'Unused stage not deleted'; end if;
 -- Counts and caps are tested inside the same transaction and rolled back.
 for n in 3..30 loop
   perform recruitment_pipeline_manage(actor,org,job,'stage.create',null,null,jsonb_build_object('name','Stage '||n));
 end loop;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'stage.create',null,null,'{"name":"Excess"}');
   raise exception 'Stage cap not enforced';
 exception when sqlstate '22023' then null; end;
 for n in 2..20 loop
   perform recruitment_pipeline_manage(actor,org,job,'automation.create',stage_two,null,jsonb_build_object('kind','email','label','Email '||n,'isEnabled',false));
 end loop;
 begin
   perform recruitment_pipeline_manage(actor,org,job,'automation.create',stage_two,null,'{"kind":"email","label":"Excess"}');
   raise exception 'Automation cap not enforced';
 exception when sqlstate '22023' then null; end;
 result:=recruitment_mutate(actor,org,'job.status',job,'{"status":"closed"}');
 begin
   perform recruitment_pipeline_manage(actor,org,job,'automation.update',stage_two,auto,'{"isEnabled":true}');
   raise exception 'Closed job writable';
 exception when sqlstate '22023' then null; end;
 if not exists(select 1 from job_revision_history where job_id=job and action='automation.update') then raise exception 'Missing audit'; end if;
 if has_function_privilege('anon','public.recruitment_pipeline_manage(uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE') then raise exception 'Anon can execute'; end if;
 raise notice 'Stage management integration passed';
end $$;
rollback;
