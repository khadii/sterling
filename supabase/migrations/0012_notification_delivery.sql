-- Apply after 0011. Record RSVP changes for the organizer without sending SMTP
-- inside the event transaction. Existing invitation/update triggers are preserved.
begin;
create or replace function public.calendar_rsvp_notification_trigger()
returns trigger language plpgsql set search_path=public as $$
declare attendee record; attendee_name text; batch_key text:=gen_random_uuid()::text;
begin
 for attendee in
  select distinct (n->>'userId')::uuid as user_id, n->>'response' as response
  from jsonb_array_elements(new.attendees) n
  join jsonb_array_elements(old.attendees) o on o->>'userId'=n->>'userId'
  where coalesce(n->>'response','pending') is distinct from coalesce(o->>'response','pending')
    and n->>'response' in ('accepted','declined')
    and (n->>'userId')::uuid<>new.organizer_id
 loop
  select coalesce(nullif(display_name,''),'An attendee') into attendee_name
  from profiles where id=attendee.user_id;
  perform queue_notification(new.organization_id,new.organizer_id,
   'calendar.rsvp','Calendar invitation response',
   coalesce(attendee_name,'An attendee')||' has a recorded response of '||attendee.response||' for '||new.title||'. Open the event to view attendees.',
   batch_key||attendee.user_id,'activity');
 end loop;
 return new;
end $$;
revoke all on function public.calendar_rsvp_notification_trigger() from public,anon,authenticated;
grant execute on function public.calendar_rsvp_notification_trigger() to service_role;
drop trigger if exists calendar_rsvp_notifications on public.calendar_events;
create trigger calendar_rsvp_notifications after update of attendees on public.calendar_events
for each row execute function public.calendar_rsvp_notification_trigger();
-- Workflow role triggers may already have seeded these grants. Provisioning must
-- tolerate that overlap, while preserving all existing default permissions.
create or replace function public.provision_employer_workspace(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  onboarding public.employer_onboarding;
  organization_uuid uuid;
  pipeline_uuid uuid;
  owner_role_uuid uuid;
  role_record record;
  permission_key text;
begin
  perform public.ensure_employer_onboarding(p_user_id);
  select * into onboarding from public.employer_onboarding where user_id = p_user_id for update;
  if onboarding.status = 'completed' then return onboarding.organization_id; end if;
  if not (onboarding.completed_steps @> array[1,2,3]::smallint[]) then
    raise exception using errcode = 'P0001', message = 'All onboarding steps must be completed';
  end if;
  update public.employer_onboarding set status = 'provisioning' where user_id = p_user_id;
  insert into public.organizations (
    name, industry_id, website, company_size, logo_path, created_by
  ) values (
    onboarding.company_name, onboarding.industry_id, onboarding.company_website,
    onboarding.company_size, onboarding.logo_path, p_user_id
  ) returning id into organization_uuid;
  insert into public.organization_settings (
    organization_id, country_code, timezone, locale, week_starts_on, date_format
  ) values (
    organization_uuid, onboarding.country_code, onboarding.timezone, onboarding.locale,
    coalesce(onboarding.week_starts_on, 'monday'), coalesce(onboarding.date_format, 'DD/MM/YYYY')
  );
  insert into public.departments (organization_id, name, description, display_order)
  select organization_uuid, item->>'name', nullif(item->>'description', ''), (ordinality - 1)::smallint
  from jsonb_array_elements(onboarding.department_drafts) with ordinality as d(item, ordinality);
  insert into public.hiring_pipelines (organization_id, name, is_default)
  values (organization_uuid, 'Default Pipeline', true) returning id into pipeline_uuid;
  insert into public.hiring_pipeline_stages (pipeline_id, name, display_order) values
    (pipeline_uuid, 'Applied', 0), (pipeline_uuid, 'Screening', 1),
    (pipeline_uuid, 'Interview', 2), (pipeline_uuid, 'Offer', 3),
    (pipeline_uuid, 'Hired', 4), (pipeline_uuid, 'Rejected', 5);
  insert into public.organization_roles (organization_id, key, name, description) values
    (organization_uuid, 'organisation_owner', 'Organisation Owner', 'Full control including ownership and billing'),
    (organization_uuid, 'organisation_admin', 'Organisation Admin', 'Workspace administration excluding ownership and billing'),
    (organization_uuid, 'recruiter', 'Recruiter', 'Recruitment management across permitted jobs'),
    (organization_uuid, 'hiring_manager', 'Hiring Manager', 'Management of assigned jobs and candidates'),
    (organization_uuid, 'interviewer', 'Interviewer', 'Interview participation and feedback');
  for role_record in select id, key from public.organization_roles where organization_id = organization_uuid loop
    for permission_key in
      select unnest(case role_record.key
        when 'organisation_owner' then array(select id from public.permissions where id like 'workspace.%' or id in (
          'billing.manage','members.invite','members.manage','roles.assign','departments.manage','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view','audit_log.view'))
        when 'organisation_admin' then array['workspace.view','workspace.update','members.invite','members.manage','roles.assign','departments.manage','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view','audit_log.view']
        when 'recruiter' then array['workspace.view','jobs.create','jobs.publish','jobs.manage_all','jobs.manage_assigned','candidates.view_all','candidates.view_assigned','candidates.manage','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view','offers.manage','reports.view']
        when 'hiring_manager' then array['workspace.view','jobs.manage_assigned','candidates.view_assigned','interviews.manage','interviews.participate','feedback.submit','feedback.view','private_notes.view','offers.view']
        else array['workspace.view','candidates.view_assigned','interviews.participate','feedback.submit']
      end)
    loop
      insert into public.organization_role_permissions (organization_role_id, permission_id)
      values (role_record.id, permission_key) on conflict do nothing;
    end loop;
  end loop;
  insert into public.organization_members (organization_id, user_id) values (organization_uuid, p_user_id);
  select id into owner_role_uuid from public.organization_roles
    where organization_id = organization_uuid and key = 'organisation_owner';
  insert into public.organization_member_roles (organization_id, user_id, organization_role_id)
  values (organization_uuid, p_user_id, owner_role_uuid);
  update public.employer_onboarding set
    status = 'completed', current_step = 4, organization_id = organization_uuid,
    completed_at = now()
  where user_id = p_user_id;
  return organization_uuid;
end;
$$;
commit;
