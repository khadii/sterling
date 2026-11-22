begin;

-- The designed automation page exposes 16 named workflow triggers grouped by
-- pipeline stage. A stage is pre-seeded with its category's triggers so the
-- frontend never receives an empty automation list: each trigger exists with a
-- concrete on/off default instead of being absent.

create or replace function public.recruitment_stage_automation_defaults(p_category text)
returns jsonb language sql immutable set search_path = public as $$
  select case p_category
    when 'assessment' then jsonb_build_array(
      jsonb_build_object('kind', 'email', 'label', 'Assessment Invitation',
        'is_enabled', false, 'config', '{"recipient":"candidate"}'::jsonb),
      jsonb_build_object('kind', 'email', 'label', 'Assessment Deadline Reminder',
        'is_enabled', false, 'config', '{"recipient":"candidate","reminderHoursBefore":24}'::jsonb)
    )
    when 'interview' then jsonb_build_array(
      jsonb_build_object('kind', 'calendar', 'label', 'Interview Scheduling',
        'is_enabled', true, 'config', '{}'::jsonb),
      jsonb_build_object('kind', 'calendar', 'label', 'Candidate Self-Scheduling',
        'is_enabled', true, 'config', '{"bufferMinutes":15,"slotDurationMinutes":60}'::jsonb),
      jsonb_build_object('kind', 'email', 'label', 'Interview Confirmation',
        'is_enabled', true, 'config', '{"recipient":"candidate"}'::jsonb),
      jsonb_build_object('kind', 'email', 'label', 'Interview Reminder',
        'is_enabled', true, 'config', '{"recipient":"candidate","timingHoursBefore":2}'::jsonb),
      jsonb_build_object('kind', 'reviewer_assignment', 'label', 'Interview Feedback Request',
        'is_enabled', true, 'config', '{}'::jsonb),
      jsonb_build_object('kind', 'custom', 'label', 'Interview Outcome Routing',
        'is_enabled', false, 'config', '{"ratingThreshold":4}'::jsonb)
    )
    when 'offer' then jsonb_build_array(
      jsonb_build_object('kind', 'custom', 'label', 'Offer Approval',
        'is_enabled', false, 'config', '{}'::jsonb),
      jsonb_build_object('kind', 'email', 'label', 'Offer Delivery and Follow-up',
        'is_enabled', false, 'config', '{"recipient":"candidate","followUpDays":3}'::jsonb),
      jsonb_build_object('kind', 'custom', 'label', 'Initiate Onboarding',
        'is_enabled', false, 'config', '{}'::jsonb)
    )
    when 'screening' then jsonb_build_array(
      jsonb_build_object('kind', 'email', 'label', 'Application Acknowledgement',
        'is_enabled', true, 'config', '{"recipient":"candidate","subject":"Application received"}'::jsonb),
      jsonb_build_object('kind', 'ai_evaluation', 'label', 'AI Match Scoring',
        'is_enabled', true, 'config', '{}'::jsonb),
      jsonb_build_object('kind', 'custom', 'label', 'Score Above Threshold',
        'is_enabled', true, 'config', '{"threshold":85}'::jsonb),
      jsonb_build_object('kind', 'custom', 'label', 'Score Below Threshold',
        'is_enabled', true, 'config', '{"threshold":50}'::jsonb),
      jsonb_build_object('kind', 'custom', 'label', 'Qualified Candidate Routing',
        'is_enabled', true, 'config', '{"score":80}'::jsonb)
    )
    else '[]'::jsonb
  end;
$$;

