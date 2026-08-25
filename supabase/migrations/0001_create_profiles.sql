create table public.roles (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  description text not null,
  is_self_assignable boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.roles (id, description, is_self_assignable) values
  ('employer', 'Posts jobs and manages hiring', true),
  ('job_seeker', 'Searches for and applies to jobs', true);

create table public.permissions (
  id text primary key check (id ~ '^[a-z][a-z0-9_.]*$'),
  description text not null
);

create table public.role_permissions (
  role_id text not null references public.roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id text not null references public.roles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create policy "Authenticated users can read roles"
on public.roles for select to authenticated using (true);

create policy "Users can read their profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can read their role assignments"
on public.user_roles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their role permissions"
on public.role_permissions for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role_id = role_permissions.role_id
  )
);

create policy "Users can read permissions assigned to them"
on public.permissions for select to authenticated
using (
  exists (
    select 1
    from public.role_permissions rp
    join public.user_roles ur on ur.role_id = rp.role_id
    where ur.user_id = (select auth.uid()) and rp.permission_id = permissions.id
  )
);

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_role text;
begin
  requested_role := new.raw_user_meta_data ->> 'role';

  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  if requested_role is not null and exists (
    select 1 from public.roles where id = requested_role and is_self_assignable = true
  ) then
    insert into public.user_roles (user_id, role_id) values (new.id, requested_role);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute procedure public.handle_user_email_change();

create function public.assign_initial_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.roles where id = p_role and is_self_assignable = true
  ) then
    raise exception 'Role is not self assignable';
  end if;

  if exists (select 1 from public.user_roles where user_id = p_user_id) then
    raise exception using errcode = '23505', message = 'An account role has already been assigned';
  end if;

  insert into public.user_roles (user_id, role_id) values (p_user_id, p_role);
end;
$$;

revoke all on function public.assign_initial_role(uuid, text) from public, anon, authenticated;
grant execute on function public.assign_initial_role(uuid, text) to service_role;

create function public.change_self_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.roles where id = p_role and is_self_assignable = true
  ) then
    raise exception using errcode = '22023', message = 'Role is not self assignable';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user_id and r.is_self_assignable = true
  ) then
    raise exception using errcode = 'P0002', message = 'Initial role has not been assigned';
  end if;

  delete from public.user_roles
  where user_id = p_user_id
    and role_id in (select id from public.roles where is_self_assignable = true);
  insert into public.user_roles (user_id, role_id) values (p_user_id, p_role);
end;
$$;

revoke all on function public.change_self_role(uuid, text) from public, anon, authenticated;
grant execute on function public.change_self_role(uuid, text) to service_role;
