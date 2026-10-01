-- Role permission updates no longer require expectedRevision.
-- PATCH /organization/roles/{roleId} and PUT /organization/roles/{roleId}/permissions
-- replace permissionIds directly and return the next revision. expectedRevision is
-- now an optional optimistic-concurrency token: when supplied, a mismatch still
-- raises PT409 (ROLE_REVISION_CONFLICT). Team membership replacement stays strict.
begin;

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
  v_result:=v_result||jsonb_build_object('revision',v_revision);
 end if;
 return v_result;
end $$;

notify pgrst, 'reload schema';
commit;
