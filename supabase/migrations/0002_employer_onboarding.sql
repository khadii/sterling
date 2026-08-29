create extension if not exists pgcrypto;

create table public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  is_active boolean not null default true,
  is_popular boolean not null default false,
  created_at timestamptz not null default now(),
  unique (name)
);

insert into public.industries (name, category, is_popular) values
  ('Accounting', 'Business Services', false),
  ('Advertising & Marketing', 'Business Services', true),
  ('Agriculture', 'Primary Industries', false),
  ('Construction', 'Industrial', true),
  ('Education', 'Public & Social Services', true),
  ('Energy & Utilities', 'Industrial', false),
  ('Financial Services', 'Financial', true),
  ('Government', 'Public & Social Services', false),
  ('Healthcare', 'Healthcare', true),
  ('Hospitality & Tourism', 'Consumer Services', true),
  ('Human Resources & Recruitment', 'Business Services', true),
  ('Information Technology', 'Technology', true),
  ('Insurance', 'Financial', false),
  ('Legal Services', 'Business Services', false),
  ('Logistics & Transportation', 'Industrial', true),
  ('Manufacturing', 'Industrial', true),
  ('Media & Entertainment', 'Media', true),
  ('Nonprofit', 'Public & Social Services', false),
  ('Professional Services', 'Business Services', true),
  ('Real Estate', 'Property', true),
  ('Retail & E-commerce', 'Consumer', true),
  ('Telecommunications', 'Technology', true)
on conflict (name) do update set
  category = excluded.category,
  is_popular = excluded.is_popular;

create table public.department_suggestions (
  id smallint generated always as identity primary key,
  name text not null unique,
  description text,
  is_popular boolean not null default false,
  display_order smallint not null
);

insert into public.department_suggestions (name, description, is_popular, display_order) values
  ('General', 'General company operations', true, 0),
  ('Engineering', 'Product and platform engineering', true, 1),
  ('Product', 'Product management and design', true, 2),
  ('Sales', 'Sales and business development', true, 3),
  ('Marketing', 'Brand, growth, and communications', true, 4),
  ('Finance', 'Finance and accounting', true, 5),
  ('Human Resources', 'People operations and recruitment', true, 6),
  ('Operations', 'Business and operational delivery', true, 7),
  ('Customer Support', 'Customer success and support', true, 8),
  ('Legal', 'Legal and compliance', false, 9)
on conflict (name) do update set
  description = excluded.description,
  is_popular = excluded.is_popular,
  display_order = excluded.display_order;

create table public.employer_onboarding (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'provisioning', 'completed')),
  current_step smallint not null default 1 check (current_step between 1 and 4),
  completed_steps smallint[] not null default '{}',
  company_name text,
  industry_id uuid references public.industries(id) on delete restrict,
  company_website text,
  company_size text check (company_size in ('1_10', '11_25', '26_50', '51_100', '100_plus')),
  logo_path text,
  logo_content_type text,
  logo_uploaded_at timestamptz,
  company_revision integer not null default 0 check (company_revision >= 0),
  department_drafts jsonb not null default '[]'::jsonb,
  departments_revision integer not null default 0 check (departments_revision >= 0),
  country_code char(2),
  timezone text,
  locale text,
  week_starts_on text check (week_starts_on in ('sunday', 'monday')),
  date_format text check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY')),
  settings_revision integer not null default 0 check (settings_revision >= 0),
  organization_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.onboarding_logo_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  original_file_name text not null,
  declared_content_type text not null,
  declared_size integer not null check (declared_size between 1 and 5242880),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry_id uuid not null references public.industries(id) on delete restrict,
  website text,
  company_size text not null check (company_size in ('1_10', '11_25', '26_50', '51_100', '100_plus')),
  logo_path text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employer_onboarding
  add constraint employer_onboarding_organization_fk
  foreign key (organization_id) references public.organizations(id) on delete restrict;

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  country_code char(2) not null,
  timezone text not null,
  locale text not null,
  week_starts_on text not null check (week_starts_on in ('sunday', 'monday')),
  date_format text not null check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  display_order smallint not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index departments_name_normalized_unique
on public.departments (organization_id, lower(btrim(name)));

create table public.hiring_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index one_default_pipeline_per_organization
on public.hiring_pipelines (organization_id) where is_default = true;

create table public.hiring_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.hiring_pipelines(id) on delete cascade,
  name text not null,
  display_order smallint not null,
  unique (pipeline_id, display_order),
  unique (pipeline_id, name)
);

create table public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, key),
  unique (id, organization_id)
);

