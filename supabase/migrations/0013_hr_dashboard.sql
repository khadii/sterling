begin;
-- Employer-managed HR records, not a second employee registration flow.
insert into public.permissions(id,description) values ('payroll.view','View payroll'),('payroll.manage','Prepare and finalize payroll'),('documents.manage','Manage employee document compliance') on conflict do nothing;
create function public.hr_owner_permissions() returns trigger language plpgsql set search_path=public as $$begin
 if new.key='organisation_owner' then insert into organization_role_permissions(organization_role_id,permission_id) select new.id,id from permissions where id in ('employees.view','employees.manage','leave.approve','attendance.approve','performance.approve','expenses.approve','payroll.view','payroll.manage','documents.manage') on conflict do nothing;end if;return new;end $$;
create trigger hr_owner_permissions after insert on public.organization_roles for each row execute function public.hr_owner_permissions();
insert into public.organization_role_permissions(organization_role_id,permission_id) select r.id,p.id from public.organization_roles r cross join public.permissions p where r.key='organisation_owner' and p.id in ('employees.view','employees.manage','leave.approve','attendance.approve','performance.approve','expenses.approve','payroll.view','payroll.manage','documents.manage') on conflict do nothing;
create table public.hr_employees (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 user_id uuid not null, department_id uuid not null, role_id uuid, starts_on date not null, ends_on date,
 birth_date date, probation_ends_on date, salary_review_on date, annual_salary numeric(16,2) check(annual_salary>=0), currency text not null check(currency ~ '^[A-Z]{3}$'),
 revision integer not null default 0, created_at timestamptz not null default now(), unique(id,organization_id), unique(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id),
 foreign key(department_id,organization_id) references public.departments(id,organization_id),
 foreign key(role_id,organization_id) references public.organization_roles(id,organization_id),
 check(ends_on is null or ends_on>=starts_on),check(birth_date is null or birth_date<starts_on)
);
create table public.hr_onboarding (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, employee_id uuid not null,
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array'),buddy_user_id uuid,
 hardware_status text not null default 'pending' check(hardware_status in ('pending','ordered','delivered')),
 welcome_pack_status text not null default 'pending' check(welcome_pack_status in ('pending','prepared','delivered')),hr_notes text,
 unique(employee_id), foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id),
 foreign key(organization_id,buddy_user_id) references public.organization_members(organization_id,user_id)
);
create table public.hr_leave_entitlements (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,year integer not null check(year between 2000 and 2200),
 leave_type text not null check(leave_type in ('annual','sick','study')),days numeric(5,1) not null check(days between 0 and 366),
 unique(employee_id,year,leave_type),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
create table public.hr_leave (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,
 leave_type text not null check(leave_type in ('annual','sick','study')),starts_on date not null,ends_on date not null,reason text,
 status text not null default 'pending' check(status in ('pending','approved','declined','cancelled')),decision_reason text,decided_by uuid,decided_at timestamptz,
 created_by uuid not null, created_at timestamptz not null default now(),
 foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id),check(ends_on>=starts_on and ends_on-starts_on<=366),check(extract(year from starts_on)=extract(year from ends_on))
);
create table public.hr_attendance (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,date date not null,
 state text not null check(state in ('present','late','absent')),hours numeric(4,2) not null check(hours between 0 and 24),
 status text not null default 'pending' check(status in ('pending','approved','declined')),decision_reason text,decided_by uuid,decided_at timestamptz,
 created_by uuid not null,created_at timestamptz not null default now(),unique(employee_id,date),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
create table public.hr_reviews (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,reviewer_user_id uuid not null,due_on date not null,notes text,
 status text not null default 'pending' check(status in ('pending','approved','declined')),decision_reason text,decided_by uuid,decided_at timestamptz,created_by uuid not null,created_at timestamptz not null default now(),
 foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id),foreign key(organization_id,reviewer_user_id) references public.organization_members(organization_id,user_id)
);
create table public.hr_expenses (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,amount numeric(16,2) not null check(amount>0),currency text not null check(currency~'^[A-Z]{3}$'),description text not null,
 status text not null default 'pending' check(status in ('pending','approved','declined')),decision_reason text,decided_by uuid,decided_at timestamptz,created_by uuid not null,created_at timestamptz not null default now(),
 foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
create table public.hr_documents (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,name text not null,expires_on date not null,
 update_requested_at timestamptz,dismissed_at timestamptz,created_at timestamptz not null default now(),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
create table public.hr_requisitions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),role_id uuid not null,team_id uuid,positions integer not null check(positions>0),
 status text not null default 'open' check(status in ('open','closed')),created_at timestamptz not null default now(),
 foreign key(role_id,organization_id) references public.organization_roles(id,organization_id),foreign key(team_id,organization_id) references public.organization_teams(id,organization_id)
);
create table public.hr_interviews (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),role_id uuid not null,event_id uuid not null references public.calendar_events(id),
 candidate_name text not null,candidate_email text not null,created_at timestamptz not null default now(),unique(event_id),foreign key(role_id,organization_id) references public.organization_roles(id,organization_id)
);
create table public.hr_department_plans (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,department_id uuid not null unique,lead_user_id uuid,annual_budget numeric(16,2) not null check(annual_budget>=0),currency text not null check(currency~'^[A-Z]{3}$'),
 operational_status text not null check(operational_status in ('stable','growing','at_capacity','optimized')),
 foreign key(department_id,organization_id) references public.departments(id,organization_id),foreign key(organization_id,lead_user_id) references public.organization_members(organization_id,user_id)
);
create table public.hr_team_plans (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,team_id uuid not null unique,planned_capacity integer not null check(planned_capacity>=0),icon_id uuid references public.department_icons(id),foreign key(team_id,organization_id) references public.organization_teams(id,organization_id)
);
create table public.hr_payroll (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),starts_on date not null,ends_on date not null,closes_on date not null,currency text not null check(currency~'^[A-Z]{3}$'),
 status text not null default 'draft' check(status in ('draft','finalized')), finalized_at timestamptz,finalized_by uuid,created_at timestamptz not null default now(),unique(id,organization_id),check(ends_on>=starts_on and ends_on-starts_on<=366)
);
create table public.hr_payroll_lines (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,payroll_id uuid not null,employee_id uuid not null,gross numeric(16,2) not null check(gross>=0),deductions numeric(16,2) not null check(deductions>=0 and deductions<=gross),
 unique(payroll_id,employee_id),foreign key(payroll_id,organization_id) references public.hr_payroll(id,organization_id),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
create table public.hr_celebrations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,message text not null,created_by uuid not null,created_at timestamptz not null default now(),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id)
);
-- Historical staffing assignments prevent transfers rewriting past department totals.
create table public.hr_staffing_history (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,employee_id uuid not null,department_id uuid not null,role_id uuid,effective_from date not null,effective_to date,
 unique(employee_id,effective_from),foreign key(employee_id,organization_id) references public.hr_employees(id,organization_id),
 foreign key(department_id,organization_id) references public.departments(id,organization_id),foreign key(role_id,organization_id) references public.organization_roles(id,organization_id),check(effective_to is null or effective_to>effective_from)
);
create function public.hr_record_staffing() returns trigger language plpgsql set search_path=public as $$
declare d date;begin
 if tg_op='INSERT' then insert into hr_staffing_history(organization_id,employee_id,department_id,role_id,effective_from) values(new.organization_id,new.id,new.department_id,new.role_id,new.starts_on);return new;end if;
 if old.starts_on is distinct from new.starts_on then
 if (select count(*) from hr_staffing_history where employee_id=new.id)>1 then raise exception 'Employment start cannot change after a transfer' using errcode='22023';end if;
 update hr_staffing_history set effective_from=new.starts_on where employee_id=new.id;
 end if;
 if old.department_id is distinct from new.department_id or old.role_id is distinct from new.role_id then
 d:=greatest(hr_today(new.organization_id),new.starts_on);
 update hr_staffing_history set effective_to=d where employee_id=new.id and effective_to is null and effective_from<d;
 insert into hr_staffing_history(organization_id,employee_id,department_id,role_id,effective_from) values(new.organization_id,new.id,new.department_id,new.role_id,d) on conflict(employee_id,effective_from) do update set department_id=excluded.department_id,role_id=excluded.role_id;
 end if;return new;
