begin;
-- Efficient lists, date-range calculations and reminder scans.
create index hr_employee_dates on public.hr_employees(organization_id,starts_on,ends_on);
create index hr_employee_role on public.hr_employees(role_id);
create index hr_employee_department on public.hr_employees(department_id);
create index hr_leave_dates on public.hr_leave(organization_id,status,starts_on,ends_on);
create index hr_documents_expiry on public.hr_documents(expires_on) where dismissed_at is null;
create index hr_review_due on public.hr_reviews(due_on) where status='pending';
create index hr_approval_lookup on public.hr_approval_steps(organization_id,kind,record_id,status);
create function public.hr_integrity() returns trigger language plpgsql set search_path=public as $$begin
 if tg_table_name='hr_employees' then
 if tg_op='UPDATE' and (old.birth_date is distinct from new.birth_date or old.starts_on is distinct from new.starts_on or old.ends_on is distinct from new.ends_on) then
 delete from calendar_events c using hr_milestones m where c.source='employee' and c.source_id=m.id and m.employee_id=new.id and c.ends_at>now();
 end if;
 if new.role_id is not null and exists(select 1 from organization_roles where id=new.role_id and definition->>'reportsToUserId'=new.user_id::text) then raise exception 'Employee cannot report to themselves' using errcode='22023';end if;
 elsif tg_table_name='hr_payroll_lines' then
 if exists(select 1 from hr_payroll where id=coalesce(new.payroll_id,old.payroll_id) and status='finalized') then raise exception 'Finalized payroll lines are immutable' using errcode='22023';end if;
 end if;return coalesce(new,old);
