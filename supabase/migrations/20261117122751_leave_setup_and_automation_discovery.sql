begin;

-- Default newly configured organisations to the toggle states in the design.
-- Existing rows are unchanged.
alter table public.leave_settings alter column accrue_by_hours set default true;

alter table public.leave_settings
  add column carry_forward_start_month integer,
  add column carry_forward_start_day integer,
  add column carry_forward_end_month integer,
  add column carry_forward_end_day integer;

-- Recurring month/day values accept February 29; validation does not depend
-- on the current year. Windows crossing December/January are supported.
create function public.leave_month_day_valid(p_month int,p_day int)
returns boolean language sql immutable security invoker set search_path=public as $$
  select case when p_month between 1 and 12 and p_day between 1 and 31
    then p_day <= extract(day from (make_date(2000,p_month,1)+interval '1 month - 1 day'))::int
    else false end
$$;
-- NOT VALID avoids rejecting a migration because of an old malformed setting;
-- inserts and updates must satisfy these constraints immediately.
alter table public.leave_settings add constraint leave_settings_year_dates_valid
  check (public.leave_month_day_valid(leave_year_start_month,leave_year_start_day)
    and public.leave_month_day_valid(leave_year_end_month,leave_year_end_day)) not valid;
alter table public.leave_settings add constraint leave_settings_carry_dates_valid
  check ((carry_forward_start_month is null and carry_forward_start_day is null
    and carry_forward_end_month is null and carry_forward_end_day is null)
    or (carry_forward_start_month is not null and carry_forward_start_day is not null
      and carry_forward_end_month is not null and carry_forward_end_day is not null
      and public.leave_month_day_valid(carry_forward_start_month,carry_forward_start_day)
      and public.leave_month_day_valid(carry_forward_end_month,carry_forward_end_day)));

create function public.leave_policy_detail(p_actor uuid,p_org uuid,p_policy uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
  perform hr_require(p_actor,p_org,'employees.view');
  select to_jsonb(lp) into result from leave_policies lp
    where lp.organization_id=p_org and lp.id=p_policy;
  if not found then raise exception 'Leave policy not found' using errcode='P0002'; end if;
  return result;
end $$;

create function public.leave_settings_get(p_actor uuid,p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
  perform hr_require(p_actor,p_org,'employees.view');
  select to_jsonb(s) || '{"isConfigured":true}'::jsonb into result
    from leave_settings s where s.organization_id=p_org;
  if found then return result; end if;
  return jsonb_build_object('organization_id',p_org,
    'leave_year_start_month',1,'leave_year_start_day',1,
    'leave_year_end_month',12,'leave_year_end_day',31,
    'pro_rate_new_starters',false,'accrue_by_hours',true,
    'track_public_holidays',false,'manager_notifications',true,
    'carry_forward_enabled',false,'carry_forward_start_month',null,
    'carry_forward_start_day',null,'carry_forward_end_month',null,
    'carry_forward_end_day',null,'updated_at',null,'isConfigured',false);
end $$;

create function public.leave_settings_save(p_actor uuid,p_org uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_row leave_settings; next_row leave_settings; payload jsonb;
begin
  perform hr_require(p_actor,p_org,'employees.manage');
  perform 1 from organizations where id=p_org for update;
  if p_data is null or jsonb_typeof(p_data)<>'object' then
    raise exception 'Leave settings must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(array[
    'leave_year_start_month','leave_year_start_day','leave_year_end_month','leave_year_end_day',
    'pro_rate_new_starters','accrue_by_hours','track_public_holidays','manager_notifications',
    'carry_forward_enabled','carry_forward_start_month','carry_forward_start_day',
    'carry_forward_end_month','carry_forward_end_day']))) then
    raise exception 'Unknown leave settings fields' using errcode='22023'; end if;
  insert into leave_settings(organization_id) values(p_org) on conflict(organization_id) do nothing;
  select to_jsonb(s) into payload from leave_settings s where s.organization_id=p_org;
  select * into next_row from jsonb_populate_record(null::leave_settings,payload || p_data);
  insert into leave_settings(organization_id,leave_year_start_month,leave_year_start_day,
    leave_year_end_month,leave_year_end_day,pro_rate_new_starters,accrue_by_hours,
    track_public_holidays,manager_notifications,carry_forward_enabled,
    carry_forward_start_month,carry_forward_start_day,carry_forward_end_month,carry_forward_end_day)
  values(p_org,next_row.leave_year_start_month,next_row.leave_year_start_day,
    next_row.leave_year_end_month,next_row.leave_year_end_day,next_row.pro_rate_new_starters,
    next_row.accrue_by_hours,next_row.track_public_holidays,next_row.manager_notifications,
    next_row.carry_forward_enabled,next_row.carry_forward_start_month,next_row.carry_forward_start_day,
    next_row.carry_forward_end_month,next_row.carry_forward_end_day)
  on conflict(organization_id) do update set
    leave_year_start_month=excluded.leave_year_start_month,leave_year_start_day=excluded.leave_year_start_day,
    leave_year_end_month=excluded.leave_year_end_month,leave_year_end_day=excluded.leave_year_end_day,
    pro_rate_new_starters=excluded.pro_rate_new_starters,accrue_by_hours=excluded.accrue_by_hours,
    track_public_holidays=excluded.track_public_holidays,manager_notifications=excluded.manager_notifications,
    carry_forward_enabled=excluded.carry_forward_enabled,
    carry_forward_start_month=excluded.carry_forward_start_month,carry_forward_start_day=excluded.carry_forward_start_day,
    carry_forward_end_month=excluded.carry_forward_end_month,carry_forward_end_day=excluded.carry_forward_end_day,
    updated_at=now()
  returning * into current_row;
  return to_jsonb(current_row) || '{"isConfigured":true}'::jsonb;