end $$;
create trigger hr_staffing_history after insert or update on public.hr_employees for each row execute function public.hr_record_staffing();
-- HR tables are service-only. Every RPC checks workspace membership and permissions.
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'hr_%' loop
 execute format('alter table public.%I enable row level security',t.tablename);
 execute format('revoke all on public.%I from anon,authenticated',t.tablename);
 execute format('grant all on public.%I to service_role',t.tablename);
 execute format('create index on public.%I(organization_id)',t.tablename);
 end loop;
end $$;
create function public.hr_require(p_actor uuid,p_org uuid,p_permission text) returns void language plpgsql set search_path=public as $$begin
 if not workflow_has_permission(p_actor,p_org,p_permission) then raise exception 'Permission required: %',p_permission using errcode='42501';end if;
end $$;
create function public.hr_today(p_org uuid) returns date language sql stable set search_path=public as $$select (now() at time zone coalesce((select timezone from organization_settings where organization_id=p_org),'UTC'))::date$$;
create function public.hr_observed_date(p_date date,p_year integer) returns date language sql immutable as $$select case when p_date is null then null else make_date(p_year,extract(month from p_date)::integer,1)+least(extract(day from p_date)::integer,extract(day from(make_date(p_year,extract(month from p_date)::integer,1)+interval '1 month - 1 day'))::integer)-1 end$$;
create function public.hr_workdays(p_from date,p_to date) returns integer language sql immutable as $$
 select count(*)::integer from generate_series(0,p_to-p_from) n where extract(isodow from p_from+n)<6;
