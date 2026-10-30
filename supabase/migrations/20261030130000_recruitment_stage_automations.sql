begin;

create table public.candidate_automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null,
  job_id uuid not null,
  stage_id uuid not null,
  automation_id uuid not null references public.job_stage_automations(id) on delete cascade,
  trigger_event_id uuid not null references public.candidate_stage_events(id) on delete cascade,
  kind text not null check (kind in ('email', 'calendar', 'ai_evaluation', 'reviewer_assignment', 'custom')),
  status text not null default 'processing'
    check (status in ('processing', 'queued', 'completed', 'deferred', 'failed', 'skipped')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (automation_id, trigger_event_id),
  foreign key (candidate_id, organization_id)
    references public.candidates(id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete cascade,
  foreign key (stage_id, organization_id)
    references public.job_pipeline_stages(id, organization_id) on delete cascade
);

create table public.candidate_reviewers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  user_id uuid not null,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  source_automation_id uuid references public.job_stage_automations(id) on delete set null,
  assignment_reason text not null default 'stage_automation',
  created_at timestamptz not null default now(),
  unique (candidate_id, user_id),
  foreign key (candidate_id, organization_id)
    references public.candidates(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create table public.candidate_ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  stage_id uuid not null,
  trigger_event_id uuid not null references public.candidate_stage_events(id) on delete cascade,
  provider text not null default 'dummy',
  model text not null default 'deferred-model',
  status text not null default 'deferred'
    check (status in ('pending', 'completed', 'deferred', 'failed')),
  score numeric(5, 2) check (score is null or score between 0 and 100),
  rationale text,
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (trigger_event_id),
  foreign key (candidate_id, organization_id)
    references public.candidates(id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete cascade,
  foreign key (stage_id, organization_id)
    references public.job_pipeline_stages(id, organization_id) on delete cascade
);

create index candidate_automation_runs_candidate_idx
  on public.candidate_automation_runs (organization_id, candidate_id, created_at desc);
create index candidate_automation_runs_status_idx
  on public.candidate_automation_runs (organization_id, status, created_at)
  where status in ('processing', 'failed');
create index candidate_reviewers_user_idx
  on public.candidate_reviewers (organization_id, user_id, created_at desc);
create index candidate_ai_evaluations_status_idx
  on public.candidate_ai_evaluations (organization_id, status, created_at)
  where status in ('pending', 'deferred', 'failed');

alter table public.candidate_automation_runs enable row level security;
alter table public.candidate_reviewers enable row level security;
alter table public.candidate_ai_evaluations enable row level security;
revoke all on public.candidate_automation_runs, public.candidate_reviewers,
  public.candidate_ai_evaluations from anon, authenticated;
grant all on public.candidate_automation_runs, public.candidate_reviewers,
  public.candidate_ai_evaluations to service_role;

create or replace function public.execute_recruitment_stage_automations(
  p_actor uuid,
  p_org uuid,
  p_candidate uuid,
  p_job uuid,
  p_stage uuid,
  p_trigger_event uuid
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_candidate candidates;
  v_job jobs;
  v_stage job_pipeline_stages;
  v_auto job_stage_automations;
  v_run_id uuid;
  v_event_id uuid;
  v_users uuid[] := '{}';
  v_user uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_subject text;
  v_body text;
  v_location text;
  v_meeting_url text;
  v_status text;
  v_affected integer;
  v_result jsonb;
  v_runs jsonb;
begin
  select * into v_candidate from candidates
    where id = p_candidate and organization_id = p_org;
  select * into v_job from jobs where id = p_job and organization_id = p_org;
  select * into v_stage from job_pipeline_stages
    where id = p_stage and job_id = p_job and organization_id = p_org;
  if v_candidate.id is null or v_job.id is null or v_stage.id is null then
    raise exception 'Automation context not found' using errcode = 'P0002';
  end if;
  select coalesce(timezone, 'UTC') into v_tz
    from organization_settings where organization_id = p_org;
  v_tz := coalesce(v_tz, 'UTC');

  for v_auto in
    select * from job_stage_automations
    where organization_id = p_org and stage_id = p_stage and is_enabled
    order by created_at, id
  loop
    insert into candidate_automation_runs (
      organization_id, candidate_id, job_id, stage_id, automation_id,
      trigger_event_id, kind
    ) values (
      p_org, p_candidate, p_job, p_stage, v_auto.id, p_trigger_event, v_auto.kind
    )
    on conflict (automation_id, trigger_event_id) do nothing
    returning id into v_run_id;
    if v_run_id is null then continue; end if;

    v_status := 'completed';
    v_result := '{}'::jsonb;
    begin
      if v_auto.kind = 'email' then
        v_subject := left(coalesce(nullif(v_auto.config->>'subject', ''),
          'Application update: ' || v_job.title), 160);
        v_body := coalesce(nullif(v_auto.config->>'body', ''),
          v_candidate.full_name || ', your application for ' || v_job.title ||
          ' has moved to the ' || v_stage.name || ' stage.');
        if lower(coalesce(v_auto.config->>'recipient', 'candidate')) = 'candidate' then
          perform queue_notification(
            p_org, null, 'recruitment.stage_email', v_subject, v_body,
            'recruitment-auto:' || v_run_id::text, 'essential',
            jsonb_build_object('candidateId', p_candidate, 'jobId', p_job,
              'stageId', p_stage, 'automationId', v_auto.id),
            v_candidate.email
          );
        else
          select coalesce(array_agg(t.user_id), '{}') into v_users
          from job_hiring_team t
          where t.organization_id = p_org and t.job_id = p_job
            and (nullif(v_auto.config->>'reviewerRole', '') is null
              or t.role_label = v_auto.config->>'reviewerRole');
          foreach v_user in array v_users loop
            perform queue_notification(
              p_org, v_user, 'recruitment.stage_email', v_subject, v_body,
              'recruitment-auto:' || v_run_id::text || ':' || v_user::text,
              'activity',
              jsonb_build_object('candidateId', p_candidate, 'jobId', p_job,
                'stageId', p_stage, 'automationId', v_auto.id)
            );
          end loop;
        end if;
        v_status := 'queued';
        v_result := jsonb_build_object('queued', true);
      elsif v_auto.kind = 'calendar' then
        select coalesce(array_agg(t.user_id), '{}') into v_users
        from job_hiring_team t
        where t.organization_id = p_org and t.job_id = p_job
          and (nullif(v_auto.config->>'reviewerRole', '') is null
            or t.role_label = v_auto.config->>'reviewerRole');
        if cardinality(v_users) = 0 then v_users := array[p_actor]; end if;
        v_start := coalesce(
          nullif(v_auto.config->>'startsAt', '')::timestamptz,
          now() + make_interval(hours => greatest(0, least(
            coalesce(nullif(v_auto.config->>'delayHours', '')::integer, 24), 8760
          )))
        );
        v_end := coalesce(
          nullif(v_auto.config->>'endsAt', '')::timestamptz,
          v_start + make_interval(mins => greatest(15, least(
            coalesce(nullif(v_auto.config->>'durationMinutes', '')::integer, 30), 480
          )))
        );
        if v_end <= v_start then v_end := v_start + interval '30 minutes'; end if;
        insert into calendar_events (
          organization_id, kind, source, source_id, title, description,
          starts_at, ends_at, timezone, location, meeting_url, organizer_id,
          attendees, created_by
        ) values (
          p_org, 'interview', 'interview', v_run_id,
          left(coalesce(nullif(v_auto.config->>'title', ''),
            'Interview: ' || v_candidate.full_name || ' - ' || v_stage.name), 160),
          nullif(v_auto.config->>'description', ''),
          v_start, v_end, v_tz,
          left(nullif(v_auto.config->>'location', ''), 300),
          left(nullif(v_auto.config->>'meetingUrl', ''), 2048),
          p_actor,
          (select jsonb_agg(jsonb_build_object('userId', x, 'response', 'pending'))
           from unnest(v_users) x),
          p_actor
        ) returning id into v_event_id;
        insert into job_interviews (
          organization_id, job_id, candidate_id, stage_id, event_id
        ) values (p_org, p_job, p_candidate, p_stage, v_event_id)
        on conflict (event_id) do nothing;
        v_result := jsonb_build_object('eventId', v_event_id,
          'startsAt', v_start, 'endsAt', v_end);
      elsif v_auto.kind = 'reviewer_assignment' then
        select coalesce(array_agg(x::uuid), '{}') into v_users
        from jsonb_array_elements_text(
          coalesce(v_auto.config->'reviewerUserIds', '[]'::jsonb)
        ) x
        where exists (
          select 1 from organization_members m
          where m.organization_id = p_org and m.user_id = x::uuid
        );
        if cardinality(v_users) = 0 then
          select coalesce(array_agg(t.user_id), '{}') into v_users
          from job_hiring_team t
          where t.organization_id = p_org and t.job_id = p_job
            and (nullif(v_auto.config->>'reviewerRole', '') is null
              or t.role_label = v_auto.config->>'reviewerRole');
        end if;
        if cardinality(v_users) = 0 and v_job.reporting_manager_id is not null then
          v_users := array[v_job.reporting_manager_id];
        end if;
        insert into candidate_reviewers (
          organization_id, candidate_id, user_id, assigned_by,
          source_automation_id, assignment_reason
        )
        select p_org, p_candidate, x, p_actor, v_auto.id,
          coalesce(nullif(v_auto.config->>'reason', ''), 'stage_automation')
        from unnest(v_users) x
        on conflict (candidate_id, user_id) do nothing;
        get diagnostics v_affected = row_count;
        foreach v_user in array v_users loop
          perform queue_notification(
            p_org, v_user, 'recruitment.reviewer_assigned',
            'Candidate assigned for review',
            v_candidate.full_name || ' moved to ' || v_stage.name ||
            ' for ' || v_job.title || '.',
            'recruitment-reviewer:' || v_run_id::text || ':' || v_user::text,
            'essential',
            jsonb_build_object('candidateId', p_candidate, 'jobId', p_job,
              'stageId', p_stage)
          );
        end loop;
        v_result := jsonb_build_object(
          'reviewerIds', v_users, 'assigned', v_affected
        );
      elsif v_auto.kind = 'ai_evaluation' then
        insert into candidate_ai_evaluations (
          organization_id, candidate_id, job_id, stage_id, trigger_event_id,
          provider, model, status, input_data, output_data
        ) values (
          p_org, p_candidate, p_job, p_stage, p_trigger_event,
          'dummy', 'deferred-model', 'deferred',
          jsonb_build_object('candidate', to_jsonb(v_candidate), 'job', to_jsonb(v_job)),
          jsonb_build_object('message',
            'AI evaluation is deferred until a real provider and model are configured.')
        )
        on conflict (trigger_event_id) do nothing;
        v_status := 'deferred';
        v_result := jsonb_build_object('provider', 'dummy',
          'model', 'deferred-model', 'deferred', true);
      else
        v_status := 'skipped';
        v_result := jsonb_build_object('message',
          'Custom automation recorded without an executable provider.');
      end if;
      update candidate_automation_runs
      set status = v_status, result = v_result, completed_at = now()
      where id = v_run_id;
    exception when others then
      update candidate_automation_runs
      set status = 'failed',
        result = jsonb_build_object('error', sqlerrm),
        completed_at = now()
      where id = v_run_id;
    end;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'result', r.result
  ) order by r.created_at, r.id), '[]'::jsonb) into v_runs
  from candidate_automation_runs r
  where r.trigger_event_id = p_trigger_event;
  return v_runs;
end $$;

alter function public.recruitment_mutate(uuid, uuid, text, uuid, jsonb)
  rename to recruitment_mutate_without_automations;

create function public.recruitment_mutate(
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

revoke all on function public.execute_recruitment_stage_automations(
  uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.execute_recruitment_stage_automations(
  uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;
revoke all on function public.recruitment_mutate_without_automations(
  uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.recruitment_mutate_without_automations(
  uuid, uuid, text, uuid, jsonb
) to service_role;
revoke all on function public.recruitment_mutate(
  uuid, uuid, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.recruitment_mutate(
  uuid, uuid, text, uuid, jsonb
) to service_role;

notify pgrst, 'reload schema';
commit;
