-- Apply after 0010. No membership or profile data is deleted.
begin;
alter table public.profiles add column display_name text check(display_name is null or length(display_name) between 1 and 120), add column avatar_url text check(avatar_url is null or (length(avatar_url)<=2048 and avatar_url like 'https://%'));
alter table public.departments add column membership_revision integer not null default 0;
alter table public.organization_teams add column membership_revision integer not null default 0;
alter table public.organization_roles add column revision integer not null default 0;

-- Row triggers maintain versions even for service-side membership mutations.
create function public.bump_membership_revision() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='organization_department_members' then
  update departments set membership_revision=membership_revision+1 where id=coalesce(new.department_id,old.department_id);
 else update organization_teams set membership_revision=membership_revision+1 where id=coalesce(new.team_id,old.team_id); end if;
 return coalesce(new,old);
end $$;
create trigger department_membership_revision after insert or delete on public.organization_department_members for each row execute function public.bump_membership_revision();
create trigger team_membership_revision after insert or delete on public.organization_team_members for each row execute function public.bump_membership_revision();

alter function public.workflow_mutate(uuid,uuid,text,uuid,jsonb) rename to workflow_mutate_with_notifications;
create function public.workflow_mutate(p_actor uuid,p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql set search_path=public as $$
declare v_revision integer; v_result jsonb; v_permission text;
begin
 perform 1 from organizations where id=p_org for update;
 if p_id is not null and ((p_action in ('team.members','team.save') and p_data ? 'memberIds') or p_action='role.permissions' or (p_action='role.save' and p_data ? 'permissionIds')) then
  v_permission:=case when p_action like 'team.%' then 'teams.manage' else 'roles.manage' end;
  if not workflow_has_permission(p_actor,p_org,v_permission) then raise exception 'Permission required' using errcode='42501'; end if;
  if p_action like 'team.%' then select membership_revision into v_revision from organization_teams where id=p_id and organization_id=p_org;
  else select revision into v_revision from organization_roles where id=p_id and organization_id=p_org; end if;
  if not found then raise exception 'Resource not found' using errcode='P0002'; end if;
  if not(p_data ? 'expectedRevision') then raise exception 'expectedRevision required for list replacement' using errcode='22023'; end if;
  if (p_data->>'expectedRevision')::integer is distinct from v_revision then raise exception 'Membership or permissions changed; reload before saving' using errcode='40001'; end if;
 end if;
 v_result:=workflow_mutate_with_notifications(p_actor,p_org,p_action,p_id,p_data-'expectedRevision');
 if p_action like 'role.%' then
  update organization_roles set revision=revision+1 where id=(v_result->>'id')::uuid returning revision into v_revision;
  v_result:=v_result||jsonb_build_object('revision',v_revision);
 end if;
 return v_result;
end $$;

alter function public.set_department_members(uuid,uuid,uuid,uuid[]) rename to set_department_members_internal;
create function public.set_department_members(p_actor uuid,p_org uuid,p_department uuid,p_members uuid[],p_revision integer) returns jsonb language plpgsql set search_path=public as $$
declare v_revision integer; v_result jsonb;
begin
 perform 1 from organizations where id=p_org for update;
 if not workflow_has_permission(p_actor,p_org,'departments.manage') then raise exception 'Permission required' using errcode='42501'; end if;
 select membership_revision into v_revision from departments where id=p_department and organization_id=p_org;
 if not found then raise exception 'Department not found' using errcode='P0002'; end if;
 if p_revision is distinct from v_revision then raise exception 'Membership changed; reload before saving' using errcode='40001'; end if;
 v_result:=set_department_members_internal(p_actor,p_org,p_department,p_members);
 select membership_revision into v_revision from departments where id=p_department;
 return v_result||jsonb_build_object('membershipRevision',v_revision);
end $$;

create function public.change_workspace_member(p_actor uuid,p_org uuid,p_kind text,p_entity uuid,p_user uuid,p_add boolean) returns jsonb language plpgsql set search_path=public as $$
declare v_members uuid[]; v_revision integer;
begin
 perform 1 from organizations where id=p_org for update;
 if p_kind='department' then
  if not workflow_has_permission(p_actor,p_org,'departments.manage') then raise exception 'Permission required' using errcode='42501'; end if;
  select membership_revision into v_revision from departments where id=p_entity and organization_id=p_org;
  if not found then raise exception 'Department not found' using errcode='P0002'; end if;
  select coalesce(array_agg(user_id),'{}') into v_members from organization_department_members where department_id=p_entity;
 elsif p_kind='team' then
  if not workflow_has_permission(p_actor,p_org,'teams.manage') then raise exception 'Permission required' using errcode='42501'; end if;
  select membership_revision into v_revision from organization_teams where id=p_entity and organization_id=p_org;
  if not found then raise exception 'Team not found' using errcode='P0002'; end if;
  select coalesce(array_agg(user_id),'{}') into v_members from organization_team_members where team_id=p_entity;
 else raise exception 'Invalid membership kind' using errcode='22023'; end if;
 if p_add and not(p_user=any(v_members)) then v_members:=array_append(v_members,p_user); elsif not p_add then v_members:=array_remove(v_members,p_user); end if;
 if p_kind='department' then return set_department_members(p_actor,p_org,p_entity,v_members,v_revision);
 else return workflow_mutate(p_actor,p_org,'team.members',p_entity,jsonb_build_object('memberIds',v_members,'expectedRevision',v_revision)); end if;
end $$;
create function public.transfer_department_member(p_actor uuid,p_org uuid,p_user uuid,p_from uuid,p_to uuid) returns jsonb language plpgsql set search_path=public as $$
declare v_result jsonb;
begin
 perform 1 from organizations where id=p_org for update;
 if not workflow_has_permission(p_actor,p_org,'departments.manage') then raise exception 'Permission required' using errcode='42501'; end if;
 if p_from=p_to then raise exception 'Select different departments' using errcode='22023'; end if;
 if not exists(select 1 from organization_department_members where organization_id=p_org and department_id=p_from and user_id=p_user) then raise exception 'Source membership not found' using errcode='P0002'; end if;
 perform change_workspace_member(p_actor,p_org,'department',p_to,p_user,true);
 perform change_workspace_member(p_actor,p_org,'department',p_from,p_user,false);
 return jsonb_build_object('userId',p_user,'fromDepartmentId',p_from,'toDepartmentId',p_to);
end $$;

create or replace function public.accept_organization_invitation(p_actor uuid,p_hash text) returns jsonb
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
  perform change_workspace_member(v_inv.invited_by,v_inv.organization_id,'department',v_inv.department_id,p_actor,true);
 end if;
 update organization_invitations set status='accepted',accepted_by=p_actor where id=v_inv.id;
 perform queue_notification(v_inv.organization_id,v_inv.invited_by,'invitation.accepted','Workspace invitation accepted',v_email||' accepted your invitation.','accepted:'||v_inv.id);
 perform queue_notification(v_inv.organization_id,p_actor,'organization.joined','Welcome to your workspace','Your invitation was accepted. You can now open the workspace.','joined:'||v_inv.id);
 return jsonb_build_object('organizationId',v_inv.organization_id,'status','accepted');
end $$;


-- Membership plus version is read in one SQL snapshot.
create function public.workspace_membership_snapshot(p_actor uuid,p_org uuid,p_kind text,p_entity uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare v_result jsonb;
begin
 if not workflow_has_permission(p_actor,p_org,case p_kind when 'department' then 'workspace.view' when 'team' then 'teams.view' else 'roles.view' end) then raise exception 'Permission required' using errcode='42501'; end if;
 if p_kind='department' then
  select jsonb_build_object('departmentId',d.id,'membershipRevision',d.membership_revision,'memberIds',coalesce((select jsonb_agg(user_id order by user_id) from organization_department_members where department_id=d.id),'[]')) into v_result from departments d where d.id=p_entity and d.organization_id=p_org;
 elsif p_kind='team' then
  select to_jsonb(t)||jsonb_build_object('memberIds',coalesce((select jsonb_agg(user_id order by user_id) from organization_team_members where team_id=t.id),'[]'),'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'email',p.email,'displayName',p.display_name,'avatarUrl',p.avatar_url) order by p.id) from organization_team_members m join profiles p on p.id=m.user_id where m.team_id=t.id),'[]')) into v_result from organization_teams t where t.id=p_entity and t.organization_id=p_org;
 elsif p_kind='role' then
  select to_jsonb(r)||jsonb_build_object('permissionIds',coalesce((select jsonb_agg(permission_id order by permission_id) from organization_role_permissions where organization_role_id=r.id),'[]')) into v_result from organization_roles r where r.id=p_entity and r.organization_id=p_org;
 else raise exception 'Invalid kind' using errcode='22023'; end if;
 if v_result is null then raise exception 'Resource not found' using errcode='P0002'; end if;
 return v_result;
end $$;

-- Operator-visible health without exposing emails or invitation tokens.
create function public.notification_health() returns jsonb language sql set search_path=public as $$
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed'),'oldestPendingAt',min(created_at) filter(where status='pending'),'lastSentAt',max(sent_at)) from notification_outbox;
$$;
create function public.prune_notification_history() returns integer language plpgsql set search_path=public as $$
declare n integer;
begin
 delete from notification_outbox where status in ('sent','suppressed') and created_at<now()-interval '90 days';
 get diagnostics n=row_count; return n;
end $$;
do $$declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('workspace_membership_snapshot','bump_membership_revision','workflow_mutate','workflow_mutate_with_notifications','set_department_members','set_department_members_internal','change_workspace_member','transfer_department_member','accept_organization_invitation','notification_health','prune_notification_history') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
