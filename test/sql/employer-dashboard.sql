-- Run after migrations 0001-0007 in a disposable database.
begin;

do $$
declare
  actor uuid := gen_random_uuid();
  organization uuid;
  event_id uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (actor, 'dashboard-test@example.com', '{"role":"employer"}', now());
  perform public.save_company_onboarding_draft(
    actor, 0,
    jsonb_build_object(
      'name', 'Dashboard Test',
      'industryId', (select id from public.industries limit 1),
      'size', '11_25'
    )
  );
  perform public.complete_employer_onboarding_step(actor, 1::smallint);
  perform public.save_department_onboarding_draft(
    actor, 0,
    jsonb_build_array(jsonb_build_object('clientId', 'eng', 'name', 'Engineering'))
  );
  perform public.complete_employer_onboarding_step(actor, 2::smallint);
  perform public.save_workspace_settings_draft(
    actor, 0,
    '{"countryCode":"NG","timezone":"Africa/Lagos","locale":"en-NG","weekStartsOn":"monday","dateFormat":"DD/MM/YYYY"}'
  );
  perform public.complete_employer_onboarding_step(actor, 3::smallint);
  organization := public.provision_employer_workspace(actor);

  if not exists (
    select 1
    from public.organization_member_roles mr
    join public.organization_role_permissions rp
      on rp.organization_role_id = mr.organization_role_id
    where mr.organization_id = organization
      and mr.user_id = actor
      and rp.permission_id in ('calendar.view', 'calendar.manage', 'activity.view')
    group by mr.user_id
    having count(distinct rp.permission_id) = 3
  ) then
    raise exception 'Owner did not receive dashboard permissions';
  end if;

  insert into public.calendar_events (
    organization_id, kind, title, starts_at, ends_at, timezone,
    organizer_id, created_by
  ) values (
    organization, 'team_meeting', 'Weekly planning',
    '2026-09-07T09:00:00Z', '2026-09-07T10:00:00Z', 'Africa/Lagos',
    actor, actor
  ) returning id into event_id;

  if not exists (
    select 1 from public.organization_activities
    where organization_id = organization
      and subject_type = 'calendar_event'
      and subject_id = event_id
      and kind = 'calendar_event_created'
  ) then
    raise exception 'Calendar event activity was not recorded';
  end if;

  begin
    insert into public.calendar_events (
      organization_id, kind, title, starts_at, ends_at, timezone,
      organizer_id, created_by
    ) values (
      organization, 'team_meeting', 'Invalid meeting',
      '2026-09-07T10:00:00Z', '2026-09-07T09:00:00Z', 'Africa/Lagos',
      actor, actor
    );
    raise exception 'Invalid event range was accepted';
  exception when check_violation then null;
  end;

  if has_table_privilege('authenticated', 'public.calendar_events', 'INSERT') then
    raise exception 'Authenticated role can bypass the API to insert calendar events';
  end if;
  if has_table_privilege('authenticated', 'public.organization_activities', 'INSERT') then
    raise exception 'Authenticated role can forge activity events';
  end if;
end $$;

rollback;