$$;
-- A percentage is undefined without a denominator: return null and its inputs, not a fabricated zero.
create function public.hr_percent(p_n numeric,p_d numeric) returns numeric language sql immutable as $$select round(p_n*100/nullif(p_d,0),2)$$;
create function public.hr_mutate(p_actor uuid,p_org uuid,p_kind text,p_id uuid,p_data jsonb) returns jsonb language plpgsql set search_path=public as $$
declare tbl text; perm text; allowed text[]; d jsonb; effective jsonb; before_row jsonb; result jsonb; cols text; vals text; sets text; emp hr_employees; field text; recipient uuid; tz text; event_kind text; from_date date; to_date date;
begin
 perform 1 from organizations where id=p_org for update;
 case p_kind
 when 'employees' then tbl:='hr_employees';perm:='employees.manage';allowed:=array['user_id','department_id','role_id','starts_on','ends_on','birth_date','probation_ends_on','salary_review_on','annual_salary','currency'];
 when 'onboarding' then tbl:='hr_onboarding';perm:='employees.manage';allowed:=array['employee_id','checklist','buddy_user_id','hardware_status','welcome_pack_status','hr_notes'];
 when 'leave' then tbl:='hr_leave';perm:='employees.manage';allowed:=array['employee_id','leave_type','starts_on','ends_on','reason'];
 when 'attendance' then tbl:='hr_attendance';perm:='employees.manage';allowed:=array['employee_id','date','state','hours'];
 when 'reviews' then tbl:='hr_reviews';perm:='employees.manage';allowed:=array['employee_id','reviewer_user_id','due_on','notes'];
 when 'expenses' then tbl:='hr_expenses';perm:='employees.manage';allowed:=array['employee_id','amount','currency','description'];
 when 'documents' then tbl:='hr_documents';perm:='documents.manage';allowed:=array['employee_id','name','expires_on'];
 when 'interviews' then tbl:='hr_interviews';perm:='interviews.manage';allowed:=array['role_id','event_id','candidate_name','candidate_email'];
 when 'requisitions' then tbl:='hr_requisitions';perm:='roles.manage';allowed:=array['role_id','team_id','positions'];
 when 'department-plans' then tbl:='hr_department_plans';perm:='departments.manage';allowed:=array['department_id','lead_user_id','annual_budget','currency','operational_status'];
 when 'team-plans' then tbl:='hr_team_plans';perm:='teams.manage';allowed:=array['team_id','planned_capacity','icon_id'];
 when 'entitlements' then tbl:='hr_leave_entitlements';perm:='employees.manage';allowed:=array['employee_id','year','leave_type','days'];
 when 'payroll' then tbl:='hr_payroll';perm:='payroll.manage';allowed:=array['starts_on','ends_on','closes_on','currency'];
 when 'payroll-lines' then tbl:='hr_payroll_lines';perm:='payroll.manage';allowed:=array['payroll_id','employee_id','gross','deductions'];
 when 'celebrations' then tbl:='hr_celebrations';perm:='employees.view';allowed:=array['employee_id','message'];
 else raise exception 'Unknown HR resource' using errcode='22023';end case;
 perform hr_require(p_actor,p_org,perm);
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'Invalid fields' using errcode='22023';end if;
 d:=p_data;
 if p_id is not null then
 execute format('select to_jsonb(t) from %I t where id=$1 and organization_id=$2 for update',tbl) into before_row using p_id,p_org;
 if before_row is null then raise exception 'Not found' using errcode='P0002';end if;
 if before_row->>'status' in ('approved','finalized','cancelled','declined','closed') then raise exception 'Finalized record cannot be edited' using errcode='22023';end if;
 end if;
 effective:=coalesce(before_row,'{}'::jsonb)||d;
 if p_id is not null and exists(select 1 from jsonb_object_keys(d) k where k in ('user_id','employee_id','payroll_id','department_id','team_id','role_id','event_id') and k not in (case when p_kind='employees' then 'department_id' else '' end,case when p_kind='employees' then 'role_id' else '' end) and before_row->k is distinct from d->k) then raise exception 'Record identity cannot change' using errcode='22023';end if;
 if p_kind='employees' and effective->>'role_id' is not null and not exists(select 1 from organization_roles where id=(effective->>'role_id')::uuid and organization_id=p_org and department_id=(effective->>'department_id')::uuid) then raise exception 'Role must belong to employee department' using errcode='22023';end if;
 if p_kind='leave' and hr_workdays((effective->>'starts_on')::date,(effective->>'ends_on')::date)=0 then raise exception 'Leave has no working days' using errcode='22023';end if;
 if p_kind='interviews' and not exists(select 1 from calendar_events where id=(effective->>'event_id')::uuid and organization_id=p_org and kind='interview') then raise exception 'Interview event not found' using errcode='22023';end if;
 if p_kind='payroll-lines' and not exists(select 1 from hr_payroll p join hr_employees e on e.id=(effective->>'employee_id')::uuid and e.organization_id=p.organization_id where p.id=(effective->>'payroll_id')::uuid and p.organization_id=p_org and p.status='draft' and p.currency=e.currency and e.starts_on<=p.ends_on and (e.ends_on is null or e.ends_on>=p.starts_on)) then raise exception 'Payroll locked, currency mismatch or inactive employee' using errcode='22023';end if;
 if p_kind='requisitions' and effective->>'team_id' is not null and not exists(select 1 from organization_teams t join organization_roles r on r.department_id=t.department_id and r.organization_id=t.organization_id where t.id=(effective->>'team_id')::uuid and r.id=(effective->>'role_id')::uuid and t.organization_id=p_org) then raise exception 'Role and team departments differ' using errcode='22023';end if;
 if p_kind='attendance' and effective->>'state'='absent' and (effective->>'hours')::numeric<>0 then raise exception 'Absent attendance must have zero hours' using errcode='22023';end if;
 if p_kind in ('leave','attendance','reviews') and not exists(select 1 from hr_employees e where e.id=(effective->>'employee_id')::uuid and e.organization_id=p_org and e.starts_on<=coalesce((effective->>'starts_on')::date,(effective->>'date')::date,(effective->>'due_on')::date) and (e.ends_on is null or e.ends_on>=coalesce((effective->>'ends_on')::date,(effective->>'date')::date,(effective->>'due_on')::date))) then raise exception 'Date outside employment' using errcode='22023';end if;
 if p_kind='entitlements' and (effective->>'days')::numeric<(select coalesce(sum(hr_workdays(starts_on,ends_on)),0) from hr_leave where employee_id=(effective->>'employee_id')::uuid and status='approved' and leave_type=effective->>'leave_type' and extract(year from starts_on)=(effective->>'year')::integer) then raise exception 'Entitlement below approved leave' using errcode='22023';end if;
 if p_kind='payroll' and p_id is not null and exists(select 1 from hr_payroll_lines where payroll_id=p_id) and (before_row->>'starts_on' is distinct from effective->>'starts_on' or before_row->>'ends_on' is distinct from effective->>'ends_on' or before_row->>'currency' is distinct from effective->>'currency') then raise exception 'Payroll period and currency are locked once lines exist' using errcode='22023';end if;
 if p_kind='team-plans' and effective->>'icon_id' is not null and not exists(select 1 from department_icons where id=(effective->>'icon_id')::uuid and is_active) then raise exception 'Active icon required' using errcode='22023';end if;
 if p_id is null then
 d:=d||jsonb_build_object('organization_id',p_org);
 if p_kind in ('leave','attendance','reviews','expenses','celebrations') then d:=d||jsonb_build_object('created_by',p_actor);end if;
 select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into cols,vals from jsonb_object_keys(d) k;
 execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I,$1) r returning to_jsonb(%I.*)',tbl,cols,vals,tbl,tbl) into result using d;
 else
 if d='{}' then return before_row;end if;
 select string_agg(format('%I=r.%I',k,k),',') into sets from jsonb_object_keys(d) k;
 execute format('update %I t set %s from jsonb_populate_record(null::%I,$1) r where t.id=$2 and t.organization_id=$3 returning to_jsonb(t)',tbl,sets,tbl) into result using d,p_id,p_org;
 end if;
 recipient:=case when p_kind='employees' then (result->>'user_id')::uuid else (select user_id from hr_employees where id=(result->>'employee_id')::uuid and organization_id=p_org) end;
 if p_kind in ('employees','leave','attendance','expenses','reviews','documents','interviews','payroll','celebrations') then
 insert into organization_activities(organization_id,category,kind,title,summary,actor_id,subject_type,subject_id,available_actions)
 values(p_org,case when p_kind='documents' then 'compliance' when p_kind='payroll' then 'payroll' when p_kind='interviews' then 'recruitment' else 'employee' end,
 'hr_'||p_kind||case when p_id is null then '_created' else '_updated' end,initcap(p_kind)||case when p_id is null then ' added' else ' updated' end,
 'Open the record for details',p_actor,p_kind,(result->>'id')::uuid,'[]');
 end if;
 if recipient is not null and p_kind in ('employees','leave','reviews','documents','celebrations') then
 perform queue_notification(p_org,recipient,'hr.'||p_kind,'Huppr workspace update',case when p_kind='celebrations' then result->>'message' else 'Your '||p_kind||' record has been updated. Open your workspace for details.' end,gen_random_uuid()::text,case when p_kind='celebrations' then 'activity' else 'essential' end);
 end if;
 -- Source events are created in the same transaction. Their rich details stay permission protected.
 select coalesce(timezone,'UTC') into tz from organization_settings where organization_id=p_org;tz:=coalesce(tz,'UTC');
 if p_kind in ('employees','reviews') then
 event_kind:=case when p_kind='employees' then 'onboarding' else 'performance_review' end;
 from_date:=case when p_kind='employees' then (result->>'starts_on')::date else (result->>'due_on')::date end;
 insert into calendar_events(organization_id,kind,source,source_id,title,starts_at,ends_at,timezone,all_day,organizer_id,created_by)
 values(p_org,event_kind,case when p_kind='employees' then 'employee' else 'performance' end,(result->>'id')::uuid,
 case when p_kind='employees' then coalesce((select display_name from profiles where id=recipient),'Employee')||' first day' else 'Performance review' end,from_date::timestamp at time zone tz,(from_date+1)::timestamp at time zone tz,tz,true,p_actor,p_actor)
 on conflict(organization_id,source,source_id) where source<>'manual' and source_id is not null do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 end if;
 return result;
