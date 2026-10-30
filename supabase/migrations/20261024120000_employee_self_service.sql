begin;
-- Employees are ordinary workspace members: one Supabase auth user, one profile,
-- one organization_members row. public.hr_employees is the employer-managed
-- record for that same account, so the employee portal reuses the existing
-- sign-in, invitation and membership flow. Nothing here creates a second
-- registration path; it only adds the surface the portal reads and writes.

-- 1. Leave types used by the designed employee leave screens.
alter table public.hr_leave drop constraint if exists hr_leave_leave_type_check;
alter table public.hr_leave add constraint hr_leave_leave_type_check
  check (leave_type in ('annual','sick','study','personal','maternity','paternity','compassionate','unpaid'));
alter table public.hr_leave_entitlements drop constraint if exists hr_leave_entitlements_leave_type_check;
alter table public.hr_leave_entitlements add constraint hr_leave_entitlements_leave_type_check
  check (leave_type in ('annual','sick','study','personal','maternity','paternity','compassionate','unpaid'));

-- 2. Entitlement stays mandatory for annual/sick/study so a missing entitlement
--    still blocks a paid request. The extended types are enforced only when an
--    entitlement row has actually been configured for them.
create or replace function public.hr_decide_final(p_actor uuid,p_org uuid,p_kind text,p_ids uuid[],p_status text,p_reason text default null) returns jsonb language plpgsql set search_path=public as $$
declare tbl text;perm text;v_id uuid;r jsonb;emp hr_employees;used numeric;entitlement numeric;tz text;outcomes jsonb:='[]';
begin
 perform 1 from organizations where id=p_org for update;
 case p_kind when 'leave' then tbl:='hr_leave';perm:='leave.approve';when 'attendance' then tbl:='hr_attendance';perm:='attendance.approve';when 'reviews' then tbl:='hr_reviews';perm:='performance.approve';when 'expenses' then tbl:='hr_expenses';perm:='expenses.approve';else raise exception 'Invalid decision type' using errcode='22023';end case;
 perform hr_require(p_actor,p_org,perm);
 if p_status not in ('approved','declined','cancelled') or (p_status='cancelled' and p_kind<>'leave') or cardinality(p_ids) not between 1 and 100 then raise exception 'Invalid decision' using errcode='22023';end if;
 if p_status='declined' and nullif(btrim(p_reason),'') is null then raise exception 'Decline reason required' using errcode='22023';end if;
 foreach v_id in array p_ids loop
 execute format('select to_jsonb(t) from %I t where id=$1 and organization_id=$2 for update',tbl) into r using v_id,p_org;
 if r is null then raise exception 'Not found' using errcode='P0002';end if;
 if r->>'status'=p_status then outcomes:=outcomes||jsonb_build_array(r);continue;end if;
 if not(r->>'status'='pending' or (p_kind='leave' and r->>'status'='approved' and p_status='cancelled')) then raise exception 'Decision already final' using errcode='22023';end if;
 select * into emp from hr_employees where id=(r->>'employee_id')::uuid and organization_id=p_org;
 if emp.user_id=p_actor then raise exception 'Cannot approve own record' using errcode='42501';end if;
 if p_kind='leave' and p_status='approved' then
 if exists(select 1 from hr_leave l where l.employee_id=emp.id and l.status='approved' and l.starts_on<=(r->>'ends_on')::date and l.ends_on>=(r->>'starts_on')::date) then raise exception 'Overlapping approved leave' using errcode='22023';end if;
 select days into entitlement from hr_leave_entitlements where employee_id=emp.id and year=extract(year from (r->>'starts_on')::date) and leave_type=r->>'leave_type';
 select coalesce(sum(hr_workdays(starts_on,ends_on)),0) into used from hr_leave where employee_id=emp.id and status='approved' and extract(year from starts_on)=extract(year from (r->>'starts_on')::date) and leave_type=r->>'leave_type';
 if entitlement is null then
 if r->>'leave_type' in ('annual','sick','study') then raise exception 'Insufficient leave entitlement' using errcode='22023';end if;
 elsif used+hr_workdays((r->>'starts_on')::date,(r->>'ends_on')::date)>entitlement then raise exception 'Insufficient leave entitlement' using errcode='22023';end if;
 end if;
 execute format('update %I set status=$1,decision_reason=$2,decided_by=$3,decided_at=now() where id=$4 returning to_jsonb(%I.*)',tbl,tbl) into r using p_status,p_reason,p_actor,v_id;
 if p_kind='leave' then
 if p_status='approved' then
 select coalesce(timezone,'UTC') into tz from organization_settings where organization_id=p_org;tz:=coalesce(tz,'UTC');
 insert into calendar_events(organization_id,kind,source,source_id,title,starts_at,ends_at,timezone,all_day,organizer_id,created_by)
 values(p_org,'leave','leave',v_id,'Approved leave',(r->>'starts_on')::date::timestamp at time zone tz,((r->>'ends_on')::date+1)::timestamp at time zone tz,tz,true,p_actor,p_actor);
 elsif p_status='cancelled' then delete from calendar_events where organization_id=p_org and source='leave' and source_id=v_id;end if;
 end if;
 perform queue_notification(p_org,emp.user_id,'hr.'||p_kind||'.decision',initcap(p_kind)||' decision','Your request was '||p_status||'. Open your workspace to view the decision.',gen_random_uuid()::text);
 insert into organization_activities(organization_id,category,kind,title,actor_id,subject_type,subject_id) values(p_org,'employee','hr_decision',initcap(p_kind)||' '||p_status,p_actor,p_kind,v_id);
 outcomes:=outcomes||jsonb_build_array(r);
 end loop;
 return jsonb_build_object('items',outcomes);
