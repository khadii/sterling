begin;

-- Some environments applied the platform-icon migration without the later
-- soft-delete migration. The API filters this column when serializing an
-- uploaded icon, so make the schema repair idempotent for those environments.
alter table public.department_icons
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deleted_icons_inactive'
      and conrelid = 'public.department_icons'::regclass
  ) then
    alter table public.department_icons
      add constraint deleted_icons_inactive
      check (deleted_at is null or (not is_active and not is_default));
  end if;
end $$;

commit;