create or replace function public.recruitment_seed_stage_automations(p_stage_id uuid)
returns void language plpgsql set search_path = public as $$
declare v_category text;
begin
  select category into v_category from job_pipeline_stages where id = p_stage_id;
  if not found or v_category not in ('screening', 'assessment', 'interview', 'offer') then
    return;
  end if;
  if exists (select 1 from job_stage_automations where stage_id = p_stage_id) then
    return;
  end if;
  insert into job_stage_automations(organization_id, stage_id, kind, label, is_enabled, config)
  select s.organization_id, s.id, d.kind, d.label, d.is_enabled, d.config
  from job_pipeline_stages s
  cross join lateral jsonb_to_recordset(recruitment_stage_automation_defaults(v_category))
    as d(kind text, label text, is_enabled boolean, config jsonb)
  where s.id = p_stage_id;
end $$;

-- Seed defaults whenever a job is saved through the wizard, so newly created
-- stages are never empty.
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

-- Seed defaults when a stage is appended through the dedicated stage manager.
create or replace function public.recruitment_pipeline_manage(
  p_actor uuid, p_org uuid, p_job uuid, p_action text,
  p_stage uuid default null, p_automation uuid default null,
  p_data jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  j jobs; st job_pipeline_stages; a job_stage_automations;
  v_stage_id uuid := p_stage; v_automation_id uuid := p_automation;
  item jsonb; items jsonb; previous integer; is_read boolean;
begin
  is_read := p_action in ('stages.list', 'automations.list');
  perform recruitment_require(p_actor, p_org,
    case when is_read then 'jobs.view' else 'jobs.manage_all' end);
  if not is_read then
    perform 1 from organizations where id = p_org for update;
  end if;
  select * into j from jobs where id = p_job and organization_id = p_org;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if not is_read and j.status = 'closed' then
    raise exception 'Closed jobs are read-only' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Payload must be an object' using errcode = '22023';
  end if;
  if p_action not in ('stages.list','stage.create','stages.reorder') then
    select * into st from job_pipeline_stages
      where id = p_stage and job_id = p_job and organization_id = p_org;
    if not found then raise exception 'Stage not found in this job' using errcode = 'P0002'; end if;
  end if;
  if p_action in ('automation.update','automation.delete') then
    select * into a from job_stage_automations
      where id = p_automation and stage_id = p_stage and organization_id = p_org;
    if not found then raise exception 'Automation not found in this stage' using errcode = 'P0002'; end if;
  end if;

  if p_action = 'stage.create' then
    if (select count(*) from job_pipeline_stages where job_id = p_job) >= 30 then
      raise exception 'A job supports at most 30 stages' using errcode = '22023';
    end if;
    insert into job_pipeline_stages(organization_id,job_id,display_order,name,category,description,accent,is_assessment,assessment)
    values(p_org,p_job,(select coalesce(max(display_order),-1)+1 from job_pipeline_stages where job_id=p_job),
      btrim(p_data->>'name'),coalesce(p_data->>'category','screening'),p_data->>'description',p_data->>'accent',
      coalesce((p_data->>'isAssessment')::boolean,false),coalesce(p_data->'assessment','{}'))
    returning id into v_stage_id;
    if jsonb_typeof(coalesce(p_data->'automations','[]')) <> 'array'
      or jsonb_array_length(coalesce(p_data->'automations','[]')) > 20 then
      raise exception 'A stage supports at most 20 automations' using errcode = '22023';
    end if;
    insert into job_stage_automations(organization_id,stage_id,kind,label,is_enabled,config)
    select p_org,v_stage_id,x->>'kind',btrim(x->>'label'),coalesce((x->>'isEnabled')::boolean,true),coalesce(x->'config','{}')
    from jsonb_array_elements(coalesce(p_data->'automations','[]')) x;
    perform recruitment_seed_stage_automations(v_stage_id);
  elsif p_action = 'stage.update' then
    if p_data ? 'automations' then
      raise exception 'Use the dedicated automation endpoints to edit automations' using errcode = '22023';
    end if;
    update job_pipeline_stages set
      name=case when p_data ? 'name' then btrim(p_data->>'name') else name end,
      category=case when p_data ? 'category' then p_data->>'category' else category end,
      description=case when p_data ? 'description' then p_data->>'description' else description end,
      accent=case when p_data ? 'accent' then p_data->>'accent' else accent end,
      is_assessment=case when p_data ? 'isAssessment' then (p_data->>'isAssessment')::boolean else is_assessment end,
      assessment=case when p_data ? 'assessment' then p_data->'assessment' else assessment end
    where id=p_stage and organization_id=p_org;
  elsif p_action = 'stage.delete' then
    if exists(select 1 from candidates where stage_id=p_stage and organization_id=p_org)
      or exists(select 1 from candidate_stage_events where organization_id=p_org and (from_stage_id=p_stage or to_stage_id=p_stage))
      or exists(select 1 from candidate_automation_runs where stage_id=p_stage and organization_id=p_org)
      or exists(select 1 from job_interviews where stage_id=p_stage and organization_id=p_org) then
      raise exception 'Stage has candidates or history; keep it or move candidates first' using errcode = '22023';
    end if;
    delete from job_pipeline_stages where id=p_stage and organization_id=p_org;
    for item in select to_jsonb(s) from job_pipeline_stages s
      where job_id=p_job and display_order>st.display_order order by display_order loop
      update job_pipeline_stages set display_order=display_order-1 where id=(item->>'id')::uuid;
    end loop;
  elsif p_action = 'stages.reorder' then
    if jsonb_typeof(p_data->'stageIds') is distinct from 'array' then
      raise exception 'stageIds must be an array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_data->'stageIds') <> (select count(*) from job_pipeline_stages where job_id=p_job)
      or jsonb_array_length(p_data->'stageIds') <> (select count(distinct x) from jsonb_array_elements_text(p_data->'stageIds') x)
      or exists(select 1 from jsonb_array_elements_text(p_data->'stageIds') x
        where not exists(select 1 from job_pipeline_stages where id=x::uuid and job_id=p_job and organization_id=p_org)) then
      raise exception 'Provide every stage ID exactly once from this job' using errcode = '22023';
    end if;
    set constraints job_pipeline_stages_job_id_display_order_key deferred;
    update job_pipeline_stages s set display_order=(t.n-1)::smallint
      from jsonb_array_elements_text(p_data->'stageIds') with ordinality t(id,n)
      where s.id=t.id::uuid and s.job_id=p_job and s.organization_id=p_org;
    set constraints job_pipeline_stages_job_id_display_order_key immediate;
  elsif p_action = 'automations.replace' then
    if jsonb_typeof(p_data->'items') is distinct from 'array' then
      raise exception 'items must be an array' using errcode='22023';
    end if;
    if jsonb_array_length(p_data->'items')>20 then
      raise exception 'A stage supports at most 20 automations' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_data->'items') x
      where x ? 'id' and not exists(select 1 from job_stage_automations z
        where z.id=(x->>'id')::uuid and z.stage_id=p_stage and z.organization_id=p_org))
      or (select count(*) from jsonb_array_elements(p_data->'items') x where x ? 'id')
        <> (select count(distinct x->>'id') from jsonb_array_elements(p_data->'items') x where x ? 'id') then
      raise exception 'Existing automation IDs must be unique and belong to this stage' using errcode='22023';
    end if;
    if exists(select 1 from job_stage_automations z join candidate_automation_runs r on r.automation_id=z.id
      where z.stage_id=p_stage and z.organization_id=p_org
      and not exists(select 1 from jsonb_array_elements(p_data->'items') x where x->>'id'=z.id::text)) then
      raise exception 'Keep rules with execution history in items and set isEnabled=false' using errcode='22023';
    end if;
    delete from job_stage_automations z where z.stage_id=p_stage and z.organization_id=p_org
      and not exists(select 1 from jsonb_array_elements(p_data->'items') x where x->>'id'=z.id::text);
    for item in select * from jsonb_array_elements(p_data->'items') loop
      if item ? 'id' then
        update job_stage_automations set kind=item->>'kind',label=btrim(item->>'label'),
          is_enabled=coalesce((item->>'isEnabled')::boolean,true),config=coalesce(item->'config','{}')
          where id=(item->>'id')::uuid and stage_id=p_stage and organization_id=p_org;
      else
        insert into job_stage_automations(organization_id,stage_id,kind,label,is_enabled,config)
          values(p_org,p_stage,item->>'kind',btrim(item->>'label'),coalesce((item->>'isEnabled')::boolean,true),coalesce(item->'config','{}'));
      end if;
    end loop;
  elsif p_action = 'automation.create' then
    if (select count(*) from job_stage_automations where stage_id=p_stage and organization_id=p_org) >= 20 then
      raise exception 'A stage supports at most 20 automations' using errcode = '22023';
    end if;
    insert into job_stage_automations(organization_id,stage_id,kind,label,is_enabled,config)
    values(p_org,p_stage,p_data->>'kind',btrim(p_data->>'label'),coalesce((p_data->>'isEnabled')::boolean,true),coalesce(p_data->'config','{}'))
    returning id into v_automation_id;
  elsif p_action = 'automation.update' then
    update job_stage_automations set
      kind=case when p_data ? 'kind' then p_data->>'kind' else kind end,
      label=case when p_data ? 'label' then btrim(p_data->>'label') else label end,
      is_enabled=case when p_data ? 'isEnabled' then (p_data->>'isEnabled')::boolean else is_enabled end,
      config=case when p_data ? 'config' then p_data->'config' else config end
    where id=p_automation and organization_id=p_org;
  elsif p_action = 'automation.delete' then
    if exists(select 1 from candidate_automation_runs where automation_id=p_automation and organization_id=p_org) then
      raise exception 'Automation has execution history; set isEnabled=false instead' using errcode = '22023';
    end if;
    delete from job_stage_automations where id=p_automation and organization_id=p_org;
  elsif not is_read then
    raise exception 'Unknown pipeline action' using errcode = '22023';
  end if;

  if not is_read then
    previous := j.revision;
    update jobs set revision=revision+1 where id=p_job and organization_id=p_org returning * into j;
    insert into job_revision_history(organization_id,job_id,actor_id,action,changes,previous_revision,new_revision)
      values(p_org,p_job,p_actor,p_action,p_data || jsonb_build_object('stageId',v_stage_id,'automationId',v_automation_id),previous,j.revision);
  end if;
  if p_action like 'automation%' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') into items
      from job_stage_automations x where x.stage_id=p_stage and x.organization_id=p_org;
    return jsonb_build_object('jobId',p_job,'stageId',p_stage,'automationId',v_automation_id,'revision',j.revision,
      'items',items,'total',jsonb_array_length(items));
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('candidateCount',(select count(*) from candidates c where c.organization_id=p_org and c.job_id=p_job and c.stage_id=s.id),'hasEnabledAutomation',exists(select 1 from job_stage_automations x where x.stage_id=s.id and x.organization_id=p_org and x.is_enabled),'automations',coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from job_stage_automations x
    where x.stage_id=s.id and x.organization_id=p_org),'[]')) order by s.display_order),'[]')
    into items from job_pipeline_stages s where s.job_id=p_job and s.organization_id=p_org;
  return jsonb_build_object('jobId',p_job,'stageId',v_stage_id,'revision',j.revision,'items',items,'total',jsonb_array_length(items));
