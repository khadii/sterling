-- Isolated PostgreSQL with test/workflow-bootstrap.sql and all migrations.
begin;
do $test$
declare
 actor uuid:=gen_random_uuid(); org uuid; owner_role uuid; role_id uuid;
 result jsonb; snapshot jsonb; old_revision integer; next_revision integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'role-wizard@test.invalid',now());
 insert into organizations(name,industry_id,company_size,created_by)
 values('Role wizard test',(select id from industries limit 1),'1_10',actor) returning id into org;
 insert into organization_members values(org,actor,now());
 insert into organization_roles(organization_id,key,name,description)
 values(org,'organisation_owner','Owner','Owner') returning id into owner_role;
 insert into organization_member_roles(organization_id,user_id,organization_role_id) values(org,actor,owner_role);
 set local role service_role;

 result:=workflow_mutate(actor,org,'role.save',null,
   '{"name":"Team Coordinator","status":"draft","permissionIds":["teams.view"]}');
 role_id:=(result->>'id')::uuid; old_revision:=(result->>'revision')::integer;
 if old_revision is distinct from 1 then raise exception 'Create revision must be 1'; end if;
 raise notice 'CREATE draft + initial permissions: revision %',old_revision;

 result:=workflow_mutate(actor,org,'role.save',role_id,'{"name":"Senior Team Coordinator"}');
 next_revision:=(result->>'revision')::integer;
 if next_revision is distinct from old_revision+1 or result->'permissionIds' is distinct from '["teams.view"]'::jsonb then
   raise exception 'Partial wizard save did not increment revision/preserve permissions';
 end if;
 raise notice 'PATCH name only: revision %, permissions preserved',next_revision;

 begin
   perform workflow_mutate(actor,org,'role.permissions',role_id,
      jsonb_build_object('permissionIds',array['teams.view','teams.manage'],'expectedRevision',old_revision));
   raise exception 'Stale revision accepted';
 exception when sqlstate 'PT409' then
   raise notice 'PUT using earlier revision %: conflict as expected',old_revision;
 end;
 snapshot:=workspace_membership_snapshot(actor,org,'role',role_id);
 if (snapshot->>'revision')::integer is distinct from next_revision or snapshot->'permissionIds' is distinct from '["teams.view"]'::jsonb then
   raise exception 'Rejected update modified the role or GET has wrong revision';
 end if;
 result:=workflow_mutate(actor,org,'role.permissions',role_id,
   jsonb_build_object('permissionIds',array['teams.view','teams.manage'],'expectedRevision',(snapshot->>'revision')::integer));
 if (result->>'revision')::integer is distinct from next_revision+1 or jsonb_array_length(result->'permissionIds')<>2 then
   raise exception 'Permission update using GET revision failed';
 end if;
 raise notice 'GET current role -> PUT reviewed permissions: revision %',result->>'revision';

 result:=workflow_mutate(actor,org,'role.save',role_id,
   jsonb_build_object('status','active','permissionIds',array['teams.view','teams.manage'],'expectedRevision',(result->>'revision')::integer));
 if (result->>'revision')::integer is distinct from 4 or result->>'status'<>'active' then
   raise exception 'Final wizard save failed';
 end if;
 raise notice 'PATCH activate with returned revision: revision %',result->>'revision';
 if (select count(*) from organization_roles where organization_id=org and not is_system and key<>'organisation_owner')<>1 then
   raise exception 'Wizard created duplicate roles';
 end if;
 raise notice 'PASS: create -> partial save -> stale rejection without mutation -> GET -> permissions save -> activation; one role';
end $test$;
rollback;
