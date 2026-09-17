-- Run after 0001–0008. All workflow writes go through a service-only transaction.
begin;
alter table public.departments add constraint departments_id_organization_unique unique(id, organization_id);
alter table public.organization_roles
  add column department_id uuid,
  add column status text not null default 'active' check(status in ('draft','active')),
  add column definition jsonb not null default '{}'::jsonb check(jsonb_typeof(definition) = 'object'),
  add column updated_at timestamptz not null default now(),
  add foreign key(department_id, organization_id) references public.departments(id, organization_id);
create trigger organization_roles_updated before update on public.organization_roles for each row execute function public.set_updated_at();

insert into public.permissions(id,description) values
 ('roles.view','View roles including requirements and compensation'),
 ('roles.manage','Create and edit custom roles'),
 ('teams.view','View teams'), ('teams.manage','Manage teams'),
 ('projects.view','View projects'), ('projects.manage','Manage projects'),
 ('tasks.view','View tasks, notes and attachments'), ('tasks.manage','Manage tasks, notes and attachments'),
 ('employees.view','View employee records'), ('employees.manage','Manage employee records'),
 ('leave.approve','Approve leave'), ('attendance.approve','Approve attendance'),
 ('performance.approve','Approve performance reviews'), ('expenses.approve','Approve expense claims')
on conflict(id) do nothing;

create function public.grant_workflow_owner_permissions() returns trigger language plpgsql set search_path=public as $$
begin
 if new.key='organisation_owner' then
  insert into public.organization_role_permissions(organization_role_id,permission_id)
  select new.id,id from public.permissions where id in ('roles.view','roles.manage','roles.assign','teams.view','teams.manage','projects.view','projects.manage','tasks.view','tasks.manage') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger workflow_owner_permissions after insert on public.organization_roles for each row execute function public.grant_workflow_owner_permissions();
insert into public.organization_role_permissions(organization_role_id,permission_id)
select r.id,p.id from public.organization_roles r cross join public.permissions p
where r.key='organisation_owner' and p.id in ('roles.view','roles.manage','roles.assign','teams.view','teams.manage','projects.view','projects.manage','tasks.view','tasks.manage') on conflict do nothing;

create table public.organization_teams (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 department_id uuid not null, name text not null check(length(btrim(name)) between 2 and 120), description text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id), unique(id,department_id,organization_id),
 foreign key(department_id,organization_id) references public.departments(id,organization_id)
);
create unique index organization_teams_name_unique on public.organization_teams(department_id,lower(btrim(name)));
create table public.organization_team_members (
 organization_id uuid not null, team_id uuid not null, user_id uuid not null,
 primary key(team_id,user_id),
 foreign key(team_id,organization_id) references public.organization_teams(id,organization_id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
create table public.organization_projects (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 department_id uuid not null, team_id uuid not null, resource_manager_id uuid not null,
 name text not null check(length(btrim(name)) between 2 and 160), description text,
 priority text not null check(priority in ('low','medium','high')), status text not null default 'todo' check(status in ('todo','in_progress','done')),
 start_date date not null, end_date date not null check(end_date>=start_date),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,organization_id),
 foreign key(team_id,department_id,organization_id) references public.organization_teams(id,department_id,organization_id),
 foreign key(organization_id,resource_manager_id) references public.organization_members(organization_id,user_id)
);
create table public.organization_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null, assignee_id uuid,
 name text not null check(length(btrim(name)) between 2 and 160), description text,
 priority text not null check(priority in ('low','normal','high','urgent')), status text not null default 'todo' check(status in ('todo','in_progress','done')),
 start_date date not null, due_date date not null check(due_date>=start_date),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,organization_id),
 foreign key(project_id,organization_id) references public.organization_projects(id,organization_id) on delete cascade,
 foreign key(organization_id,assignee_id) references public.organization_members(organization_id,user_id)
);
create table public.organization_task_notes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, task_id uuid not null,
 author_id uuid not null references public.profiles(id), body text not null check(length(btrim(body)) between 1 and 5000), created_at timestamptz not null default now(),
 foreign key(task_id,organization_id) references public.organization_tasks(id,organization_id) on delete cascade
);
create table public.organization_task_history (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, task_id uuid not null,
 actor_id uuid not null references public.profiles(id), action text not null, changes jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(task_id,organization_id) references public.organization_tasks(id,organization_id) on delete cascade
);
create index workflow_projects_team on public.organization_projects(organization_id,team_id);
create index workflow_tasks_project on public.organization_tasks(organization_id,project_id);
create index workflow_notes_task on public.organization_task_notes(organization_id,task_id,created_at);
create index workflow_history_task on public.organization_task_history(organization_id,task_id,created_at);