end $$;

-- 3. Clock sessions, announcements and learning records the portal needs.
create table public.hr_attendance_sessions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null,
 work_date date not null,
 checked_in_at timestamptz not null default now(),
 checked_out_at timestamptz,
 break_started_at timestamptz,
 break_minutes numeric(6,2) not null default 0 check(break_minutes>=0),
 work_mode text not null default 'office' check(work_mode in ('office','remote','hybrid')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(employee_id,work_date),
 foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id) on delete cascade,
 check(checked_out_at is null or checked_out_at>=checked_in_at)
);
create table public.hr_announcements(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 category text not null default 'general' check(category in ('general','holiday','hr','event')),
 title text not null check(length(btrim(title)) between 2 and 160),
 body text not null check(length(btrim(body)) between 1 and 5000),
 published_at timestamptz not null default now(),
 expires_on date,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.hr_courses(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null check(length(btrim(title)) between 2 and 160),
 description text,
 duration_minutes integer not null default 0 check(duration_minutes between 0 and 100000),
 level text not null default 'beginner' check(level in ('beginner','intermediate','advanced')),
 is_published boolean not null default true,
 created_at timestamptz not null default now(),
 unique(id,organization_id)
);
create table public.hr_course_enrollments(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 employee_id uuid not null,
 course_id uuid not null,
 status text not null default 'not_started' check(status in ('not_started','in_progress','completed')),
 progress integer not null default 0 check(progress between 0 and 100),
 started_at timestamptz,
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(employee_id,course_id),
 foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id) on delete cascade,
 foreign key(course_id,organization_id) references public.hr_courses(id,organization_id) on delete cascade
);
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename in ('hr_attendance_sessions','hr_announcements','hr_courses','hr_course_enrollments') loop
 execute format('alter table public.%I enable row level security',t.tablename);
 execute format('revoke all on public.%I from anon,authenticated',t.tablename);
 execute format('grant all on public.%I to service_role',t.tablename);
 execute format('create index on public.%I(organization_id)',t.tablename);
 end loop;
end $$;
create index hr_attendance_sessions_employee_date on public.hr_attendance_sessions(employee_id,work_date desc);
create index hr_announcements_published on public.hr_announcements(organization_id,published_at desc);
create index hr_course_enrollments_employee on public.hr_course_enrollments(employee_id);

-- 4. Resolve the signed-in account to its own employee record. Every self-service
--    function starts here, so an account can only ever see its own rows.
create function public.hr_self_id(p_actor uuid,p_org uuid) returns uuid language plpgsql stable set search_path=public as $$
declare v uuid;begin
 select id into v from hr_employees where organization_id=p_org and user_id=p_actor;
 if v is null then raise exception 'No employee record for this account' using errcode='P0002';end if;
 return v;
