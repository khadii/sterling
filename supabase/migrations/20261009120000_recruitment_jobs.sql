begin;
-- Recruitment jobs: employer-owned job postings, configurable hiring pipelines,
-- screening configuration and candidates. All tables are service-only; every
-- function re-checks workspace membership and permissions.
insert into public.permissions (id, description) values
  ('jobs.view', 'View jobs and their hiring pipelines')
on conflict (id) do update set description = excluded.description;

insert into public.organization_role_permissions (organization_role_id, permission_id)
select r.id, 'jobs.view'
from public.organization_roles r
where r.key in ('organisation_owner', 'organisation_admin', 'recruiter', 'hiring_manager', 'interviewer')
on conflict do nothing;

create function public.grant_recruitment_view_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.key in ('organisation_owner', 'organisation_admin', 'recruiter', 'hiring_manager', 'interviewer') then
    insert into public.organization_role_permissions (organization_role_id, permission_id)
    values (new.id, 'jobs.view')
    on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger grant_recruitment_view_permission after insert on public.organization_roles
for each row execute function public.grant_recruitment_view_permission();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid,
  department_id uuid,
  team_id uuid,
  reporting_manager_id uuid,
  reference text,
  title text not null check (length(btrim(title)) between 2 and 160),
  summary text check (summary is null or length(summary) <= 5000),
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  work_arrangement text not null default 'hybrid'
    check (work_arrangement in ('remote', 'hybrid', 'on_site')),
  seniority_level text,
  experience_min_years smallint check (experience_min_years is null or experience_min_years between 0 and 60),
  education_requirement text check (education_requirement is null or length(education_requirement) <= 300),
  primary_tooling text check (primary_tooling is null or length(primary_tooling) <= 300),
  review_sla_hours smallint not null default 24 check (review_sla_hours between 1 and 720),
  location_country char(2) check (location_country is null or location_country ~ '^[A-Z]{2}$'),
  location_city text,
  salary_min numeric(16, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(16, 2) check (salary_max is null or salary_max >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  positions smallint not null default 1 check (positions between 1 and 1000),
  posted_on date,
  closes_on date,
  published_at timestamptz,
  public_slug text check (public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{2,120}$'),
  status text not null default 'draft' check (status in ('draft', 'open', 'on_hold', 'closed')),
  revision integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, reference),
  check (salary_max is null or salary_min is null or salary_max >= salary_min),
  check (closes_on is null or posted_on is null or closes_on >= posted_on),
  foreign key (department_id, organization_id) references public.departments(id, organization_id),
  foreign key (role_id, organization_id) references public.organization_roles(id, organization_id),
  foreign key (team_id, organization_id) references public.organization_teams(id, organization_id),
  foreign key (organization_id, reporting_manager_id)
    references public.organization_members(organization_id, user_id)
);

create table public.job_benefits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  display_order smallint not null check (display_order between 0 and 50),
  label text not null check (length(btrim(label)) between 1 and 200),
  unique (job_id, display_order),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_hiring_team (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  user_id uuid not null,
  role_label text not null default 'reviewer' check (length(btrim(role_label)) between 1 and 120),
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  unique (job_id, user_id),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members(organization_id, user_id) on delete cascade
);

create table public.job_responsibilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  display_order smallint not null check (display_order between 0 and 50),
  body text not null check (length(btrim(body)) between 1 and 500),
  unique (job_id, display_order),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  kind text not null default 'must_have' check (kind in ('must_have', 'preferred')),
  display_order smallint not null check (display_order between 0 and 50),
  body text not null check (length(btrim(body)) between 1 and 500),
  unique (job_id, kind, display_order),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  display_order smallint not null check (display_order between 0 and 100),
  name text not null check (length(btrim(name)) between 1 and 120),
  level text check (level is null or level in ('working', 'proficient', 'expert')),
  is_required boolean not null default true,
  unique (job_id, display_order),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_screening_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  display_order smallint not null check (display_order between 0 and 50),
  prompt text not null check (length(btrim(prompt)) between 4 and 1000),
  kind text not null default 'short_answer'
    check (kind in ('number', 'boolean', 'short_answer', 'url')),
  threshold text,
  weight smallint check (weight is null or weight between 0 and 100),
  is_knockout boolean not null default false,
  is_required boolean not null default true,
  expected_answer text,
  unique (job_id, display_order),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  display_order smallint not null check (display_order between 0 and 50),
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null default 'screening'
    check (category in ('screening', 'interview', 'assessment', 'offer', 'hired', 'other')),
  description text check (description is null or length(description) <= 1000),
  accent text check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$'),
  is_assessment boolean not null default false,
  -- Assessment duration, passing grade and points. Structured configuration only;
  -- question content and automated scoring arrive with the assessment module.
  assessment jsonb not null default '{}'::jsonb check (jsonb_typeof(assessment) = 'object'),
  unique (job_id, display_order),
  unique (job_id, name),
  unique (id, organization_id),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.job_stage_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.job_pipeline_stages(id) on delete cascade,
  kind text not null check (kind in ('email', 'calendar', 'ai_evaluation', 'reviewer_assignment', 'custom')),
  label text not null check (length(btrim(label)) between 1 and 160),
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  unique (stage_id, label)
);

create table public.job_publishing_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  channel text not null
    check (channel in ('careers_page', 'global_syndication', 'internal_mobility', 'premium_boost')),
  is_enabled boolean not null default false,
  unique (job_id, channel),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  stage_id uuid references public.job_pipeline_stages(id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  email text not null check (length(btrim(email)) between 3 and 320),
  phone text check (phone is null or length(phone) <= 40),
  source text not null default 'careers_page'
    check (source in ('careers_page', 'linkedin', 'referral', 'indeed', 'other', 'manual')),
  "current_role" text,
  current_company text,
  resume_url text check (resume_url is null or length(resume_url) <= 2048),
  match_score smallint check (match_score is null or match_score between 0 and 100),
  status text not null default 'new'
    check (status in ('new', 'in_review', 'assessment', 'interview', 'offer', 'hired', 'rejected')),
  applied_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (job_id, email),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);

