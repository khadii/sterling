begin;

-- Roles store iconId in their JSON definition. Verify the reference atomically.
create function public.guard_organization_role_icon()
returns trigger language plpgsql set search_path = '' as $$
declare icon_uuid uuid;
begin
  if new.definition ? 'iconId'
     and new.definition->>'iconId' is not null then
    icon_uuid := (new.definition->>'iconId')::uuid;
    perform 1 from public.department_icons
      where id = icon_uuid and is_active and deleted_at is null
      for share;
    if not found then
      raise exception using errcode = '22023', message = 'Active role icon required';
    end if;
  end if;
  return new;
end; $$;

create trigger organization_role_icon_guard
before insert or update of definition on public.organization_roles
for each row execute function public.guard_organization_role_icon();

-- Extend the permanent-delete guard so a referenced role icon cannot disappear.
create or replace function public.prepare_department_icon_deletion(p_icon_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.department_icons; paths jsonb;
begin
 lock table public.employer_onboarding, public.departments,
   public.department_suggestions, public.hr_team_plans, public.organization_roles
   in share row exclusive mode;
 select * into target from public.department_icons where id = p_icon_id for update;
 if not found then return null; end if;
 if target.is_default then
   raise exception using errcode = '22023', message = 'Default icon cannot be deleted';
 end if;
 if exists (select 1 from public.hr_team_plans where icon_id = p_icon_id)
 or exists (select 1 from public.departments where icon_id = p_icon_id)
 or exists (select 1 from public.department_suggestions where icon_id = p_icon_id)
 or exists (select 1 from public.organization_roles
   where definition->>'iconId' = p_icon_id::text)
 or exists (select 1 from public.employer_onboarding o,
   lateral jsonb_array_elements(o.department_drafts) d
   where d->>'iconId' = p_icon_id::text) then
   raise exception using errcode = '23503', message = 'Icon is still in use';
 end if;
 update public.department_icons
   set is_active = false, deleted_at = coalesce(deleted_at, now())
   where id = p_icon_id;
 select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from (
   select target.storage_path as path where target.storage_path is not null
   union select storage_path from public.department_icon_uploads
     where icon_id = p_icon_id
 ) files;
 return paths;
end; $$;

commit;
