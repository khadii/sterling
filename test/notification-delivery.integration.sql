-- Isolated PostgreSQL with migrations 0001–0012. No SMTP; fixtures roll back.
begin;
do $$
#variable_conflict use_variable
declare owner_id uuid:=gen_random_uuid(); attendee_id uuid:=gen_random_uuid(); broken_id uuid:=gen_random_uuid(); org uuid; event_id uuid; claimed notification_outbox;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,'owner@delivery.invalid',now()),(attendee_id,'attendee@delivery.invalid',now()),(broken_id,'broken@delivery.invalid',now());
 insert into user_roles(user_id,role_id) values(owner_id,'employer'),(broken_id,'employer');
 perform ensure_employer_onboarding(owner_id);
 update employer_onboarding set company_name='Delivery test',industry_id=(select id from industries limit 1),company_size='1_10',country_code='NG',timezone='Africa/Lagos',locale='en',completed_steps=array[1,2,3]::smallint[] where user_id=owner_id;
 set local role service_role;
 org:=provision_employer_workspace(owner_id);
 if provision_employer_workspace(owner_id)<>org then raise exception 'Repeat completion created a workspace';end if;
 if (select count(*) from notification_outbox where organization_id=org and kind='workspace.ready' and recipient_id=owner_id and status='pending')<>1 then raise exception 'Completion must queue exactly one welcome';end if;
 select * into claimed from claim_notification_emails(20) where kind='workspace.ready' and organization_id=org;
 if claimed.id is null then raise exception 'Welcome not deliverable';end if;
 perform finish_notification_email(claimed.id,claimed.lease_id,true);
 if not exists(select 1 from notification_outbox where id=claimed.id and status='sent' and sent_at is not null) then raise exception 'Welcome result not saved';end if;
 -- Incomplete onboarding must not leave a workspace or a welcome notification.
 begin perform provision_employer_workspace(broken_id);raise exception 'Incomplete setup allowed' using errcode='22023';exception when raise_exception then null;end;
 if exists(select 1 from notification_outbox where recipient_id=broken_id) then raise exception 'Failed setup queued mail';end if;
 insert into organization_members(organization_id,user_id) values(org,attendee_id);
 insert into calendar_events(organization_id,kind,title,starts_at,ends_at,timezone,organizer_id,created_by,attendees)
 values(org,'team_meeting','Planning',now()+interval '2 hours',now()+interval '3 hours','UTC',owner_id,owner_id,jsonb_build_array(jsonb_build_object('userId',attendee_id,'response','pending'))) returning id into event_id;
 update calendar_events set attendees=jsonb_build_array(jsonb_build_object('userId',attendee_id,'response','accepted')) where id=event_id;
 update calendar_events set attendees=attendees where id=event_id;
 if (select count(*) from notification_outbox where organization_id=org and kind='calendar.rsvp' and recipient_id=owner_id)<>1 then raise exception 'RSVP missing or duplicated';end if;
 perform set_notification_preferences(owner_id,'off',true);
 update calendar_events set attendees=jsonb_build_array(jsonb_build_object('userId',attendee_id,'response','declined')) where id=event_id;
 if (select count(*) from notification_outbox where organization_id=org and kind='calendar.rsvp')<>1 then raise exception 'RSVP opt-out ignored';end if;
 if has_function_privilege('authenticated','public.calendar_rsvp_notification_trigger()','execute') then raise exception 'Trigger publicly executable';end if;
 raise notice 'PASS: actual workspace provisioning, repeat completion, failed setup, welcome claim/ack, RSVP changes, no-op updates and preferences';
end $$;
rollback;