create table public.candidate_stage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid,
  from_status text,
  to_status text,
  note text check (note is null or length(note) <= 1000),
  actor_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (candidate_id, organization_id) references public.candidates(id, organization_id) on delete cascade
);

create table public.job_interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid,
  stage_id uuid references public.job_pipeline_stages(id) on delete set null,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  unique (event_id),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade,
  foreign key (candidate_id, organization_id) references public.candidates(id, organization_id) on delete cascade
);

-- Job writes are last-write-wins; expectedRevision is optional. Every write is
-- still recorded so an overwrite is auditable instead of silent.
create table public.job_revision_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  actor_id uuid not null,
  action text not null,
  changes jsonb not null default '{}',
  previous_revision integer not null,
  new_revision integer not null,
  created_at timestamptz not null default now()
);

create index jobs_org_status_posted_idx on public.jobs (organization_id, status, posted_on desc nulls last);
create index jobs_org_department_idx on public.jobs (organization_id, department_id);
create index jobs_org_created_idx on public.jobs (organization_id, created_at desc, id desc);
create unique index jobs_public_slug_idx on public.jobs (public_slug) where public_slug is not null;
create index job_responsibilities_job_idx on public.job_responsibilities (job_id, display_order);
create index job_qualifications_job_idx on public.job_qualifications (job_id, kind, display_order);
create index job_skills_job_idx on public.job_skills (job_id, display_order);
create index job_screening_questions_job_idx on public.job_screening_questions (job_id, display_order);
create index job_pipeline_stages_job_idx on public.job_pipeline_stages (organization_id, job_id, display_order);
create index job_stage_automations_stage_idx on public.job_stage_automations (organization_id, stage_id);
create index job_publishing_channels_job_idx on public.job_publishing_channels (job_id);
create index job_benefits_job_idx on public.job_benefits (job_id, display_order);
create index job_hiring_team_job_idx on public.job_hiring_team (organization_id, job_id);
create index job_hiring_team_user_idx on public.job_hiring_team (organization_id, user_id);
create index candidates_org_job_status_idx on public.candidates (organization_id, job_id, status);
create index candidates_org_stage_idx on public.candidates (organization_id, job_id, stage_id);
create index candidates_org_applied_idx on public.candidates (organization_id, applied_at desc, id desc);
create index candidates_org_activity_idx on public.candidates (organization_id, last_activity_at desc, id desc);
create index candidates_org_source_idx on public.candidates (organization_id, source);
create index candidate_stage_events_candidate_idx on public.candidate_stage_events (candidate_id, occurred_at desc);
create index candidate_stage_events_org_idx on public.candidate_stage_events (organization_id, occurred_at desc, id desc);
create index job_interviews_schedule_idx on public.job_interviews (organization_id, status, created_at desc);
create index job_interviews_job_idx on public.job_interviews (organization_id, job_id);
create index job_revision_history_job_idx on public.job_revision_history (organization_id, job_id, created_at desc);

create trigger jobs_set_updated_at before update on public.jobs
for each row execute procedure public.set_updated_at();
create trigger candidates_set_updated_at before update on public.candidates
for each row execute procedure public.set_updated_at();

-- Service-only tables: no browser policies, no direct grants.
do $$ declare t record; begin
  for t in select tablename from pg_tables
    where schemaname = 'public'
      and (tablename = 'jobs' or tablename like 'job\_%' or tablename = 'candidates' or tablename like 'candidate\_%')
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
    execute format('grant all on public.%I to service_role', t.tablename);
  end loop;
end $$;

create function public.recruitment_require(p_actor uuid, p_org uuid, p_permission text)
returns void language plpgsql set search_path = public as $$
begin
  if not workflow_has_permission(p_actor, p_org, p_permission) then
    raise exception 'Permission required: %', p_permission using errcode = '42501';
  end if;
end $$;

-- Undefined percentages return null with their inputs; real zero counts return 0.
create function public.recruitment_percent(p_part numeric, p_total numeric)
returns numeric language sql immutable as $$ select round(p_part * 100 / nullif(p_total, 0), 1) $$;

