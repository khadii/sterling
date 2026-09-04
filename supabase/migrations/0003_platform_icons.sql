begin;

insert into public.roles (id, description, is_self_assignable) values
 ('admin', 'Platform administrator', false), ('superadmin', 'Platform superadministrator', false)
on conflict (id) do update set is_self_assignable = false;
insert into public.permissions (id, description) values ('department_icons.manage', 'Manage the platform department icon catalogue') on conflict do nothing;
insert into public.role_permissions (role_id, permission_id) values
 ('admin', 'department_icons.manage'), ('superadmin', 'department_icons.manage') on conflict do nothing;
alter table public.profiles add column full_name text;

create table public.department_icons (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 2 and 60),
 builtin_key text unique,
 storage_path text unique,
 is_active boolean not null default true,
 is_default boolean not null default false,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((builtin_key is null) <> (storage_path is null))
);
create unique index department_icons_default on public.department_icons (is_default) where is_default;
create trigger department_icons_updated before update on public.department_icons for each row execute function public.set_updated_at();
alter table public.department_icons enable row level security;
create policy "Authenticated catalogue read" on public.department_icons for select to authenticated using (is_active);
revoke insert, update, delete on public.department_icons from anon, authenticated;

insert into public.department_icons (name, builtin_key, is_default) values
 ('General', 'building', true), ('Human Resources', 'users', false), ('Finance', 'wallet', false),
 ('Sales', 'trending-up', false), ('Marketing', 'megaphone', false), ('Operations', 'settings', false),
 ('Customer Support', 'headset', false), ('Engineering', 'code', false), ('Product', 'archive', false),
 ('Design', 'palette', false), ('Legal', 'scale', false), ('Administration', 'building-office', false),
 ('Logistics', 'truck', false);

create function public.protect_default_department_icon() returns trigger language plpgsql set search_path = '' as $$
begin
 if old.is_default and (not new.is_active or not new.is_default) then
   raise exception using errcode = '22023', message = 'Default icon must remain active';
 end if;
 return new;
end; $$;
create trigger protect_default_department_icon before update on public.department_icons for each row execute function public.protect_default_department_icon();

create table public.department_icon_uploads (
 id uuid primary key,
 created_by uuid not null references public.profiles(id),
 name text not null check (length(btrim(name)) between 2 and 60),
 storage_path text not null unique,
 content_type text not null check (content_type in ('image/png','image/jpeg','image/gif','image/svg+xml')),
 file_size integer not null check (file_size between 1 and 1048576),
 expires_at timestamptz not null,
 icon_id uuid references public.department_icons(id),
 created_at timestamptz not null default now()
);
alter table public.department_icon_uploads enable row level security;
revoke all on public.department_icon_uploads from anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 values ('department-icons', 'department-icons', false, 1048576, array['image/png','image/jpeg','image/gif','image/svg+xml']);

create function public.confirm_department_icon(p_user_id uuid, p_upload_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare upload public.department_icon_uploads; result uuid;
begin
 if not exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = p_user_id and ur.role_id in ('admin','superadmin') and rp.permission_id = 'department_icons.manage') then
  raise exception using errcode = '42501', message = 'Platform icon management required';
 end if;
 select * into upload from public.department_icon_uploads where id = p_upload_id and created_by = p_user_id for update;
 if not found then raise exception using errcode = '22023', message = 'Invalid upload'; end if;
 if upload.icon_id is not null then return upload.icon_id; end if;
 if upload.expires_at <= now() then raise exception using errcode = '40001', message = 'Upload expired'; end if;
 insert into public.department_icons (name, storage_path, created_by)
 values (upload.name, 'published/' || upload.id || '.png', p_user_id) returning id into result;
 update public.department_icon_uploads set icon_id = result where id = upload.id;
 return result;
end; $$;
revoke all on function public.confirm_department_icon(uuid,uuid) from public, anon, authenticated;
grant execute on function public.confirm_department_icon(uuid,uuid) to service_role;

alter table public.department_suggestions add column icon_id uuid references public.department_icons(id) on delete restrict;
alter table public.departments add column icon_id uuid references public.department_icons(id) on delete restrict;
insert into public.department_suggestions (name, description, is_popular, display_order) values
 ('Design','Design and creative work',true,10), ('Administration','Company administration',true,11) on conflict do nothing;
update public.department_suggestions s set icon_id = i.id from public.department_icons i where i.name = s.name;
update public.department_suggestions set icon_id = (select id from public.department_icons where is_default) where icon_id is null;
update public.departments set icon_id = (select id from public.department_icons where is_default) where icon_id is null;
alter table public.department_suggestions alter column icon_id set not null;

