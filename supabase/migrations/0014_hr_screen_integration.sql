begin;
create table public.hr_milestones (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,kind text not null check(kind in ('birthday','work_anniversary')),year integer not null,
 unique(employee_id,kind,year),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
alter table public.hr_milestones enable row level security;revoke all on public.hr_milestones from anon,authenticated;grant all on public.hr_milestones to service_role;
create function public.hr_sync_milestones(p_actor uuid,p_org uuid,p_from date,p_to date) returns void language plpgsql set search_path=public as $$
declare e hr_employees;yr integer;k text;dt date;source_date date;mid uuid;tz text;person text;
begin
 perform hr_require(p_actor,p_org,'calendar.view');
 if p_to<p_from or p_to-p_from>370 then raise exception 'Invalid range' using errcode='22023';end if;
 select coalesce(timezone,'UTC') into tz from organization_settings where organization_id=p_org;tz:=coalesce(tz,'UTC');
 delete from calendar_events c using hr_milestones m,hr_employees staff where c.organization_id=p_org and c.source='employee' and c.source_id=m.id and m.employee_id=staff.id and ((staff.ends_on is not null and (c.starts_at at time zone tz)::date>staff.ends_on) or (m.kind='birthday' and staff.birth_date is null));
 for e in select * from hr_employees where organization_id=p_org and starts_on<=p_to and (ends_on is null or ends_on>=p_from) loop
 select coalesce(display_name,'Team member') into person from profiles where id=e.user_id;
 for yr in select generate_series(extract(year from p_from)::integer,extract(year from p_to)::integer) loop
 foreach k in array array['birthday','work_anniversary'] loop
 source_date:=case when k='birthday' then e.birth_date else e.starts_on end;
 if source_date is null then continue;end if;
 -- February 29 anniversaries are observed February 28 in non-leap years.
 dt:=hr_observed_date(source_date,yr);
 if dt<p_from or dt>p_to or dt<e.starts_on or (e.ends_on is not null and dt>e.ends_on) or (k='work_anniversary' and yr<=extract(year from e.starts_on)) then continue;end if;
 insert into hr_milestones(organization_id,employee_id,kind,year) values(p_org,e.id,k,yr) on conflict(employee_id,kind,year) do update set year=excluded.year returning id into mid;
 insert into calendar_events(organization_id,kind,source,source_id,title,starts_at,ends_at,timezone,all_day,organizer_id,created_by)
 values(p_org,k,'employee',mid,person||case when k='birthday' then ' birthday' else ' work anniversary' end,dt::timestamp at time zone tz,(dt+1)::timestamp at time zone tz,tz,true,p_actor,p_actor)
 on conflict(organization_id,source,source_id) where source<>'manual' and source_id is not null do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,title=excluded.title
 where calendar_events.starts_at is distinct from excluded.starts_at or calendar_events.title is distinct from excluded.title;
 end loop;end loop;end loop;
end $$;
create function public.hr_widgets(p_actor uuid,p_org uuid,p_date date default null) returns jsonb language plpgsql stable set search_path=public as $$
begin
 p_date:=coalesce(p_date,hr_today(p_org));perform hr_require(p_actor,p_org,'workspace.view');
 return jsonb_build_object(
 'starters',coalesce((select jsonb_agg(jsonb_build_object('employeeId',e.id,'userId',e.user_id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'departmentId',e.department_id)) from hr_employees e join profiles p on p.id=e.user_id where e.organization_id=p_org and e.starts_on=p_date and (e.ends_on is null or e.ends_on>=p_date)),'[]'),
 'awayToday',coalesce((select jsonb_agg(jsonb_build_object('employeeId',e.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'endsOn',l.ends_on)) from hr_leave l join hr_employees e on e.id=l.employee_id join profiles p on p.id=e.user_id where l.organization_id=p_org and l.status='approved' and p_date between l.starts_on and l.ends_on),'[]'),
 'milestones',coalesce((select jsonb_agg(jsonb_build_object('employeeId',e.id,'displayName',p.display_name,'probationEndsOn',e.probation_ends_on,'salaryReviewOn',e.salary_review_on)) from hr_employees e join profiles p on p.id=e.user_id where e.organization_id=p_org and e.starts_on<=p_date and (e.ends_on is null or e.ends_on>=p_date) and (e.probation_ends_on between p_date and p_date+30 or e.salary_review_on between p_date and p_date+30)),'[]'),
 'upcomingBirthdaysAndAnniversaries',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'title',c.title,'startsAt',c.starts_at,'sourceId',m.employee_id)) from calendar_events c join hr_milestones m on m.id=c.source_id where c.organization_id=p_org and (c.starts_at at time zone c.timezone)::date between p_date and p_date+30),'[]'),
 'nextPayrollClose',case when workflow_has_permission(p_actor,p_org,'payroll.view') then (select jsonb_build_object('id',id,'closesOn',closes_on,'currency',currency) from hr_payroll where organization_id=p_org and status='draft' and closes_on>=p_date order by closes_on,id limit 1) else null end);
