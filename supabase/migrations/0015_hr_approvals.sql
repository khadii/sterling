begin;
create table public.hr_approval_chains(organization_id uuid not null references public.organizations(id),kind text not null check(kind in ('leave','attendance','reviews','expenses')),approver_ids uuid[] not null,primary key(organization_id,kind));
create table public.hr_approval_steps(organization_id uuid not null references public.organizations(id),kind text not null,record_id uuid not null,position integer not null,approver_id uuid not null,status text not null default 'pending' check(status in ('pending','approved','declined')),decided_at timestamptz,primary key(record_id,position));
alter table public.hr_approval_chains enable row level security;alter table public.hr_approval_steps enable row level security;
revoke all on public.hr_approval_chains,public.hr_approval_steps from anon,authenticated;grant all on public.hr_approval_chains,public.hr_approval_steps to service_role;
create function public.hr_set_approval_chain(p_actor uuid,p_org uuid,p_kind text,p_approvers uuid[]) returns jsonb language plpgsql set search_path=public as $$
declare perm text;current_row jsonb;begin
 perform 1 from organizations where id=p_org for update;perform hr_require(p_actor,p_org,'employees.manage');
 perm:=case p_kind when 'leave' then 'leave.approve' when 'attendance' then 'attendance.approve' when 'reviews' then 'performance.approve' when 'expenses' then 'expenses.approve' else null end;
 if perm is null or cardinality(p_approvers)>10 or cardinality(p_approvers)<>(select count(distinct x) from unnest(p_approvers)x) then raise exception 'Invalid approval chain' using errcode='22023';end if;
 if exists(select 1 from unnest(p_approvers) a where not workflow_has_permission(a,p_org,perm)) then raise exception 'Approvers require matching workspace permissions' using errcode='22023';end if;
 insert into hr_approval_chains values(p_org,p_kind,p_approvers) on conflict(organization_id,kind) do update set approver_ids=excluded.approver_ids;return jsonb_build_object('kind',p_kind,'approverIds',p_approvers);
end $$;
create function public.hr_capture_approval_chain() returns trigger language plpgsql set search_path=public as $$
declare k text:=substr(tg_table_name,4);employee_user uuid;begin
 select user_id into employee_user from hr_employees where id=new.employee_id;
 if exists(select 1 from hr_approval_chains where organization_id=new.organization_id and kind=k and employee_user=any(approver_ids)) then raise exception 'Approval chain includes request subject; select a different approver' using errcode='22023';end if;
 insert into hr_approval_steps(organization_id,kind,record_id,position,approver_id) select new.organization_id,k,new.id,a.n,a.user_id from hr_approval_chains c cross join lateral unnest(c.approver_ids) with ordinality a(user_id,n) where c.organization_id=new.organization_id and c.kind=k;
 if exists(select 1 from hr_approval_steps where record_id=new.id) then perform queue_notification(new.organization_id,(select approver_id from hr_approval_steps where record_id=new.id order by position limit 1),'hr.approval','Approval required','A request is awaiting your decision.','approval:'||new.id||':initial');end if;return new;
end $$;
create trigger hr_leave_approval_chain after insert on public.hr_leave for each row execute function public.hr_capture_approval_chain();
create trigger hr_attendance_approval_chain after insert on public.hr_attendance for each row execute function public.hr_capture_approval_chain();
create trigger hr_reviews_approval_chain after insert on public.hr_reviews for each row execute function public.hr_capture_approval_chain();
create trigger hr_expenses_approval_chain after insert on public.hr_expenses for each row execute function public.hr_capture_approval_chain();
alter function public.hr_decide(uuid,uuid,text,uuid[],text,text) rename to hr_decide_final;
create function public.hr_decide(p_actor uuid,p_org uuid,p_kind text,p_ids uuid[],p_status text,p_reason text default null) returns jsonb language plpgsql set search_path=public as $$
declare v_id uuid;step hr_approval_steps;outcomes jsonb:='[]';perm text;current_row jsonb;begin
 perform 1 from organizations where id=p_org for update;
 perm:=case p_kind when 'leave' then 'leave.approve' when 'attendance' then 'attendance.approve' when 'reviews' then 'performance.approve' when 'expenses' then 'expenses.approve' else null end;
 if perm is null or cardinality(p_ids) not between 1 and 100 or p_status not in ('approved','declined','cancelled') then raise exception 'Invalid decision' using errcode='22023';end if;
 perform hr_require(p_actor,p_org,perm);
 foreach v_id in array p_ids loop
 execute format('select to_jsonb(t) from %I t where id=$1 and organization_id=$2','hr_'||p_kind) into current_row using v_id,p_org;
 if current_row is null then raise exception 'Not found' using errcode='P0002';end if;
 if current_row->>'status'<>'pending' then
 outcomes:=outcomes||(hr_decide_final(p_actor,p_org,p_kind,array[v_id],p_status,p_reason)->'items');continue;
 end if;
 if p_status='approved' and exists(select 1 from hr_approval_steps where record_id=v_id and approver_id=p_actor and status='approved') then
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',v_id,'status','pending','approvalRecorded',true));continue;end if;
 select * into step from hr_approval_steps where organization_id=p_org and record_id=v_id and kind=p_kind and status='pending' order by position limit 1 for update;
 if found and p_status<>'cancelled' then
 if step.approver_id<>p_actor then raise exception 'Awaiting another approver' using errcode='42501';end if;
 if p_status='declined' and nullif(btrim(p_reason),'') is null then raise exception 'Decline reason required' using errcode='22023';end if;
 update hr_approval_steps set status=p_status,decided_at=now() where record_id=v_id and position=step.position;
 if p_status='approved' and exists(select 1 from hr_approval_steps where record_id=v_id and status='pending') then
 perform queue_notification(p_org,(select approver_id from hr_approval_steps where record_id=v_id and status='pending' order by position limit 1),'hr.approval','Approval required','A request is awaiting your decision.','approval:'||v_id||':'||step.position);
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',v_id,'status','pending','approvalRecorded',true));continue;
 end if;
 end if;
 outcomes:=outcomes||(hr_decide_final(p_actor,p_org,p_kind,array[v_id],p_status,p_reason)->'items');
 end loop;return jsonb_build_object('items',outcomes);