end $$;
create function public.employee_profile(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 select jsonb_build_object(
 'employeeId',e.id,'userId',e.user_id,
 'displayName',coalesce(p.display_name,p.full_name,p.email),'fullName',coalesce(p.full_name,p.display_name),
 'avatarUrl',p.avatar_url,'email',p.email,
 'organizationId',p_org,'organizationName',(select name from organizations where id=p_org),
 'departmentId',e.department_id,'departmentName',(select name from departments where id=e.department_id),
 'roleId',e.role_id,'roleName',(select name from organization_roles where id=e.role_id),
 'managerUserId',(select lead_user_id from hr_department_plans where department_id=e.department_id and organization_id=p_org),
 'managerName',(select coalesce(pr.display_name,pr.full_name,pr.email) from hr_department_plans dp join profiles pr on pr.id=dp.lead_user_id where dp.department_id=e.department_id and dp.organization_id=p_org),
 'startsOn',e.starts_on,'endsOn',e.ends_on,'probationEndsOn',e.probation_ends_on,'birthDate',e.birth_date,
 'annualSalary',e.annual_salary,'currency',e.currency,
 'status',case when e.ends_on is not null and e.ends_on<hr_today(p_org) then 'inactive' else 'active' end,
 'date',hr_today(p_org),
 'timezone',coalesce((select timezone from organization_settings where organization_id=p_org),'UTC')
 ) into v from profiles p where p.id=e.user_id;
 return v;
end $$;
create function public.employee_leave(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;d date;yr integer;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);yr:=extract(year from d)::integer;
 select jsonb_build_object(
 'date',d,'year',yr,
 'balances',coalesce((select jsonb_agg(jsonb_build_object('leaveType',t.leave_type,'year',t.year,'entitled',t.days,'used',coalesce(u.used,0),'remaining',greatest(t.days-coalesce(u.used,0),0),'usedPercent',hr_percent(coalesce(u.used,0),t.days)) order by t.leave_type)
   from hr_leave_entitlements t
   left join lateral(select sum(hr_workdays(starts_on,ends_on)) used from hr_leave where employee_id=e.id and status='approved' and leave_type=t.leave_type and extract(year from starts_on)=t.year) u on true
   where t.employee_id=e.id and t.year=yr),'[]'),
 'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leaveType',l.leave_type,'startsOn',l.starts_on,'endsOn',l.ends_on,'days',hr_workdays(l.starts_on,l.ends_on),'status',l.status,'reason',l.reason,'requestedOn',l.created_at) order by l.starts_on)
   from hr_leave l where l.employee_id=e.id and l.status in ('approved','pending') and l.ends_on>=d),'[]'),
 'history',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leaveType',l.leave_type,'startsOn',l.starts_on,'endsOn',l.ends_on,'days',hr_workdays(l.starts_on,l.ends_on),'status',l.status,'reason',l.reason,'decisionReason',l.decision_reason,'requestedOn',l.created_at) order by l.starts_on desc)
   from hr_leave l where l.employee_id=e.id and l.ends_on<d),'[]'),
 'summary',jsonb_build_object(
  'pending',(select count(*) from hr_leave where employee_id=e.id and status='pending'),
  'approved',(select count(*) from hr_leave where employee_id=e.id and status='approved'),
  'declined',(select count(*) from hr_leave where employee_id=e.id and status='declined'),
  'daysUsed',coalesce((select sum(hr_workdays(starts_on,ends_on)) from hr_leave where employee_id=e.id and status='approved' and extract(year from starts_on)=yr),0))
 ) into v;
 return v;
