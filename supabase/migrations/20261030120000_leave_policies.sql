begin;
-- Employer-managed leave policy suite. Complements hr_leave and
-- hr_leave_entitlements with the configurable policy, eligibility, accrual,
-- request-rule, approval and report surfaces from the design.
create table public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  leave_type text not null,
  description text,
  status text not null default 'draft'
    check (status in ('active', 'draft', 'not_active', 'inactive')),
  effective_from date,
  revision integer not null default 0,
  eligibility_match text not null default 'all'
    check (eligibility_match in ('all', 'any')),
  department_ids uuid[] not null default '{}',
  role_ids uuid[] not null default '{}',
  employment_types text[] not null default '{}',
  gender_eligibility text not null default 'all'
    check (gender_eligibility in ('all', 'male', 'female')),
  allowance_type text not null default 'fixed'
    check (allowance_type in ('fixed', 'unlimited')),
  days_per_year numeric(5, 1)
    check (days_per_year is null or (days_per_year between 0 and 366)),
  pro_rate_new_hires boolean not null default false,
  accrual_method text not null default 'upfront'
    check (accrual_method in ('upfront', 'scheduled')),
  accrual_frequency text,
  max_carryover numeric(5, 1)
    check (max_carryover is null or max_carryover >= 0),
  carryover_expiry text,
  min_duration numeric(4, 2) not null default 0.5 check (min_duration > 0),
  max_consecutive_days integer
    check (max_consecutive_days is null or max_consecutive_days > 0),
  advance_notice_days integer
    check (advance_notice_days is null or advance_notice_days >= 0),
  require_documentation boolean not null default false,
  documentation_threshold_days integer,
  blackout_periods jsonb not null default '[]'
    check (jsonb_typeof(blackout_periods) = 'array'),
  approval_workflow text not null default 'default'
    check (approval_workflow in ('default', 'custom')),
  approval_chain jsonb not null default '[]'
    check (jsonb_typeof(approval_chain) = 'array'),
  allow_negative_balance boolean not null default false,
  auto_deduct_payroll boolean not null default false,
  assignment jsonb not null default '[]'
    check (jsonb_typeof(assignment) = 'array'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create table public.leave_settings (
  organization_id uuid primary key references public.organizations(id),
  leave_year_start_month integer not null default 1
    check (leave_year_start_month between 1 and 12),
  leave_year_start_day integer not null default 1
    check (leave_year_start_day between 1 and 31),
  leave_year_end_month integer not null default 12
    check (leave_year_end_month between 1 and 12),
  leave_year_end_day integer not null default 31
    check (leave_year_end_day between 1 and 31),
  pro_rate_new_starters boolean not null default false,
  accrue_by_hours boolean not null default false,
  track_public_holidays boolean not null default false,
  manager_notifications boolean not null default true,
  carry_forward_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.leave_policies enable row level security;
alter table public.leave_settings enable row level security;
revoke all on public.leave_policies from anon, authenticated;
revoke all on public.leave_settings from anon, authenticated;
grant all on public.leave_policies to service_role;
grant all on public.leave_settings to service_role;
create index on public.leave_policies (organization_id);
create index on public.leave_policies (organization_id, status);
create function public.leave_mutate(
  p_actor uuid,
  p_org uuid,
  p_action text,
  p_id uuid,
  p_data jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
  result jsonb;
begin
  perform 1 from organizations where id = p_org for update;
  if p_action = 'policy.save' then
    perform hr_require(p_actor, p_org, 'employees.manage');
    if p_data is null or jsonb_typeof(p_data) <> 'object' then
      raise exception 'Invalid policy data' using errcode = '22023';
    end if;
    if p_id is null then
      insert into leave_policies (organization_id, name, leave_type, description,
        status, effective_from, eligibility_match, department_ids, role_ids,
        employment_types, gender_eligibility, allowance_type, days_per_year,
        pro_rate_new_hires, accrual_method, accrual_frequency, max_carryover,
        carryover_expiry, min_duration, max_consecutive_days,
        advance_notice_days, require_documentation, documentation_threshold_days,
        blackout_periods, approval_workflow, approval_chain,
        allow_negative_balance, auto_deduct_payroll, assignment, created_by)
      values (p_org, p_data->>'name', p_data->>'leave_type', p_data->>'description',
        coalesce(p_data->>'status', 'draft'),
        nullif(p_data->>'effective_from', '')::date,
        coalesce(p_data->>'eligibility_match', 'all'),
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_data->'department_ids', '[]'::jsonb)) x), '{}'),
        coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_data->'role_ids', '[]'::jsonb)) x), '{}'),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'employment_types', '[]'::jsonb)) x), '{}'),
        coalesce(p_data->>'gender_eligibility', 'all'),
        coalesce(p_data->>'allowance_type', 'fixed'),
        nullif(p_data->>'days_per_year', '')::numeric,
        coalesce((p_data->>'pro_rate_new_hires')::boolean, false),
        coalesce(p_data->>'accrual_method', 'upfront'),
        p_data->>'accrual_frequency',
        nullif(p_data->>'max_carryover', '')::numeric,
        p_data->>'carryover_expiry',
        coalesce(nullif(p_data->>'min_duration', '')::numeric, 0.5),
        nullif(p_data->>'max_consecutive_days', '')::integer,
        nullif(p_data->>'advance_notice_days', '')::integer,
        coalesce((p_data->>'require_documentation')::boolean, false),
        nullif(p_data->>'documentation_threshold_days', '')::integer,
        coalesce(p_data->'blackout_periods', '[]'::jsonb),
        coalesce(p_data->>'approval_workflow', 'default'),
        coalesce(p_data->'approval_chain', '[]'::jsonb),
        coalesce((p_data->>'allow_negative_balance')::boolean, false),
        coalesce((p_data->>'auto_deduct_payroll')::boolean, false),
        coalesce(p_data->'assignment', '[]'::jsonb),
        p_actor)
      returning to_jsonb(leave_policies.*) into result;
    else
      update leave_policies set
        name = coalesce(p_data->>'name', name),
        leave_type = coalesce(p_data->>'leave_type', leave_type),
        description = coalesce(p_data->>'description', description),
        status = coalesce(p_data->>'status', status),
        effective_from = coalesce(nullif(p_data->>'effective_from', '')::date, effective_from),
        eligibility_match = coalesce(p_data->>'eligibility_match', eligibility_match),
        department_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_data->'department_ids', '[]'::jsonb)) x), department_ids),
        role_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_data->'role_ids', '[]'::jsonb)) x), role_ids),
        employment_types = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'employment_types', '[]'::jsonb)) x), employment_types),
        gender_eligibility = coalesce(p_data->>'gender_eligibility', gender_eligibility),
        allowance_type = coalesce(p_data->>'allowance_type', allowance_type),
        days_per_year = coalesce(nullif(p_data->>'days_per_year', '')::numeric, days_per_year),
        pro_rate_new_hires = coalesce((p_data->>'pro_rate_new_hires')::boolean, pro_rate_new_hires),
        accrual_method = coalesce(p_data->>'accrual_method', accrual_method),
        accrual_frequency = coalesce(p_data->>'accrual_frequency', accrual_frequency),
        max_carryover = coalesce(nullif(p_data->>'max_carryover', '')::numeric, max_carryover),
        carryover_expiry = coalesce(p_data->>'carryover_expiry', carryover_expiry),
        min_duration = coalesce(nullif(p_data->>'min_duration', '')::numeric, min_duration),
        max_consecutive_days = coalesce(nullif(p_data->>'max_consecutive_days', '')::integer, max_consecutive_days),
        advance_notice_days = coalesce(nullif(p_data->>'advance_notice_days', '')::integer, advance_notice_days),
        require_documentation = coalesce((p_data->>'require_documentation')::boolean, require_documentation),
        documentation_threshold_days = coalesce(nullif(p_data->>'documentation_threshold_days', '')::integer, documentation_threshold_days),
        blackout_periods = coalesce(p_data->'blackout_periods', blackout_periods),
        approval_workflow = coalesce(p_data->>'approval_workflow', approval_workflow),
        approval_chain = coalesce(p_data->'approval_chain', approval_chain),
        allow_negative_balance = coalesce((p_data->>'allow_negative_balance')::boolean, allow_negative_balance),
        auto_deduct_payroll = coalesce((p_data->>'auto_deduct_payroll')::boolean, auto_deduct_payroll),
        assignment = coalesce(p_data->'assignment', assignment),
        revision = revision + 1,
        updated_at = now()
      where id = p_id and organization_id = p_org
      returning to_jsonb(leave_policies.*) into result;
      if result is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    end if;
    return result;
  end if;
  if p_action = 'policy.delete' then
    perform hr_require(p_actor, p_org, 'employees.manage');
    delete from leave_policies where id = p_id and organization_id = p_org
      returning to_jsonb(leave_policies.*) into result;
    if result is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    return result;
  end if;
  if p_action = 'settings.save' then
    perform hr_require(p_actor, p_org, 'employees.manage');
    insert into leave_settings (organization_id, leave_year_start_month,
      leave_year_start_day, leave_year_end_month, leave_year_end_day,
      pro_rate_new_starters, accrue_by_hours, track_public_holidays,
      manager_notifications, carry_forward_enabled)
    values (p_org,
      coalesce((p_data->>'leave_year_start_month')::int, 1),
      coalesce((p_data->>'leave_year_start_day')::int, 1),
      coalesce((p_data->>'leave_year_end_month')::int, 12),
      coalesce((p_data->>'leave_year_end_day')::int, 31),
      coalesce((p_data->>'pro_rate_new_starters')::boolean, false),
      coalesce((p_data->>'accrue_by_hours')::boolean, false),
      coalesce((p_data->>'track_public_holidays')::boolean, false),
      coalesce((p_data->>'manager_notifications')::boolean, true),
      coalesce((p_data->>'carry_forward_enabled')::boolean, false))
    on conflict (organization_id) do update set
      leave_year_start_month = excluded.leave_year_start_month,
      leave_year_start_day = excluded.leave_year_start_day,
      leave_year_end_month = excluded.leave_year_end_month,
      leave_year_end_day = excluded.leave_year_end_day,
      pro_rate_new_starters = excluded.pro_rate_new_starters,
      accrue_by_hours = excluded.accrue_by_hours,
      track_public_holidays = excluded.track_public_holidays,
      manager_notifications = excluded.manager_notifications,
      carry_forward_enabled = excluded.carry_forward_enabled,
      updated_at = now()
    returning to_jsonb(leave_settings.*) into result;
    return result;
  end if;
  raise exception 'Unknown leave action' using errcode = '22023';
