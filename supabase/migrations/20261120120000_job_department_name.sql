-- Expose the department name alongside the department id on job list and
-- detail responses. The id is already emitted by to_jsonb(jobs.*); this only
-- resolves and adds the human-readable name so clients avoid a second lookup.

create or replace function public.recruitment_job_detail(p_actor uuid, p_org uuid, p_job uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare job_row jobs; stages jsonb; stage_count integer; automated integer; department_name text;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  select * into job_row from jobs where id = p_job and organization_id = p_org;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  select name into department_name from departments where id = job_row.department_id and organization_id = p_org;
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
    'departmentName', department_name,
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

create or replace function public.recruitment_job_list(
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
      'departmentName', d.name,
      'applicationCount', coalesce(c.applications, 0),
      'newApplicationCount', coalesce(c.new_applications, 0),
      'hiredCount', coalesce(c.hired, 0),
      'stageCount', coalesce(s.stages, 0)
    ) as item, j.posted_on, j.created_at, j.id
    from jobs j
    left join departments d on d.id = j.department_id and d.organization_id = p_org
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

notify pgrst, 'reload schema';