end $$;
create function public.employee_leave_detail(p_actor uuid,p_org uuid,p_id uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 select to_jsonb(l)||jsonb_build_object(
  'days',hr_workdays(l.starts_on,l.ends_on),
  'approvalSteps',coalesce((select jsonb_agg(jsonb_build_object('position',s.position,'approverId',s.approver_id,'approverName',(select coalesce(pr.display_name,pr.full_name,pr.email) from profiles pr where pr.id=s.approver_id),'status',s.status,'decidedAt',s.decided_at) order by s.position) from hr_approval_steps s where s.record_id=l.id and s.kind='leave'),'[]'),
  'decidedByName',(select coalesce(pr.display_name,pr.full_name,pr.email) from profiles pr where pr.id=l.decided_by)
 ) into v from hr_leave l where l.id=p_id and l.employee_id=e.id and l.organization_id=p_org;
 if v is null then raise exception 'Leave request not found' using errcode='P0002';end if;
 return v;
end $$;
create function public.employee_leave_request(p_actor uuid,p_org uuid,p_data jsonb) returns jsonb language plpgsql set search_path=public as $$
declare e hr_employees;d jsonb;from_date date;to_date date;v jsonb;
begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('leave_type','starts_on','ends_on','reason')) then raise exception 'Invalid fields' using errcode='22023';end if;
 d:=p_data;
 if coalesce(d->>'leave_type','') not in ('annual','sick','study','personal','maternity','paternity','compassionate','unpaid') then raise exception 'Invalid leave type' using errcode='22023';end if;
 if coalesce(d->>'starts_on','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(d->>'ends_on','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Dates must use YYYY-MM-DD' using errcode='22023';end if;
 from_date:=(d->>'starts_on')::date;to_date:=(d->>'ends_on')::date;
 if to_date<from_date or extract(year from from_date)<>extract(year from to_date) then raise exception 'Leave must start and end in the same year' using errcode='22023';end if;
 if hr_workdays(from_date,to_date)=0 then raise exception 'Leave has no working days' using errcode='22023';end if;
 if e.starts_on>from_date or (e.ends_on is not null and e.ends_on<to_date) then raise exception 'Date outside employment' using errcode='22023';end if;
 if exists(select 1 from hr_leave l where l.employee_id=e.id and l.status in ('pending','approved') and l.starts_on<=to_date and l.ends_on>=from_date) then raise exception 'Overlapping leave request' using errcode='22023';end if;
 insert into hr_leave(organization_id,employee_id,leave_type,starts_on,ends_on,reason,created_by)
 values(p_org,e.id,d->>'leave_type',from_date,to_date,nullif(btrim(coalesce(d->>'reason','')),''),p_actor) returning to_jsonb(hr_leave.*) into v;
 return v||jsonb_build_object('days',hr_workdays(from_date,to_date));
end $$;
create function public.employee_leave_cancel(p_actor uuid,p_org uuid,p_id uuid) returns jsonb language plpgsql set search_path=public as $$
declare e hr_employees;r hr_leave;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 select * into r from hr_leave where id=p_id and employee_id=e.id and organization_id=p_org for update;
 if not found then raise exception 'Leave request not found' using errcode='P0002';end if;
 if r.status<>'pending' then raise exception 'Only a pending request can be cancelled' using errcode='22023';end if;
 delete from hr_approval_steps where record_id=p_id;
 delete from calendar_events where organization_id=p_org and source='leave' and source_id=p_id;
 delete from hr_leave where id=p_id returning to_jsonb(hr_leave.*) into v;
 return v;
end $$;
create function public.employee_attendance(p_actor uuid,p_org uuid,p_from date default null,p_to date default null) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;d date;f date;t date;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);f:=coalesce(p_from,d-30);t:=coalesce(p_to,d);
 if t<f or t-f>366 then raise exception 'Invalid date range' using errcode='22023';end if;
 select jsonb_build_object(
 'from',f,'to',t,'date',d,'targetHours',8,
 'today',(select jsonb_build_object('id',s.id,'checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,'breakStartedAt',s.break_started_at,'breakMinutes',s.break_minutes,'workMode',s.work_mode,'hours',round(extract(epoch from (coalesce(s.checked_out_at,now())-s.checked_in_at))/3600.0-coalesce(s.break_minutes,0)/60.0,2)) from hr_attendance_sessions s where s.employee_id=e.id and s.work_date=d),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'workDate',s.work_date,'checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,'breakMinutes',s.break_minutes,'workMode',s.work_mode,'hours',round(extract(epoch from (coalesce(s.checked_out_at,now())-s.checked_in_at))/3600.0-coalesce(s.break_minutes,0)/60.0,2)) order by s.work_date desc) from hr_attendance_sessions s where s.employee_id=e.id and s.work_date between f and t),'[]'),
 'records',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'date',a.date,'state',a.state,'hours',a.hours,'status',a.status,'decisionReason',a.decision_reason) order by a.date desc) from hr_attendance a where a.employee_id=e.id and a.date between f and t),'[]'),
 'summary',jsonb_build_object(
  'presentDays',(select count(*) from hr_attendance a where a.employee_id=e.id and a.status='approved' and a.state='present' and a.date between date_trunc('month',d)::date and d),
  'lateDays',(select count(*) from hr_attendance a where a.employee_id=e.id and a.status='approved' and a.state='late' and a.date between date_trunc('month',d)::date and d),
  'absentDays',(select count(*) from hr_attendance a where a.employee_id=e.id and a.status='approved' and a.state='absent' and a.date between date_trunc('month',d)::date and d))
 ) into v;
 return v;