end $$;

-- Public, unauthenticated list of published jobs for the careers board.
create or replace function public.recruitment_public_jobs(
  p_org uuid default null,
  p_search text default null,
  p_organization text default null,
  p_department text default null,
  p_work_arrangement text default null,
  p_employment_type text default null,
  p_location text default null,
  p_posted_from date default null,
  p_posted_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb language plpgsql stable set search_path = public as $$
declare items jsonb; total integer;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  select count(*) into total
  from jobs j join organizations o on o.id = j.organization_id
  where j.status = 'open' and j.published_at is not null
    and (p_org is null or j.organization_id = p_org)
    and (p_search is null or j.title ilike '%' || p_search || '%'
      or coalesce(j.summary, '') ilike '%' || p_search || '%')
    and (p_organization is null or o.name ilike '%' || p_organization || '%')
    and (p_department is null or exists (
      select 1 from departments d where d.id = j.department_id
        and d.organization_id = j.organization_id and d.name ilike '%' || p_department || '%'))
    and (p_work_arrangement is null or j.work_arrangement = p_work_arrangement)
    and (p_employment_type is null or j.employment_type = p_employment_type)
    and (p_location is null or coalesce(j.location_city, '') ilike '%' || p_location || '%'
      or coalesce(j.location_country, '') ilike '%' || p_location || '%')
    and (p_posted_from is null or j.posted_on >= p_posted_from)
    and (p_posted_to is null or j.posted_on <= p_posted_to);

  select coalesce(jsonb_agg(q.item order by q.posted_on desc nulls last, q.created_at desc, q.id desc), '[]'::jsonb)
  into items
  from (
    select jsonb_build_object(
      'id', j.id,
      'publicSlug', j.public_slug,
      'title', j.title,
      'summary', j.summary,
      'organizationId', j.organization_id,
      'organizationName', o.name,
      'departmentName', d.name,
      'workArrangement', j.work_arrangement,
      'employmentType', j.employment_type,
      'seniorityLevel', j.seniority_level,
      'locationCity', j.location_city,
      'locationCountry', j.location_country,
      'salaryMin', j.salary_min,
      'salaryMax', j.salary_max,
      'currency', j.currency,
      'postedOn', j.posted_on,
      'closesOn', j.closes_on
    ) as item, j.posted_on, j.created_at, j.id
    from jobs j
    join organizations o on o.id = j.organization_id
    left join departments d on d.id = j.department_id and d.organization_id = j.organization_id
    where j.status = 'open' and j.published_at is not null
      and (p_org is null or j.organization_id = p_org)
      and (p_search is null or j.title ilike '%' || p_search || '%'
        or coalesce(j.summary, '') ilike '%' || p_search || '%')
      and (p_organization is null or o.name ilike '%' || p_organization || '%')
      and (p_department is null or (d.name ilike '%' || p_department || '%'))
      and (p_work_arrangement is null or j.work_arrangement = p_work_arrangement)
      and (p_employment_type is null or j.employment_type = p_employment_type)
      and (p_location is null or coalesce(j.location_city, '') ilike '%' || p_location || '%'
        or coalesce(j.location_country, '') ilike '%' || p_location || '%')
      and (p_posted_from is null or j.posted_on >= p_posted_from)
      and (p_posted_to is null or j.posted_on <= p_posted_to)
    limit p_limit offset p_offset
  ) q;
  return jsonb_build_object('items', items, 'total', total, 'limit', p_limit, 'offset', p_offset);
end $$;

-- Backfill existing stages so the seeded catalog is visible on jobs created
-- before this migration.
do $$ declare s record; begin
  for s in select id from job_pipeline_stages loop
    perform recruitment_seed_stage_automations(s.id);
  end loop;
end $$;

revoke all on function public.recruitment_stage_automation_defaults(text) from public, anon, authenticated;
revoke all on function public.recruitment_seed_stage_automations(uuid) from public, anon, authenticated;
revoke all on function public.recruitment_public_jobs(
  uuid, text, text, text, text, text, text, date, date, integer, integer
) from public, anon, authenticated;
grant execute on function public.recruitment_stage_automation_defaults(text) to service_role;
grant execute on function public.recruitment_seed_stage_automations(uuid) to service_role;
grant execute on function public.recruitment_public_jobs(
  uuid, text, text, text, text, text, text, date, date, integer, integer
) to service_role;

notify pgrst, 'reload schema';
commit;
