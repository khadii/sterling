begin;
do $$
declare test_id uuid; result jsonb;
begin
 insert into public.department_icons(name, storage_path)
 values ('Deletion test', 'published/deletion-test.png') returning id into test_id;
 result := public.prepare_department_icon_deletion(test_id);
 if result <> '["published/deletion-test.png"]'::jsonb then raise exception 'Wrong paths'; end if;
 if public.prepare_department_icon_deletion(test_id) <> result then raise exception 'Retry failed'; end if;
 perform public.finish_department_icon_deletion(test_id);
 if exists(select 1 from public.department_icons where id = test_id) then raise exception 'Record retained'; end if;
 if public.prepare_department_icon_deletion(test_id) is not null then raise exception 'Missing lookup failed'; end if;
 begin
   perform public.prepare_department_icon_deletion((select id from public.department_icons where is_default));
   raise exception 'Default protection failed';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.prepare_department_icon_deletion((select icon_id from public.department_suggestions s
     join public.department_icons i on i.id = s.icon_id where not i.is_default limit 1));
   raise exception 'Reference protection failed';
 exception when foreign_key_violation then null;
 end;
end; $$;
rollback;
