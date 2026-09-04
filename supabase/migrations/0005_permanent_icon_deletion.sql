begin;

-- Keep a retry marker until Storage removal succeeds; then physically delete.
create function public.prepare_department_icon_deletion(p_icon_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.department_icons; paths jsonb;
begin
 lock table public.employer_onboarding, public.departments, public.department_suggestions
   in share row exclusive mode;
 select * into target from public.department_icons where id = p_icon_id for update;
 if not found then return null; end if;
 if target.is_default then
   raise exception using errcode = '22023', message = 'Default icon cannot be deleted';
 end if;
 if exists (select 1 from public.departments where icon_id = p_icon_id)
 or exists (select 1 from public.department_suggestions where icon_id = p_icon_id)
 or exists (select 1 from public.employer_onboarding o,
   lateral jsonb_array_elements(o.department_drafts) d
   where d->>'iconId' = p_icon_id::text) then
   raise exception using errcode = '23503', message = 'Icon is still in use';
 end if;
 update public.department_icons set is_active = false, deleted_at = coalesce(deleted_at, now())
 where id = p_icon_id;
 select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from (
   select target.storage_path as path where target.storage_path is not null
   union select storage_path from public.department_icon_uploads where icon_id = p_icon_id
 ) files;
 return paths;
end; $$;

create function public.finish_department_icon_deletion(p_icon_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.department_icons where id = p_icon_id
   and deleted_at is not null and not is_default and not is_active for update;
 if not found then return; end if;
 delete from public.department_icon_uploads where icon_id = p_icon_id;
 delete from public.department_icons where id = p_icon_id;
end; $$;

revoke all on function public.prepare_department_icon_deletion(uuid) from public, anon, authenticated;
revoke all on function public.finish_department_icon_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_department_icon_deletion(uuid) to service_role;
grant execute on function public.finish_department_icon_deletion(uuid) to service_role;
commit;