create table public.organization_task_attachments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, task_id uuid not null,
 uploaded_by uuid not null references public.profiles(id), file_name text not null, content_type text not null check(content_type in ('application/pdf','text/csv')),
 file_size integer not null check(file_size between 1 and 5242880), storage_path text not null unique, created_at timestamptz not null default now(),
 foreign key(task_id,organization_id) references public.organization_tasks(id,organization_id)
);
alter table public.organization_task_attachments enable row level security;
create index workflow_attachments_task on public.organization_task_attachments(organization_id,task_id);
grant all on public.organization_task_attachments to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('task-attachments','task-attachments',false,5242880,array['application/pdf','text/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Tables have no direct browser policies: the API authenticates and scopes every read.
alter table public.organization_teams enable row level security;
alter table public.organization_team_members enable row level security;
alter table public.organization_projects enable row level security;
alter table public.organization_tasks enable row level security;
alter table public.organization_task_notes enable row level security;
alter table public.organization_task_history enable row level security;
grant all on public.organization_teams,public.organization_team_members,public.organization_projects,public.organization_tasks,public.organization_task_notes,public.organization_task_history to service_role;
create trigger workflow_teams_updated before update on public.organization_teams for each row execute function public.set_updated_at();
create trigger workflow_projects_updated before update on public.organization_projects for each row execute function public.set_updated_at();
create trigger workflow_tasks_updated before update on public.organization_tasks for each row execute function public.set_updated_at();

create function public.workflow_has_permission(p_actor uuid,p_org uuid,p_permission text) returns boolean
language sql stable set search_path=public as $$
 select exists(select 1 from public.organization_members m
 join public.organization_member_roles mr on mr.organization_id=m.organization_id and mr.user_id=m.user_id
 join public.organization_roles r on r.id=mr.organization_role_id and r.organization_id=m.organization_id and r.status='active'
 join public.organization_role_permissions rp on rp.organization_role_id=r.id
 where m.user_id=p_actor and m.organization_id=p_org and rp.permission_id=p_permission);
$$;
revoke all on function public.workflow_has_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.workflow_has_permission(uuid,uuid,text) to service_role;

create function public.workflow_mutate(p_actor uuid,p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql set search_path=public as $$
declare v_id uuid; v_old jsonb; v_data jsonb; v_result jsonb; v_permission text; v_permissions text[]; v_role public.organization_roles; v_member uuid; v_owner boolean;
begin
 -- Serialize workflow edits/permission changes within a workspace to avoid lost grants.
 perform 1 from public.organizations where id=p_org for update;
 v_permission := case
 when p_action in ('role.save','role.permissions') then 'roles.manage'
 when p_action in ('member.assign','member.unassign') then 'roles.assign'
 when p_action in ('team.save','team.members') then 'teams.manage'
 when p_action='project.save' then 'projects.manage'
 when p_action in ('task.save','task.delete','task.note','task.attach','task.detach') then 'tasks.manage'
 else null end;
 if v_permission is null then raise exception 'Unknown workflow action' using errcode='22023'; end if;
 if not public.workflow_has_permission(p_actor,p_org,v_permission) then raise exception 'Permission required: %',v_permission using errcode='42501'; end if;
 select exists(select 1 from public.organization_member_roles mr join public.organization_roles r on r.id=mr.organization_role_id
 where mr.organization_id=p_org and mr.user_id=p_actor and r.key='organisation_owner' and r.status='active') into v_owner;

 if p_action in ('role.save','role.permissions') then
  if p_id is not null then
   select * into v_role from public.organization_roles where id=p_id and organization_id=p_org for update;
   if not found then raise exception 'Role not found' using errcode='P0002'; end if;
   if v_role.is_system then raise exception 'System roles cannot be edited' using errcode='42501'; end if;
  elsif p_action='role.permissions' then raise exception 'Role required' using errcode='22023';
  end if;
  v_permissions := case when p_data ? 'permissionIds' then array(select jsonb_array_elements_text(p_data->'permissionIds'))
    else array(select permission_id from public.organization_role_permissions where organization_role_id=p_id) end;
  if exists(select 1 from unnest(v_permissions) x where not exists(select 1 from public.permissions where id=x)) then raise exception 'Unknown permission' using errcode='22023'; end if;
  if exists(select 1 from unnest(v_permissions) x where x in ('workspace.delete','workspace.transfer','billing.manage')) then raise exception 'Owner-only permissions cannot be delegated through custom roles' using errcode='42501'; end if;
  if not v_owner and exists(select 1 from unnest(v_permissions) x where not public.workflow_has_permission(p_actor,p_org,x)) then raise exception 'Cannot grant permissions you do not hold' using errcode='42501'; end if;
  v_data := coalesce(v_role.definition,'{}'::jsonb) || (p_data - 'permissionIds');
  if p_id is null then v_id:=gen_random_uuid(); else v_id:=p_id; end if;
  if p_action='role.permissions' then v_data:=v_role.definition; end if;
  if coalesce(v_data->>'status','draft')='active' and v_data->>'departmentId' is not null then
   if coalesce(v_data->>'level','')='' or coalesce(v_data->>'employmentType','')='' or coalesce(v_data->>'workArrangement','')='' or coalesce(v_data->>'description','')='' then
    raise exception 'Complete basic information before activating a department role' using errcode='22023';
   end if;
  end if;
  if v_data->>'departmentId' is not null and not exists(select 1 from public.departments where id=(v_data->>'departmentId')::uuid and organization_id=p_org and not is_archived) then raise exception 'Department not available' using errcode='22023'; end if;
  if v_data->>'reportsToUserId' is not null and not exists(select 1 from public.organization_members where organization_id=p_org and user_id=(v_data->>'reportsToUserId')::uuid) then raise exception 'Reporting manager must be a member' using errcode='22023'; end if;
  if (v_data#>>'{requirements,maxYears}')::numeric < (v_data#>>'{requirements,minYears}')::numeric or (v_data#>>'{benefits,maximumSalary}')::numeric < (v_data#>>'{benefits,minimumSalary}')::numeric then raise exception 'Invalid numeric range' using errcode='22023'; end if;
  if (v_data#>>'{benefits,minimumSalary}' is not null or v_data#>>'{benefits,maximumSalary}' is not null) and v_data#>>'{benefits,currency}' is null then raise exception 'Salary currency required' using errcode='22023'; end if;
  if p_id is not null and coalesce(v_data->>'status','draft')='draft' and exists(select 1 from public.organization_member_roles where organization_role_id=p_id) then raise exception 'Assigned roles cannot become drafts' using errcode='22023'; end if;
  insert into public.organization_roles(id,organization_id,key,name,description,is_system,department_id,status,definition)
  values(v_id,p_org,'custom_'||replace(v_id::text,'-',''),v_data->>'name',coalesce(v_data->>'description',''),false,(v_data->>'departmentId')::uuid,coalesce(v_data->>'status','draft'),v_data)
  on conflict(id) do update set name=excluded.name,description=excluded.description,department_id=excluded.department_id,status=excluded.status,definition=excluded.definition;
  delete from public.organization_role_permissions where organization_role_id=v_id;
  insert into public.organization_role_permissions(organization_role_id,permission_id) select v_id,x from unnest(v_permissions) x;
  select to_jsonb(r) || jsonb_build_object('permissionIds',to_jsonb(v_permissions)) into v_result from public.organization_roles r where id=v_id;
  return v_result;
 end if;

 if p_action in ('member.assign','member.unassign') then
  if not exists(select 1 from public.organization_members where user_id=p_id and organization_id=p_org) then raise exception 'Member not found' using errcode='P0002'; end if;
  for v_id in select value::uuid from jsonb_array_elements_text(p_data->'roleIds') loop
   select * into v_role from public.organization_roles where id=v_id and organization_id=p_org;
   if not found then raise exception 'Role not found' using errcode='P0002'; end if;
   if v_role.status<>'active' then raise exception 'Draft roles cannot be assigned' using errcode='22023'; end if;
   if v_role.key='organisation_owner' then raise exception 'Use ownership transfer to change owners' using errcode='42501'; end if;
   if not v_owner and exists(select 1 from public.organization_role_permissions rp where rp.organization_role_id=v_id and not public.workflow_has_permission(p_actor,p_org,rp.permission_id)) then raise exception 'Role exceeds your permissions' using errcode='42501'; end if;
   if p_action='member.assign' then
    insert into public.organization_member_roles(organization_id,user_id,organization_role_id) values(p_org,p_id,v_id) on conflict do nothing;
   else delete from public.organization_member_roles where organization_id=p_org and user_id=p_id and organization_role_id=v_id;
   end if;
  end loop;
  return jsonb_build_object('userId',p_id,'roleIds',(select coalesce(jsonb_agg(organization_role_id),'[]') from public.organization_member_roles where organization_id=p_org and user_id=p_id));
 end if;

 if p_action in ('team.save','team.members') then
  if p_id is not null then
   select to_jsonb(t)||jsonb_build_object('departmentId',department_id) into v_old from public.organization_teams t where id=p_id and organization_id=p_org;
   if not found then raise exception 'Team not found' using errcode='P0002'; end if;
  end if;
  v_data:=coalesce(v_old,'{}')||p_data; v_id:=coalesce(p_id,gen_random_uuid());
  if not exists(select 1 from public.departments where id=(v_data->>'departmentId')::uuid and organization_id=p_org and not is_archived) then raise exception 'Department not available' using errcode='22023'; end if;
  insert into public.organization_teams(id,organization_id,department_id,name,description) values(v_id,p_org,(v_data->>'departmentId')::uuid,v_data->>'name',v_data->>'description')
  on conflict(id) do update set department_id=excluded.department_id,name=excluded.name,description=excluded.description;
  if p_data ? 'memberIds' then
   delete from public.organization_team_members where team_id=v_id;
   insert into public.organization_team_members(organization_id,team_id,user_id) select p_org,v_id,value::uuid from jsonb_array_elements_text(p_data->'memberIds');
  end if;
  select to_jsonb(t)||jsonb_build_object('memberIds',(select coalesce(jsonb_agg(user_id),'[]') from public.organization_team_members where team_id=v_id)) into v_result from public.organization_teams t where id=v_id;
  return v_result;
 end if;

 if p_action='project.save' then
  if p_id is not null then
   select to_jsonb(p)||jsonb_build_object('departmentId',department_id,'teamId',team_id,'resourceManagerId',resource_manager_id,'startDate',start_date,'endDate',end_date) into v_old from public.organization_projects p where id=p_id and organization_id=p_org;
   if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  end if;
  v_data:=coalesce(v_old,'{}')||p_data; v_id:=coalesce(p_id,gen_random_uuid());
  if not exists(select 1 from public.departments where id=(v_data->>'departmentId')::uuid and organization_id=p_org and not is_archived) then raise exception 'Department not available' using errcode='22023'; end if;
  insert into public.organization_projects(id,organization_id,department_id,team_id,resource_manager_id,name,description,priority,status,start_date,end_date)
  values(v_id,p_org,(v_data->>'departmentId')::uuid,(v_data->>'teamId')::uuid,(v_data->>'resourceManagerId')::uuid,v_data->>'name',v_data->>'description',v_data->>'priority',coalesce(v_data->>'status','todo'),(v_data->>'startDate')::date,(v_data->>'endDate')::date)
  on conflict(id) do update set department_id=excluded.department_id,team_id=excluded.team_id,resource_manager_id=excluded.resource_manager_id,name=excluded.name,description=excluded.description,priority=excluded.priority,status=excluded.status,start_date=excluded.start_date,end_date=excluded.end_date;
  select to_jsonb(p) into v_result from public.organization_projects p where id=v_id; return v_result;
 end if;

 if p_id is not null then
  select to_jsonb(t)||jsonb_build_object('projectId',project_id,'assigneeId',assignee_id,'startDate',start_date,'dueDate',due_date) into v_old from public.organization_tasks t where id=p_id and organization_id=p_org;
  if not found then raise exception 'Task not found' using errcode='P0002'; end if;
 end if;
 if p_action='task.attach' then
  if (select count(*) from public.organization_task_attachments where task_id=p_id)>=100 then raise exception 'Maximum 100 attachments per task' using errcode='22023'; end if;
  insert into public.organization_task_attachments(organization_id,task_id,uploaded_by,file_name,content_type,file_size,storage_path)
  values(p_org,p_id,p_actor,p_data->>'fileName',p_data->>'contentType',(p_data->>'fileSize')::integer,p_data->>'storagePath') returning to_jsonb(organization_task_attachments.*) into v_result;
  insert into public.organization_task_history(organization_id,task_id,actor_id,action,changes) values(p_org,p_id,p_actor,'attachment_added',jsonb_build_object('fileName',p_data->>'fileName'));
  return v_result;
 elsif p_action='task.detach' then
  delete from public.organization_task_attachments where id=(p_data->>'attachmentId')::uuid and task_id=p_id and organization_id=p_org;
  insert into public.organization_task_history(organization_id,task_id,actor_id,action) values(p_org,p_id,p_actor,'attachment_removed');
  return jsonb_build_object('deleted',true);
 elsif p_action='task.delete' then
  if exists(select 1 from public.organization_task_attachments where task_id=p_id) then raise exception 'Remove attachments before deleting this task' using errcode='23503'; end if;
  delete from public.organization_tasks where id=p_id and organization_id=p_org;
  return jsonb_build_object('id',p_id,'deleted',true);
 elsif p_action='task.note' then
  insert into public.organization_task_notes(organization_id,task_id,author_id,body) values(p_org,p_id,p_actor,p_data->>'body') returning to_jsonb(organization_task_notes.*) into v_result;
  insert into public.organization_task_history(organization_id,task_id,actor_id,action) values(p_org,p_id,p_actor,'note_added');
  return v_result;
 end if;
 v_data:=coalesce(v_old,'{}')||p_data; v_id:=coalesce(p_id,gen_random_uuid());
 insert into public.organization_tasks(id,organization_id,project_id,assignee_id,name,description,priority,status,start_date,due_date)
 values(v_id,p_org,(v_data->>'projectId')::uuid,(v_data->>'assigneeId')::uuid,v_data->>'name',v_data->>'description',v_data->>'priority',coalesce(v_data->>'status','todo'),(v_data->>'startDate')::date,(v_data->>'dueDate')::date)
 on conflict(id) do update set assignee_id=excluded.assignee_id,name=excluded.name,description=excluded.description,priority=excluded.priority,status=excluded.status,start_date=excluded.start_date,due_date=excluded.due_date;
 insert into public.organization_task_history(organization_id,task_id,actor_id,action,changes)
 values(p_org,v_id,p_actor,case when p_id is null then 'created' else 'updated' end,p_data - 'description');
 select to_jsonb(t) into v_result from public.organization_tasks t where id=v_id; return v_result;
end $$;
revoke all on function public.workflow_mutate(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workflow_mutate(uuid,uuid,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
