-- Run against an isolated database with all migrations applied. Rolls back all fixtures.
begin;
do $$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); org uuid; other_org uuid;
 dep uuid; other_dep uuid; owner_role uuid; role_id uuid; team_id uuid; project_id uuid; task_id uuid; result jsonb; manager_role uuid;
begin
 insert into auth.users(id,email) values(actor,'owner@test.invalid'),(employee,'member@test.invalid'),(outsider,'outsider@test.invalid');
 insert into public.organizations(name,industry_id,company_size,created_by) values('Workflow Test',(select id from public.industries limit 1),'1_10',actor) returning id into org;
 insert into public.organizations(name,industry_id,company_size,created_by) values('Other Workspace',(select id from public.industries limit 1),'1_10',outsider) returning id into other_org;
 insert into public.organization_members values(org,actor,now()),(org,employee,now()),(other_org,outsider,now());
 insert into public.organization_roles(organization_id,key,name,description) values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into public.organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 insert into public.departments(organization_id,name) values(org,'Engineering') returning id into dep;
 insert into public.departments(organization_id,name) values(other_org,'Other') returning id into other_dep;
 set local role service_role;

 if not public.workflow_has_permission(actor,org,'roles.manage') then raise exception 'Owner provisioning did not grant workflow permissions'; end if;
 if public.workflow_has_permission(outsider,org,'roles.manage') then raise exception 'Cross-workspace permission leak'; end if;
 if has_function_privilege('authenticated','public.workflow_mutate(uuid,uuid,text,uuid,jsonb)','execute') then raise exception 'RPC exposed to browser'; end if;
 if has_function_privilege('anon','public.workflow_mutate(uuid,uuid,text,uuid,jsonb)','execute') then raise exception 'RPC exposed to anonymous user'; end if;

 result:=public.workflow_mutate(actor,org,'role.save',null,jsonb_build_object('name','Backend Engineer','departmentId',dep,'permissionIds',jsonb_build_array('teams.view')));
 role_id:=(result->>'id')::uuid;
 if result->>'status'<>'draft' or role_id is null then raise exception 'Role draft not persisted'; end if;
 begin
  perform public.workflow_mutate(actor,org,'member.assign',employee,jsonb_build_object('roleIds',jsonb_build_array(role_id)));
  raise exception 'Draft assigned';
 exception when invalid_parameter_value then null; end;
 result:=public.workflow_mutate(actor,org,'role.save',role_id,'{"status":"active","level":"Senior","employmentType":"full_time","workArrangement":"remote","description":"Build APIs","requirements":{"minYears":3,"maxYears":6},"benefits":{"currency":"USD","minimumSalary":50000,"maximumSalary":90000}}');
 if result->>'name'<>'Backend Engineer' then raise exception 'PATCH lost previous fields'; end if;
 perform public.workflow_mutate(actor,org,'member.assign',employee,jsonb_build_object('roleIds',jsonb_build_array(role_id)));
 if not public.workflow_has_permission(employee,org,'teams.view') then raise exception 'Assignment did not grant permissions'; end if;
 perform public.workflow_mutate(actor,org,'role.permissions',role_id,jsonb_build_object('permissionIds','[]'::jsonb,'expectedRevision',(select revision from organization_roles where id=role_id)));
 if public.workflow_has_permission(employee,org,'teams.view') then raise exception 'Revocation did not take effect'; end if;
 begin
  perform public.workflow_mutate(actor,org,'role.permissions',role_id,jsonb_build_object('permissionIds',array['not.real'],'expectedRevision',(select revision from organization_roles where id=role_id))); raise exception 'Unknown permission accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.workflow_mutate(actor,org,'role.permissions',owner_role,jsonb_build_object('permissionIds','[]'::jsonb,'expectedRevision',(select revision from organization_roles where id=owner_role))); raise exception 'Owner role modified';
 exception when insufficient_privilege then null; end;
 begin
  perform public.workflow_mutate(actor,org,'member.unassign',actor,jsonb_build_object('roleIds',jsonb_build_array(owner_role))); raise exception 'Owner removed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.workflow_mutate(actor,org,'role.save',role_id,'{"status":"draft"}'); raise exception 'Assigned role demoted to draft';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.workflow_mutate(actor,org,'role.save',role_id,'{"benefits":{"currency":"USD","minimumSalary":90,"maximumSalary":80}}'); raise exception 'Invalid salary range accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.workflow_mutate(actor,org,'role.save',null,jsonb_build_object('name','Wrong Department','departmentId',other_dep)); raise exception 'Foreign department accepted';
 exception when invalid_parameter_value then null; end;

 result:=public.workflow_mutate(actor,org,'role.save',null,'{"name":"Limited manager","status":"active","permissionIds":["roles.manage"]}'); manager_role:=(result->>'id')::uuid;
 perform public.workflow_mutate(actor,org,'member.assign',employee,jsonb_build_object('roleIds',jsonb_build_array(manager_role)));
 begin
  perform public.workflow_mutate(employee,org,'role.save',null,'{"name":"Escalation","status":"active","permissionIds":["roles.assign"]}'); raise exception 'Privilege escalation accepted';
 exception when insufficient_privilege then null; end;

 result:=public.workflow_mutate(actor,org,'team.save',null,jsonb_build_object('name','Backend Core','departmentId',dep,'memberIds',jsonb_build_array(employee))); team_id:=(result->>'id')::uuid;
 begin
  perform public.workflow_mutate(actor,org,'team.members',team_id,jsonb_build_object('memberIds',jsonb_build_array(outsider),'expectedRevision',(select membership_revision from organization_teams where id=team_id))); raise exception 'Foreign team member accepted';
 exception when foreign_key_violation then null; end;
 if not exists(select 1 from public.organization_team_members m where m.team_id=team_id and m.user_id=employee) then raise exception 'Failed membership replacement lost existing members'; end if;
 begin
  perform public.workflow_mutate(outsider,org,'team.save',null,jsonb_build_object('name','Intrusion','departmentId',dep)); raise exception 'Outsider mutation accepted';
 exception when insufficient_privilege then null; end;

 result:=public.workflow_mutate(actor,org,'project.save',null,jsonb_build_object('name','API Refactor','departmentId',dep,'teamId',team_id,'resourceManagerId',actor,'priority','medium','startDate','2026-10-01','endDate','2026-12-01')); project_id:=(result->>'id')::uuid;
 begin
  perform public.workflow_mutate(actor,org,'project.save',project_id,'{"endDate":"2026-01-01"}'); raise exception 'Reversed project dates accepted';
 exception when check_violation then null; end;
 result:=public.workflow_mutate(actor,org,'task.save',null,jsonb_build_object('projectId',project_id,'name','Audit endpoints','assigneeId',employee,'priority','normal','startDate','2026-10-01','dueDate','2026-10-15')); task_id:=(result->>'id')::uuid;
 perform public.workflow_mutate(actor,org,'task.save',task_id,'{"status":"done","assigneeId":null}');
 perform public.workflow_mutate(actor,org,'task.note',task_id,'{"body":"Audit complete"}');
 if (select count(*) from public.organization_task_history h where h.task_id=task_id)<>3 then raise exception 'Task history missing'; end if;
 result:=public.workflow_mutate(actor,org,'task.attach',task_id,jsonb_build_object('fileName','audit.csv','fileSize',12,'contentType','text/csv','storagePath',org::text||'/'||task_id::text||'/test.csv'));
 begin
  perform public.workflow_mutate(actor,org,'task.delete',task_id,'{}'); raise exception 'Deleted task without storage cleanup';
 exception when foreign_key_violation then null; end;
 perform public.workflow_mutate(actor,org,'task.detach',task_id,jsonb_build_object('attachmentId',result->>'id'));
 begin
  perform public.workflow_mutate(actor,org,'task.save',task_id,jsonb_build_object('assigneeId',outsider)); raise exception 'Foreign assignee accepted';
 exception when foreign_key_violation then null; end;
 perform public.workflow_mutate(actor,org,'task.delete',task_id,'{}');
 if exists(select 1 from public.organization_task_notes n where n.task_id=task_id) then raise exception 'Task notes not removed'; end if;
 raise notice 'PASS: role wizard, grants/revocation, owner protection, tenant isolation, atomic membership replacement, project/task lifecycle and history';
end $$;
rollback;