end $$;
create function public.hr_decide(p_actor uuid,p_org uuid,p_kind text,p_ids uuid[],p_status text,p_reason text default null) returns jsonb language plpgsql set search_path=public as $$
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
 if entitlement is null or used+hr_workdays((r->>'starts_on')::date,(r->>'ends_on')::date)>entitlement then raise exception 'Insufficient leave entitlement' using errcode='22023';end if;
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
create function public.hr_action(p_actor uuid,p_org uuid,p_kind text,p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql set search_path=public as $$
declare r jsonb;v_user uuid;p hr_payroll;event calendar_events;v_attendees jsonb;
begin
 perform 1 from organizations where id=p_org for update;
 if p_kind='documents' then
 perform hr_require(p_actor,p_org,'documents.manage');
 select to_jsonb(d),e.user_id into r,v_user from hr_documents d join hr_employees e on e.id=d.employee_id where d.id=p_id and d.organization_id=p_org;
 if r is null then raise exception 'Document not found' using errcode='P0002';end if;
 if p_action='request-update' then
 update hr_documents set update_requested_at=now(),dismissed_at=null where id=p_id returning to_jsonb(hr_documents.*) into r;
 perform queue_notification(p_org,v_user,'hr.document.update','Document update required','Please update your '||(r->>'name')||' document. Open the workspace for details.','document-update:'||p_id||':'||current_date);
 elsif p_action='dismiss' then update hr_documents set dismissed_at=now() where id=p_id returning to_jsonb(hr_documents.*) into r;
 else raise exception 'Invalid document action' using errcode='22023';end if;
 elsif p_kind='payroll' and p_action='finalize' then
 perform hr_require(p_actor,p_org,'payroll.manage');
 select * into p from hr_payroll where id=p_id and organization_id=p_org for update;
 if not found then raise exception 'Payroll not found' using errcode='P0002';end if;
 if p.status='finalized' then return to_jsonb(p);end if;
 if not exists(select 1 from hr_payroll_lines where payroll_id=p_id) then raise exception 'Payroll has no lines' using errcode='22023';end if;
 if exists(select 1 from hr_employees e where e.organization_id=p_org and e.currency=p.currency and e.starts_on<=p.ends_on and (e.ends_on is null or e.ends_on>=p.starts_on) and not exists(select 1 from hr_payroll_lines l where l.payroll_id=p_id and l.employee_id=e.id)) then raise exception 'Missing employee payroll lines' using errcode='22023';end if;
 if exists(select 1 from hr_payroll other where other.organization_id=p_org and other.currency=p.currency and other.status='finalized' and other.id<>p_id and other.starts_on<=p.ends_on and other.ends_on>=p.starts_on) then raise exception 'A finalized payroll already covers this period and currency' using errcode='22023';end if;
 if exists(select 1 from hr_attendance a join hr_employees e on e.id=a.employee_id where a.organization_id=p_org and e.currency=p.currency and a.date between p.starts_on and p.ends_on and a.status<>'approved') then raise exception 'Unapproved timesheets remain' using errcode='22023';end if;
 update hr_payroll set status='finalized',finalized_at=now(),finalized_by=p_actor where id=p_id returning to_jsonb(hr_payroll.*) into r;
 insert into organization_activities(organization_id,category,kind,title,actor_id,subject_type,subject_id) values(p_org,'payroll','payroll_finalized','Payroll finalized',p_actor,'payroll',p_id);
 for v_user in select e.user_id from hr_payroll_lines l join hr_employees e on e.id=l.employee_id where l.payroll_id=p_id loop perform queue_notification(p_org,v_user,'hr.payroll.finalized','Payroll record finalized','Your payroll record has been finalized. Open the workspace for details.','payroll-finalized:'||p_id||':'||v_user);end loop;
 elsif p_kind='requisitions' and p_action='close' then
 perform hr_require(p_actor,p_org,'roles.manage');update hr_requisitions set status='closed' where id=p_id and organization_id=p_org returning to_jsonb(hr_requisitions.*) into r;
 if r is null then raise exception 'Requisition not found' using errcode='P0002';end if;
 elsif p_kind='calendar' and p_action='rsvp' then
 perform hr_require(p_actor,p_org,'calendar.view');
 if p_data->>'response' not in ('pending','accepted','declined') then raise exception 'Invalid RSVP' using errcode='22023';end if;
 select * into event from calendar_events where id=p_id and organization_id=p_org for update;
 if not found then raise exception 'Event not found' using errcode='P0002';end if;
 if not exists(select 1 from jsonb_array_elements(event.attendees) a where a->>'userId'=p_actor::text) then raise exception 'Not an attendee' using errcode='42501';end if;
 select jsonb_agg(case when a->>'userId'=p_actor::text then a||jsonb_build_object('response',p_data->>'response') else a end) into v_attendees from jsonb_array_elements(event.attendees) a;
 update calendar_events set attendees=v_attendees where id=p_id returning to_jsonb(calendar_events.*) into r;
 else raise exception 'Unknown action' using errcode='22023';end if;
 return r;
end $$;
create function public.hr_metrics(p_actor uuid,p_org uuid,p_date date default null) returns jsonb language plpgsql stable set search_path=public as $$
declare d date;tz text;result jsonb;
begin
 perform hr_require(p_actor,p_org,'workspace.view');
 select coalesce(timezone,'UTC') into tz from organization_settings where organization_id=p_org;tz:=coalesce(tz,'UTC');d:=coalesce(p_date,(now() at time zone tz)::date);
 with active as (select e.id,e.organization_id,e.user_id,h.department_id,h.role_id,e.starts_on,e.ends_on,e.annual_salary,e.currency from hr_employees e join hr_staffing_history h on h.employee_id=e.id and h.effective_from<=d and (h.effective_to is null or h.effective_to>d) where e.organization_id=p_org and e.starts_on<=d and (e.ends_on is null or e.ends_on>=d)),
 previous as (select count(*) n from hr_employees where organization_id=p_org and starts_on<=(d-interval '1 month')::date and (ends_on is null or ends_on>=(d-interval '1 month')::date)),
 dept as (select dep.id,dep.name,dep.description,plan.lead_user_id,plan.operational_status,plan.annual_budget,plan.currency,
 (select count(*) from active e where e.department_id=dep.id) headcount,
 (select count(*) from hr_employees e where e.organization_id=p_org and exists(select 1 from hr_staffing_history h where h.employee_id=e.id and h.department_id=dep.id and h.effective_from<=(d-interval '1 month')::date and (h.effective_to is null or h.effective_to>(d-interval '1 month')::date)) and e.starts_on<=(d-interval '1 month')::date and (e.ends_on is null or e.ends_on>=(d-interval '1 month')::date)) previous_headcount,
 (select count(*) from organization_teams t where t.department_id=dep.id) subteams,
 (select count(*) from hr_attendance a join active e on e.id=a.employee_id where e.department_id=dep.id and a.date=d and a.status='approved' and a.state in ('present','late')) present,
 (select coalesce(sum(e.annual_salary),0) from active e where e.department_id=dep.id and e.currency=plan.currency) salary,
 (select count(*) from active e where e.department_id=dep.id and (e.annual_salary is null or e.currency is distinct from plan.currency)) salary_missing,
 (select coalesce(sum(greatest(q.positions-(select count(*) from active e where e.role_id=r.id),0)),0) from organization_roles r join lateral (select coalesce(sum(positions),0)::integer positions from hr_requisitions where role_id=r.id and status='open') q on true where r.department_id=dep.id) open_roles
 from departments dep left join hr_department_plans plan on plan.department_id=dep.id where dep.organization_id=p_org and not dep.is_archived),
 teams as (select t.*,plan.planned_capacity,plan.icon_id,
 (select count(*) from organization_team_members m join active e on e.user_id=m.user_id and e.organization_id=m.organization_id where m.team_id=t.id) filled
 from organization_teams t left join hr_team_plans plan on plan.team_id=t.id where t.organization_id=p_org)
 select jsonb_build_object('date',d,'timezone',tz,
 'summary',jsonb_build_object('headcount',(select count(*) from active),'previousHeadcount',(select n from previous),'headcountChange',(select count(*) from active)-(select n from previous),'headcountGrowthPercent',hr_percent((select count(*) from active)-(select n from previous),(select n from previous)),
 'departments',(select count(*) from dept),'subteams',(select count(*) from teams),'openRoles',(select coalesce(sum(open_roles),0) from dept),
 'onLeaveToday',(select count(distinct employee_id) from hr_leave where organization_id=p_org and status='approved' and d between starts_on and ends_on),
 'pendingLeaveRequests',(select count(*) from hr_leave where organization_id=p_org and status='pending'),
 'startersToday',(select count(*) from active where starts_on=d),
 'reviewsDueThisWeek',(select count(*) from hr_reviews where organization_id=p_org and status='pending' and due_on>=date_trunc('week',d)::date and due_on<date_trunc('week',d)::date+7),
 'interviewsToday',(select count(*) from calendar_events where organization_id=p_org and kind='interview' and starts_at<(d+1)::timestamp at time zone tz and ends_at>d::timestamp at time zone tz),
 'expiringDocuments',(select count(*) from hr_documents where organization_id=p_org and dismissed_at is null and expires_on<=d+7),
 'pendingApprovals',(select count(*) from hr_leave where organization_id=p_org and status='pending')+(select count(*) from hr_attendance where organization_id=p_org and status='pending')+(select count(*) from hr_reviews where organization_id=p_org and status='pending')+(select count(*) from hr_expenses where organization_id=p_org and status='pending')),
 'departments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'headcount',headcount,'previousHeadcount',previous_headcount,'growthPercent',hr_percent(headcount-previous_headcount,previous_headcount),'subteams',subteams,'openRoles',open_roles,'attendancePercent',hr_percent(present,headcount),'leadUserId',lead_user_id,'lead',(select jsonb_build_object('userId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url) from profiles p where p.id=lead_user_id),'operationalStatus',operational_status,'annualBudget',annual_budget,'currency',currency,'annualSalaryTotal',case when workflow_has_permission(p_actor,p_org,'payroll.view') then salary else null end,'salaryRecordsMissingOrOtherCurrency',salary_missing,'budgetUtilizationPercent',case when d=hr_today(p_org) and salary_missing=0 then hr_percent(salary,annual_budget) else null end)) from dept),'[]'),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',id,'departmentId',department_id,'headcount',filled,'plannedCapacity',planned_capacity,'capacityPercent',hr_percent(filled,planned_capacity),'understaffed',case when planned_capacity is null then null else filled<planned_capacity end,'iconId',icon_id) order by filled desc,id) from teams),'[]'),
 'attendance',jsonb_build_object('present',(select count(*) from hr_attendance a join active e on e.id=a.employee_id where a.date=d and a.status='approved' and a.state='present'),'late',(select count(*) from hr_attendance a join active e on e.id=a.employee_id where a.date=d and a.status='approved' and a.state='late'),'absent',(select count(*) from hr_attendance a join active e on e.id=a.employee_id where a.date=d and a.status='approved' and a.state='absent'),'unrecorded',(select count(*) from active e where not exists(select 1 from hr_attendance a where a.employee_id=e.id and a.date=d and a.status='approved'))),
 'leaveOverview',jsonb_build_object('pending',(select count(*) from hr_leave where organization_id=p_org and status='pending'),'approved',(select count(*) from hr_leave where organization_id=p_org and status='approved'),'awayToday',(select count(distinct employee_id) from hr_leave where organization_id=p_org and status='approved' and d between starts_on and ends_on))) into result;
 return result;