end $$;
create function public.hr_event_details(p_actor uuid,p_org uuid,p_event uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e calendar_events;employee uuid;result jsonb;
begin
 perform hr_require(p_actor,p_org,'calendar.view');select * into e from calendar_events where id=p_event and organization_id=p_org;
 if not found then raise exception 'Event not found' using errcode='P0002';end if;
 if not workflow_has_permission(p_actor,p_org,'employees.view') then return jsonb_build_object('restricted',true);end if;
 if e.source='employee' then
 select id into employee from hr_employees where id=e.source_id and organization_id=p_org;
 if employee is null then select employee_id into employee from hr_milestones where id=e.source_id and organization_id=p_org;end if;
 if employee is not null then return hr_employee_stats(p_actor,p_org,employee);end if;
 elsif e.source='leave' and workflow_has_permission(p_actor,p_org,'leave.approve') then
 select to_jsonb(l)||jsonb_build_object('employee',hr_employee_stats(p_actor,p_org,l.employee_id)) into result from hr_leave l where id=e.source_id and organization_id=p_org;return result;
 elsif e.kind='interview' and workflow_has_permission(p_actor,p_org,'interviews.manage') then
 select to_jsonb(i) into result from hr_interviews i where event_id=e.id and organization_id=p_org;return result;
 elsif e.source='performance' and workflow_has_permission(p_actor,p_org,'performance.approve') then
 select to_jsonb(r) into result from hr_reviews r where id=e.source_id and organization_id=p_org;return result;
 end if;return '{}'::jsonb;
end $$;
-- Ignore no-op event updates in the activity timeline.
create or replace function public.record_employer_feature_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='calendar_events' then
 if new.source<>'manual' then return new;end if;
 if tg_op='UPDATE' and (to_jsonb(old)-'updated_at')=(to_jsonb(new)-'updated_at') then return new;end if;
 insert into public.organization_activities(organization_id,category,kind,title,summary,actor_id,subject_type,subject_id)
 values(new.organization_id,'events',case when tg_op='INSERT' then 'calendar_event_created' else 'calendar_event_updated' end,new.title,'Calendar event changed',new.created_by,'calendar_event',new.id);
 elsif tg_table_name='departments' then
 insert into public.organization_activities(organization_id,category,kind,title,summary,subject_type,subject_id) values(new.organization_id,'employee','department_created',new.name,'Department created','department',new.id);
 end if;return new;
end $$;
create function public.hr_member_directory(p_actor uuid,p_org uuid,p_search text default '',p_page integer default 1,p_limit integer default 50) returns jsonb language plpgsql stable set search_path=public as $$
declare result jsonb;begin
 perform hr_require(p_actor,p_org,'workspace.view');
 if p_page<1 or p_limit not between 1 and 100 then raise exception 'Invalid pagination' using errcode='22023';end if;
 with matches as(select p.id,p.email,p.display_name,p.avatar_url,coalesce((select jsonb_agg(r.name) from organization_member_roles mr join organization_roles r on r.id=mr.organization_role_id where mr.organization_id=p_org and mr.user_id=p.id),'[]') roles
 from organization_members m join profiles p on p.id=m.user_id where m.organization_id=p_org and (p_search='' or position(lower(p_search) in lower(coalesce(p.display_name,'')||' '||p.email))>0 or exists(select 1 from organization_member_roles mr join organization_roles r on r.id=mr.organization_role_id where mr.organization_id=p_org and mr.user_id=p.id and position(lower(p_search) in lower(r.name))>0) or exists(select 1 from hr_employees e join organization_roles r on r.id=e.role_id where e.organization_id=p_org and e.user_id=p.id and position(lower(p_search) in lower(r.name))>0))),page as(select * from matches order by display_name nulls last,id offset (p_page-1)*p_limit limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'displayName',display_name,'avatarUrl',avatar_url,'roles',roles)) from page),'[]'),'total',(select count(*) from matches),'page',p_page,'limit',p_limit) into result;return result;
