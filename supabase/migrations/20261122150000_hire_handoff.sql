begin;

-- When a candidate reaches the hired stage, turn them into an employee record
-- and start onboarding if their email already maps to a workspace member.
-- External hires (no account yet) get an activity entry and a notification so
-- the employer can send the standard invitation next.
create or replace function public.recruitment_hire_candidate(
  p_actor uuid, p_org uuid, p_candidate uuid
) returns void language plpgsql set search_path = public as $$
declare
  cand candidates;
  job_row jobs;
  member_user uuid;
  dept uuid;
  role_id uuid;
  emp uuid;
begin
  select * into cand from candidates where id = p_candidate and organization_id = p_org;
  if not found or cand.status <> 'hired' then return; end if;
  select * into job_row from jobs where id = cand.job_id and organization_id = p_org;
  select m.user_id into member_user
  from organization_members m join profiles p on p.id = m.user_id
  where m.organization_id = p_org and lower(p.email) = lower(cand.email)
  limit 1;

  dept := job_row.department_id;
  role_id := job_row.role_id;
  if dept is null then
    select id into dept from departments
    where organization_id = p_org and not is_archived
    order by display_order, created_at limit 1;
  end if;

  if member_user is not null and dept is not null then
    insert into hr_employees (
      organization_id, user_id, department_id, role_id, starts_on, annual_salary, currency
    ) values (
      p_org, member_user, dept, role_id, hr_today(p_org),
      coalesce(job_row.salary_min, job_row.salary_max),
      upper(coalesce(nullif(btrim(job_row.currency::text), ''), 'USD'))
    )
    on conflict (organization_id, user_id) do nothing
    returning id into emp;
    if emp is null then
      select id into emp from hr_employees where organization_id = p_org and user_id = member_user;
    end if;
    insert into hr_onboarding (organization_id, employee_id)
    values (p_org, emp)
    on conflict (employee_id) do nothing;
    perform queue_notification(
      p_org, member_user, 'hr.hired', 'Welcome aboard',
      'You have been hired for ' || job_row.title || '. Complete your onboarding to get started.',
      'hire:' || cand.id, 'essential',
      jsonb_build_object('candidateId', cand.id, 'jobId', job_row.id, 'employeeId', emp)
    );
  else
    perform queue_notification(
      p_org, null, 'hr.hired', 'Offer accepted',
      'You have been hired for ' || job_row.title || '. Check your email for your workspace invitation.',
      'hire:' || cand.id, 'essential',
      jsonb_build_object('candidateId', cand.id, 'jobId', job_row.id), cand.email
    );
  end if;

  insert into organization_activities (
    organization_id, category, kind, title, summary, actor_id, subject_type, subject_id
  ) values (
    p_org, 'employee', 'candidate_hired', cand.full_name,
    'Hired for ' || job_row.title, p_actor, 'candidate', cand.id
  );
end $$;

-- Re-point the mutate wrapper so a hired candidate also triggers onboarding.
create or replace function public.recruitment_mutate(
  p_actor uuid,
  p_org uuid,
  p_action text,
  p_id uuid default null,
  p_data jsonb default '{}'
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_before_stage uuid;
  v_result jsonb;
  v_candidate_id uuid;
  v_stage_id uuid;
  v_trigger_event uuid;
  v_runs jsonb := '[]'::jsonb;
begin
  if p_action in ('candidate.save', 'candidate.advance') and p_id is not null then
    select stage_id into v_before_stage from candidates
      where id = p_id and organization_id = p_org;
  end if;

  v_result := recruitment_mutate_without_automations(
    p_actor, p_org, p_action, p_id, p_data
  );
  if p_action = 'job.save' then
    perform recruitment_seed_stage_automations(s.id)
    from job_pipeline_stages s where s.job_id = (v_result->>'id')::uuid;
  end if;
  if p_action not in ('candidate.save', 'candidate.advance') then
    return v_result;
  end if;

  v_candidate_id := (v_result->>'id')::uuid;
  if p_action = 'candidate.advance' and (v_result->>'status') = 'hired' then
    perform recruitment_hire_candidate(p_actor, p_org, v_candidate_id);
  end if;
  select stage_id into v_stage_id from candidates
    where id = v_candidate_id and organization_id = p_org;
  if v_stage_id is null or
    (p_action = 'candidate.save' and v_before_stage is not distinct from v_stage_id) then
    return v_result;
  end if;

  select e.id into v_trigger_event
  from candidate_stage_events e
  where e.organization_id = p_org and e.candidate_id = v_candidate_id
    and e.to_stage_id = v_stage_id
  order by e.occurred_at desc, e.id desc
  limit 1;
  if v_trigger_event is not null then
    v_runs := execute_recruitment_stage_automations(
      p_actor, p_org, v_candidate_id, (v_result->>'job_id')::uuid,
      v_stage_id, v_trigger_event
    );
  end if;
  return v_result || jsonb_build_object('automations', v_runs);
end $$;

revoke all on function public.recruitment_hire_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.recruitment_hire_candidate(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
