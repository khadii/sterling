-- Repair: hr_activity_actions declared a PL/pgSQL variable named "status" and
-- then compared hr_approval_steps.status against it. PostgreSQL could not tell
-- the two apart, so every call raised 'column reference "status" is ambiguous'.
-- The variable is renamed and the column is qualified.
begin;

create or replace function public.hr_activity_actions(p_actor uuid,p_org uuid,p_ids uuid[]) returns jsonb language plpgsql stable set search_path=public as $$
declare a organization_activities;perm text;v_status text;subject_user uuid;actions jsonb;result jsonb:='{}';begin
 perform hr_require(p_actor,p_org,'activity.view');if cardinality(p_ids)>100 then raise exception 'Too many activities' using errcode='22023';end if;
 for a in select * from organization_activities where organization_id=p_org and id=any(p_ids) loop
 actions:='[]';perm:=case a.subject_type when 'leave' then 'leave.approve' when 'attendance' then 'attendance.approve' when 'reviews' then 'performance.approve' when 'expenses' then 'expenses.approve' else null end;
 if perm is not null and workflow_has_permission(p_actor,p_org,perm) then
 execute format('select t.status,e.user_id from %I t join hr_employees e on e.id=t.employee_id where t.id=$1 and t.organization_id=$2','hr_'||a.subject_type) into v_status,subject_user using a.subject_id,p_org;
 if v_status='pending' and subject_user<>p_actor and (not exists(select 1 from hr_approval_steps s where s.record_id=a.subject_id) or (select s.approver_id from hr_approval_steps s where s.record_id=a.subject_id and s.status='pending' order by s.position limit 1)=p_actor) then actions:='["approve","decline"]';end if;
 elsif a.subject_type='documents' and workflow_has_permission(p_actor,p_org,'documents.manage') then actions:='["request_update","dismiss"]';
 elsif a.subject_type='employees' and workflow_has_permission(p_actor,p_org,'employees.view') then actions:='["view_profile","view_onboarding"]';
 elsif a.subject_type in ('interviews','calendar_event') and workflow_has_permission(p_actor,p_org,'calendar.view') then actions:='["view_event"]';
 elsif a.subject_type='payroll' and workflow_has_permission(p_actor,p_org,'payroll.view') then actions:='["view_payroll"]';end if;
 result:=result||jsonb_build_object(a.id::text,actions);
 end loop;return result;
end $$;

revoke all on function public.hr_activity_actions(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.hr_activity_actions(uuid,uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
