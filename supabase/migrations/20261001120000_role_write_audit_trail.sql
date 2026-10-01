-- Role writes are last-write-wins (expectedRevision is optional) but never silent.
-- Every role create/update records the actor, the submitted changes, and the
-- previous/new revision so overwrites can be audited via role history.
-- Self-contained: also restores the optional-revision guard from
-- 20260930120000_role_permissions_optional_revision.sql if that was not applied.
begin;

create table if not exists public.organization_role_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  role_id uuid not null,
  actor_id uuid not null,
  action text not null,
  changes jsonb not null default '{}',
  previous_revision integer not null,
  new_revision integer not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_role_history_role_idx
  on public.organization_role_history (organization_id, role_id, created_at desc);
alter table public.organization_role_history enable row level security;
grant all on public.organization_role_history to service_role;

create or replace function public.workflow_mutate(p_actor uuid,p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql set search_path=public as $$
declare v_revision integer; v_result jsonb; v_permission text; v_strict boolean;
begin
 perform 1 from organizations where id=p_org for update;
 if p_id is not null and ((p_action in ('team.members','team.save') and p_data ? 'memberIds') or p_action='role.permissions' or (p_action='role.save' and p_data ? 'permissionIds')) then
  v_permission:=case when p_action like 'team.%' then 'teams.manage' else 'roles.manage' end;
  if not workflow_has_permission(p_actor,p_org,v_permission) then raise exception 'Permission required' using errcode='42501'; end if;
  if p_action like 'team.%' then
   select membership_revision into v_revision from organization_teams where id=p_id and organization_id=p_org;
   v_strict:=true;
  else
   select revision into v_revision from organization_roles where id=p_id and organization_id=p_org;
   v_strict:=false;
  end if;
  if not found then raise exception 'Resource not found' using errcode='P0002'; end if;
  if v_strict and not(p_data ? 'expectedRevision') then raise exception 'expectedRevision required for list replacement' using errcode='22023'; end if;
  if p_data ? 'expectedRevision' and (p_data->>'expectedRevision')::integer is distinct from v_revision then raise exception 'Membership or permissions changed; reload before saving' using errcode='PT409'; end if;
 end if;
 v_result:=workflow_mutate_with_notifications(p_actor,p_org,p_action,p_id,p_data-'expectedRevision');
 if p_action like 'role.%' then
  update organization_roles set revision=revision+1 where id=(v_result->>'id')::uuid returning revision into v_revision;
  insert into public.organization_role_history(organization_id,role_id,actor_id,action,changes,previous_revision,new_revision)
  values(p_org,(v_result->>'id')::uuid,p_actor,p_action,coalesce(p_data,'{}')-'expectedRevision',v_revision-1,v_revision);
  v_result:=v_result||jsonb_build_object('revision',v_revision);
 end if;
 return v_result;
end $$;

notify pgrst, 'reload schema';
commit;