insert into public.permissions (id, description) values
  ('workspace.view', 'View the organisation workspace'),
  ('workspace.update', 'Update workspace settings'),
  ('workspace.delete', 'Delete the organisation workspace'),
  ('workspace.transfer', 'Transfer workspace ownership'),
  ('billing.manage', 'Manage workspace billing'),
  ('members.invite', 'Invite organisation members'),
  ('members.manage', 'Manage organisation members'),
  ('roles.assign', 'Assign organisation roles'),
  ('departments.manage', 'Manage departments'),
  ('jobs.create', 'Create jobs'),
  ('jobs.publish', 'Publish jobs'),
  ('jobs.manage_all', 'Manage all jobs'),
  ('jobs.manage_assigned', 'Manage assigned jobs'),
  ('candidates.view_all', 'View candidates for all jobs'),
  ('candidates.view_assigned', 'View candidates for assigned jobs'),
  ('candidates.manage', 'Manage candidate records'),
  ('interviews.manage', 'Manage interviews'),
  ('interviews.participate', 'Participate in assigned interviews'),
  ('feedback.submit', 'Submit interview feedback'),
  ('feedback.view', 'View permitted feedback'),
  ('private_notes.view', 'View private candidate notes'),
  ('offers.view', 'View offer details'),
  ('offers.manage', 'Manage offers'),
  ('reports.view', 'View recruitment reports'),
  ('audit_log.view', 'View organisation audit logs')
on conflict (id) do update set description = excluded.description;