end $$;
create function public.leave_policy_list(
  p_actor uuid,
  p_org uuid,
  p_status text default null,
  p_search text default null,
  p_limit int default 200,
  p_offset int default 0
) returns jsonb language plpgsql set search_path = public as $$
declare
  total int;
  rows jsonb;
begin
  perform hr_require(p_actor, p_org, 'employees.view');
  select count(*) into total from leave_policies
    where organization_id = p_org
      and (p_status is null or status = p_status)
      and (p_search is null or name ilike '%' || p_search || '%'
           or leave_type ilike '%' || p_search || '%');
  select coalesce(jsonb_agg(p order by p->>'name'), '[]'::jsonb) into rows
    from (
      select to_jsonb(lp.*) as p
      from leave_policies lp
      where lp.organization_id = p_org
        and (p_status is null or lp.status = p_status)
        and (p_search is null or lp.name ilike '%' || p_search || '%'
             or lp.leave_type ilike '%' || p_search || '%')
      order by lp.name
      limit p_limit offset p_offset
    ) q;
  return jsonb_build_object('items', rows, 'total', total,
    'limit', p_limit, 'offset', p_offset);
end $$;
create function public.leave_reports(p_actor uuid, p_org uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  summary jsonb;
  by_type jsonb;
  balances jsonb;
begin
  perform hr_require(p_actor, p_org, 'employees.view');
  select jsonb_build_object(
    'daysUsed', coalesce(sum(hr_workdays(starts_on, ends_on)), 0),
    'requests', count(*),
    'avgDaysPerRequest', coalesce(round(coalesce(sum(hr_workdays(starts_on, ends_on)), 0)::numeric / nullif(count(*), 0), 1), 0),
    'pending', count(*) filter (where status = 'pending'),
    'approved', count(*) filter (where status = 'approved')
  ) into summary
  from hr_leave
  where organization_id = p_org and status <> 'cancelled';
  select coalesce(jsonb_agg(t order by (t->>'days')::numeric desc), '[]'::jsonb) into by_type
    from (
      select jsonb_build_object('leaveType', leave_type,
        'days', coalesce(sum(hr_workdays(starts_on, ends_on)), 0),
        'requests', count(*)) as t
      from hr_leave
      where organization_id = p_org and status in ('approved', 'pending')
      group by leave_type
    ) q;
  select coalesce(jsonb_agg(b order by b->>'remaining' desc), '[]'::jsonb) into balances
    from (
      select jsonb_build_object(
        'employeeId', e.id,
        'employeeName', p.display_name,
        'department', d.name,
        'leaveType', en.leave_type,
        'entitlement', en.days,
        'used', coalesce((
          select sum(hr_workdays(l.starts_on, l.ends_on))
          from hr_leave l
          where l.employee_id = e.id and l.leave_type = en.leave_type
            and l.status = 'approved' and extract(year from l.starts_on) = en.year
        ), 0),
        'remaining', greatest(en.days - coalesce((
          select sum(hr_workdays(l.starts_on, l.ends_on))
          from hr_leave l
          where l.employee_id = e.id and l.leave_type = en.leave_type
            and l.status = 'approved' and extract(year from l.starts_on) = en.year
        ), 0), 0)
      ) as b
      from hr_leave_entitlements en
      join hr_employees e on e.id = en.employee_id and e.organization_id = en.organization_id
      join profiles p on p.id = e.user_id
      left join departments d on d.id = e.department_id and d.organization_id = e.organization_id
      where en.organization_id = p_org
      order by p.display_name, en.leave_type
      limit 200
    ) q;
  return jsonb_build_object('summary', summary, 'byType', by_type,
    'balances', balances);
end $$;
notify pgrst, 'reload schema';
commit;
