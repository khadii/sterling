-- Apply after 0009. Transactional outbox: no SMTP work runs inside API writes.
begin;
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 activity_email text not null default 'immediate' check(activity_email in ('immediate','daily','off')),
 reminders boolean not null default true
);
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 recipient_id uuid references public.profiles(id) on delete cascade, recipient_email text,
 kind text not null, category text not null check(category in ('essential','activity','reminder')),
 subject text not null, body text not null, payload jsonb not null default '{}',
 dedupe_key text not null unique, status text not null default 'pending' check(status in ('pending','processing','sent','failed','suppressed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_id uuid, leased_until timestamptz, last_error text, sent_at timestamptz, created_at timestamptz not null default now(),
 check(recipient_id is not null or recipient_email is not null)
);
create index notification_task_due on public.organization_tasks(due_date,organization_id) where status<>'done';
create index notification_calendar_start on public.calendar_events(starts_at);
create index notification_pending on public.notification_outbox(available_at) where status in ('pending','processing');
create table public.organization_department_members (
 organization_id uuid not null, department_id uuid not null, user_id uuid not null,
 primary key(department_id,user_id),
 foreign key(department_id,organization_id) references public.departments(id,organization_id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
create table public.organization_invitations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 email text not null, invited_by uuid not null references public.profiles(id), token_hash text not null unique,
 role_ids uuid[] not null, department_id uuid, status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 expires_at timestamptz not null default now()+interval '7 days', accepted_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 foreign key(department_id,organization_id) references public.departments(id,organization_id)
);
create unique index invitation_pending_email on public.organization_invitations(organization_id,lower(email)) where status='pending';
alter table public.notification_preferences enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.organization_department_members enable row level security;
alter table public.organization_invitations enable row level security;
revoke all on public.notification_preferences,public.notification_outbox,public.organization_department_members,public.organization_invitations from anon,authenticated;
grant all on public.notification_preferences,public.notification_outbox,public.organization_department_members,public.organization_invitations to service_role;

create function public.queue_notification(p_org uuid,p_user uuid,p_kind text,p_subject text,p_body text,p_key text,p_category text default 'essential',p_payload jsonb default '{}',p_email text default null)
returns void language plpgsql set search_path=public as $$
declare v_mode text; v_reminders boolean;
begin
 if p_user is null and p_email is null then return; end if;
 select activity_email,reminders into v_mode,v_reminders from notification_preferences where user_id=p_user;
 if (p_category='activity' and v_mode='off') or (p_category='reminder' and v_reminders=false) then return; end if;
 insert into notification_outbox(organization_id,recipient_id,recipient_email,kind,category,subject,body,dedupe_key,payload,available_at)
 values(p_org,p_user,p_email,p_kind,p_category,p_subject,p_body,p_key,p_payload || jsonb_build_object('delivery',coalesce(v_mode,'immediate')),
 case when p_category='activity' and v_mode='daily' then date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day 9 hours' else now() end)
 on conflict(dedupe_key) do nothing;
end $$;

-- Wrap the existing permission-checked transaction; compare final state rather than
-- delete/insert row churn when replacing team members or role permissions.
alter function public.workflow_mutate(uuid,uuid,text,uuid,jsonb) rename to workflow_mutate_without_notifications;
create function public.workflow_mutate(p_actor uuid,p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql set search_path=public as $$
declare v_before jsonb; v_after jsonb; v_users uuid[]; v_new_users uuid[]; v_permissions text[]; v_new_permissions text[];
 v_user uuid; v_manager uuid; v_old_manager uuid; v_result jsonb; v_id uuid; v_name text; v_kind text; v_key text:=gen_random_uuid()::text; v_member uuid;
begin
 perform 1 from organizations where id=p_org for update;
 if p_action like 'team.%' then
  select coalesce(array_agg(user_id),'{}') into v_users from organization_team_members where team_id=p_id;
 elsif p_action like 'role.%' then
  select to_jsonb(r) into v_before from organization_roles r where id=p_id and organization_id=p_org;
  select coalesce(array_agg(permission_id order by permission_id),'{}') into v_permissions from organization_role_permissions where organization_role_id=p_id;
 elsif p_action like 'member.%' then
  select coalesce(array_agg(organization_role_id),'{}') into v_users from organization_member_roles where organization_id=p_org and user_id=p_id;
 elsif p_action='project.save' then
  select to_jsonb(p) into v_before from organization_projects p where id=p_id and organization_id=p_org;
 elsif p_action like 'task.%' then
  select to_jsonb(t) into v_before from organization_tasks t where id=p_id and organization_id=p_org;
 end if;
 v_result:=workflow_mutate_without_notifications(p_actor,p_org,p_action,p_id,p_data);
 v_id:=coalesce((v_result->>'id')::uuid,p_id); v_name:=coalesce(v_result->>'name',v_before->>'name','');
 if p_action like 'member.%' then
  select coalesce(array_agg(organization_role_id),'{}') into v_new_users from organization_member_roles where organization_id=p_org and user_id=p_id;
  for v_member in select x from unnest(v_users||v_new_users) x group by x having not(x=any(v_users) and x=any(v_new_users)) loop
   select name into v_name from organization_roles where id=v_member;
   v_kind:=case when v_member=any(v_new_users) then 'role.assigned' else 'role.revoked' end;
   perform queue_notification(p_org,p_id,v_kind,'Your organization access changed',case when v_member=any(v_new_users) then 'You were assigned the role ' else 'Your role was removed: ' end||v_name,v_key||p_id||v_member);
  end loop;
 elsif p_action like 'team.%' then
  select coalesce(array_agg(user_id),'{}') into v_new_users from organization_team_members where team_id=v_id;
  for v_user in select x from unnest(v_users||v_new_users) x group by x having not(x=any(v_users) and x=any(v_new_users)) loop
   v_kind:=case when v_user=any(v_new_users) then 'team.added' else 'team.removed' end;
   perform queue_notification(p_org,v_user,v_kind,'Your team membership changed',case when v_user=any(v_new_users) then 'You were added to team ' else 'You were removed from team ' end||v_name,v_key||v_user);
  end loop;
 elsif p_action like 'role.%' and v_before is not null then
  select coalesce(array_agg(permission_id order by permission_id),'{}') into v_new_permissions from organization_role_permissions where organization_role_id=v_id;
  if v_permissions is distinct from v_new_permissions or v_before#>>'{definition,reportsToUserId}' is distinct from v_result#>>'{definition,reportsToUserId}' or v_before->>'department_id' is distinct from v_result->>'department_id' then
   for v_user in select user_id from organization_member_roles where organization_role_id=v_id loop
    perform queue_notification(p_org,v_user,'role.changed','Your assigned role changed','Access, department or reporting manager changed for '||v_name||'. Review your role in the workspace.',v_key||v_user);
   end loop;
   v_manager:=(v_result#>>'{definition,reportsToUserId}')::uuid;
   if v_manager is not null and v_before#>>'{definition,reportsToUserId}' is distinct from v_manager::text then
    perform queue_notification(p_org,v_manager,'manager.assigned','Reporting responsibility assigned','You are now the reporting manager for role '||v_name,v_key||'manager'||v_manager);
   end if;
  end if;
 elsif p_action='project.save' then
  v_manager:=(v_result->>'resource_manager_id')::uuid; v_old_manager:=(v_before->>'resource_manager_id')::uuid;
  if v_manager is distinct from v_old_manager then
   perform queue_notification(p_org,v_manager,'project.manager','Project responsibility assigned','You are the resource manager for '||v_name,v_key||'manager');
   if v_old_manager is not null then perform queue_notification(p_org,v_old_manager,'project.manager_removed','Project responsibility changed','You are no longer the resource manager for '||v_name,v_key||'oldmanager'); end if;
  end if;
  if v_before is null or v_before->>'team_id' is distinct from v_result->>'team_id' or v_before->>'end_date' is distinct from v_result->>'end_date' or v_before->>'status' is distinct from v_result->>'status' then
   for v_user in select user_id from organization_team_members where team_id=(v_result->>'team_id')::uuid union select v_manager loop
    if v_user<>p_actor then perform queue_notification(p_org,v_user,'project.updated','Project update',v_name||': status '||(v_result->>'status')||', deadline '||(v_result->>'end_date'),v_key||'update'||v_user,'activity'); end if;
   end loop;
  end if;
 elsif p_action in ('task.save','task.delete','task.note') then
  select resource_manager_id into v_manager from organization_projects where id=coalesce((v_result->>'project_id')::uuid,(v_before->>'project_id')::uuid);
  if p_action='task.save' and v_before->>'assignee_id' is distinct from v_result->>'assignee_id' then
   perform queue_notification(p_org,(v_result->>'assignee_id')::uuid,'task.assigned','Task assigned to you',v_name||'; due '||(v_result->>'due_date'),v_key||'assigned');
   perform queue_notification(p_org,(v_before->>'assignee_id')::uuid,'task.unassigned','Task reassigned', 'You are no longer assigned to '||v_name,v_key||'unassigned');
  end if;
  if p_action in ('task.delete','task.note') or (p_action='task.save' and v_before is not null and (v_before->>'status' is distinct from v_result->>'status' or v_before->>'due_date' is distinct from v_result->>'due_date')) then
   for v_user in select distinct x from unnest(array[coalesce((v_result->>'assignee_id')::uuid,(v_before->>'assignee_id')::uuid),v_manager]) x where x is not null and x<>p_actor loop
    v_kind:=case p_action when 'task.delete' then 'task.deleted' when 'task.note' then 'task.note' else 'task.updated' end;
    perform queue_notification(p_org,v_user,v_kind,'Task update',case p_action when 'task.delete' then 'Task deleted: ' when 'task.note' then 'A new note was added to task ' else 'Task changed: ' end||v_name||case when p_action='task.save' then '; status '||(v_result->>'status')||'; due '||(v_result->>'due_date') else '' end,v_key||v_user,'activity');
   end loop;
  end if;
 end if;
 return v_result;
end $$;

create function public.calendar_notification_trigger() returns trigger language plpgsql set search_path=public as $$
declare v_old uuid[]:='{}'; v_new uuid[]:='{}'; v_user uuid; v_row jsonb; v_kind text; v_changed boolean; v_key text:=gen_random_uuid()::text;
begin
 if tg_op<>'INSERT' then select coalesce(array_agg((a->>'userId')::uuid),'{}') into v_old from jsonb_array_elements(old.attendees) a; end if;
 if tg_op<>'DELETE' then select coalesce(array_agg((a->>'userId')::uuid),'{}') into v_new from jsonb_array_elements(new.attendees) a; end if;
 v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_changed:=tg_op<>'UPDATE';
 if tg_op='UPDATE' then v_changed:= row(old.title,old.starts_at,old.ends_at,old.location,old.meeting_url,old.timezone,old.all_day) is distinct from row(new.title,new.starts_at,new.ends_at,new.location,new.meeting_url,new.timezone,new.all_day); end if;
 for v_user in select distinct unnest(v_old||v_new) loop
  v_kind:=case when not(v_user=any(v_new)) then 'calendar.cancelled' when not(v_user=any(v_old)) then 'calendar.invited' when v_changed then 'calendar.updated' else null end;
  if v_kind is not null then
   perform queue_notification((v_row->>'organization_id')::uuid,v_user,v_kind,'Calendar event update',case v_kind when 'calendar.cancelled' then 'Your event invitation was cancelled: ' when 'calendar.invited' then 'You are invited to ' else 'Event details changed: ' end||(v_row->>'title')||'; starts '||(v_row->>'starts_at')||'; timezone '||(v_row->>'timezone')||'; location '||coalesce(v_row->>'location','See workspace')||'; meeting link '||coalesce(v_row->>'meeting_url','See workspace'),v_key||v_user);
  end if;
 end loop;
 return coalesce(new,old);
end $$;
create trigger calendar_notifications after insert or update or delete on public.calendar_events for each row execute function public.calendar_notification_trigger();

create function public.welcome_notification_trigger() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  perform queue_notification(new.organization_id,new.user_id,'workspace.ready','Your workspace is ready','Your workspace has been created successfully. Sign in to get started.','welcome:'||new.organization_id||':'||new.user_id);
 end if;
 return new;
end $$;
create trigger welcome_notification after update on public.employer_onboarding for each row execute function public.welcome_notification_trigger();

create function public.set_department_members(p_actor uuid,p_org uuid,p_department uuid,p_members uuid[]) returns jsonb language plpgsql set search_path=public as $$
declare v_old uuid[]; v_user uuid; v_name text; v_key text:=gen_random_uuid()::text;
begin
 perform 1 from organizations where id=p_org for update;
 if not workflow_has_permission(p_actor,p_org,'departments.manage') then raise exception 'Permission required' using errcode='42501'; end if;
 select name into v_name from departments where id=p_department and organization_id=p_org and not is_archived;
 if not found then raise exception 'Department not found' using errcode='P0002'; end if;
 if cardinality(p_members)>200 or exists(select 1 from unnest(p_members) x where not exists(select 1 from organization_members where organization_id=p_org and user_id=x)) then raise exception 'Invalid members' using errcode='22023'; end if;
 select coalesce(array_agg(user_id),'{}') into v_old from organization_department_members where department_id=p_department;
 delete from organization_department_members where department_id=p_department and not(user_id=any(p_members));
 insert into organization_department_members select p_org,p_department,x from unnest(p_members) x on conflict do nothing;
 for v_user in select x from unnest(v_old||p_members) x group by x having not(x=any(v_old) and x=any(p_members)) loop
  perform queue_notification(p_org,v_user,case when v_user=any(p_members) then 'department.added' else 'department.removed' end,'Department membership changed',case when v_user=any(p_members) then 'You were added to ' else 'You were removed from ' end||v_name,v_key||v_user);
 end loop;
 return jsonb_build_object('departmentId',p_department,'memberIds',p_members);
end $$;

create function public.create_organization_invitation(p_actor uuid,p_org uuid,p_email text,p_roles uuid[],p_department uuid,p_hash text,p_token text) returns jsonb
language plpgsql set search_path=public as $$
declare v_id uuid; v_role uuid; v_owner boolean;
begin
 perform 1 from organizations where id=p_org for update;
 if not workflow_has_permission(p_actor,p_org,'roles.assign') or not workflow_has_permission(p_actor,p_org,'members.invite') then raise exception 'Permission required' using errcode='42501'; end if;
 if cardinality(p_roles) not between 1 and 20 then raise exception 'Select roles' using errcode='22023'; end if;
 select exists(select 1 from organization_member_roles m join organization_roles r on r.id=m.organization_role_id where m.organization_id=p_org and m.user_id=p_actor and r.key='organisation_owner') into v_owner;
 for v_role in select unnest(p_roles) loop
  if not exists(select 1 from organization_roles where id=v_role and organization_id=p_org and status='active' and not is_system) then raise exception 'Choose active custom roles' using errcode='22023'; end if;
  if not v_owner and exists(select 1 from organization_role_permissions where organization_role_id=v_role and not workflow_has_permission(p_actor,p_org,permission_id)) then raise exception 'Role exceeds your permissions' using errcode='42501'; end if;
 end loop;
 if p_department is not null and (not workflow_has_permission(p_actor,p_org,'departments.manage') or not exists(select 1 from departments where id=p_department and organization_id=p_org and not is_archived)) then raise exception 'Department not available' using errcode='42501'; end if;
 if exists(select 1 from organization_members m join profiles p on p.id=m.user_id where m.organization_id=p_org and lower(p.email)=lower(p_email)) then raise exception 'Already a member' using errcode='23505'; end if;
 update organization_invitations set status='revoked' where organization_id=p_org and lower(email)=lower(p_email) and status='pending';
 insert into organization_invitations(organization_id,email,invited_by,token_hash,role_ids,department_id)
 values(p_org,lower(p_email),p_actor,p_hash,p_roles,p_department) returning id into v_id;
 perform queue_notification(p_org,null,'organization.invited','You have been invited to a workspace','Sign in or create an account with this email address, then accept your invitation. It expires in seven days.','invite:'||v_id,'essential',jsonb_build_object('invitationId',v_id,'token',p_token),lower(p_email));
 return jsonb_build_object('id',v_id,'email',lower(p_email),'status','pending','expiresAt',now()+interval '7 days','emailStatus','queued');
end $$;

-- Read auth.users only inside this service-only definer function. Acceptance must
-- match the verified authenticated account, never a caller-supplied email.
create function public.accept_organization_invitation(p_actor uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inv organization_invitations; v_members uuid[]; v_email text; v_org uuid;
begin
 select organization_id into v_org from organization_invitations where token_hash=p_hash;
 perform 1 from organizations where id=v_org for update;
 select * into v_inv from organization_invitations where token_hash=p_hash for update;
 if not found then raise exception 'Invalid invitation' using errcode='22023'; end if;
 select lower(email) into v_email from auth.users where id=p_actor and email_confirmed_at is not null;
 if v_email is null or v_email<>lower(v_inv.email) then raise exception 'Use the invited verified account' using errcode='42501'; end if;
 if v_inv.status='accepted' and v_inv.accepted_by=p_actor then return jsonb_build_object('organizationId',v_inv.organization_id,'status','accepted'); end if;
 if v_inv.status<>'pending' or v_inv.expires_at<=now() then raise exception 'Invitation expired or revoked' using errcode='22023'; end if;
 if not workflow_has_permission(v_inv.invited_by,v_inv.organization_id,'roles.assign') or not workflow_has_permission(v_inv.invited_by,v_inv.organization_id,'members.invite') then raise exception 'Inviter access changed' using errcode='42501'; end if;
 insert into organization_members(organization_id,user_id) values(v_inv.organization_id,p_actor) on conflict do nothing;
 perform workflow_mutate(v_inv.invited_by,v_inv.organization_id,'member.assign',p_actor,jsonb_build_object('roleIds',v_inv.role_ids));
 if v_inv.department_id is not null then
  select coalesce(array_agg(user_id),'{}') into v_members from organization_department_members where department_id=v_inv.department_id;
  perform set_department_members(v_inv.invited_by,v_inv.organization_id,v_inv.department_id,v_members||p_actor);
 end if;
 update organization_invitations set status='accepted',accepted_by=p_actor where id=v_inv.id;
 perform queue_notification(v_inv.organization_id,v_inv.invited_by,'invitation.accepted','Workspace invitation accepted',v_email||' accepted your invitation.','accepted:'||v_inv.id);
 perform queue_notification(v_inv.organization_id,p_actor,'organization.joined','Welcome to your workspace','Your invitation was accepted. You can now open the workspace.','joined:'||v_inv.id);
 return jsonb_build_object('organizationId',v_inv.organization_id,'status','accepted');
end $$;

create function public.queue_notification_reminders() returns void language plpgsql set search_path=public as $$
declare v record; v_user uuid; v_day date; v_kind text;
begin
 -- Date-only task deadlines are evaluated in the organization's configured timezone.
 for v in select t.*,p.resource_manager_id,(now() at time zone coalesce(s.timezone,'UTC'))::date as local_day from organization_tasks t join organization_projects p on p.id=t.project_id left join organization_settings s on s.organization_id=t.organization_id
 where t.status<>'done' and t.due_date <= (now() at time zone coalesce(s.timezone,'UTC'))::date+1 loop
  v_kind:=case when v.due_date<v.local_day then 'task.overdue' else 'task.due' end;
  for v_user in select distinct x from unnest(array[v.assignee_id,case when v.due_date<v.local_day then v.resource_manager_id else null end]) x where x is not null loop
   perform queue_notification(v.organization_id,v_user,v_kind,'Task deadline reminder',v.name||'; due '||v.due_date, v_kind||':'||v.id||':'||v_user||':'||v.local_day,'reminder',jsonb_build_object('taskId',v.id,'dueDate',v.due_date));
  end loop;
 end loop;
 for v in select * from calendar_events where starts_at>now() and starts_at<=now()+interval '1 hour' loop
  for v_user in select distinct (a->>'userId')::uuid from jsonb_array_elements(v.attendees) a where coalesce(a->>'response','pending')<>'declined' loop
   perform queue_notification(v.organization_id,v_user,'calendar.reminder','Upcoming calendar event',v.title||'; starts '||v.starts_at||'; timezone '||v.timezone,'event:'||v.id||':'||v.starts_at||':'||v_user,'reminder',jsonb_build_object('eventId',v.id,'startsAt',v.starts_at));
  end loop;
 end loop;
end $$;

create function public.claim_notification_emails(p_limit integer default 10) returns setof public.notification_outbox
language plpgsql set search_path=public as $$
begin
 -- Recover abandoned leases, with a finite attempt limit.
 update notification_outbox set status=case when attempts>=6 then 'failed' else 'pending' end,lease_id=null,leased_until=null where status='processing' and leased_until<now();
 update notification_outbox n set status='suppressed',payload=payload-'token' where n.status='pending' and (
  (n.recipient_id is not null and not exists(select 1 from organization_members m where m.organization_id=n.organization_id and m.user_id=n.recipient_id))
  or (n.kind like 'task.%' and not workflow_has_permission(n.recipient_id,n.organization_id,'tasks.view'))
  or (n.kind like 'project.%' and not workflow_has_permission(n.recipient_id,n.organization_id,'projects.view'))
  or (n.kind like 'calendar.%' and not workflow_has_permission(n.recipient_id,n.organization_id,'calendar.view'))
  or exists(select 1 from notification_preferences p where p.user_id=n.recipient_id and ((n.category='activity' and p.activity_email='off') or (n.category='reminder' and not p.reminders)))
  or (n.kind='organization.invited' and not exists(select 1 from organization_invitations i where i.id=(n.payload->>'invitationId')::uuid and i.status='pending' and i.expires_at>now()))
  or (n.payload ? 'taskId' and not exists(select 1 from organization_tasks t join organization_projects p on p.id=t.project_id where t.id=(n.payload->>'taskId')::uuid and t.status<>'done' and t.due_date::text=n.payload->>'dueDate' and n.recipient_id in (t.assignee_id,p.resource_manager_id)))
  or (n.payload ? 'eventId' and not exists(select 1 from calendar_events e where e.id=(n.payload->>'eventId')::uuid and e.starts_at>now() and e.starts_at=(n.payload->>'startsAt')::timestamptz and exists(select 1 from jsonb_array_elements(e.attendees) a where a->>'userId'=n.recipient_id::text and coalesce(a->>'response','pending')<>'declined')))
 );
 return query with batch as (select id from notification_outbox where status='pending' and available_at<=now() order by available_at,id for update skip locked limit greatest(1,least(p_limit,20)))
 update notification_outbox n set status='processing',attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '5 minutes' from batch where n.id=batch.id returning n.*;
end $$;

create function public.finish_notification_email(p_id uuid,p_lease uuid,p_success boolean) returns boolean language plpgsql set search_path=public as $$
begin
 update notification_outbox set status=case when p_success then 'sent' when attempts>=6 then 'failed' else 'pending' end,
 sent_at=case when p_success then now() else null end,last_error=case when p_success then null else 'Mail provider rejected or failed delivery; inspect server logs' end,
 available_at=now()+make_interval(secs=>least(3600,(30*power(2,attempts))::integer)),lease_id=null,leased_until=null,
 payload=case when p_success and kind='organization.invited' then payload-'token' else payload end
 where id=p_id and lease_id=p_lease and status='processing';
 return found;
end $$;

create function public.revoke_organization_invitation(p_actor uuid,p_org uuid,p_id uuid) returns jsonb language plpgsql set search_path=public as $$
begin
 perform 1 from organizations where id=p_org for update;
 if not workflow_has_permission(p_actor,p_org,'members.invite') then raise exception 'Permission required' using errcode='42501'; end if;
 update organization_invitations set status='revoked' where id=p_id and organization_id=p_org and status='pending';
 if not found then raise exception 'Pending invitation not found' using errcode='P0002'; end if;
 return jsonb_build_object('id',p_id,'status','revoked');
end $$;
create function public.set_notification_preferences(p_user uuid,p_activity text default null,p_reminders boolean default null) returns void language plpgsql set search_path=public as $$
begin
 insert into notification_preferences(user_id,activity_email,reminders) values(p_user,coalesce(p_activity,'immediate'),coalesce(p_reminders,true))
 on conflict(user_id) do update set activity_email=coalesce(p_activity,notification_preferences.activity_email),reminders=coalesce(p_reminders,notification_preferences.reminders);
end $$;

-- Internal functions must never be callable with a public Supabase key.
do $$declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'revoke_organization_invitation','set_notification_preferences','queue_notification','workflow_mutate','workflow_mutate_without_notifications','calendar_notification_trigger','welcome_notification_trigger','set_department_members','create_organization_invitation','accept_organization_invitation','queue_notification_reminders','claim_notification_emails','finish_notification_email') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
