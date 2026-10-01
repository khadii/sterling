begin;
do $$
#variable_conflict use_variable
declare actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); org uuid; dep uuid; role_id uuid; owner_role uuid; employee uuid; req uuid; run uuid; result jsonb; attendance uuid;attendance_count integer;team uuid;dep2 uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'hr-owner@test.invalid',now()),(member,'hr-member@test.invalid',now()),(other,'hr-other@test.invalid',now());
 insert into organizations(name,industry_id,company_size,created_by) values('HR',(select id from industries limit 1),'1_10',actor) returning id into org;
 insert into organization_settings(organization_id,country_code,timezone,locale,week_starts_on,date_format) values(org,'NG','Africa/Lagos','en','monday','DD/MM/YYYY');
 insert into organization_members(organization_id,user_id) values(org,actor),(org,member);
 insert into organization_roles(organization_id,key,name,description) values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 insert into departments(organization_id,name) values(org,'Mechanical Engineering') returning id into dep;
 insert into organization_roles(organization_id,key,name,department_id,description) values(org,'mechanical','Mechanical Engineer',dep,'Engineer') returning id into role_id;
 insert into organization_role_permissions select owner_role,id from permissions on conflict do nothing;
 set local role service_role;
 result:=hr_metrics(actor,org,'2026-09-20');
 if result#>>'{summary,headcount}' is distinct from '0' or result#>>'{summary,openRoles}' is distinct from '0' then raise exception 'Zero count lost';end if;
 result:=hr_mutate(actor,org,'employees',null,jsonb_build_object('user_id',member,'department_id',dep,'role_id',role_id,'starts_on','2026-09-01','annual_salary',120000,'currency','USD'));employee:=(result->>'id')::uuid;
 perform hr_mutate(actor,org,'onboarding',null,jsonb_build_object('employee_id',employee,'checklist','[{"title":"Laptop","completed":true},{"title":"Intro","completed":false}]'::jsonb));
 result:=hr_employee_stats(actor,org,employee,'2026-09-20');if (result#>>'{onboarding,progressPercent}')::numeric is distinct from 50 then raise exception 'Checklist incorrect';end if;
 perform hr_mutate(actor,org,'requisitions',null,jsonb_build_object('role_id',role_id,'positions',3));
 result:=hr_role_stats(actor,org,role_id,'2026-09-20');if result->>'filledPositions' is distinct from '1' or result->>'openPositions' is distinct from '2' then raise exception 'Role counts wrong';end if;
 result:=hr_metrics(actor,org,'2026-09-20');if result#>>'{summary,headcount}' is distinct from '1' or result#>>'{summary,openRoles}' is distinct from '2' then raise exception 'Dashboard count incorrect';end if;
 if hr_workdays('2026-09-18','2026-09-21') is distinct from 2 then raise exception 'Weekend counted as leave';end if;
 perform hr_mutate(actor,org,'entitlements',null,jsonb_build_object('employee_id',employee,'year',2026,'leave_type','annual','days',5));
 result:=hr_mutate(actor,org,'leave',null,jsonb_build_object('employee_id',employee,'leave_type','annual','starts_on','2026-09-21','ends_on','2026-09-23'));req:=(result->>'id')::uuid;
 perform hr_decide(actor,org,'leave',array[req],'approved');perform hr_decide(actor,org,'leave',array[req],'approved');
 if (select count(*) from calendar_events where source='leave' and source_id=req) is distinct from 1 then raise exception 'Leave event duplicate';end if;
 result:=hr_employee_stats(actor,org,employee,'2026-09-20');if (result#>>'{leaveBalances,0,remaining}')::numeric is distinct from 2 then raise exception 'Balance wrong';end if;
 begin perform hr_mutate(other,org,'employees',null,jsonb_build_object('user_id',other));raise exception 'Outsider allowed';exception when insufficient_privilege then null;end;
 result:=hr_mutate(actor,org,'leave',null,jsonb_build_object('employee_id',employee,'leave_type','annual','starts_on','2026-09-22','ends_on','2026-09-24'));
 begin perform hr_decide(actor,org,'leave',array[(result->>'id')::uuid],'approved');raise exception 'Overlap allowed';exception when invalid_parameter_value then null;end;
 perform hr_decide(actor,org,'leave',array[req],'cancelled');
 if exists(select 1 from calendar_events where source='leave' and source_id=req) then raise exception 'Cancelled leave visible';end if;
 result:=hr_mutate(actor,org,'attendance',null,jsonb_build_object('employee_id',employee,'date','2026-09-20','hours',8,'state','present'));attendance:=(result->>'id')::uuid;
 result:=hr_mutate(actor,org,'payroll',null,'{"starts_on":"2026-09-01","ends_on":"2026-09-30","closes_on":"2026-09-28","currency":"USD"}');run:=(result->>'id')::uuid;
 perform hr_mutate(actor,org,'payroll-lines',null,jsonb_build_object('payroll_id',run,'employee_id',employee,'gross',10000,'deductions',1000));
 result:=hr_payroll_stats(actor,org,run);if (result->>'netTotal')::numeric is distinct from 9000 then raise exception 'Payroll arithmetic wrong';end if;
 begin perform hr_action(actor,org,'payroll',run,'finalize');raise exception 'Unapproved timesheet finalized';exception when invalid_parameter_value then null;end;
 perform hr_decide(actor,org,'attendance',array[attendance],'approved');perform hr_action(actor,org,'payroll',run,'finalize');
 if (hr_payroll_stats(actor,org,run)->>'status') is distinct from 'finalized' then raise exception 'Payroll not finalized';end if;
 if has_table_privilege('authenticated','public.hr_employees','select') then raise exception 'HR table exposed';end if;
 -- A finalized run cannot be changed through a line PATCH.
 begin perform hr_mutate(actor,org,'payroll-lines',(select id from hr_payroll_lines where payroll_id=run limit 1),jsonb_build_object('gross',0,'deductions',0));raise exception 'Finalized line edited';exception when invalid_parameter_value then null;end;
 -- Zero salary is a real value, not missing data.
 perform hr_mutate(actor,org,'employees',employee,'{"annual_salary":0}');
 result:=hr_role_stats(actor,org,role_id,hr_today(org));if (result#>>'{averageSalaryByCurrency,0,average}')::numeric is distinct from 0 then raise exception 'Zero average lost';end if;
 perform hr_mutate(actor,org,'onboarding',(select id from hr_onboarding where employee_id=employee),'{"checklist":[]}');
 if (hr_employee_stats(actor,org,employee,'2026-09-20')#>>'{onboarding,progressPercent}')::numeric is distinct from 0 then raise exception 'Empty checklist wrong';end if;
 -- Ordered approvals remain pending until every approver acts; replay is safe.
 insert into organization_members(organization_id,user_id) values(org,other);
 insert into organization_member_roles values(org,other,owner_role);
 perform hr_set_approval_chain(actor,org,'leave',array[actor,other]);
 result:=hr_mutate(actor,org,'leave',null,jsonb_build_object('employee_id',employee,'leave_type','annual','starts_on','2026-09-28','ends_on','2026-09-28'));req:=(result->>'id')::uuid;
 begin perform hr_decide(other,org,'leave',array[req],'approved');raise exception 'Out of order approval accepted';exception when insufficient_privilege then null;end;
 perform hr_decide(actor,org,'leave',array[req],'approved');perform hr_decide(actor,org,'leave',array[req],'approved');
 if (select status from hr_leave where id=req) is distinct from 'pending' then raise exception 'Chain finalized early';end if;
 begin perform hr_mutate(actor,org,'leave',req,'{"reason":"change after approval"}');raise exception 'Approved step data edited';exception when invalid_parameter_value then null;end;
 perform hr_decide(other,org,'leave',array[req],'approved');
 if (select status from hr_leave where id=req) is distinct from 'approved' then raise exception 'Chain not finalized';end if;
 perform hr_decide(other,org,'leave',array[req],'approved');
 -- Batch failure rolls back earlier decisions, including their notifications.
 perform hr_set_approval_chain(actor,org,'expenses','{}');
 result:=hr_mutate(actor,org,'expenses',null,jsonb_build_object('employee_id',employee,'amount',10,'currency','USD','description','Train'));req:=(result->>'id')::uuid;
 begin perform hr_decide(actor,org,'expenses',array[req,gen_random_uuid()],'approved');raise exception 'Missing item accepted';exception when no_data_found then null;end;
 if (select status from hr_expenses where id=req) is distinct from 'pending' then raise exception 'Partial batch committed';end if;
 -- Roles duplicate as drafts without copying holders.
 result:=hr_duplicate_role(actor,org,role_id);if result->>'status' is distinct from 'draft' then raise exception 'Duplicate not draft';end if;
 -- Calendar birthdays cross year boundaries and repeated reads do not duplicate them.
 perform hr_mutate(actor,org,'employees',employee,'{"birth_date":"1995-01-01"}');
 perform hr_sync_milestones(actor,org,'2026-12-25','2027-01-08');perform hr_sync_milestones(actor,org,'2026-12-25','2027-01-08');
 if (select count(*) from calendar_events c join hr_milestones m on m.id=c.source_id where m.employee_id=employee and m.kind='birthday' and m.year=2027) is distinct from 1 then raise exception 'Birthday duplicated or missing';end if;
 perform hr_widgets(actor,org,'2026-12-25');perform hr_department_chart(actor,org,dep);perform hr_trends(actor,org,'2026-09-20');perform hr_member_directory(actor,org,'Mechanical',1,50);perform hr_team_directory(actor,org,dep);
 -- Another organization cannot read a source record even with an existing valid ID.
 begin perform hr_employee_stats(actor,gen_random_uuid(),employee);raise exception 'Cross tenant detail leaked';exception when insufficient_privilege then null;end;
 -- RSVP only updates the caller's entry, and excludes non-attendees.
 insert into calendar_events(organization_id,kind,title,starts_at,ends_at,timezone,organizer_id,created_by,attendees) values(org,'team_meeting','Planning',now()+interval '1 day',now()+interval '1 day 1 hour','Africa/Lagos',actor,actor,jsonb_build_array(jsonb_build_object('userId',other,'response','pending'))) returning id into req;
 perform hr_action(other,org,'calendar',req,'rsvp','{"response":"accepted"}');
 if (select attendees#>>'{0,response}' from calendar_events where id=req) is distinct from 'accepted' then raise exception 'RSVP not saved';end if;
 begin perform hr_action(actor,org,'calendar',req,'rsvp','{"response":"accepted"}');raise exception 'Non attendee RSVP allowed';exception when insufficient_privilege then null;end;
 result:=hr_claim_zoom(actor,org,req);begin perform hr_claim_zoom(actor,org,req);raise exception 'Duplicate Zoom creation allowed';exception when sqlstate 'PT409' then null;end;
 perform hr_finish_zoom(actor,org,req,'123','https://zoom.us/j/123');
 begin perform hr_finish_zoom(actor,org,req,'456','https://zoom.us/j/456');raise exception 'Concurrent Zoom URL overwritten';exception when sqlstate 'PT409' then null;end;
 if hr_claim_zoom(actor,org,req)->>'existingUrl' is distinct from 'https://zoom.us/j/123' then raise exception 'Zoom URL not reused';end if;
 perform hr_mutate(actor,org,'documents',null,jsonb_build_object('employee_id',employee,'name','Passport','expires_on',hr_today(org)));
 perform queue_notification_reminders();select count(*) into attendance_count from notification_outbox;
 perform queue_notification_reminders();if (select count(*) from notification_outbox) is distinct from attendance_count then raise exception 'Reminder duplicated';end if;
 perform hr_activity_detail(actor,org,(select id from organization_activities where subject_type='documents' and organization_id=org limit 1));
 perform hr_activity_actions(actor,org,array[(select id from organization_activities where organization_id=org limit 1)]);

 result:=workflow_mutate(actor,org,'team.save',null,jsonb_build_object('departmentId',dep,'name','Core team','memberIds',jsonb_build_array(member,other)));team:=(result->>'id')::uuid;
 perform hr_mutate(actor,org,'team-plans',null,jsonb_build_object('team_id',team,'planned_capacity',2));
 result:=hr_team_directory(actor,org,dep);if (result#>>'{items,0,capacityPercent}')::numeric is distinct from 50 then raise exception 'Team capacity wrong or counts non-employees';end if;
 perform hr_mutate(actor,org,'team-plans',(select id from hr_team_plans where team_id=team),'{"planned_capacity":0}');
 result:=hr_team_directory(actor,org,dep);if result#>'{items,0,capacityPercent}' is distinct from 'null'::jsonb then raise exception 'Zero denominator fabricated';end if;
 if hr_observed_date('1996-02-29',2027) is distinct from '2027-02-28'::date then raise exception 'Leap birthday wrong';end if;
 insert into departments(organization_id,name) values(org,'Operations') returning id into dep2;
 perform hr_mutate(actor,org,'employees',employee,jsonb_build_object('department_id',dep2,'role_id',null));
 if (select count(*) from hr_staffing_history where employee_id=employee) is distinct from 2 then raise exception 'Transfer lost history';end if;
 result:=hr_role_stats(actor,org,role_id,'2026-09-20');if result->>'filledPositions' is distinct from '1' then raise exception 'Transfer rewrote previous role occupancy';end if;
 raise notice 'PASS: zero totals, headcount, role vacancies, onboarding percent, leave balance/weekends/overlap, idempotence, payroll arithmetic/finalization and tenant authorization';
end $$;
rollback;