create table public.organization_role_permissions (
  organization_role_id uuid not null references public.organization_roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  primary key (organization_role_id, permission_id)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.organization_member_roles (
  organization_id uuid not null,
  user_id uuid not null,
  organization_role_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (organization_id, user_id, organization_role_id),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade,
  foreign key (organization_role_id, organization_id)
    references public.organization_roles(id, organization_id) on delete cascade
);

create index organization_members_user_id_idx on public.organization_members(user_id);
create index onboarding_logo_uploads_user_id_idx on public.onboarding_logo_uploads(user_id);

create trigger employer_onboarding_set_updated_at
before update on public.employer_onboarding
for each row execute procedure public.set_updated_at();
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();
create trigger organization_settings_set_updated_at
before update on public.organization_settings
for each row execute procedure public.set_updated_at();

alter table public.industries enable row level security;
alter table public.department_suggestions enable row level security;
alter table public.employer_onboarding enable row level security;
alter table public.onboarding_logo_uploads enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.departments enable row level security;
alter table public.hiring_pipelines enable row level security;
alter table public.hiring_pipeline_stages enable row level security;
alter table public.organization_roles enable row level security;
alter table public.organization_role_permissions enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_member_roles enable row level security;

create policy "Authenticated users can read active industries"
on public.industries for select to authenticated using (is_active = true);
create policy "Authenticated users can read department suggestions"
on public.department_suggestions for select to authenticated using (true);
create policy "Employers can read their onboarding"
on public.employer_onboarding for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read organizations they belong to"
on public.organizations for select to authenticated using (
  exists (select 1 from public.organization_members m
          where m.organization_id = organizations.id and m.user_id = (select auth.uid()))
);
create policy "Users can read their organization memberships"
on public.organization_members for select to authenticated using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onboarding-logos', 'onboarding-logos', false, 5242880,
  array['image/svg+xml', 'image/png', 'image/jpeg', 'image/gif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.ensure_employer_onboarding(p_user_id uuid)
returns public.employer_onboarding
language plpgsql security definer set search_path = '' as $$
declare result public.employer_onboarding;
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role_id = 'employer'
  ) then
    raise exception using errcode = '42501', message = 'Employer role required';
  end if;
  insert into public.employer_onboarding (user_id)
  values (p_user_id) on conflict (user_id) do nothing;
  select * into result from public.employer_onboarding where user_id = p_user_id;
  return result;
end;
$$;

create function public.save_company_onboarding_draft(
  p_user_id uuid, p_expected_revision integer, p_patch jsonb
)
returns public.employer_onboarding
language plpgsql security definer set search_path = '' as $$
declare row_data public.employer_onboarding;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into row_data from public.employer_onboarding where user_id = p_user_id for update;
  if row_data.status = 'completed' then
    raise exception using errcode = 'P0003', message = 'Onboarding is already completed';
  end if;
  if row_data.company_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Stale company draft revision';
  end if;
  if p_patch ? 'industryId' and not exists (
    select 1 from public.industries
    where id = (p_patch->>'industryId')::uuid and is_active = true
  ) then
    raise exception using errcode = '22023', message = 'Invalid industry';
  end if;
  update public.employer_onboarding set
    status = case when status = 'not_started' then 'in_progress' else status end,
    company_name = case when p_patch ? 'name' then nullif(btrim(p_patch->>'name'), '') else company_name end,
    industry_id = case when p_patch ? 'industryId' then (p_patch->>'industryId')::uuid else industry_id end,
    company_website = case when p_patch ? 'website' then nullif(p_patch->>'website', '') else company_website end,
    company_size = case when p_patch ? 'size' then p_patch->>'size' else company_size end,
    company_revision = company_revision + 1
  where user_id = p_user_id
  returning * into row_data;
  return row_data;
end;
$$;

create function public.save_department_onboarding_draft(
  p_user_id uuid, p_expected_revision integer, p_departments jsonb
)
returns public.employer_onboarding
language plpgsql security definer set search_path = '' as $$
declare row_data public.employer_onboarding;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into row_data from public.employer_onboarding where user_id = p_user_id for update;
  if row_data.status = 'completed' then
    raise exception using errcode = 'P0003', message = 'Onboarding is already completed';
  end if;
  if row_data.departments_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Stale department draft revision';
  end if;
  update public.employer_onboarding set
    status = case when status = 'not_started' then 'in_progress' else status end,
    department_drafts = p_departments,
    departments_revision = departments_revision + 1
  where user_id = p_user_id
  returning * into row_data;
  return row_data;
end;
$$;

create function public.save_workspace_settings_draft(
  p_user_id uuid, p_expected_revision integer, p_patch jsonb
)
returns public.employer_onboarding
language plpgsql security definer set search_path = '' as $$
declare row_data public.employer_onboarding;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into row_data from public.employer_onboarding where user_id = p_user_id for update;
  if row_data.status = 'completed' then
    raise exception using errcode = 'P0003', message = 'Onboarding is already completed';
  end if;
  if row_data.settings_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Stale workspace settings revision';
  end if;
  update public.employer_onboarding set
    status = case when status = 'not_started' then 'in_progress' else status end,
    country_code = case when p_patch ? 'countryCode' then p_patch->>'countryCode' else country_code end,
    timezone = case when p_patch ? 'timezone' then p_patch->>'timezone' else timezone end,
    locale = case when p_patch ? 'locale' then p_patch->>'locale' else locale end,
    week_starts_on = case when p_patch ? 'weekStartsOn' then p_patch->>'weekStartsOn' else week_starts_on end,
    date_format = case when p_patch ? 'dateFormat' then p_patch->>'dateFormat' else date_format end,
    settings_revision = settings_revision + 1
  where user_id = p_user_id
  returning * into row_data;
  return row_data;
end;
$$;

create function public.complete_employer_onboarding_step(p_user_id uuid, p_step smallint)
returns public.employer_onboarding
language plpgsql security definer set search_path = '' as $$
declare row_data public.employer_onboarding;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into row_data from public.employer_onboarding where user_id = p_user_id for update;
  if row_data.status = 'completed' then return row_data; end if;
  if p_step = 1 and (row_data.company_name is null or row_data.industry_id is null or row_data.company_size is null) then
    raise exception using errcode = 'P0001', message = 'Company name, industry, and size are required';
  elsif p_step = 2 then
    if not (1 = any(row_data.completed_steps)) then
      raise exception using errcode = 'P0004', message = 'Complete company profile first';
    end if;
    if jsonb_array_length(row_data.department_drafts) < 1 then
      raise exception using errcode = 'P0001', message = 'At least one department is required';
    end if;
  elsif p_step = 3 then
    if not (2 = any(row_data.completed_steps)) then
      raise exception using errcode = 'P0004', message = 'Complete departments first';
    end if;
    if row_data.country_code is null or row_data.timezone is null or row_data.locale is null then
      raise exception using errcode = 'P0001', message = 'Country, timezone, and locale are required';
    end if;
  elsif p_step not between 1 and 3 then
    raise exception using errcode = '22023', message = 'Invalid onboarding step';
  end if;
  update public.employer_onboarding set
    status = 'in_progress',
    completed_steps = case when p_step = any(completed_steps) then completed_steps else array_append(completed_steps, p_step) end,
    current_step = least(p_step + 1, 4)
  where user_id = p_user_id
  returning * into row_data;
  return row_data;
end;
$$;

create function public.provision_employer_workspace(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  onboarding public.employer_onboarding;
  organization_uuid uuid;
  pipeline_uuid uuid;
  owner_role_uuid uuid;
  role_record record;
  permission_key text;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into onboarding from public.employer_onboarding where user_id = p_user_id for update;
  if onboarding.status = 'completed' then return onboarding.organization_id; end if;
  if not (onboarding.completed_steps @> array[1,2,3]::smallint[]) then
    raise exception using errcode = 'P0001', message = 'All onboarding steps must be completed';
  end if;
  update public.employer_onboarding set status = 'provisioning' where user_id = p_user_id;
  insert into public.organizations (
    name, industry_id, website, company_size, logo_path, created_by
  ) values (
    onboarding.company_name, onboarding.industry_id, onboarding.company_website,
    onboarding.company_size, onboarding.logo_path, p_user_id
  ) returning id into organization_uuid;
  insert into public.organization_settings (
    organization_id, country_code, timezone, locale, week_starts_on, date_format
  ) values (
    organization_uuid, onboarding.country_code, onboarding.timezone, onboarding.locale,
    coalesce(onboarding.week_starts_on, 'monday'), coalesce(onboarding.date_format, 'DD/MM/YYYY')
  );
  insert into public.departments (organization_id, name, description, display_order)
  select organization_uuid, item->>'name', nullif(item->>'description', ''), (ordinality - 1)::smallint
  from jsonb_array_elements(onboarding.department_drafts) with ordinality as d(item, ordinality);
  insert into public.hiring_pipelines (organization_id, name, is_default)
  values (organization_uuid, 'Default Pipeline', true) returning id into pipeline_uuid;
  insert into public.hiring_pipeline_stages (pipeline_id, name, display_order) values
    (pipeline_uuid, 'Applied', 0), (pipeline_uuid, 'Screening', 1),
    (pipeline_uuid, 'Interview', 2), (pipeline_uuid, 'Offer', 3),
    (pipeline_uuid, 'Hired', 4), (pipeline_uuid, 'Rejected', 5);
  insert into public.organization_roles (organization_id, key, name, description) values
    (organization_uuid, 'organisation_owner', 'Organisation Owner', 'Full control including ownership and billing'),
    (organization_uuid, 'organisation_admin', 'Organisation Admin', 'Workspace administration excluding ownership and billing'),
    (organization_uuid, 'recruiter', 'Recruiter', 'Recruitment management across permitted jobs'),
    (organization_uuid, 'hiring_manager', 'Hiring Manager', 'Management of assigned jobs and candidates'),
    (organization_uuid, 'interviewer', 'Interviewer', 'Interview participation and feedback');
  for role_record in select id, key from public.organization_roles where organization_id = organization_uuid loop
    for permission_key in
      select unnest(case role_record.key
        when 'organisation_owner' then array(select id from public.permissions where id like 'workspace.%' or id in (
          'billing.manage','members.invite','members.manage','roles.assign','departments.manage','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view','audit_log.view'))
        when 'organisation_admin' then array['workspace.view','workspace.update','members.invite','members.manage','roles.assign','departments.manage','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view','audit_log.view']
        when 'recruiter' then array['workspace.view','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view']
        when 'hiring_manager' then array['workspace.view','jobs.manage_assigned','candidates.view_assigned','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view']
        else array['workspace.view','candidates.view_assigned','interviews.participate','feedback.submit']
      end)
    loop
      insert into public.organization_role_permissions (organization_role_id, permission_id)
      values (role_record.id, permission_key);
    end loop;
  end loop;
  insert into public.organization_members (organization_id, user_id) values (organization_uuid, p_user_id);
  select id into owner_role_uuid from public.organization_roles
    where organization_id = organization_uuid and key = 'organisation_owner';
  insert into public.organization_member_roles (organization_id, user_id, organization_role_id)
  values (organization_uuid, p_user_id, owner_role_uuid);
  update public.employer_onboarding set
    status = 'completed', current_step = 4, organization_id = organization_uuid,
    completed_at = now()
  where user_id = p_user_id;
  return organization_uuid;
end;
$$;

revoke all on function public.ensure_employer_onboarding(uuid) from public, anon, authenticated;
revoke all on function public.save_company_onboarding_draft(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.save_department_onboarding_draft(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.save_workspace_settings_draft(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_employer_onboarding_step(uuid, smallint) from public, anon, authenticated;
revoke all on function public.provision_employer_workspace(uuid) from public, anon, authenticated;
grant execute on function public.ensure_employer_onboarding(uuid) to service_role;
grant execute on function public.save_company_onboarding_draft(uuid, integer, jsonb) to service_role;
grant execute on function public.save_department_onboarding_draft(uuid, integer, jsonb) to service_role;
grant execute on function public.save_workspace_settings_draft(uuid, integer, jsonb) to service_role;
grant execute on function public.complete_employer_onboarding_step(uuid, smallint) to service_role;
grant execute on function public.provision_employer_workspace(uuid) to service_role;