end $$;
create function public.employee_clock(p_actor uuid,p_org uuid,p_action text,p_work_mode text default null) returns jsonb language plpgsql set search_path=public as $$
declare e hr_employees;d date;s hr_attendance_sessions;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 if p_action not in ('in','out','break-start','break-end') then raise exception 'Invalid clock action' using errcode='22023';end if;
 if p_work_mode is not null and p_work_mode not in ('office','remote','hybrid') then raise exception 'Invalid work mode' using errcode='22023';end if;
 d:=hr_today(p_org);
 select * into s from hr_attendance_sessions where employee_id=e.id and work_date=d for update;
 if p_action='in' then
 if found and s.checked_out_at is null then raise exception 'Already clocked in' using errcode='22023';end if;
 if found and s.checked_out_at is not null then raise exception 'Today is already closed' using errcode='22023';end if;
 insert into hr_attendance_sessions(organization_id,employee_id,work_date,work_mode) values(p_org,e.id,d,coalesce(p_work_mode,'office')) returning * into s;
 else
 if not found then raise exception 'Not clocked in today' using errcode='P0002';end if;
 if s.checked_out_at is not null then raise exception 'Today is already closed' using errcode='22023';end if;
 if p_action='out' then
 update hr_attendance_sessions set checked_out_at=now(),break_started_at=null,updated_at=now() where id=s.id returning * into s;
 elsif p_action='break-start' then
 if s.break_started_at is not null then raise exception 'Break already started' using errcode='22023';end if;
 update hr_attendance_sessions set break_started_at=now(),updated_at=now() where id=s.id returning * into s;
 else
 if s.break_started_at is null then raise exception 'Break has not started' using errcode='22023';end if;
 update hr_attendance_sessions set break_minutes=break_minutes+round(extract(epoch from (now()-s.break_started_at))/60.0,2),break_started_at=null,updated_at=now() where id=s.id returning * into s;
 end if;
 end if;
 v:=jsonb_build_object('id',s.id,'workDate',s.work_date,'checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,'breakStartedAt',s.break_started_at,'breakMinutes',s.break_minutes,'workMode',s.work_mode,'hours',round(extract(epoch from (coalesce(s.checked_out_at,now())-s.checked_in_at))/3600.0-coalesce(s.break_minutes,0)/60.0,2));
 if p_action='out' then
 insert into hr_attendance(organization_id,employee_id,date,state,hours,status,created_by)
 values(p_org,e.id,d,case when s.checked_in_at::time>'09:15' then 'late' else 'present' end,round(extract(epoch from (s.checked_out_at-s.checked_in_at))/3600.0-coalesce(s.break_minutes,0)/60.0,2),'pending',p_actor)
 on conflict(employee_id,date) do update set state=excluded.state,hours=excluded.hours,status='pending',created_by=excluded.created_by;
 end if;
 return v;
end $$;
create function public.employee_tasks(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;d date;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);
 select jsonb_build_object(
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'description',t.description,'projectId',t.project_id,'projectName',(select name from organization_projects where id=t.project_id),'priority',t.priority,'status',t.status,'startDate',t.start_date,'dueDate',t.due_date,'overdue',t.due_date<d and t.status<>'done','ownerName',(select coalesce(pr.display_name,pr.full_name,pr.email) from organization_projects pj join profiles pr on pr.id=pj.resource_manager_id where pj.id=t.project_id)) order by t.due_date)
   from organization_tasks t where t.organization_id=p_org and t.assignee_id=e.user_id),'[]'),
 'summary',jsonb_build_object(
  'total',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id),
  'todo',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='todo'),
  'inProgress',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='in_progress'),
  'completed',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='done'),
  'overdue',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status<>'done' and due_date<d))
 ) into v;
 return v;
