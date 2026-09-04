begin;

insert into public.permissions (id, description) values
  ('calendar.view', 'View the organization calendar'),
  ('calendar.manage', 'Create and manage organization calendar events'),
  ('activity.view', 'View the organization activity timeline')
on conflict (id) do update set description = excluded.description;

insert into public.organization_role_permissions (organization_role_id, permission_id)
select r.id, p.permission_id
from public.organization_roles r
cross join (values ('calendar.view'), ('activity.view')) p(permission_id)
where r.key in ('organisation_owner', 'organisation_admin', 'hiring_manager', 'recruiter')
on conflict do nothing;

insert into public.organization_role_permissions (organization_role_id, permission_id)
select r.id, 'calendar.manage'
from public.organization_roles r
where r.key in ('organisation_owner', 'organisation_admin', 'hiring_manager', 'recruiter')
on conflict do nothing;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('interview', 'onboarding', 'leave', 'team_meeting', 'public_holiday', 'birthday', 'work_anniversary', 'performance_review')),
  source text not null default 'manual' check (source in ('manual', 'interview', 'leave', 'employee', 'performance')),
  source_id uuid,
  title text not null check (length(btrim(title)) between 2 and 160),
  description text check (description is null or length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  all_day boolean not null default false,
  location text check (location is null or length(location) <= 300),
  meeting_url text check (meeting_url is null or length(meeting_url) <= 2048),
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  attendees jsonb not null default '[]'::jsonb check (jsonb_typeof(attendees) = 'array'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index calendar_events_range_idx on public.calendar_events (organization_id, starts_at, ends_at);
create unique index calendar_events_source_unique
on public.calendar_events (organization_id, source, source_id)
where source <> 'manual' and source_id is not null;
create trigger calendar_events_set_updated_at before update on public.calendar_events
for each row execute procedure public.set_updated_at();

create table public.organization_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('recruitment', 'employee', 'payroll', 'compliance', 'events')),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$'),
  title text not null check (length(btrim(title)) between 2 and 160),
  summary text check (summary is null or length(summary) <= 1000),
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  subject_type text,
  subject_id uuid,
  urgency text not null default 'normal' check (urgency in ('normal', 'attention', 'urgent')),
  available_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(available_actions) = 'array'),
  created_at timestamptz not null default now()
);

create index organization_activities_timeline_idx
on public.organization_activities (organization_id, occurred_at desc, id desc);

create function public.assign_dashboard_role_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.key in ('organisation_owner', 'organisation_admin', 'hiring_manager', 'recruiter') then
    insert into public.organization_role_permissions (organization_role_id, permission_id)
    values (new.id, 'calendar.view'), (new.id, 'calendar.manage'), (new.id, 'activity.view')
    on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger assign_dashboard_role_permissions after insert on public.organization_roles
for each row execute function public.assign_dashboard_role_permissions();

create function public.record_employer_feature_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'calendar_events' then
    insert into public.organization_activities
      (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values
      (new.organization_id, 'events', case when tg_op = 'INSERT' then 'calendar_event_created' else 'calendar_event_updated' end,
       new.title, case when tg_op = 'INSERT' then 'Calendar event created' else 'Calendar event updated' end,
       new.created_by, 'calendar_event', new.id);
  elsif tg_table_name = 'departments' then
    insert into public.organization_activities
      (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values
      (new.organization_id, 'employee', 'department_created', new.name, 'Department created', null, 'department', new.id);
  end if;
  return new;
end; $$;

create trigger record_calendar_event_activity after insert or update on public.calendar_events
for each row execute function public.record_employer_feature_activity();
create trigger record_department_activity after insert on public.departments
for each row execute function public.record_employer_feature_activity();

alter table public.calendar_events enable row level security;
alter table public.organization_activities enable row level security;
revoke all on public.calendar_events, public.organization_activities from anon, authenticated;

commit;