end $$;
create trigger hr_employee_integrity before insert or update on public.hr_employees for each row execute function public.hr_integrity();
create trigger hr_payroll_immutable before insert or update or delete on public.hr_payroll_lines for each row execute function public.hr_integrity();
create function public.hr_activity_detail(p_actor uuid,p_org uuid,p_id uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare a organization_activities;tbl text;perm text;r jsonb;actions jsonb:='[]';begin
 perform hr_require(p_actor,p_org,'activity.view');select * into a from organization_activities where organization_id=p_org and id=p_id;
 if not found then raise exception 'Activity not found' using errcode='P0002';end if;
 case a.subject_type
 when 'employees' then return jsonb_build_object('activity',to_jsonb(a),'details',hr_employee_stats(p_actor,p_org,a.subject_id),'actions',jsonb_build_array('view_profile','view_onboarding'));
 when 'calendar_event' then return jsonb_build_object('activity',to_jsonb(a),'details',hr_event_details(p_actor,p_org,a.subject_id),'actions',jsonb_build_array('view_event'));
 when 'payroll' then return jsonb_build_object('activity',to_jsonb(a),'details',hr_payroll_stats(p_actor,p_org,a.subject_id),'actions',case when workflow_has_permission(p_actor,p_org,'payroll.manage') then jsonb_build_array('review_timesheets','finalize') else '[]'::jsonb end);
 when 'leave' then tbl:='hr_leave';perm:='leave.approve';
 when 'attendance' then tbl:='hr_attendance';perm:='attendance.approve';
 when 'reviews' then tbl:='hr_reviews';perm:='performance.approve';
 when 'expenses' then tbl:='hr_expenses';perm:='expenses.approve';
 when 'documents' then tbl:='hr_documents';perm:='documents.manage';actions:='["request_update","dismiss"]';
 when 'interviews' then tbl:='hr_interviews';perm:='interviews.manage';actions:='["view_event"]';
 when 'celebrations' then tbl:='hr_celebrations';perm:='employees.view';
 else return jsonb_build_object('activity',to_jsonb(a),'details',null,'actions','[]'::jsonb);end case;
 perform hr_require(p_actor,p_org,perm);
 execute format('select to_jsonb(t) from %I t where id=$1 and organization_id=$2',tbl) into r using a.subject_id,p_org;
 if r->>'status'='pending' and exists(select 1 from hr_employees where id=(r->>'employee_id')::uuid and user_id<>p_actor) and (not exists(select 1 from hr_approval_steps where record_id=a.subject_id) or (select approver_id from hr_approval_steps where record_id=a.subject_id and status='pending' order by position limit 1)=p_actor) then actions:='["approve","decline"]';end if;
 return jsonb_build_object('activity',to_jsonb(a),'details',r,'actions',actions,'approvalSteps',coalesce((select jsonb_agg(to_jsonb(s) order by position) from hr_approval_steps s where record_id=a.subject_id and organization_id=p_org),'[]'));
end $$;
create function public.hr_trends(p_actor uuid,p_org uuid,p_date date default null) returns jsonb language plpgsql stable set search_path=public as $$
begin
 perform hr_require(p_actor,p_org,'workspace.view');p_date:=coalesce(p_date,hr_today(p_org));
 return jsonb_build_object('headcount', (select jsonb_agg(jsonb_build_object('date',day,'value',(select count(*) from hr_employees e where e.organization_id=p_org and e.starts_on<=day and (e.ends_on is null or e.ends_on>=day))) order by day) from (select (p_date-m*interval '1 month')::date as day from generate_series(0,5)m) dates),
 'attendance',(select jsonb_agg(jsonb_build_object('date',day,'present',(select count(*) from hr_attendance a where a.organization_id=p_org and a.date=day and a.status='approved' and a.state in ('present','late'))) order by day) from (select p_date-m as day from generate_series(0,6)m) dates));
end $$;
-- Reminder markers make repeated worker invocations idempotent.
create table public.hr_reminder_markers(key text primary key,created_at timestamptz not null default now());
alter table public.hr_reminder_markers enable row level security;revoke all on public.hr_reminder_markers from anon,authenticated;grant all on public.hr_reminder_markers to service_role;
alter function public.queue_notification_reminders() rename to queue_notification_reminders_before_hr;
create function public.queue_notification_reminders() returns void language plpgsql set search_path=public as $$
declare r record;u uuid;k text;inserted integer;begin
 perform queue_notification_reminders_before_hr();
 for r in select * from (
 select d.organization_id,d.id,'documents'::text kind,'Document expiring'::text title,'compliance'::text category,'documents.manage'::text permission,e.user_id,d.expires_on due from hr_documents d join hr_employees e on e.id=d.employee_id where d.dismissed_at is null and d.expires_on<=hr_today(d.organization_id)+7
 union all select p.organization_id,p.id,'payroll','Payroll closing','payroll','payroll.manage',null,p.closes_on from hr_payroll p where p.status='draft' and p.closes_on<=hr_today(p.organization_id)+3
 union all select v.organization_id,v.id,'reviews','Performance review due','employee','performance.approve',v.reviewer_user_id,v.due_on from hr_reviews v where v.status='pending' and v.due_on<=hr_today(v.organization_id)+7

 union all select e.organization_id,e.id,'employees','Employee starts today','employee','employees.manage',e.user_id,e.starts_on from hr_employees e where e.starts_on=hr_today(e.organization_id)
 union all select e.organization_id,e.id,'employees','Probation ending','employee','employees.manage',e.user_id,e.probation_ends_on from hr_employees e where e.probation_ends_on between hr_today(e.organization_id) and hr_today(e.organization_id)+7 and (e.ends_on is null or e.ends_on>=hr_today(e.organization_id))
 union all select e.organization_id,e.id,'employees','Salary review due','employee','employees.manage',e.user_id,e.salary_review_on from hr_employees e where e.salary_review_on between hr_today(e.organization_id) and hr_today(e.organization_id)+7 and (e.ends_on is null or e.ends_on>=hr_today(e.organization_id))
 union all select e.organization_id,e.id,'employees','Birthday today','employee','employees.manage',e.user_id,hr_today(e.organization_id) from hr_employees e where hr_observed_date(e.birth_date,extract(year from hr_today(e.organization_id))::integer)=hr_today(e.organization_id) and e.starts_on<=hr_today(e.organization_id) and (e.ends_on is null or e.ends_on>=hr_today(e.organization_id))
 union all select e.organization_id,e.id,'employees','Work anniversary today','employee','employees.manage',e.user_id,hr_today(e.organization_id) from hr_employees e where hr_observed_date(e.starts_on,extract(year from hr_today(e.organization_id))::integer)=hr_today(e.organization_id) and e.starts_on<hr_today(e.organization_id) and (e.ends_on is null or e.ends_on>=hr_today(e.organization_id))
 ) candidate where not exists(select 1 from hr_reminder_markers where key='hr-reminder:'||candidate.title||':'||candidate.id||':'||candidate.due||':'||hr_today(candidate.organization_id)) order by due,id limit 200
 loop
 k:='hr-reminder:'||r.title||':'||r.id||':'||r.due||':'||hr_today(r.organization_id);
 insert into hr_reminder_markers(key) values(k) on conflict do nothing;get diagnostics inserted=row_count;if inserted=0 then continue;end if;
 insert into organization_activities(organization_id,category,kind,title,summary,subject_type,subject_id,urgency) values(r.organization_id,r.category,'hr_reminder',r.title,'Due '||r.due,r.kind,r.id,case when r.due<hr_today(r.organization_id) then 'urgent' else 'attention' end);
 for u in select distinct user_id from organization_members where organization_id=r.organization_id and (user_id=r.user_id or workflow_has_permission(user_id,r.organization_id,r.permission)) loop
 perform queue_notification(r.organization_id,u,'hr.reminder',r.title,'A workspace item is due '||r.due||'. Open your workspace for details.',k||':'||u,'reminder',jsonb_build_object('resource',r.kind,'recordId',r.id));end loop;
 end loop;
 delete from hr_reminder_markers where created_at<now()-interval '90 days';
end $$;
create table public.hr_zoom_meetings(event_id uuid primary key references public.calendar_events(id) on delete cascade,organization_id uuid not null references public.organizations(id),state text not null default 'creating' check(state in ('creating','ready')),meeting_id text,created_at timestamptz not null default now());
alter table public.hr_zoom_meetings enable row level security;revoke all on public.hr_zoom_meetings from anon,authenticated;grant all on public.hr_zoom_meetings to service_role;
create function public.hr_claim_zoom(p_actor uuid,p_org uuid,p_event uuid) returns jsonb language plpgsql set search_path=public as $$
declare e calendar_events;begin
 perform hr_require(p_actor,p_org,'calendar.manage');select * into e from calendar_events where id=p_event and organization_id=p_org for update;
 if not found then raise exception 'Event not found' using errcode='P0002';end if;
 if e.meeting_url is not null then return jsonb_build_object('existingUrl',e.meeting_url);end if;
 if e.all_day or e.ends_at<=now() or e.ends_at-e.starts_at>interval '24 hours' then raise exception 'Zoom requires a future timed event of at most 24 hours' using errcode='22023';end if;
 if exists(select 1 from hr_zoom_meetings where event_id=p_event) then raise exception 'Meeting creation already requested; reconcile with Zoom before retrying' using errcode='40001';end if;
 insert into hr_zoom_meetings(event_id,organization_id) values(p_event,p_org);return to_jsonb(e);
end $$;
create function public.hr_finish_zoom(p_actor uuid,p_org uuid,p_event uuid,p_meeting text,p_url text) returns jsonb language plpgsql set search_path=public as $$
declare e calendar_events;begin
 perform hr_require(p_actor,p_org,'calendar.manage');select * into e from calendar_events where id=p_event and organization_id=p_org for update;
 if not found then raise exception 'Event not found' using errcode='P0002';end if;
 if e.meeting_url is not null then raise exception 'Event meeting changed during creation' using errcode='40001';end if;
 update hr_zoom_meetings set state='ready',meeting_id=p_meeting where event_id=p_event and organization_id=p_org;
 if not found then raise exception 'Meeting claim not found' using errcode='P0002';end if;
 update calendar_events set meeting_url=p_url where id=p_event;return jsonb_build_object('eventId',p_event,'meetingId',p_meeting,'meetingUrl',p_url);
end $$;
create or replace function public.prepare_department_icon_deletion(p_icon_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.department_icons; paths jsonb;
begin
 lock table public.employer_onboarding, public.departments, public.department_suggestions, public.hr_team_plans
   in share row exclusive mode;
 select * into target from public.department_icons where id = p_icon_id for update;
 if not found then return null; end if;
 if target.is_default then
   raise exception using errcode = '22023', message = 'Default icon cannot be deleted';
 end if;
 if exists (select 1 from public.hr_team_plans where icon_id = p_icon_id)
 or exists (select 1 from public.departments where icon_id = p_icon_id)
 or exists (select 1 from public.department_suggestions where icon_id = p_icon_id)
 or exists (select 1 from public.employer_onboarding o,
   lateral jsonb_array_elements(o.department_drafts) d
   where d->>'iconId' = p_icon_id::text) then
   raise exception using errcode = '23503', message = 'Icon is still in use';
 end if;
 update public.department_icons set is_active = false, deleted_at = coalesce(deleted_at, now())
 where id = p_icon_id;
 select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from (
   select target.storage_path as path where target.storage_path is not null
   union select storage_path from public.department_icon_uploads where icon_id = p_icon_id
 ) files;
 return paths;
end; $$;

create function public.hr_team_icon_guard() returns trigger language plpgsql set search_path=public as $$begin
 if new.icon_id is not null then perform 1 from department_icons where id=new.icon_id and is_active and deleted_at is null for share;if not found then raise exception 'Active icon required' using errcode='22023';end if;end if;return new;end $$;
create trigger hr_team_icon_guard before insert or update of icon_id on public.hr_team_plans for each row execute function public.hr_team_icon_guard();
create function public.hr_role_stats_batch(p_actor uuid,p_org uuid,p_ids uuid[]) returns jsonb language plpgsql stable set search_path=public as $$begin
 perform hr_require(p_actor,p_org,'roles.view');if cardinality(p_ids)>100 then raise exception 'Too many roles' using errcode='22023';end if;
 return coalesce((select jsonb_object_agg(id::text,hr_role_stats(p_actor,p_org,id)) from unnest(p_ids)id),'{}');end $$;
create function public.hr_activity_actions(p_actor uuid,p_org uuid,p_ids uuid[]) returns jsonb language plpgsql stable set search_path=public as $$
declare a organization_activities;perm text;status text;subject_user uuid;actions jsonb;result jsonb:='{}';begin
 perform hr_require(p_actor,p_org,'activity.view');if cardinality(p_ids)>100 then raise exception 'Too many activities' using errcode='22023';end if;
 for a in select * from organization_activities where organization_id=p_org and id=any(p_ids) loop
 actions:='[]';perm:=case a.subject_type when 'leave' then 'leave.approve' when 'attendance' then 'attendance.approve' when 'reviews' then 'performance.approve' when 'expenses' then 'expenses.approve' else null end;
 if perm is not null and workflow_has_permission(p_actor,p_org,perm) then
 execute format('select t.status,e.user_id from %I t join hr_employees e on e.id=t.employee_id where t.id=$1 and t.organization_id=$2','hr_'||a.subject_type) into status,subject_user using a.subject_id,p_org;
 if status='pending' and subject_user<>p_actor and (not exists(select 1 from hr_approval_steps where record_id=a.subject_id) or (select approver_id from hr_approval_steps where record_id=a.subject_id and status='pending' order by position limit 1)=p_actor) then actions:='["approve","decline"]';end if;
 elsif a.subject_type='documents' and workflow_has_permission(p_actor,p_org,'documents.manage') then actions:='["request_update","dismiss"]';
 elsif a.subject_type='employees' and workflow_has_permission(p_actor,p_org,'employees.view') then actions:='["view_profile","view_onboarding"]';
 elsif a.subject_type in ('interviews','calendar_event') and workflow_has_permission(p_actor,p_org,'calendar.view') then actions:='["view_event"]';
 elsif a.subject_type='payroll' and workflow_has_permission(p_actor,p_org,'payroll.view') then actions:='["view_payroll"]';end if;
 result:=result||jsonb_build_object(a.id::text,actions);
 end loop;return result;
end $$;
-- Team membership and role assignments are distinct from employment: job titles never silently grant access.
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'hr_%' or p.proname in ('queue_notification_reminders','queue_notification_reminders_before_hr')) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';commit;