end $$;
create function public.employee_task_status(p_actor uuid,p_org uuid,p_id uuid,p_status text) returns jsonb language plpgsql set search_path=public as $$
declare e hr_employees;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 if p_status not in ('todo','in_progress','done') then raise exception 'Invalid status' using errcode='22023';end if;
 update organization_tasks set status=p_status,updated_at=now() where id=p_id and organization_id=p_org and assignee_id=e.user_id returning to_jsonb(organization_tasks.*) into v;
 if v is null then raise exception 'Task not found' using errcode='P0002';end if;
 insert into organization_task_history(organization_id,task_id,actor_id,action,changes) values(p_org,p_id,p_actor,'status',jsonb_build_object('status',p_status));
 return v;
end $$;
create function public.employee_team(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;d date;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);
 select coalesce(jsonb_agg(jsonb_build_object(
  'employeeId',m.id,'userId',m.user_id,
  'displayName',coalesce(pr.display_name,pr.full_name,pr.email),'avatarUrl',pr.avatar_url,'email',pr.email,
  'roleName',(select name from organization_roles where id=m.role_id),'departmentName',(select name from departments where id=m.department_id),
  'teamId',(select tm.team_id from organization_team_members tm where tm.organization_id=p_org and tm.user_id=m.user_id limit 1),
  'status',case
    when exists(select 1 from hr_leave l where l.employee_id=m.id and l.status='approved' and d between l.starts_on and l.ends_on) then 'out_of_office'
    when exists(select 1 from calendar_events c where c.organization_id=p_org and c.starts_at<=now() and c.ends_at>now() and (c.organizer_id=m.user_id or c.attendees @> jsonb_build_array(m.user_id::text))) then 'in_meeting'
    when exists(select 1 from hr_attendance_sessions s where s.employee_id=m.id and s.work_date=d and s.checked_out_at is null) then coalesce('working_'||(select s.work_mode from hr_attendance_sessions s where s.employee_id=m.id and s.work_date=d),'working_office')
    else 'offline' end
 ) order by pr.display_name nulls last)
 ,'[]') into v
 from hr_employees m left join profiles pr on pr.id=m.user_id
 where m.organization_id=p_org and m.id<>e.id and m.starts_on<=d and (m.ends_on is null or m.ends_on>=d)
 and (m.department_id=e.department_id or exists(select 1 from organization_team_members x join organization_team_members y on y.team_id=x.team_id where x.organization_id=p_org and x.user_id=e.user_id and y.user_id=m.user_id));
 return jsonb_build_object('items',v);