-- Single-pass jobs dashboard. Every branch is backed by an index on
-- (organization_id, ...) so one request never scans a table twice.
create function public.recruitment_metrics(p_actor uuid, p_org uuid, p_date date default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  d date; tz text; week_start date; from_7 timestamptz; from_prev timestamptz; result jsonb;
begin
  perform recruitment_require(p_actor, p_org, 'workspace.view');
  select coalesce(timezone, 'UTC') into tz from organization_settings where organization_id = p_org;
  tz := coalesce(tz, 'UTC');
  d := coalesce(p_date, (now() at time zone tz)::date);
  week_start := d - (extract(isodow from d)::integer - 1);
  from_7 := (d - 7)::timestamp at time zone tz;
  from_prev := (d - 14)::timestamp at time zone tz;
  with job_totals as (
    select
      count(*) filter (where status = 'open') as open_jobs,
      count(*) filter (where status = 'open' and posted_on >= d - 30) as open_jobs_30,
      count(*) filter (where status = 'open' and posted_on >= d - 60 and posted_on < d - 30) as open_jobs_prev,
      count(*) filter (where status = 'on_hold') as on_hold_jobs,
      count(*) filter (where status = 'closed') as closed_jobs,
      count(*) filter (where status = 'draft') as draft_jobs
    from jobs where organization_id = p_org
  ), candidate_totals as (
    select
      count(*) as applications,
      count(*) filter (where applied_at >= from_7) as applications_7,
      count(*) filter (where applied_at >= from_prev and applied_at < from_7) as applications_prev,
      count(*) filter (where status = 'in_review') as in_review,
      count(*) filter (where status = 'assessment') as assessment,
      count(*) filter (where status = 'interview') as interview,
      count(*) filter (where status = 'offer') as offer,
      count(*) filter (where status = 'hired') as hired,
      count(*) filter (where status = 'rejected') as rejected
    from candidates where organization_id = p_org
  ), sources as (
    select source, count(*) as n from candidates where organization_id = p_org group by source
  ), interviews as (
    select
      count(*) filter (
        where i.status = 'scheduled' and e.starts_at < (d + 1)::timestamp at time zone tz
          and e.ends_at > d::timestamp at time zone tz
      ) as today,
      count(*) filter (
        where i.status = 'scheduled' and e.starts_at < (week_start + 7)::timestamp at time zone tz
          and e.ends_at > week_start::timestamp at time zone tz
      ) as this_week,
      count(*) filter (where i.status = 'scheduled' and e.ends_at < now()) as overdue
    from job_interviews i
    join calendar_events e on e.id = i.event_id and e.organization_id = i.organization_id
    where i.organization_id = p_org
  )
  select jsonb_build_object(
    'date', d,
    'timezone', tz,
    'summary', jsonb_build_object(
      'openJobs', j.open_jobs,
      'openJobsChange', j.open_jobs_30 - j.open_jobs_prev,
      'draftJobs', j.draft_jobs,
      'onHoldJobs', j.on_hold_jobs,
      'closedJobs', j.closed_jobs,
      'totalApplications', c.applications,
      'applicationsLast7Days', c.applications_7,
      'applicationsChangePercent',
        recruitment_percent(c.applications_7 - c.applications_prev, c.applications_prev),
      'candidatesInReview', c.in_review,
      'offersExtended', c.offer,
      'hiredTotal', c.hired,
      'rejectedTotal', c.rejected,
      'interviewsToday', i.today,
      'interviewsThisWeek', i.this_week,
      'interviewsOverdue', i.overdue
    ),
    'applicationsBySource', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', s.source,
        'count', s.n,
        'percent', recruitment_percent(s.n, c.applications)
      ) order by s.n desc, s.source)
      from sources s
    ), '[]'::jsonb),
    'pipeline', jsonb_build_array(
      jsonb_build_object('key', 'applied', 'count', c.applications),
      jsonb_build_object('key', 'screening', 'count', c.in_review),
      jsonb_build_object('key', 'assessment', 'count', c.assessment),
      jsonb_build_object('key', 'interview', 'count', c.interview),
      jsonb_build_object('key', 'offer', 'count', c.offer),
      jsonb_build_object('key', 'hired', 'count', c.hired)
    ),
    'interviews', jsonb_build_object('today', i.today, 'thisWeek', i.this_week, 'overdue', i.overdue)
  ) into result
  from job_totals j, candidate_totals c, interviews i;
  return result || jsonb_build_object('recentActivity', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'title', a.title, 'summary', a.summary,
      'occurredAt', a.occurred_at, 'actorId', a.actor_id, 'urgency', a.urgency
    ) order by a.occurred_at desc, a.id desc)
    from (
      select id, kind, title, summary, occurred_at, actor_id, urgency
      from organization_activities
      where organization_id = p_org and category = 'recruitment'
      order by occurred_at desc, id desc
      limit 8
    ) a
  ), '[]'::jsonb));
end $$;

create function public.recruitment_job_stats(p_actor uuid, p_org uuid, p_job uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare job_row jobs; result jsonb;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  select * into job_row from jobs where id = p_job and organization_id = p_org;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'jobId', job_row.id,
    'status', job_row.status,
    'totalPositions', job_row.positions,
    'filledPositions', coalesce(c.hired, 0),
    'openPositions', greatest(job_row.positions - coalesce(c.hired, 0), 0),
    'totalApplications', coalesce(c.applications, 0),
    'reviewed', coalesce(c.reviewed, 0),
    'interviewed', coalesce(c.interviewed, 0),
    'rejected', coalesce(c.rejected, 0),
    'offers', coalesce(c.offer, 0),
    'applicationsBySource', coalesce(src.items, '[]'::jsonb),
    'byStage', coalesce(st.items, '[]'::jsonb)
  ) into result
  from (
    select
      count(*) as applications,
      count(*) filter (where status in ('in_review', 'assessment', 'interview', 'offer', 'hired')) as reviewed,
      count(*) filter (where status in ('interview', 'offer', 'hired')) as interviewed,
      count(*) filter (where status = 'rejected') as rejected,
      count(*) filter (where status = 'offer') as offer,
      count(*) filter (where status = 'hired') as hired
    from candidates where organization_id = p_org and job_id = p_job
  ) c
  left join lateral (
    select jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n,
      'percent', recruitment_percent(s.n, c.applications)) order by s.n desc, s.source) as items
    from (select source, count(*) as n from candidates
      where organization_id = p_org and job_id = p_job group by source) s
  ) src on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('stageId', st.id, 'name', st.name,
      'displayOrder', st.display_order, 'category', st.category,
      'candidateCount', coalesce(cnt.n, 0)) order by st.display_order) as items
    from job_pipeline_stages st
    left join lateral (
      select count(*) as n from candidates
      where organization_id = p_org and stage_id = st.id
    ) cnt on true
    where st.job_id = p_job
  ) st on true;
  return result;
end $$;

