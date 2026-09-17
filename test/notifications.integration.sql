-- Isolated PostgreSQL, migrations 0001–0012. No emails sent. All fixtures roll back.
begin;
set local timezone='UTC';
do $$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); newcomer uuid:=gen_random_uuid(); org uuid; dep uuid; owner_role uuid; role_id uuid;
 team_id uuid; project_id uuid; task_id uuid; event_id uuid; result jsonb; invitation jsonb; job notification_outbox; n integer; before_count integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'owner@notifications.invalid',now()),(member,'member@notifications.invalid',now()),(other,'other@notifications.invalid',now()),(newcomer,'future@notifications.invalid',now());
 insert into organizations(name,industry_id,company_size,created_by) values('Notifications',(select id from industries limit 1),'1_10',actor) returning id into org;
 insert into organization_members values(org,actor,now()),(org,member,now());
 insert into organization_roles(organization_id,key,name,description) values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 insert into organization_role_permissions select owner_role,id from permissions where id in ('members.invite','departments.manage','workspace.view') on conflict do nothing;
 insert into departments(organization_id,name) values(org,'Engineering') returning id into dep;
 insert into employer_onboarding(user_id) values(actor) on conflict do nothing;
 -- Completion transition queues one durable welcome, without SMTP in the transaction.
 update employer_onboarding set organization_id=org,status='completed' where user_id=actor;
 update employer_onboarding set status='completed' where user_id=actor;
 if (select count(*) from notification_outbox where kind='workspace.ready')<>1 then raise exception 'Welcome not idempotent'; end if;
 set local role service_role;
 if has_function_privilege('authenticated','public.accept_organization_invitation(uuid,text)','execute') then raise exception 'Accept RPC exposed'; end if;
 if has_table_privilege('anon','public.notification_outbox','select') then raise exception 'Outbox exposed'; end if;
 perform set_department_members(actor,org,dep,array[member],(select membership_revision from departments where id=dep));
 perform set_department_members(actor,org,dep,array[member],(select membership_revision from departments where id=dep));
 if (select count(*) from notification_outbox where kind='department.added')<>1 then raise exception 'Duplicate department notification'; end if;
 begin
  perform set_department_members(actor,org,dep,array[other],(select membership_revision from departments where id=dep));
  raise exception 'Outsider added';
 exception when invalid_parameter_value then null; end;
 if not exists(select 1 from organization_department_members where department_id=dep and user_id=member) then raise exception 'Failed write lost membership'; end if;
 perform set_department_members(actor,org,dep,'{}',(select membership_revision from departments where id=dep));
 if (select count(*) from notification_outbox where kind='department.removed')<>1 then raise exception 'Missing removal'; end if;
 result:=workflow_mutate(actor,org,'role.save',null,'{"name":"Engineer","status":"active","permissionIds":["tasks.view","teams.view","workspace.view"]}');role_id:=(result->>'id')::uuid;
 perform workflow_mutate(actor,org,'member.assign',member,jsonb_build_object('roleIds',array[role_id]));
 perform workflow_mutate(actor,org,'member.assign',member,jsonb_build_object('roleIds',array[role_id]));
 if (select count(*) from notification_outbox where kind='role.assigned')<>1 then raise exception 'Duplicate role assignment'; end if;
 perform workflow_mutate(actor,org,'role.permissions',role_id,jsonb_build_object('permissionIds',array['tasks.view','teams.view','workspace.view'],'expectedRevision',(select revision from organization_roles where id=role_id)));
 if exists(select 1 from notification_outbox where kind='role.changed') then raise exception 'Unchanged grants notified'; end if;
 perform workflow_mutate(actor,org,'role.permissions',role_id,jsonb_build_object('permissionIds',array['tasks.view','workspace.view'],'expectedRevision',(select revision from organization_roles where id=role_id)));
 if not exists(select 1 from notification_outbox where kind='role.changed') then raise exception 'Access change missed'; end if;
 result:=workflow_mutate(actor,org,'team.save',null,jsonb_build_object('name','Backend','departmentId',dep,'memberIds',array[member]));team_id:=(result->>'id')::uuid;
 perform workflow_mutate(actor,org,'team.members',team_id,jsonb_build_object('memberIds',array[member],'expectedRevision',(select membership_revision from organization_teams where id=team_id)));
 if (select count(*) from notification_outbox where kind='team.added')<>1 then raise exception 'Replacement sent duplicate member email'; end if;
 result:=workflow_mutate(actor,org,'project.save',null,jsonb_build_object('name','Delivery','departmentId',dep,'teamId',team_id,'resourceManagerId',actor,'priority','high','startDate',current_date,'endDate',current_date+10));project_id:=(result->>'id')::uuid;
 result:=workflow_mutate(actor,org,'task.save',null,jsonb_build_object('name','Implement','projectId',project_id,'assigneeId',member,'priority','normal','startDate',current_date,'dueDate',current_date+1));task_id:=(result->>'id')::uuid;
 if not exists(select 1 from notification_outbox where kind='task.assigned') then raise exception 'Missing assignment email'; end if;
 perform queue_notification_reminders(); perform queue_notification_reminders();
 if (select count(*) from notification_outbox where kind='task.due')<>1 then raise exception 'Repeated reminder: %', (select jsonb_agg(jsonb_build_object('kind',kind,'recipient',recipient_id,'key',dedupe_key)) from notification_outbox where category='reminder'); end if;
 perform workflow_mutate(actor,org,'task.save',task_id,'{"status":"done"}');
 insert into calendar_events(organization_id,kind,title,starts_at,ends_at,timezone,organizer_id,created_by,attendees)
 values(org,'team_meeting','Planning',now()+interval '30 minutes',now()+interval '90 minutes','UTC',actor,actor,jsonb_build_array(jsonb_build_object('userId',member,'response','pending'))) returning id into event_id;
 update calendar_events set title=title where id=event_id;
 if (select count(*) from notification_outbox where kind='calendar.invited')<>1 or exists(select 1 from notification_outbox where kind='calendar.updated') then raise exception 'Calendar duplicate'; end if;
 perform queue_notification_reminders();
 delete from calendar_events where id=event_id;
 if not exists(select 1 from notification_outbox where kind='calendar.cancelled') then raise exception 'Missing cancellation'; end if;
 perform set_notification_preferences(member,'off',false);
 perform queue_notification(org,member,'test.activity','Test','Body','pref-off','activity');
 if exists(select 1 from notification_outbox where dedupe_key='pref-off') then raise exception 'Preference ignored'; end if;
 perform set_notification_preferences(member,'daily',null);
 if (select reminders from notification_preferences where user_id=member) then raise exception 'Partial preference update reset reminders'; end if;
 perform queue_notification(org,member,'test.digest','Digest','Body','digest','activity');
 if not exists(select 1 from notification_outbox where dedupe_key='digest' and available_at>now() and payload->>'delivery'='daily') then raise exception 'Digest scheduling failed'; end if;
 -- Invite is not a membership grant until verified acceptance; repeat accept is harmless.
 invitation:=create_organization_invitation(actor,org,'other@notifications.invalid',array[role_id],dep,'hash-one','token-one');
 if exists(select 1 from organization_members where organization_id=org and user_id=other) then raise exception 'Invite auto-granted membership'; end if;
 begin
  perform accept_organization_invitation(member,'hash-one');raise exception 'Wrong account accepted';
 exception when insufficient_privilege then null; end;
 perform accept_organization_invitation(other,'hash-one');
 select count(*) into before_count from notification_outbox;
 perform accept_organization_invitation(other,'hash-one');
 if (select count(*) from notification_outbox)<>before_count then raise exception 'Accept duplicate'; end if;
 if not exists(select 1 from organization_department_members where department_id=dep and user_id=other) then raise exception 'Invitation department missing'; end if;
 invitation:=create_organization_invitation(actor,org,'future@notifications.invalid',array[role_id],null,'hash-two','token-two');
 perform revoke_organization_invitation(actor,org,(invitation->>'id')::uuid);
 begin perform accept_organization_invitation(newcomer,'hash-two'); raise exception 'Revoked invitation accepted'; exception when invalid_parameter_value then null; end;
 invitation:=create_organization_invitation(actor,org,'future@notifications.invalid',array[role_id],null,'hash-three','token-three');
 update organization_invitations set expires_at=now()-interval '1 second' where id=(invitation->>'id')::uuid;
 begin perform accept_organization_invitation(newcomer,'hash-three'); raise exception 'Expired invitation accepted'; exception when invalid_parameter_value then null; end;
 -- Rollback of a workflow change also rolls back its outbox insert.
 select count(*) into before_count from notification_outbox;
 begin
  perform workflow_mutate(actor,org,'member.unassign',member,jsonb_build_object('roleIds',array[role_id]));
  raise exception 'rollback test' using errcode='22023';
 exception when invalid_parameter_value then null; end;
 if (select count(*) from notification_outbox)<>before_count then raise exception 'Rollback leaked notification'; end if;
 -- Claim suppresses stale reminders and accepted/revoked invitation messages.
 select * into job from claim_notification_emails(1);
 if job.id is null then raise exception 'No claim'; end if;
 if exists(select 1 from notification_outbox where kind in ('task.due','calendar.reminder','organization.invited') and status='pending') then raise exception 'Stale email pending'; end if;
 if exists(select 1 from claim_notification_emails(20) where id=job.id) then raise exception 'Concurrent double claim'; end if;
 if finish_notification_email(job.id,gen_random_uuid(),true) then raise exception 'Wrong lease accepted'; end if;
 if not finish_notification_email(job.id,job.lease_id,false) then raise exception 'Retry not recorded'; end if;
 if not exists(select 1 from notification_outbox where id=job.id and status='pending' and available_at>now()) then raise exception 'No retry backoff'; end if;
 update notification_outbox set status='processing',attempts=6,leased_until=now()-interval '1 minute' where id=job.id;
 perform claim_notification_emails(1);
 if not exists(select 1 from notification_outbox where id=job.id and status='failed') then raise exception 'Infinite retry'; end if;
 raise notice 'PASS: membership, role changes, task/calendar notifications, preferences, invitation identity and acceptance, rollback, stale suppression, leases and retries';
end $$;
rollback;