end $$;
create function public.employee_documents(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare v_employee uuid;d date;begin
 v_employee:=hr_self_id(p_actor,p_org);
 d:=hr_today(p_org);
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'expiresOn',x.expires_on,'updateRequestedAt',x.update_requested_at,'dismissedAt',x.dismissed_at,'expiringSoon',x.expires_on<=d+30,'expired',x.expires_on<d) order by x.expires_on) from hr_documents x where x.employee_id=v_employee and x.organization_id=p_org),'[]'));
end $$;
create function public.employee_payslips(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare v_employee uuid;begin
 v_employee:=hr_self_id(p_actor,p_org);
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'payrollId',l.payroll_id,'periodStartsOn',p.starts_on,'periodEndsOn',p.ends_on,'currency',p.currency,'gross',l.gross,'deductions',l.deductions,'net',l.gross-l.deductions,'finalizedAt',p.finalized_at) order by p.starts_on desc) from hr_payroll_lines l join hr_payroll p on p.id=l.payroll_id where l.employee_id=v_employee and l.organization_id=p_org and p.status='finalized'),'[]'));
end $$;
create function public.employee_announcements(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare d date;begin
 perform hr_self_id(p_actor,p_org);
 d:=hr_today(p_org);
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'category',a.category,'publishedAt',a.published_at,'expiresOn',a.expires_on,'authorName',(select coalesce(pr.display_name,pr.full_name,pr.email) from profiles pr where pr.id=a.created_by)) order by a.published_at desc) from hr_announcements a where a.organization_id=p_org and a.published_at<=now() and (a.expires_on is null or a.expires_on>=d)),'[]'));
end $$;
create function public.employee_learning(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare v_employee uuid;begin
 v_employee:=hr_self_id(p_actor,p_org);
 return jsonb_build_object(
 'items',coalesce((select jsonb_agg(jsonb_build_object('courseId',c.id,'title',c.title,'description',c.description,'durationMinutes',c.duration_minutes,'level',c.level,'status',coalesce(n.status,'not_started'),'progress',coalesce(n.progress,0),'startedAt',n.started_at,'completedAt',n.completed_at) order by c.title) from hr_courses c left join hr_course_enrollments n on n.course_id=c.id and n.employee_id=v_employee where c.organization_id=p_org and c.is_published),'[]'),
 'summary',jsonb_build_object(
  'completed',(select count(*) from hr_course_enrollments where employee_id=v_employee and organization_id=p_org and status='completed'),
  'inProgress',(select count(*) from hr_course_enrollments where employee_id=v_employee and organization_id=p_org and status='in_progress'),
  'notStarted',(select count(*) from hr_course_enrollments where employee_id=v_employee and organization_id=p_org and status='not_started'),
  'totalMinutes',coalesce((select sum(c.duration_minutes) from hr_course_enrollments n join hr_courses c on c.id=n.course_id where n.employee_id=v_employee and n.organization_id=p_org and n.status='completed'),0),
  'overallProgress',(select round(avg(progress),0) from hr_course_enrollments where employee_id=v_employee and organization_id=p_org)
 ));
end $$;
create function public.employee_course_progress(p_actor uuid,p_org uuid,p_course uuid,p_progress integer) returns jsonb language plpgsql set search_path=public as $$
declare e hr_employees;v jsonb;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 if p_progress not between 0 and 100 then raise exception 'Invalid progress' using errcode='22023';end if;
 if not exists(select 1 from hr_courses where id=p_course and organization_id=p_org and is_published) then raise exception 'Course not found' using errcode='P0002';end if;
 insert into hr_course_enrollments(organization_id,employee_id,course_id,status,progress,started_at,completed_at)
 values(p_org,e.id,p_course,case when p_progress=0 then 'not_started' when p_progress=100 then 'completed' else 'in_progress' end,p_progress,case when p_progress>0 then now() end,case when p_progress=100 then now() end)
 on conflict(employee_id,course_id) do update set progress=excluded.progress,
  status=case when excluded.progress=0 then 'not_started' when excluded.progress=100 then 'completed' else 'in_progress' end,
  started_at=coalesce(hr_course_enrollments.started_at,excluded.started_at),
  completed_at=case when excluded.progress=100 then now() else null end,updated_at=now()
 returning to_jsonb(hr_course_enrollments.*) into v;
 return v;
end $$;
create function public.employee_calendar(p_actor uuid,p_org uuid,p_from date default null,p_to date default null) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;d date;f date;t date;tz text;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);f:=coalesce(p_from,d);t:=coalesce(p_to,d+30);
 tz:=coalesce((select timezone from organization_settings where organization_id=p_org),'UTC');
 if t<f or t-f>366 then raise exception 'Invalid date range' using errcode='22023';end if;
 return jsonb_build_object('from',f,'to',t,'items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'title',c.title,'description',c.description,'startsAt',c.starts_at,'endsAt',c.ends_at,'allDay',c.all_day,'location',c.location,'meetingUrl',c.meeting_url,'timezone',c.timezone) order by c.starts_at)
  from calendar_events c where c.organization_id=p_org and c.starts_at<(t+1)::timestamp at time zone tz and c.ends_at>f::timestamp at time zone tz and (c.organizer_id=e.user_id or c.attendees @> jsonb_build_array(e.user_id::text))),'[]'));