end $$;
create function public.hr_role_stats(p_actor uuid,p_org uuid,p_role uuid,p_date date default null) returns jsonb language plpgsql stable set search_path=public as $$
declare filled integer;planned integer;result jsonb;begin
 p_date:=coalesce(p_date,hr_today(p_org));perform hr_require(p_actor,p_org,'roles.view');
 if not exists(select 1 from organization_roles where id=p_role and organization_id=p_org) then raise exception 'Role not found' using errcode='P0002';end if;
 select count(*) into filled from hr_employees where organization_id=p_org and exists(select 1 from hr_staffing_history h where h.employee_id=hr_employees.id and h.role_id=p_role and h.effective_from<=p_date and (h.effective_to is null or h.effective_to>p_date)) and starts_on<=p_date and (ends_on is null or ends_on>=p_date);
 select coalesce(sum(positions),0) into planned from hr_requisitions where organization_id=p_org and role_id=p_role and status='open';
 select jsonb_build_object('totalPositions',greatest(planned,filled),'plannedPositions',planned,'filledPositions',filled,'openPositions',greatest(planned-filled,0),
 'averageSalaryByCurrency',case when p_date=hr_today(p_org) and workflow_has_permission(p_actor,p_org,'payroll.view') then coalesce((select jsonb_agg(s) from (select currency,round(avg(annual_salary),2) as average,count(annual_salary) as "sampleSize" from hr_employees where organization_id=p_org and exists(select 1 from hr_staffing_history h where h.employee_id=hr_employees.id and h.role_id=p_role and h.effective_from<=p_date and (h.effective_to is null or h.effective_to>p_date)) and starts_on<=p_date and (ends_on is null or ends_on>=p_date) group by currency) s),'[]') else null end,
 'members',coalesce((select jsonb_agg(jsonb_build_object('employeeId',e.id,'userId',e.user_id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'startsOn',e.starts_on)) from hr_employees e join profiles p on p.id=e.user_id where e.organization_id=p_org and exists(select 1 from hr_staffing_history h where h.employee_id=e.id and h.role_id=p_role and h.effective_from<=p_date and (h.effective_to is null or h.effective_to>p_date)) and e.starts_on<=p_date and (e.ends_on is null or e.ends_on>=p_date)),'[]')) into result;
 return result;
