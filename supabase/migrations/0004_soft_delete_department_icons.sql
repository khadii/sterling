begin;

-- Keep referenced images and IDs intact while removing deleted icons from selection.
alter table public.department_icons add column deleted_at timestamptz;
alter table public.department_icons add constraint deleted_icons_inactive
  check (deleted_at is null or (not is_active and not is_default));

-- Existing active-only read policy and draft validation exclude deleted icons.
-- Existing references may retain them, just as they retain inactive icons.
commit;