end $$;
create function public.hr_document_updates(p_actor uuid,p_org uuid,p_ids uuid[]) returns jsonb language plpgsql set search_path=public as $$
declare v_id uuid;results jsonb:='[]';begin
 perform hr_require(p_actor,p_org,'documents.manage');if cardinality(p_ids) not between 1 and 100 then raise exception 'Invalid batch size' using errcode='22023';end if;
 foreach v_id in array p_ids loop results:=results||jsonb_build_array(hr_action(p_actor,p_org,'documents',v_id,'request-update'));end loop;return jsonb_build_object('items',results);
end $$;
-- Changes to pending approved steps must not alter the data an earlier approver accepted.
create function public.hr_lock_approved_steps() returns trigger language plpgsql set search_path=public as $$begin
 if (to_jsonb(new)-array['status','decision_reason','decided_by','decided_at']) is distinct from (to_jsonb(old)-array['status','decision_reason','decided_by','decided_at']) and exists(select 1 from hr_approval_steps where record_id=old.id and status<>'pending') then raise exception 'Request already entered approval; submit a new request' using errcode='22023';end if;return new;
end $$;
create trigger hr_leave_approval_lock before update on public.hr_leave for each row execute function public.hr_lock_approved_steps();
create trigger hr_attendance_approval_lock before update on public.hr_attendance for each row execute function public.hr_lock_approved_steps();
create trigger hr_review_approval_lock before update on public.hr_reviews for each row execute function public.hr_lock_approved_steps();
create trigger hr_expense_approval_lock before update on public.hr_expenses for each row execute function public.hr_lock_approved_steps();
create function public.hr_resubmit(p_actor uuid,p_org uuid,p_kind text,p_id uuid) returns jsonb language plpgsql set search_path=public as $$
declare r jsonb;begin
 perform hr_require(p_actor,p_org,'employees.manage');perform 1 from organizations where id=p_org for update;
 if p_kind not in ('leave','attendance','reviews','expenses') then raise exception 'Invalid resubmission kind' using errcode='22023';end if;
 execute format('select to_jsonb(t) from %I t where organization_id=$1 and id=$2 for update','hr_'||p_kind) into r using p_org,p_id;
 if r is null then raise exception 'Not found' using errcode='P0002';end if;
 if r->>'status'<>'declined' then raise exception 'Only declined requests can be resubmitted' using errcode='22023';end if;
 delete from hr_approval_steps where organization_id=p_org and record_id=p_id;
 execute format('update %I set status=''pending'',decision_reason=null,decided_at=null,decided_by=null where id=$1 returning to_jsonb(%I.*)','hr_'||p_kind,'hr_'||p_kind) into r using p_id;
 return r;
end $$;
create trigger hr_leave_resubmit after update of status on public.hr_leave for each row when (old.status='declined' and new.status='pending') execute function public.hr_capture_approval_chain();
create trigger hr_attendance_resubmit after update of status on public.hr_attendance for each row when (old.status='declined' and new.status='pending') execute function public.hr_capture_approval_chain();
create trigger hr_review_resubmit after update of status on public.hr_reviews for each row when (old.status='declined' and new.status='pending') execute function public.hr_capture_approval_chain();
create trigger hr_expense_resubmit after update of status on public.hr_expenses for each row when (old.status='declined' and new.status='pending') execute function public.hr_capture_approval_chain();
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hr_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';commit;
