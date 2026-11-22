begin;

-- Public, unauthenticated job application for the careers board. The caller is
-- never an authenticated actor, so the candidate is recorded without a
-- created_by or actor_id and routed to the job's first pipeline stage.
create or replace function public.recruitment_public_apply(p_job uuid, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare job_row jobs; first_stage uuid; cand candidates;
begin
  select * into job_row from jobs where id = p_job;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if job_row.status <> 'open' or job_row.published_at is null then
    raise exception 'This job is not accepting applications' using errcode = '22023';
  end if;
  if job_row.closes_on is not null and job_row.closes_on <
    (now() at time zone coalesce(
      (select timezone from organization_settings where organization_id = job_row.organization_id), 'UTC'))::date then
    raise exception 'This job is closed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data) <> 'object' or exists(
    select 1 from jsonb_object_keys(p_data) k
    where k not in ('fullName','email','phone','resumeUrl','currentRole','currentCompany')
  ) then
    raise exception 'Invalid fields' using errcode = '22023';
  end if;
  if nullif(btrim(p_data->>'fullName'),'') is null then
    raise exception 'Full name is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_data->>'email'),'') is null
    or position('@' in btrim(p_data->>'email')) = 0 then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if exists(select 1 from candidates where job_id = p_job and email = lower(btrim(p_data->>'email'))) then
    raise exception 'You have already applied to this job' using errcode = '23505';
  end if;
  select id into first_stage from job_pipeline_stages
    where job_id = p_job order by display_order limit 1;
  insert into candidates (
    organization_id, job_id, stage_id, full_name, email, phone, source,
    "current_role", current_company, resume_url, status
  ) values (
    job_row.organization_id, p_job, first_stage,
    btrim(p_data->>'fullName'), lower(btrim(p_data->>'email')),
    nullif(btrim(coalesce(p_data->>'phone','')),''),
    'careers_page',
    nullif(btrim(coalesce(p_data->>'currentRole','')),''),
    nullif(btrim(coalesce(p_data->>'currentCompany','')),''),
    nullif(btrim(coalesce(p_data->>'resumeUrl','')),''),
    'new'
  ) returning * into cand;
  insert into candidate_stage_events (organization_id, candidate_id, to_stage_id, to_status, actor_id)
  values (job_row.organization_id, cand.id, cand.stage_id, cand.status, null);
  insert into organization_activities (organization_id, category, kind, title, summary, actor_id, subject_type, subject_id)
  values (job_row.organization_id, 'recruitment', 'candidate_added', cand.full_name,
    'New application received from the careers board', null, 'candidate', cand.id);
  return jsonb_build_object(
    'id', cand.id,
    'jobId', cand.job_id,
    'jobTitle', job_row.title,
    'fullName', cand.full_name,
    'email', cand.email,
    'status', cand.status,
    'appliedAt', cand.applied_at
  );
end $$;

-- Invitations now tell the employer whether the invited email is already a
-- registered account, so the UI can show a profile for known users and a
-- pending workspace-only invitation for everyone else.
create or replace function public.create_organization_invitation(
  p_actor uuid, p_org uuid, p_email text, p_roles uuid[], p_department uuid,
  p_hash text, p_token text
) returns jsonb language plpgsql set search_path = public as $$
declare v_id uuid; v_role uuid; v_owner boolean; v_registered boolean;
begin
  perform 1 from organizations where id = p_org for update;
  if not workflow_has_permission(p_actor,p_org,'roles.assign')
    or not workflow_has_permission(p_actor,p_org,'members.invite') then
    raise exception 'Permission required' using errcode = '42501';
  end if;
  if cardinality(p_roles) not between 1 and 20 then raise exception 'Select roles' using errcode = '22023'; end if;
  select exists(select 1 from organization_member_roles m
    join organization_roles r on r.id = m.organization_role_id
    where m.organization_id = p_org and m.user_id = p_actor and r.key = 'organisation_owner') into v_owner;
  for v_role in select unnest(p_roles) loop
    if not exists(select 1 from organization_roles
      where id = v_role and organization_id = p_org and status = 'active' and not is_system) then
      raise exception 'Choose active custom roles' using errcode = '22023';
    end if;
    if not v_owner and exists(select 1 from organization_role_permissions
      where organization_role_id = v_role and not workflow_has_permission(p_actor,p_org,permission_id)) then
      raise exception 'Role exceeds your permissions' using errcode = '42501';
    end if;
  end loop;
  if p_department is not null and (not workflow_has_permission(p_actor,p_org,'departments.manage')
    or not exists(select 1 from departments where id = p_department and organization_id = p_org and not is_archived)) then
    raise exception 'Department not available' using errcode = '42501';
  end if;
  if exists(select 1 from organization_members m join profiles p on p.id = m.user_id
    where m.organization_id = p_org and lower(p.email) = lower(p_email)) then
    raise exception 'Already a member' using errcode = '23505';
  end if;
  select exists(select 1 from profiles p where lower(p.email) = lower(p_email)) into v_registered;
  update organization_invitations set status = 'revoked'
    where organization_id = p_org and lower(email) = lower(p_email) and status = 'pending';
  insert into organization_invitations(organization_id,email,invited_by,token_hash,role_ids,department_id)
  values(p_org,lower(p_email),p_actor,p_hash,p_roles,p_department) returning id into v_id;
  perform queue_notification(p_org,null,'organization.invited','You have been invited to a workspace',
    'Sign in or create an account with this email address, then accept your invitation. It expires in seven days.',
    'invite:'||v_id,'essential',jsonb_build_object('invitationId',v_id,'token',p_token),lower(p_email));
  return jsonb_build_object('id',v_id,'email',lower(p_email),'status','pending',
    'expiresAt',now()+interval '7 days','emailStatus','queued','isRegisteredUser',v_registered);
end $$;

create or replace function public.list_organization_invitations(
  p_actor uuid, p_org uuid, p_page integer default 1, p_limit integer default 50
)
returns jsonb language plpgsql stable set search_path = public as $$
declare items jsonb; total integer;
begin
  if not workflow_has_permission(p_actor, p_org, 'members.invite') then
    raise exception 'Permission required' using errcode = '42501';
  end if;
  if p_page < 1 or p_limit not between 1 and 100 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  select count(*) into total from organization_invitations i where i.organization_id = p_org;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.email, 'status', i.status,
    'expiresAt', i.expires_at, 'createdAt', i.created_at,
    'isRegisteredUser', exists(select 1 from profiles p where lower(p.email) = lower(i.email))
  ) order by i.created_at desc), '[]'::jsonb) into items
  from (
    select i.* from organization_invitations i
    where i.organization_id = p_org
    order by i.created_at desc
    limit p_limit offset (p_page - 1) * p_limit
  ) i;
  return jsonb_build_object('items', items, 'total', total, 'page', p_page, 'limit', p_limit);
end $$;

revoke all on function public.recruitment_public_apply(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.list_organization_invitations(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.recruitment_public_apply(uuid, jsonb) to service_role;
grant execute on function public.list_organization_invitations(uuid, uuid, integer, integer) to service_role;

notify pgrst, 'reload schema';
commit;
