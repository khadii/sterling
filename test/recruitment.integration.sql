begin;
do $$
#variable_conflict use_variable
declare
  actor uuid := gen_random_uuid(); member uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  org uuid; dep uuid; role_id uuid; owner_role uuid; job uuid; second_job uuid; cand uuid;
  stage_interview uuid; stage_offer uuid; result jsonb; revision integer;
begin
  -- The full automation catalog is 16 triggers across four stage categories:
  -- 5 screening, 2 assessment, 6 interview, 3 offer, with no missing or
  -- duplicate labels.
  if (select count(*) from (values ('screening'), ('assessment'), ('interview'), ('offer')) c(cat)
      cross join lateral jsonb_array_elements(recruitment_stage_automation_defaults(c.cat)) x) <> 16 then
    raise exception 'Automation catalog total wrong'; end if;
  if (select count(distinct label) from (values ('screening'), ('assessment'), ('interview'), ('offer')) c(cat)
      cross join lateral jsonb_array_elements(recruitment_stage_automation_defaults(c.cat)) x) <> 16 then
    raise exception 'Automation catalog has duplicate labels'; end if;
  if jsonb_array_length(recruitment_stage_automation_defaults('screening')) <> 5 then
    raise exception 'Screening automation catalog wrong'; end if;
  if jsonb_array_length(recruitment_stage_automation_defaults('assessment')) <> 2 then
    raise exception 'Assessment automation catalog wrong'; end if;
  if jsonb_array_length(recruitment_stage_automation_defaults('interview')) <> 6 then
    raise exception 'Interview automation catalog wrong'; end if;
  if jsonb_array_length(recruitment_stage_automation_defaults('offer')) <> 3 then
    raise exception 'Offer automation catalog wrong'; end if;

  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'rec-owner@test.invalid',now()),(member,'rec-member@test.invalid',now()),(other,'rec-other@test.invalid',now());
  insert into organizations(name,industry_id,company_size,created_by)
    values('Recruitment',(select id from industries limit 1),'1_10',actor) returning id into org;
  insert into organization_settings(organization_id,country_code,timezone,locale,week_starts_on,date_format)
    values(org,'NG','Africa/Lagos','en','monday','DD/MM/YYYY');
  insert into organization_members(organization_id,user_id) values(org,actor),(org,member);
  insert into organization_roles(organization_id,key,name,description)
    values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
  insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
  insert into departments(organization_id,name) values(org,'Product') returning id into dep;
  insert into organization_roles(organization_id,key,name,department_id,description)
    values(org,'designer','Senior Product Designer',dep,'Designer') returning id into role_id;
  insert into organization_role_permissions select owner_role,id from permissions on conflict do nothing;
  set local role service_role;

  -- An empty workspace reports real zeros and never fabricates a percentage.
  result := recruitment_metrics(actor,org,'2026-10-09');
  if result#>>'{summary,openJobs}' is distinct from '0' then raise exception 'Zero open jobs lost'; end if;
  if result#>>'{summary,totalApplications}' is distinct from '0' then raise exception 'Zero applications lost'; end if;
  if result#>>'{summary,hiredTotal}' is distinct from '0' then raise exception 'Zero hires lost'; end if;
  if result#>'{summary,applicationsChangePercent}' is distinct from 'null'::jsonb then raise exception 'Undefined percent fabricated'; end if;
  if jsonb_array_length(result->'applicationsBySource') <> 0 then raise exception 'Source list not empty'; end if;
  if jsonb_array_length(result->'recentActivity') <> 0 then raise exception 'Activity timeline not empty'; end if;

  -- Create a job with the full create-job wizard payload.
  result := recruitment_mutate(actor,org,'job.save',null,jsonb_build_object(
    'roleId',role_id,'departmentId',dep,'title','Senior Product Designer','reference','JOB-0012',
    'summary','Lead design systems','employmentType','full_time','workArrangement','hybrid',
    'seniorityLevel','Senior (L4)','experienceMinYears',5,'educationRequirement','Degree or equivalent',
    'primaryTooling','Figma mastery','reviewSlaHours',24,'locationCountry','ng','locationCity','Lagos',
    'salaryMin',120000,'salaryMax',150000,'currency','usd','positions',2,
    'responsibilities',jsonb_build_array(
      jsonb_build_object('body','Design token systems scaling'),
      jsonb_build_object('body','Mentorship of junior designers')),
    'qualifications',jsonb_build_array(jsonb_build_object('kind','preferred','body','WCAG AA familiarity')),
    'skills',jsonb_build_array(jsonb_build_object('name','Figma','level','expert','isRequired',true)),
    'screeningQuestions',jsonb_build_array(jsonb_build_object(
      'prompt','How many years of SaaS product design experience?','kind','number',
      'threshold','5+ years','weight',50,'isRequired',true)),
    'benefits',jsonb_build_array(jsonb_build_object('label','Comprehensive Health Insurance')),
    'hiringTeam',jsonb_build_array(jsonb_build_object('userId',member,'roleLabel','Hiring Lead','isLead',true)),
    'stages',jsonb_build_array(
      jsonb_build_object('name','Screening','category','screening','automations',jsonb_build_array(
        jsonb_build_object('kind','email','label','Send acknowledgement email','isEnabled',true))),
      jsonb_build_object('name','Interview','category','interview'),
      jsonb_build_object('name','Assessment','category','assessment','isAssessment',true,
        'assessment',jsonb_build_object('durationMinutes',45,'passingPercent',80,'pointsTotal',50)),
      jsonb_build_object('name','Offer','category','offer'),
      jsonb_build_object('name','Hired','category','hired'))));
  job := (result->>'id')::uuid;
  if result->>'status' is distinct from 'draft' then raise exception 'New job is not a draft'; end if;
  if result->>'currency' is distinct from 'USD' then raise exception 'Currency not normalised'; end if;
  -- recruitment_mutate echoes the stored row in snake_case; the composed
  -- detail/metrics responses below use camelCase.
  if result->>'location_country' is distinct from 'NG' then raise exception 'Country not normalised'; end if;

  result := recruitment_job_detail(actor,org,job);
  if jsonb_array_length(result->'stages') <> 5 then raise exception 'Stage set wrong'; end if;
  if result->>'departmentName' is distinct from 'Product' then raise exception 'Department name missing from detail'; end if;
  if jsonb_array_length(result->'responsibilities') <> 2 then raise exception 'Responsibilities lost'; end if;
  if jsonb_array_length(result->'skills') <> 1 or jsonb_array_length(result->'benefits') <> 1 then
    raise exception 'Skills or benefits lost'; end if;
  if jsonb_array_length(result->'channels') <> 4 then raise exception 'Default publishing channels missing'; end if;
  if result#>>'{channels,0,channel}' is distinct from 'careers_page' then raise exception 'Careers page channel missing'; end if;
  if (result->>'automationPercent')::numeric is distinct from 40 then raise exception 'Automation coverage wrong'; end if;
  if result#>>'{hiringTeam,0,userId}' is distinct from member::text then raise exception 'Hiring team member lost'; end if;
  if result#>>'{hiringTeam,0,roleLabel}' is distinct from 'Hiring Lead' then raise exception 'Hiring team role lost'; end if;
  if (result#>>'{stages,2,assessment,passingPercent}')::numeric is distinct from 80 then
    raise exception 'Assessment configuration lost'; end if;
  -- Seeded automation catalog: a configured stage is prefilled with its
  -- category's triggers and a concrete on/off state, never an empty list.
  if (select jsonb_array_length(s->'automations') from jsonb_array_elements(result->'stages') s
      where s->>'name' = 'Interview') <> 6 then
    raise exception 'Interview automation catalog not prefilled'; end if;
  if (select jsonb_array_length(s->'automations') from jsonb_array_elements(result->'stages') s
      where s->>'name' = 'Assessment') <> 2 then
    raise exception 'Assessment automation catalog not prefilled'; end if;
  if (select jsonb_array_length(s->'automations') from jsonb_array_elements(result->'stages') s
      where s->>'name' = 'Offer') <> 3 then
    raise exception 'Offer automation catalog not prefilled'; end if;
  if (select count(*) from jsonb_array_elements(result->'stages') s,
      jsonb_array_elements(s->'automations') a
    where s->>'name' = 'Interview' and (a->>'isEnabled')::boolean) <> 5 then
    raise exception 'Interview automation on/off defaults wrong'; end if;

  -- Publishing requires a pipeline and is idempotent-safe.
  result := recruitment_mutate(actor,org,'job.publish',job,'{}');
  if result->>'status' is distinct from 'open' or result->>'public_slug' is null then raise exception 'Publish failed'; end if;
  begin perform recruitment_mutate(actor,org,'job.status',job,jsonb_build_object('status','open'));
    raise exception 'Already open job accepted a reopen'; exception when invalid_parameter_value then null; end;
  -- The public board is unauthenticated and returns published jobs with their
  -- organisation and department names joined in.
  result := recruitment_public_jobs(null,null,null,null,null,null,null,null,null,50,0);
  if (result->>'total')::integer <> 1 then raise exception 'Public jobs total wrong'; end if;
  if result#>>'{items,0,title}' is distinct from 'Senior Product Designer' then
    raise exception 'Public job title wrong'; end if;
  if result#>>'{items,0,organizationName}' is distinct from 'Recruitment' then
    raise exception 'Public job organization name wrong'; end if;
  if result#>>'{items,0,departmentName}' is distinct from 'Product' then
    raise exception 'Public job department name wrong'; end if;
  if (recruitment_public_jobs(null,'designer',null,null,null,null,null,null,null,50,0)->>'total')::integer <> 1 then
    raise exception 'Public jobs search filter wrong'; end if;
  if (recruitment_public_jobs(null,null,'Recruitment',null,null,null,null,null,null,50,0)->>'total')::integer <> 1 then
    raise exception 'Public jobs organization filter wrong'; end if;
  if (recruitment_public_jobs(null,null,null,null,'hybrid',null,null,null,null,50,0)->>'total')::integer <> 1 then
    raise exception 'Public jobs work-arrangement filter wrong'; end if;
  if (recruitment_public_jobs(null,null,null,null,'remote',null,null,null,null,50,0)->>'total')::integer <> 0 then
    raise exception 'Public jobs work-arrangement filter wrong'; end if;
  if (recruitment_public_jobs(null,null,null,null,null,null,null,'2000-01-01','2999-01-01',50,0)->>'total')::integer <> 1 then
    raise exception 'Public jobs date range filter wrong'; end if;
  if (recruitment_public_jobs(null,null,null,null,null,null,null,'2000-01-01','2000-12-31',50,0)->>'total')::integer <> 0 then
    raise exception 'Public jobs date range exclusion wrong'; end if;

  -- Candidates move through the configured stages and keep a full history.
  result := recruitment_mutate(actor,org,'candidate.save',null,jsonb_build_object(
    'jobId',job,'fullName','Sarah Johnson','email','Sarah.Johnson@Example.com','source','linkedin',
    'currentRole','UX Designer','currentCompany','Google','matchScore',94));
  cand := (result->>'id')::uuid;
  if result->>'email' is distinct from 'sarah.johnson@example.com' then raise exception 'Email not normalised'; end if;
  if result->>'status' is distinct from 'new' then raise exception 'New candidate status wrong'; end if;
  select id into stage_interview from job_pipeline_stages where job_id=job and name='Interview';
  select id into stage_offer from job_pipeline_stages where job_id=job and name='Offer';
  result := recruitment_mutate(actor,org,'candidate.advance',cand,jsonb_build_object('stageId',stage_interview));
  if result->>'status' is distinct from 'interview' then raise exception 'Advance did not map the stage to a status'; end if;
  result := recruitment_mutate(actor,org,'candidate.advance',cand,
    jsonb_build_object('stageId',stage_offer,'status','rejected','rejectionReason','Role filled'));
  if result->>'status' is distinct from 'rejected' then raise exception 'Explicit candidate status ignored'; end if;
  if (select count(*) from candidate_stage_events where candidate_id=cand) <> 3 then
    raise exception 'Stage history incomplete'; end if;

  -- A stage from a different job is rejected.
  result := recruitment_mutate(actor,org,'job.save',null,jsonb_build_object('title','Frontend Developer'));
  second_job := (result->>'id')::uuid;
  begin perform recruitment_mutate(actor,org,'candidate.advance',cand,jsonb_build_object(
    'stageId',(select id from job_pipeline_stages where job_id=second_job limit 1)));
    raise exception 'Stage from another job accepted'; exception when invalid_parameter_value then null; end;
  begin perform recruitment_mutate(actor,org,'candidate.save',null,jsonb_build_object(
    'jobId',job,'fullName','Duplicate','email','sarah.johnson@example.com'));
    raise exception 'Duplicate applicant accepted'; exception when unique_violation then null; end;

  -- Dashboard, detail and pipeline statistics stay consistent.
  result := recruitment_metrics(actor,org,'2026-10-09');
  if result#>>'{summary,openJobs}' is distinct from '1' then raise exception 'Open job count wrong'; end if;
  if result#>>'{summary,draftJobs}' is distinct from '1' then raise exception 'Draft job count wrong'; end if;
  if result#>>'{summary,totalApplications}' is distinct from '1' then raise exception 'Application count wrong'; end if;
  if result#>>'{summary,rejectedTotal}' is distinct from '1' then raise exception 'Rejected count wrong'; end if;
  if result#>>'{summary,interviewsToday}' is distinct from '0' then raise exception 'Zero interviews lost'; end if;
  if result#>>'{pipeline,0,count}' is distinct from '1' then raise exception 'Pipeline applied count wrong'; end if;
  if result#>>'{applicationsBySource,0,source}' is distinct from 'linkedin' then raise exception 'Source breakdown wrong'; end if;
  if (result#>>'{applicationsBySource,0,percent}')::numeric is distinct from 100 then raise exception 'Source percent wrong'; end if;
  if jsonb_array_length(result->'recentActivity') = 0 then raise exception 'Recruitment activity missing'; end if;

  result := recruitment_job_stats(actor,org,job);
  if result->>'totalPositions' is distinct from '2' then raise exception 'Position count wrong'; end if;
  if result->>'filledPositions' is distinct from '0' or result->>'openPositions' is distinct from '2' then
    raise exception 'Open position count wrong'; end if;
  if result->>'rejected' is distinct from '1' then raise exception 'Job rejected count wrong'; end if;
  if jsonb_array_length(result->'byStage') <> 5 then raise exception 'Job stage breakdown wrong'; end if;

  result := recruitment_pipeline(actor,org,job,50);
  if jsonb_array_length(result->'stages') <> 5 then raise exception 'Pipeline board wrong'; end if;
  if (select count(*) from jsonb_array_elements(result->'stages') s
      where s#>>'{candidates,0,fullName}' = 'Sarah Johnson') <> 1 then
    raise exception 'Candidate card missing from the pipeline board'; end if;

  -- Revision conflicts are opt-in: omitting expectedRevision still saves.
  result := recruitment_mutate(actor,org,'job.save',job,
    jsonb_build_object('title','Senior Product Designer II','expectedRevision',1));
  revision := (result->>'revision')::integer;
  if revision <> 2 then raise exception 'Revision not incremented'; end if;
  begin perform recruitment_mutate(actor,org,'job.save',job,
    jsonb_build_object('title','Stale write','expectedRevision',1));
    raise exception 'Stale expectedRevision accepted'; exception when sqlstate 'PT409' then null; end;
  result := recruitment_mutate(actor,org,'job.save',job,jsonb_build_object('title','Senior Product Designer III'));
  if (result->>'revision')::integer <> revision + 1 then raise exception 'Last-write-wins save failed'; end if;
  if (select count(*) from job_revision_history where job_id=job) < 4 then raise exception 'Audit trail missing'; end if;
  if not exists(select 1 from organization_activities where organization_id=org and category='recruitment') then
    raise exception 'Recruitment activity not recorded'; end if;

  -- Indexed list queries return the totals and per-row counts the table shows.
  result := recruitment_job_list(actor,org,null,null,null,50,0);
  if (result->>'total')::integer <> 2 then raise exception 'Job list total wrong'; end if;
  if jsonb_array_length(result->'items') <> 2 then raise exception 'Job list items wrong'; end if;
  if (select count(*) from jsonb_array_elements(result->'items') i
      where i->>'departmentName' = 'Product') <> 1 then
    raise exception 'Job list department name missing'; end if;
  if (select count(*) from jsonb_array_elements(result->'items') i
      where (i->>'applicationCount')::integer = 1) <> 1 then
    raise exception 'Job list applicant count wrong'; end if;
  if (select count(*) from jsonb_array_elements(result->'items') i
      where (i->>'stageCount')::integer = 5) <> 2 then
    raise exception 'Job list stage count wrong'; end if;
  if (recruitment_job_list(actor,org,'draft',null,null,50,0)->>'total')::integer <> 1 then
    raise exception 'Job status filter wrong'; end if;
  if (recruitment_job_list(actor,org,null,null,'Frontend',50,0)->>'total')::integer <> 1 then
    raise exception 'Job search filter wrong'; end if;
  result := recruitment_candidate_list(actor,org,job,null,null,null,50,0);
  if (result->>'total')::integer <> 1 then raise exception 'Candidate list total wrong'; end if;
  if result#>>'{items,0,jobTitle}' is distinct from 'Senior Product Designer III' then
    raise exception 'Candidate job title not joined'; end if;
  if result#>>'{items,0,stageName}' is distinct from 'Offer' then
    raise exception 'Candidate stage not joined'; end if;
  if (recruitment_candidate_list(actor,org,job,null,'rejected',null,50,0)->>'total')::integer <> 1 then
    raise exception 'Candidate status filter wrong'; end if;
  if (recruitment_candidate_list(actor,org,job,null,null,'Sarah',50,0)->>'total')::integer <> 1 then
    raise exception 'Candidate search filter wrong'; end if;

  -- Public application records a candidate without an authenticated actor and
  -- routes it to the first pipeline stage.
  result := recruitment_public_apply(job, jsonb_build_object(
    'fullName','Public Applicant','email','public.applicant@example.com',
    'currentRole','Designer','resumeUrl','https://example.com/resume.pdf'));
  if result->>'status' is distinct from 'new' then raise exception 'Public application status wrong'; end if;
  if (select source from candidates where id = (result->>'id')::uuid) is distinct from 'careers_page' then
    raise exception 'Public application source wrong'; end if;
  if (select stage_id is not null from candidates where id = (result->>'id')::uuid) is not true then
    raise exception 'Public application not routed to a stage'; end if;
  begin perform recruitment_public_apply(job, jsonb_build_object(
    'fullName','Public Applicant','email','public.applicant@example.com'));
    raise exception 'Duplicate public application accepted'; exception when unique_violation then null; end;

  -- Hiring a candidate whose email matches a member creates an employee record
  -- and starts onboarding.
  result := recruitment_mutate(actor,org,'candidate.save',null,jsonb_build_object(
    'jobId',job,'fullName','Internal Hire','email','rec-member@test.invalid','source','manual'));
  perform recruitment_mutate(actor,org,'candidate.advance',(result->>'id')::uuid,
    jsonb_build_object('stageId',(select id from job_pipeline_stages where job_id=job and name='Hired')));
  if not exists(select 1 from hr_employees e join profiles p on p.id=e.user_id
      where e.organization_id=org and lower(p.email)='rec-member@test.invalid') then
    raise exception 'Hire did not create employee record'; end if;
  if not exists(select 1 from hr_onboarding o join hr_employees e on e.id=o.employee_id
      join profiles p on p.id=e.user_id
      where e.organization_id=org and lower(p.email)='rec-member@test.invalid') then
    raise exception 'Hire did not start onboarding'; end if;

  -- Closed jobs are read-only until they are reopened.
  perform recruitment_mutate(actor,org,'job.status',job,jsonb_build_object('status','closed'));
  begin perform recruitment_mutate(actor,org,'job.save',job,jsonb_build_object('title','Blocked edit'));
    raise exception 'Closed job edited'; exception when invalid_parameter_value then null; end;
  perform recruitment_mutate(actor,org,'job.status',job,jsonb_build_object('status','open'));

  -- Another tenant and the browser roles cannot reach any of it.
  begin perform recruitment_metrics(other,org,'2026-10-09'); raise exception 'Outsider read metrics';
    exception when insufficient_privilege then null; end;
  begin perform recruitment_job_detail(other,org,job); raise exception 'Outsider read the job';
    exception when insufficient_privilege then null; end;
  begin perform recruitment_mutate(other,org,'job.save',null,jsonb_build_object('title','Sneaky job'));
    raise exception 'Outsider created a job'; exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.jobs','select')
    or has_table_privilege('authenticated','public.candidates','select') then
    raise exception 'Recruitment tables exposed to the browser role'; end if;
  raise notice 'PASS: job wizard payload, detail bundle, publishing, candidate pipeline, dashboard and job statistics, revision conflicts, audit trail and tenant isolation';
end $$;
rollback;