-- One round trip for the job detail page and the create-job review step: the job
-- row plus every configured child collection, each already ordered.
create function public.recruitment_job_detail(p_actor uuid, p_org uuid, p_job uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare job_row jobs; stages jsonb; stage_count integer; automated integer;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  select * into job_row from jobs where id = p_job and organization_id = p_org;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id, 'name', st.name, 'displayOrder', st.display_order, 'category', st.category,
      'description', st.description, 'accent', st.accent, 'isAssessment', st.is_assessment,
      'assessment', st.assessment,
      'automations', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'label', a.label,
          'isEnabled', a.is_enabled, 'config', a.config) order by a.created_at, a.id)
        from job_stage_automations a where a.stage_id = st.id
      ), '[]'::jsonb),
      'hasEnabledAutomation', exists(select 1 from job_stage_automations a
        where a.stage_id = st.id and a.is_enabled),
      'candidateCount', (select count(*) from candidates c where c.stage_id = st.id)
    ) order by st.display_order), '[]'::jsonb) into stages
  from job_pipeline_stages st where st.job_id = p_job;
  stage_count := jsonb_array_length(stages);
  select count(*) into automated from jsonb_array_elements(stages) s where (s->>'hasEnabledAutomation')::boolean;
  return to_jsonb(job_row) || jsonb_build_object(
    'responsibilities', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'displayOrder', r.display_order, 'body', r.body)
        order by r.display_order) from job_responsibilities r where r.job_id = p_job), '[]'::jsonb),
    'qualifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'displayOrder', q.display_order, 'body', q.body)
        order by q.kind, q.display_order) from job_qualifications q where q.job_id = p_job), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'displayOrder', s.display_order, 'name', s.name,
        'level', s.level, 'isRequired', s.is_required) order by s.display_order)
      from job_skills s where s.job_id = p_job), '[]'::jsonb),
    'screeningQuestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'displayOrder', q.display_order, 'prompt', q.prompt,
        'kind', q.kind, 'threshold', q.threshold, 'weight', q.weight, 'isKnockout', q.is_knockout,
        'isRequired', q.is_required, 'expectedAnswer',
          case when workflow_has_permission(p_actor, p_org, 'candidates.view_all')
            or workflow_has_permission(p_actor, p_org, 'candidates.view_assigned')
            or workflow_has_permission(p_actor, p_org, 'jobs.manage_all') then q.expected_answer end
        ) order by q.display_order) from job_screening_questions q where q.job_id = p_job), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'displayOrder', b.display_order, 'label', b.label)
        order by b.display_order) from job_benefits b where b.job_id = p_job), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('channel', c.channel, 'isEnabled', c.is_enabled) order by c.channel)
      from job_publishing_channels c where c.job_id = p_job), '[]'::jsonb),
    'hiringTeam', coalesce((
      select jsonb_agg(jsonb_build_object('userId', t.user_id, 'roleLabel', t.role_label,
        'isLead', t.is_lead, 'displayName', pr.display_name, 'avatarUrl', pr.avatar_url)
        order by t.is_lead desc, t.created_at, t.user_id)
      from job_hiring_team t left join profiles pr on pr.id = t.user_id
      where t.job_id = p_job), '[]'::jsonb),
    'stages', stages,
    'stageCount', stage_count,
    'automatedStageCount', automated,
    -- Undefined when the job has no stages yet; a real 0% stays 0.
    'automationPercent', case when stage_count = 0 then null else recruitment_percent(automated, stage_count) end,
    'positionSummary', jsonb_build_object(
      'totalPositions', job_row.positions,
      'filledPositions', (select count(*) from candidates c where c.job_id = p_job and c.status = 'hired'),
      'openPositions', greatest(job_row.positions
        - (select count(*) from candidates c where c.job_id = p_job and c.status = 'hired'), 0)
    )
  );
end $$;

create function public.recruitment_pipeline(p_actor uuid, p_org uuid, p_job uuid, p_limit integer default 50)
returns jsonb language plpgsql stable set search_path = public as $$
declare result jsonb;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  if p_limit not between 1 and 200 then raise exception 'Invalid limit' using errcode = '22023'; end if;
  if not exists (select 1 from jobs where id = p_job and organization_id = p_org) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stageId', st.id, 'name', st.name, 'displayOrder', st.display_order,
    'category', st.category, 'description', st.description, 'accent', st.accent,
    'isAssessment', st.is_assessment, 'assessment', st.assessment,
    'candidateCount', coalesce(cards.n, 0), 'candidates', coalesce(cards.items, '[]'::jsonb)
  ) order by st.display_order), '[]'::jsonb) into result
  from job_pipeline_stages st
  left join lateral (
    select count(*) as n, jsonb_agg(jsonb_build_object(
      'id', x.id, 'fullName', x.full_name, 'email', x.email, 'source', x.source,
      'currentRole', x."current_role", 'currentCompany', x.current_company,
      'matchScore', x.match_score, 'status', x.status,
      'appliedAt', x.applied_at, 'lastActivityAt', x.last_activity_at
    ) order by x.last_activity_at desc, x.id) as items
    from (
      select * from candidates
      where organization_id = p_org and job_id = p_job and stage_id = st.id
      order by last_activity_at desc, id
      limit p_limit
    ) x
  ) cards on true
  where st.job_id = p_job;
  return jsonb_build_object('jobId', p_job, 'stages', result);
end $$;

create function public.recruitment_mutate(
  p_actor uuid, p_org uuid, p_action text, p_id uuid default null, p_data jsonb default '{}'
) returns jsonb language plpgsql set search_path = public as $$
declare
  job_row jobs; cand candidates; v_id uuid; v_revision integer; v_previous integer;
  v_stage job_pipeline_stages; v_status text; v_slug text; v_item jsonb;
  v_prev_stage uuid; v_prev_status text;