end $$;
create function public.hr_employee_stats(p_actor uuid,p_org uuid,p_employee uuid,p_date date default null) returns jsonb language plpgsql stable set search_path=public as $$
declare e hr_employees;result jsonb;begin
 p_date:=coalesce(p_date,hr_today(p_org));perform hr_require(p_actor,p_org,'employees.view');select * into e from hr_employees where id=p_employee and organization_id=p_org;
 if not found then raise exception 'Employee not found' using errcode='P0002';end if;
 select jsonb_build_object('employee',(to_jsonb(e)-'annual_salary')||jsonb_build_object('annual_salary',case when workflow_has_permission(p_actor,p_org,'payroll.view') then e.annual_salary else null end,'display_name',(select display_name from profiles where id=e.user_id),'avatar_url',(select avatar_url from profiles where id=e.user_id),'department_name',(select name from departments where id=e.department_id),'role_name',(select name from organization_roles where id=e.role_id)),'leaveBalances',coalesce((select jsonb_agg(jsonb_build_object('leaveType',t.leave_type,'year',t.year,'entitled',t.days,'used',coalesce(u.days,0),'remaining',t.days-coalesce(u.days,0))) from hr_leave_entitlements t left join lateral(select sum(hr_workdays(starts_on,ends_on)) days from hr_leave where employee_id=e.id and status='approved' and leave_type=t.leave_type and extract(year from starts_on)=t.year) u on true where t.employee_id=e.id and t.year=extract(year from p_date)),'[]'),
 'onboarding',coalesce((select jsonb_build_object('checklist',o.checklist,'completedItems',(select count(*) from jsonb_array_elements(o.checklist) c where (c->>'completed')::boolean),'totalItems',jsonb_array_length(o.checklist),'progressPercent',case when jsonb_array_length(o.checklist)=0 then 0 else hr_percent((select count(*) from jsonb_array_elements(o.checklist) c where (c->>'completed')::boolean),jsonb_array_length(o.checklist)) end,'buddyUserId',o.buddy_user_id,'hardwareStatus',o.hardware_status,'welcomePackStatus',o.welcome_pack_status,'hrNotes',case when workflow_has_permission(p_actor,p_org,'employees.manage') then o.hr_notes else null end) from hr_onboarding o where o.employee_id=e.id),jsonb_build_object('checklist','[]'::jsonb,'completedItems',0,'totalItems',0,'progressPercent',0)),
 'attendance',jsonb_build_object('approvedDays',(select count(*) from hr_attendance where employee_id=e.id and status='approved' and date between date_trunc('month',p_date)::date and p_date),'approvedHours',(select coalesce(sum(hours),0) from hr_attendance where employee_id=e.id and status='approved' and date between date_trunc('month',p_date)::date and p_date)),
 'pendingReviews',(select count(*) from hr_reviews where employee_id=e.id and status='pending')) into result;
 return result;
end $$;
create function public.hr_payroll_stats(p_actor uuid,p_org uuid,p_id uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare p hr_payroll;begin
 perform hr_require(p_actor,p_org,'payroll.view');select * into p from hr_payroll where id=p_id and organization_id=p_org;
 if not found then raise exception 'Payroll not found' using errcode='P0002';end if;
 return to_jsonb(p)||jsonb_build_object('grossTotal',(select coalesce(sum(gross),0) from hr_payroll_lines where payroll_id=p_id),'deductionsTotal',(select coalesce(sum(deductions),0) from hr_payroll_lines where payroll_id=p_id),'netTotal',(select coalesce(sum(gross-deductions),0) from hr_payroll_lines where payroll_id=p_id),'employeeCount',(select count(*) from hr_payroll_lines where payroll_id=p_id),'pendingTimesheets',(select count(*) from hr_attendance a join hr_employees e on e.id=a.employee_id where a.organization_id=p_org and e.currency=p.currency and a.date between p.starts_on and p.ends_on and a.status<>'approved'),'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('net',gross-deductions)) from hr_payroll_lines l where payroll_id=p_id),'[]'));
end $$;
-- Limit function execution to backend service credentials.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hr_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
notify pgrst,'reload schema';
commit;