-- Normalize and validate inside the save transaction, not just in browser validation.
create function public.validate_department_draft_icons() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item jsonb; normalized jsonb := '[]'; selected uuid; default_icon uuid; seen text[] := '{}'; seen_ids text[] := '{}'; label text;
begin
 if jsonb_typeof(new.department_drafts) <> 'array' or jsonb_array_length(new.department_drafts) not between 1 and 20 then
   raise exception using errcode = '22023', message = 'Select between 1 and 20 departments';
 end if;
 select id into default_icon from public.department_icons where is_default;
 for item in select value from jsonb_array_elements(new.department_drafts) loop
  label := regexp_replace(btrim(item->>'name'), '\s+', ' ', 'g');
  if label is null or length(label) not between 2 and 60 or length(coalesce(item->>'description','')) > 250
   or coalesce(item->>'clientId','') = '' or length(item->>'clientId') > 100 then
   raise exception using errcode = '22023', message = 'Invalid department';
  end if;
  if lower(label) = any(seen) or item->>'clientId' = any(seen_ids) then
   raise exception using errcode = '23505', message = 'Duplicate department name or client ID';
  end if;
  seen := array_append(seen,lower(label)); seen_ids := array_append(seen_ids,item->>'clientId');
  selected := coalesce((item->>'iconId')::uuid,default_icon);
  -- Keep previously selected inactive icons, but disallow selecting them for new departments.
  perform 1 from public.department_icons where id = selected and (is_active or exists (
   select 1 from jsonb_array_elements(old.department_drafts) previous
   where previous->>'clientId' = item->>'clientId' and previous->>'iconId' = selected::text
  )) for share;
  if not found then raise exception using errcode = '22023', message = 'Select an active department icon'; end if;
  normalized := normalized || jsonb_build_array(item || jsonb_build_object('name',label,'iconId',selected));
 end loop;
 new.department_drafts := normalized;
 return new;
end; $$;
-- Backfill legacy drafts before installing validation (empty untouched drafts remain valid).
update public.employer_onboarding o set department_drafts = (
 select coalesce(jsonb_agg(item || jsonb_build_object('iconId', (select id from public.department_icons where is_default))), '[]'::jsonb)
 from jsonb_array_elements(o.department_drafts) item
) where jsonb_array_length(department_drafts) > 0;
create trigger validate_department_draft_icons before update of department_drafts on public.employer_onboarding
 for each row execute function public.validate_department_draft_icons();

-- Runs inside the existing atomic workspace provisioning transaction.
create function public.assign_provisioned_department_icon() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.icon_id is null then
  select (o.department_drafts -> new.display_order::integer ->> 'iconId')::uuid into new.icon_id
  from public.employer_onboarding o join public.organizations org on org.created_by = o.user_id
  where org.id = new.organization_id and o.status = 'provisioning';
  new.icon_id := coalesce(new.icon_id, (select id from public.department_icons where is_default));
 end if;
 return new;
end; $$;
create trigger assign_provisioned_department_icon before insert on public.departments for each row execute function public.assign_provisioned_department_icon();
alter table public.departments alter column icon_id set not null;

-- Legacy 100_plus represented the bucket above 51–100. Rename it without losing records.
alter table public.employer_onboarding drop constraint employer_onboarding_company_size_check;
alter table public.organizations drop constraint organizations_company_size_check;
update public.employer_onboarding set company_size = '101_plus', company_revision = company_revision + 1 where company_size = '100_plus';
update public.organizations set company_size = '101_plus' where company_size = '100_plus';
alter table public.employer_onboarding add constraint employer_onboarding_company_size_check check (company_size in ('1_10','11_25','26_50','51_100','101_plus'));
alter table public.organizations add constraint organizations_company_size_check check (company_size in ('1_10','11_25','26_50','51_100','101_plus'));

-- Explicit operator-only bootstrap; never called by signup, OAuth or application startup.
create function public.bootstrap_platform_superadmin(p_user_id uuid, p_email text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if p_email <> 'kadirid9@gmail.com' or not exists (select 1 from auth.users where id = p_user_id and lower(email) = p_email and email_confirmed_at is not null) then
  raise exception using errcode = '42501', message = 'Verified designated superadmin account required';
 end if;
 insert into public.profiles (id,email,full_name) values (p_user_id,p_email,p_name)
 on conflict (id) do update set full_name = excluded.full_name;
 insert into public.user_roles (user_id,role_id) values (p_user_id,'superadmin') on conflict do nothing;
end; $$;
revoke all on function public.bootstrap_platform_superadmin(uuid,text,text) from public, anon, authenticated;
grant execute on function public.bootstrap_platform_superadmin(uuid,text,text) to service_role;
commit;