end $$;

create index job_stage_automations_org_enabled_created_idx
  on public.job_stage_automations(organization_id,is_enabled,created_at,id);

create function public.recruitment_automation_list(
  p_actor uuid,p_org uuid,p_enabled boolean default null,p_job uuid default null,
  p_stage uuid default null,p_kind text default null,p_limit int default null,p_offset int default 0
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
  perform recruitment_require(p_actor,p_org,'jobs.view');
  if (p_limit is not null and (p_limit<1 or p_limit>200)) or p_offset<0 then
    raise exception 'Invalid automation pagination' using errcode='22023'; end if;
  if p_kind is not null and p_kind not in ('email','calendar','reviewer_assignment','ai_evaluation','custom') then
    raise exception 'Unknown automation kind' using errcode='22023'; end if;
  with filtered as materialized (
    select a.id,a.kind,a.label,a.is_enabled,a.config,a.created_at,
      s.id as stage_id,s.name as stage_name,s.category as stage_category,
      s.display_order as stage_order,j.id as job_id,j.title as job_title
    from job_stage_automations a
    join job_pipeline_stages s on s.id=a.stage_id and s.organization_id=a.organization_id
    join jobs j on j.id=s.job_id and j.organization_id=s.organization_id
    where a.organization_id=p_org
      and (p_enabled is null or a.is_enabled=p_enabled)
      and (p_job is null or j.id=p_job) and (p_stage is null or s.id=p_stage)
      and (p_kind is null or a.kind=p_kind)
  ), page as (
    select * from filtered order by created_at desc,id desc limit p_limit offset p_offset
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from page x),'[]'::jsonb),
    'total',(select count(*) from filtered),'limit',p_limit,'offset',p_offset) into result;
  return result;
end $$;

-- Existing tables remain service-only with RLS enabled; new RPCs cannot be
-- called directly by anon/authenticated clients with a supplied actor ID.
revoke all on function public.leave_month_day_valid(int,int) from public,anon,authenticated;
revoke all on function public.leave_policy_detail(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_settings_get(uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_settings_save(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.recruitment_automation_list(uuid,uuid,boolean,uuid,uuid,text,int,int) from public,anon,authenticated;
grant execute on function public.leave_month_day_valid(int,int) to service_role;
grant execute on function public.leave_policy_detail(uuid,uuid,uuid) to service_role;
grant execute on function public.leave_settings_get(uuid,uuid) to service_role;
grant execute on function public.leave_settings_save(uuid,uuid,jsonb) to service_role;
grant execute on function public.recruitment_automation_list(uuid,uuid,boolean,uuid,uuid,text,int,int) to service_role;
notify pgrst,'reload schema';
commit;