end $$;
create function public.employee_dashboard(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;p jsonb;d date;yr integer;tz text;begin
 select * into e from hr_employees where organization_id=p_org and user_id=p_actor;
 if not found then raise exception 'No employee record for this account' using errcode='P0002';end if;
 d:=hr_today(p_org);yr:=extract(year from d)::integer;
 tz:=coalesce((select timezone from organization_settings where organization_id=p_org),'UTC');
 p:=employee_profile(p_actor,p_org);
 return jsonb_build_object(
 'profile',p,
 'date',d,
 'announcements',coalesce((select jsonb_agg(x) from (select jsonb_build_object('id',a.id,'title',a.title,'body',a.body,'category',a.category,'publishedAt',a.published_at) x from hr_announcements a where a.organization_id=p_org and a.published_at<=now() and (a.expires_on is null or a.expires_on>=d) order by a.published_at desc limit 3) s),'[]'),
 'clock',(select jsonb_build_object('id',s.id,'checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,'breakStartedAt',s.break_started_at,'breakMinutes',s.break_minutes,'workMode',s.work_mode,'checkedIn',s.checked_out_at is null,'hours',round(extract(epoch from (coalesce(s.checked_out_at,now())-s.checked_in_at))/3600.0-coalesce(s.break_minutes,0)/60.0,2),'targetHours',8) from hr_attendance_sessions s where s.employee_id=e.id and s.work_date=d),
 'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'title',c.title,'startsAt',c.starts_at,'endsAt',c.ends_at,'allDay',c.all_day,'location',c.location,'meetingUrl',c.meeting_url) order by c.starts_at) from calendar_events c where c.organization_id=p_org and c.starts_at<(d+1)::timestamp at time zone tz and c.ends_at>d::timestamp at time zone tz and (c.organizer_id=e.user_id or c.attendees @> jsonb_build_array(e.user_id::text))),'[]'),
 'leave',jsonb_build_object(
  'balances',coalesce((select jsonb_agg(jsonb_build_object('leaveType',t.leave_type,'year',t.year,'entitled',t.days,'used',coalesce(u.used,0),'remaining',greatest(t.days-coalesce(u.used,0),0)) order by t.leave_type) from hr_leave_entitlements t left join lateral(select sum(hr_workdays(starts_on,ends_on)) used from hr_leave where employee_id=e.id and status='approved' and leave_type=t.leave_type and extract(year from starts_on)=t.year) u on true where t.employee_id=e.id and t.year=yr),'[]'),
  'pending',(select count(*) from hr_leave where employee_id=e.id and status='pending'),
  'nextLeave',(select jsonb_build_object('id',l.id,'leaveType',l.leave_type,'startsOn',l.starts_on,'endsOn',l.ends_on,'days',hr_workdays(l.starts_on,l.ends_on),'status',l.status) from hr_leave l where l.employee_id=e.id and l.status in ('approved','pending') and l.ends_on>=d order by l.starts_on limit 1)),
 'tasks',jsonb_build_object(
  'total',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id),
  'todo',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='todo'),
  'inProgress',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='in_progress'),
  'completed',(select count(*) from organization_tasks where organization_id=p_org and assignee_id=e.user_id and status='done'),
  'next',coalesce((select jsonb_agg(x) from (select jsonb_build_object('id',t.id,'name',t.name,'dueDate',t.due_date,'priority',t.priority,'status',t.status) x from organization_tasks t where t.organization_id=p_org and t.assignee_id=e.user_id and t.status<>'done' order by t.due_date limit 5) s),'[]')),
 'learning',jsonb_build_object(
  'completed',(select count(*) from hr_course_enrollments where employee_id=e.id and organization_id=p_org and status='completed'),
  'inProgress',(select count(*) from hr_course_enrollments where employee_id=e.id and organization_id=p_org and status='in_progress'),
  'overallProgress',(select round(avg(progress),0) from hr_course_enrollments where employee_id=e.id and organization_id=p_org)),
 'review',(select jsonb_build_object('id',r.id,'dueOn',r.due_on,'status',r.status,'reviewerName',(select coalesce(pr.display_name,pr.full_name,pr.email) from profiles pr where pr.id=r.reviewer_user_id)) from hr_reviews r where r.employee_id=e.id and r.organization_id=p_org and r.status='pending' order by r.due_on limit 1),
 'team',employee_team(p_actor,p_org)->'items'
 );
end $$;

-- 5. Service-role only, same contract as every other workspace function.
do $$declare f record;begin
 for f in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('hr_self_id','employee_profile','employee_leave','employee_leave_detail','employee_leave_request','employee_leave_cancel','employee_attendance','employee_clock','employee_tasks','employee_task_status','employee_team','employee_documents','employee_payslips','employee_announcements','employee_learning','employee_course_progress','employee_calendar','employee_dashboard') loop
 execute format('revoke all on function public.%s from public,anon,authenticated',f.sig);
 execute format('grant execute on function public.%s to service_role',f.sig);
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