begin
  -- Serialize recruitment writes per workspace like the workflow and HR modules.
  perform 1 from organizations where id = p_org for update;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Invalid payload' using errcode = '22023';
  end if;

  if p_action = 'job.save' then
    perform recruitment_require(p_actor, p_org, case when p_id is null then 'jobs.create' else 'jobs.manage_all' end);
    if (select count(*) from jsonb_object_keys(p_data) k where not (k = any(array[
      'roleId','departmentId','teamId','reportingManagerId','reference','title','summary',
      'employmentType','workArrangement','seniorityLevel','experienceMinYears',
      'educationRequirement','primaryTooling','reviewSlaHours','locationCountry','locationCity',
      'salaryMin','salaryMax','currency','positions','postedOn','closesOn',
      'responsibilities','qualifications','skills','screeningQuestions','stages','channels',
      'benefits','hiringTeam','expectedRevision'
    ]))) > 0 then raise exception 'Invalid fields' using errcode = '22023'; end if;

    if p_id is null then
      if nullif(btrim(coalesce(p_data->>'title', '')), '') is null then
        raise exception 'Job title is required' using errcode = '22023';
      end if;
      insert into jobs (
        organization_id, role_id, department_id, team_id, reporting_manager_id, reference,
        title, summary, employment_type, work_arrangement, seniority_level, experience_min_years,
        education_requirement, primary_tooling, review_sla_hours, location_country, location_city,
        salary_min, salary_max, currency, positions, posted_on, closes_on, status, created_by
      ) values (
        p_org,
        nullif(p_data->>'roleId', '')::uuid,
        nullif(p_data->>'departmentId', '')::uuid,
        nullif(p_data->>'teamId', '')::uuid,
        nullif(p_data->>'reportingManagerId', '')::uuid,
        nullif(btrim(coalesce(p_data->>'reference', '')), ''),
        btrim(p_data->>'title'),
        nullif(p_data->>'summary', ''),
        coalesce(nullif(p_data->>'employmentType', ''), 'full_time'),
        coalesce(nullif(p_data->>'workArrangement', ''), 'hybrid'),
        nullif(btrim(coalesce(p_data->>'seniorityLevel', '')), ''),
        nullif(p_data->>'experienceMinYears', '')::smallint,
        nullif(btrim(coalesce(p_data->>'educationRequirement', '')), ''),
        nullif(btrim(coalesce(p_data->>'primaryTooling', '')), ''),
        coalesce(nullif(p_data->>'reviewSlaHours', '')::smallint, 24),
        upper(nullif(btrim(coalesce(p_data->>'locationCountry', '')), '')),
        nullif(btrim(coalesce(p_data->>'locationCity', '')), ''),
        nullif(p_data->>'salaryMin', '')::numeric,
        nullif(p_data->>'salaryMax', '')::numeric,
        upper(nullif(btrim(coalesce(p_data->>'currency', '')), '')),
        coalesce(nullif(p_data->>'positions', '')::smallint, 1),
        nullif(p_data->>'postedOn', '')::date,
        nullif(p_data->>'closesOn', '')::date,
        'draft', p_actor
      ) returning * into job_row;
      v_previous := 0;
      -- A new job starts with the organization default pipeline shape.
      if not (p_data ? 'stages') then
        insert into job_pipeline_stages (organization_id, job_id, display_order, name, category)
        select p_org, job_row.id, s.display_order, s.name,
          case s.name when 'Interview' then 'interview' when 'Offer' then 'offer'
            when 'Hired' then 'hired' when 'Assessment' then 'assessment' else 'screening' end
        from (values (0, 'Screening'), (1, 'Interview'), (2, 'Assessment'), (3, 'Offer'), (4, 'Hired')) s(display_order, name);
      end if;
      if not (p_data ? 'channels') then
        insert into job_publishing_channels (organization_id, job_id, channel, is_enabled)
        values (p_org, job_row.id, 'careers_page', true), (p_org, job_row.id, 'global_syndication', false),
               (p_org, job_row.id, 'internal_mobility', true), (p_org, job_row.id, 'premium_boost', false);
      end if;
    else
      select * into job_row from jobs where id = p_id and organization_id = p_org for update;
      if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
      if job_row.status = 'closed' then
        raise exception 'Closed jobs are read-only. Reopen the job before editing.' using errcode = '22023';
      end if;
      if p_data ? 'expectedRevision' and (p_data->>'expectedRevision')::integer is distinct from job_row.revision then
        raise exception 'Job changed since this form was loaded' using errcode = 'PT409';
      end if;
      v_previous := job_row.revision;
      update jobs set
        role_id = case when p_data ? 'roleId' then nullif(p_data->>'roleId', '')::uuid else role_id end,
        department_id = case when p_data ? 'departmentId' then nullif(p_data->>'departmentId', '')::uuid else department_id end,
        team_id = case when p_data ? 'teamId' then nullif(p_data->>'teamId', '')::uuid else team_id end,
        reporting_manager_id = case when p_data ? 'reportingManagerId' then nullif(p_data->>'reportingManagerId', '')::uuid else reporting_manager_id end,
        reference = case when p_data ? 'reference' then nullif(btrim(p_data->>'reference'), '') else reference end,
        title = case when p_data ? 'title' then btrim(p_data->>'title') else title end,
        summary = case when p_data ? 'summary' then nullif(p_data->>'summary', '') else summary end,
        employment_type = case when p_data ? 'employmentType' then p_data->>'employmentType' else employment_type end,
        work_arrangement = case when p_data ? 'workArrangement' then p_data->>'workArrangement' else work_arrangement end,
        seniority_level = case when p_data ? 'seniorityLevel' then nullif(btrim(p_data->>'seniorityLevel'), '') else seniority_level end,
        experience_min_years = case when p_data ? 'experienceMinYears' then nullif(p_data->>'experienceMinYears', '')::smallint else experience_min_years end,
        education_requirement = case when p_data ? 'educationRequirement' then nullif(btrim(p_data->>'educationRequirement'), '') else education_requirement end,
        primary_tooling = case when p_data ? 'primaryTooling' then nullif(btrim(p_data->>'primaryTooling'), '') else primary_tooling end,
        review_sla_hours = case when p_data ? 'reviewSlaHours' then (p_data->>'reviewSlaHours')::smallint else review_sla_hours end,
        location_country = case when p_data ? 'locationCountry' then upper(nullif(btrim(p_data->>'locationCountry'), '')) else location_country end,
        location_city = case when p_data ? 'locationCity' then nullif(btrim(p_data->>'locationCity'), '') else location_city end,
        salary_min = case when p_data ? 'salaryMin' then nullif(p_data->>'salaryMin', '')::numeric else salary_min end,
        salary_max = case when p_data ? 'salaryMax' then nullif(p_data->>'salaryMax', '')::numeric else salary_max end,
        currency = case when p_data ? 'currency' then upper(nullif(btrim(p_data->>'currency'), '')) else currency end,
        positions = case when p_data ? 'positions' then (p_data->>'positions')::smallint else positions end,
        posted_on = case when p_data ? 'postedOn' then nullif(p_data->>'postedOn', '')::date else posted_on end,
        closes_on = case when p_data ? 'closesOn' then nullif(p_data->>'closesOn', '')::date else closes_on end,
        revision = revision + 1
      where id = p_id and organization_id = p_org returning * into job_row;
    end if;
    v_id := job_row.id;

    if p_data ? 'responsibilities' then
      delete from job_responsibilities where job_id = v_id and organization_id = p_org;
      insert into job_responsibilities (organization_id, job_id, display_order, body)
      select p_org, v_id, (ordinality - 1)::smallint, btrim(x->>'body')
      from jsonb_array_elements(p_data->'responsibilities') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'body', '')), '') is not null;
    end if;
    if p_data ? 'qualifications' then
      delete from job_qualifications where job_id = v_id and organization_id = p_org;
      insert into job_qualifications (organization_id, job_id, kind, display_order, body)
      select p_org, v_id, coalesce(nullif(x->>'kind', ''), 'must_have'),
        (ordinality - 1)::smallint, btrim(x->>'body')
      from jsonb_array_elements(p_data->'qualifications') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'body', '')), '') is not null;
    end if;
    if p_data ? 'skills' then
      delete from job_skills where job_id = v_id and organization_id = p_org;
      insert into job_skills (organization_id, job_id, display_order, name, level, is_required)
      select p_org, v_id, (ordinality - 1)::smallint, btrim(x->>'name'),
        nullif(x->>'level', ''),
        coalesce((x->>'isRequired')::boolean, true)
      from jsonb_array_elements(p_data->'skills') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'name', '')), '') is not null;
    end if;
    if p_data ? 'screeningQuestions' then
      delete from job_screening_questions where job_id = v_id and organization_id = p_org;
      insert into job_screening_questions (
        organization_id, job_id, display_order, prompt, kind, threshold, weight,
        is_knockout, is_required, expected_answer
      )
      select p_org, v_id, (ordinality - 1)::smallint, btrim(x->>'prompt'),
        coalesce(nullif(x->>'kind', ''), 'short_answer'), nullif(x->>'threshold', ''),
        nullif(x->>'weight', '')::smallint, coalesce((x->>'isKnockout')::boolean, false),
        coalesce((x->>'isRequired')::boolean, true), nullif(x->>'expectedAnswer', '')
      from jsonb_array_elements(p_data->'screeningQuestions') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'prompt', '')), '') is not null;
    end if;
    if p_data ? 'stages' then
      delete from job_pipeline_stages where job_id = v_id and organization_id = p_org;
      insert into job_pipeline_stages (
        organization_id, job_id, display_order, name, category, description, accent, is_assessment, assessment
      )
      select p_org, v_id, (ordinality - 1)::smallint, btrim(x->>'name'),
        coalesce(nullif(x->>'category', ''), 'screening'), nullif(x->>'description', ''),
        nullif(x->>'accent', ''), coalesce((x->>'isAssessment')::boolean, false),
        coalesce(x->'assessment', '{}'::jsonb)
      from jsonb_array_elements(p_data->'stages') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'name', '')), '') is not null;
      for v_item in select jsonb_array_elements(p_data->'stages') loop
        if jsonb_array_length(coalesce(v_item->'automations', '[]'::jsonb)) > 0 then
          insert into job_stage_automations (organization_id, stage_id, kind, label, is_enabled, config)
          select p_org, st.id, coalesce(nullif(a->>'kind', ''), 'custom'), btrim(a->>'label'),
            coalesce((a->>'isEnabled')::boolean, true), coalesce(a->'config', '{}'::jsonb)
          from job_pipeline_stages st
          cross join jsonb_array_elements(coalesce(v_item->'automations', '[]'::jsonb)) a
          where st.job_id = v_id and st.name = btrim(v_item->>'name');
        end if;
      end loop;
    end if;
    if p_data ? 'channels' then
      delete from job_publishing_channels where job_id = v_id and organization_id = p_org;
      insert into job_publishing_channels (organization_id, job_id, channel, is_enabled)
      select p_org, v_id, btrim(x->>'channel'), coalesce((x->>'isEnabled')::boolean, false)
      from jsonb_array_elements(p_data->'channels') x
      where nullif(btrim(coalesce(x->>'channel', '')), '') is not null;
    end if;
    if p_data ? 'benefits' then
      delete from job_benefits where job_id = v_id and organization_id = p_org;
      insert into job_benefits (organization_id, job_id, display_order, label)
      select p_org, v_id, (ordinality - 1)::smallint, btrim(x->>'label')
      from jsonb_array_elements(p_data->'benefits') with ordinality t(x, ordinality)
      where nullif(btrim(coalesce(x->>'label', '')), '') is not null;
    end if;
    if p_data ? 'hiringTeam' then
      delete from job_hiring_team where job_id = v_id and organization_id = p_org;
      insert into job_hiring_team (organization_id, job_id, user_id, role_label, is_lead)
      select p_org, v_id, (x->>'userId')::uuid,
        coalesce(nullif(btrim(x->>'roleLabel'), ''), 'reviewer'),
        coalesce((x->>'isLead')::boolean, false)
      from jsonb_array_elements(p_data->'hiringTeam') x
      where nullif(x->>'userId', '') is not null;
    end if;
    v_revision := job_row.revision;
    insert into job_revision_history (organization_id, job_id, actor_id, action, changes, previous_revision, new_revision)
    values (p_org, v_id, p_actor, case when p_id is null then 'job.create' else 'job.update' end,
      p_data - 'expectedRevision', v_previous, v_revision);
    insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values (p_org, 'recruitment', case when p_id is null then 'job_created' else 'job_updated' end,
      job_row.title, case when p_id is null then 'Job created' else 'Job updated' end,
      p_actor, 'job', v_id);
    return to_jsonb(job_row) || jsonb_build_object('revision', v_revision);
  end if;

  if p_action = 'job.publish' then
    perform recruitment_require(p_actor, p_org, 'jobs.publish');
    select * into job_row from jobs where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
    if job_row.status = 'open' then return to_jsonb(job_row); end if;
    if job_row.status = 'closed' then raise exception 'Reopen the job before publishing' using errcode = '22023'; end if;
    if not exists (select 1 from job_pipeline_stages where job_id = p_id) then
      raise exception 'A published job needs at least one pipeline stage' using errcode = '22023';
    end if;
    v_slug := coalesce(job_row.public_slug, lower(regexp_replace(job_row.title, '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || substr(replace(job_row.id::text, '-', ''), 1, 6));
    update jobs set status = 'open', published_at = coalesce(published_at, now()),
      posted_on = coalesce(posted_on, hr_today(p_org)), public_slug = v_slug, revision = revision + 1
    where id = p_id and organization_id = p_org returning * into job_row;
    insert into job_revision_history (organization_id, job_id, actor_id, action, changes, previous_revision, new_revision)
    values (p_org, p_id, p_actor, 'job.publish', jsonb_build_object('status', 'open'), job_row.revision - 1, job_row.revision);
    insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values (p_org, 'recruitment', 'job_published', job_row.title, 'Job published', p_actor, 'job', p_id);
    return to_jsonb(job_row);
  end if;

  if p_action = 'job.status' then
    perform recruitment_require(p_actor, p_org, 'jobs.manage_all');
    v_status := nullif(btrim(coalesce(p_data->>'status', '')), '');
    if v_status not in ('open', 'on_hold', 'closed') then
      raise exception 'Invalid job status' using errcode = '22023';
    end if;
    select * into job_row from jobs where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
    if v_status = 'open' and job_row.status not in ('draft', 'on_hold', 'closed') then
      raise exception 'Job is already open' using errcode = '22023';
    end if;
    if v_status = 'open' and job_row.published_at is null then
      raise exception 'Publish the job before opening it' using errcode = '22023';
    end if;
    update jobs set status = v_status, revision = revision + 1
    where id = p_id and organization_id = p_org returning * into job_row;
    insert into job_revision_history (organization_id, job_id, actor_id, action, changes, previous_revision, new_revision)
    values (p_org, p_id, p_actor, 'job.status', jsonb_build_object('status', v_status), job_row.revision - 1, job_row.revision);
    insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values (p_org, 'recruitment', 'job_status_changed', job_row.title, 'Job marked ' || replace(v_status, '_', ' '),
      p_actor, 'job', p_id);
    return to_jsonb(job_row);
  end if;

  if p_action = 'candidate.save' then
    perform recruitment_require(p_actor, p_org, 'candidates.manage');
    if (select count(*) from jsonb_object_keys(p_data) k where not (k = any(array[
      'jobId','stageId','fullName','email','phone','source','currentRole','currentCompany',
      'resumeUrl','matchScore','status','rejectionReason'
    ]))) > 0 then raise exception 'Invalid fields' using errcode = '22023'; end if;
    if p_id is null and nullif(p_data->>'jobId', '') is null then
      raise exception 'jobId is required' using errcode = '22023';
    end if;
    if p_id is null then
      insert into candidates (
        organization_id, job_id, stage_id, full_name, email, phone, source, "current_role",
        current_company, resume_url, match_score, status, created_by
      ) values (
        p_org, (p_data->>'jobId')::uuid, nullif(p_data->>'stageId', '')::uuid,
        btrim(p_data->>'fullName'), lower(btrim(p_data->>'email')),
        nullif(btrim(coalesce(p_data->>'phone', '')), ''),
        coalesce(nullif(p_data->>'source', ''), 'careers_page'),
        nullif(btrim(coalesce(p_data->>'currentRole', '')), ''),
        nullif(btrim(coalesce(p_data->>'currentCompany', '')), ''),
        nullif(btrim(coalesce(p_data->>'resumeUrl', '')), ''),
        nullif(p_data->>'matchScore', '')::smallint,
        coalesce(nullif(p_data->>'status', ''), 'new'), p_actor
      ) returning * into cand;
      insert into candidate_stage_events (organization_id, candidate_id, to_stage_id, to_status, actor_id)
      values (p_org, cand.id, cand.stage_id, cand.status, p_actor);
      insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
      values (p_org, 'recruitment', 'candidate_added', cand.full_name, 'New application received', p_actor, 'candidate', cand.id);
      return to_jsonb(cand);
    end if;
    select * into cand from candidates where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'Candidate not found' using errcode = 'P0002'; end if;
    if p_data ? 'stageId' and nullif(p_data->>'stageId', '') is not null
      and not exists (select 1 from job_pipeline_stages
        where id = (p_data->>'stageId')::uuid and job_id = cand.job_id and organization_id = p_org) then
      raise exception 'Stage does not belong to this job' using errcode = '22023';
    end if;
    update candidates set
      stage_id = case when p_data ? 'stageId' then nullif(p_data->>'stageId', '')::uuid else stage_id end,
      full_name = case when p_data ? 'fullName' then btrim(p_data->>'fullName') else full_name end,
      email = case when p_data ? 'email' then lower(btrim(p_data->>'email')) else email end,
      phone = case when p_data ? 'phone' then nullif(btrim(p_data->>'phone'), '') else phone end,
      source = case when p_data ? 'source' then p_data->>'source' else source end,
      "current_role" = case when p_data ? 'currentRole' then nullif(btrim(p_data->>'currentRole'), '') else "current_role" end,
      current_company = case when p_data ? 'currentCompany' then nullif(btrim(p_data->>'currentCompany'), '') else current_company end,
      resume_url = case when p_data ? 'resumeUrl' then nullif(btrim(p_data->>'resumeUrl'), '') else resume_url end,
      match_score = case when p_data ? 'matchScore' then nullif(p_data->>'matchScore', '')::smallint else match_score end,
      status = case when p_data ? 'status' then p_data->>'status' else status end,
      rejection_reason = case when p_data ? 'rejectionReason' then nullif(p_data->>'rejectionReason', '') else rejection_reason end,
      last_activity_at = now()
    where id = p_id and organization_id = p_org returning * into cand;
    insert into candidate_stage_events (organization_id, candidate_id, to_stage_id, to_status, actor_id)
    values (p_org, cand.id, cand.stage_id, cand.status, p_actor);
    return to_jsonb(cand);
  end if;

  if p_action = 'candidate.advance' then
    perform recruitment_require(p_actor, p_org, 'candidates.manage');
    select * into cand from candidates where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'Candidate not found' using errcode = 'P0002'; end if;
    v_prev_stage := cand.stage_id;
    v_prev_status := cand.status;
    select * into v_stage from job_pipeline_stages
      where id = (p_data->>'stageId')::uuid and job_id = cand.job_id and organization_id = p_org;
    if not found then raise exception 'Stage does not belong to this job' using errcode = '22023'; end if;
    v_status := coalesce(nullif(p_data->>'status', ''), case v_stage.category
      when 'interview' then 'interview' when 'assessment' then 'assessment'
      when 'offer' then 'offer' when 'hired' then 'hired' else 'in_review' end);
    if v_status not in ('new', 'in_review', 'assessment', 'interview', 'offer', 'hired', 'rejected') then
      raise exception 'Invalid candidate status' using errcode = '22023';
    end if;
    update candidates set stage_id = v_stage.id, status = v_status,
      last_activity_at = now(),
      rejection_reason = case when v_status = 'rejected' then nullif(p_data->>'rejectionReason', '') else rejection_reason end
    where id = p_id and organization_id = p_org returning * into cand;
    insert into candidate_stage_events (organization_id, candidate_id, from_stage_id, to_stage_id, from_status, to_status, note, actor_id)
    values (p_org, cand.id, v_prev_stage, v_stage.id, v_prev_status, v_status, nullif(p_data->>'note', ''), p_actor);
    insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
    values (p_org, 'recruitment', 'candidate_stage_changed', cand.full_name,
      'Moved to ' || v_stage.name, p_actor, 'candidate', cand.id);
    return to_jsonb(cand);
  end if;

  raise exception 'Unknown recruitment action' using errcode = '22023';
end $$;

-- One indexed round trip for the jobs table, including the applicant counts the
-- dashboard shows per row, plus the unpaginated total for the same filter.
create function public.recruitment_job_list(
  p_actor uuid, p_org uuid, p_status text default null, p_department uuid default null,
  p_search text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable set search_path = public as $$
declare items jsonb; total integer; result jsonb;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  if p_limit not between 1 and 200 or p_offset < 0 then raise exception 'Invalid pagination' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('draft', 'open', 'on_hold', 'closed') then
    raise exception 'Invalid job status' using errcode = '22023';
  end if;
  select count(*) into total from jobs j
  where j.organization_id = p_org
    and (p_status is null or j.status = p_status)
    and (p_department is null or j.department_id = p_department)
    and (p_search is null or j.title ilike '%' || p_search || '%'
      or coalesce(j.reference, '') ilike '%' || p_search || '%');
  select coalesce(jsonb_agg(q.item order by q.posted_on desc nulls last, q.created_at desc, q.id desc), '[]'::jsonb)
  into items
  from (
    select to_jsonb(j) || jsonb_build_object(
      'applicationCount', coalesce(c.applications, 0),
      'newApplicationCount', coalesce(c.new_applications, 0),
      'hiredCount', coalesce(c.hired, 0),
      'stageCount', coalesce(s.stages, 0)
    ) as item, j.posted_on, j.created_at, j.id
    from jobs j
    left join lateral (
      select count(*) as applications,
        count(*) filter (where k.status = 'new') as new_applications,
        count(*) filter (where k.status = 'hired') as hired
      from candidates k where k.organization_id = p_org and k.job_id = j.id
    ) c on true
    left join lateral (
      select count(*) as stages from job_pipeline_stages st where st.job_id = j.id
    ) s on true
    where j.organization_id = p_org
      and (p_status is null or j.status = p_status)
      and (p_department is null or j.department_id = p_department)
      and (p_search is null or j.title ilike '%' || p_search || '%'
        or coalesce(j.reference, '') ilike '%' || p_search || '%')
    order by j.posted_on desc nulls last, j.created_at desc, j.id desc
    limit p_limit offset p_offset
  ) q;
  return jsonb_build_object('items', items, 'total', total, 'limit', p_limit, 'offset', p_offset);
end $$;

create function public.recruitment_candidate_list(
  p_actor uuid, p_org uuid, p_job uuid default null, p_stage uuid default null,
  p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable set search_path = public as $$
declare items jsonb; total integer;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  if p_limit not between 1 and 200 or p_offset < 0 then raise exception 'Invalid pagination' using errcode = '22023'; end if;
  select count(*) into total from candidates c
  where c.organization_id = p_org
    and (p_job is null or c.job_id = p_job)
    and (p_stage is null or c.stage_id = p_stage)
    and (p_status is null or c.status = p_status)
    and (p_search is null or c.full_name ilike '%' || p_search || '%'
      or c.email ilike '%' || p_search || '%');
  select coalesce(jsonb_agg(q.item order by q.last_activity_at desc, q.id desc), '[]'::jsonb) into items
  from (
    select to_jsonb(c) || jsonb_build_object(
      'jobTitle', j.title, 'stageName', st.name, 'stageCategory', st.category
    ) as item, c.last_activity_at, c.id
    from candidates c
    join jobs j on j.id = c.job_id and j.organization_id = c.organization_id
    left join job_pipeline_stages st on st.id = c.stage_id
    where c.organization_id = p_org
      and (p_job is null or c.job_id = p_job)
      and (p_stage is null or c.stage_id = p_stage)
      and (p_status is null or c.status = p_status)
      and (p_search is null or c.full_name ilike '%' || p_search || '%'
        or c.email ilike '%' || p_search || '%')
    order by c.last_activity_at desc, c.id desc
    limit p_limit offset p_offset
  ) q;
  return jsonb_build_object('items', items, 'total', total, 'limit', p_limit, 'offset', p_offset);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'recruitment\_%' or p.proname = 'grant_recruitment_view_permission')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