end $$;
create function public.hr_team_directory(p_actor uuid,p_org uuid,p_department uuid default null,p_search text default '',p_page integer default 1,p_limit integer default 50,p_sort text default 'size_desc') returns jsonb language plpgsql stable set search_path=public as $$
declare result jsonb;begin
 perform hr_require(p_actor,p_org,'teams.view');
 if p_sort not in ('size_desc','size_asc','name') then raise exception 'Invalid sort' using errcode='22023';end if;
 if p_page<1 or p_limit not between 1 and 100 then raise exception 'Invalid pagination' using errcode='22023';end if;
 with matches as(select t.*,p.planned_capacity,p.icon_id,(select count(*) from organization_team_members m join hr_employees e on e.organization_id=m.organization_id and e.user_id=m.user_id where m.team_id=t.id and e.starts_on<=hr_today(p_org) and (e.ends_on is null or e.ends_on>=hr_today(p_org))) size from organization_teams t left join hr_team_plans p on p.team_id=t.id where t.organization_id=p_org and (p_department is null or t.department_id=p_department) and (p_search='' or position(lower(p_search) in lower(t.name))>0)), page as(select * from matches order by case when p_sort='size_desc' then size end desc,case when p_sort='size_asc' then size end asc,case when p_sort='name' then name end asc,id offset (p_page-1)*p_limit limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'organizationId',organization_id,'departmentId',department_id,'name',name,'description',description,'membershipRevision',membership_revision,'createdAt',created_at,'updatedAt',updated_at,'memberCount',size,'plannedCapacity',planned_capacity,'capacityPercent',hr_percent(size,planned_capacity),'understaffed',case when planned_capacity is null then null else size<planned_capacity end,'iconId',icon_id,'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url)) from (select p.* from organization_team_members m join profiles p on p.id=m.user_id where m.team_id=page.id and exists(select 1 from hr_employees e where e.organization_id=m.organization_id and e.user_id=m.user_id and e.starts_on<=hr_today(p_org) and (e.ends_on is null or e.ends_on>=hr_today(p_org))) order by p.id limit 3)p),'[]')) order by case when p_sort='size_desc' then size end desc,case when p_sort='size_asc' then size end asc,case when p_sort='name' then name end asc,id) from page),'[]'),'total',(select count(*) from matches),'page',p_page,'limit',p_limit) into result;return result;
end $$;
create function public.hr_duplicate_role(p_actor uuid,p_org uuid,p_role uuid) returns jsonb language plpgsql set search_path=public as $$
declare r organization_roles;grants jsonb;begin
 perform hr_require(p_actor,p_org,'roles.manage');select * into r from organization_roles where id=p_role and organization_id=p_org;
 if not found then raise exception 'Role not found' using errcode='P0002';end if;
 select coalesce(jsonb_agg(permission_id),'[]') into grants from organization_role_permissions where organization_role_id=r.id;
 return workflow_mutate(p_actor,p_org,'role.save',null,r.definition||jsonb_build_object('name',left(r.name,100)||' copy '||substr(gen_random_uuid()::text,1,8),'departmentId',r.department_id,'status','draft','permissionIds',grants));
end $$;
create function public.hr_department_chart(p_actor uuid,p_org uuid,p_department uuid) returns jsonb language plpgsql stable set search_path=public as $$
begin
 perform hr_require(p_actor,p_org,'employees.view');
 if not exists(select 1 from departments where id=p_department and organization_id=p_org) then raise exception 'Department not found' using errcode='P0002';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('employeeId',e.id,'userId',e.user_id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'roleId',r.id,'roleName',r.name,'reportsToUserId',r.definition->>'reportsToUserId')) from hr_employees e join profiles p on p.id=e.user_id left join organization_roles r on r.id=e.role_id where e.organization_id=p_org and e.department_id=p_department and e.starts_on<=hr_today(p_org) and (e.ends_on is null or e.ends_on>=hr_today(p_org))),'[]'));
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hr_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';commit;
