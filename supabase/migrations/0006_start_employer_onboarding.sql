begin;

alter table public.employer_onboarding add column started_at timestamptz;
-- Historical start time is unknown; use the last saved timestamp for existing progress.
update public.employer_onboarding set started_at = updated_at where status <> 'not_started';

create function public.record_employer_onboarding_start()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status <> 'not_started' and new.started_at is null then
   new.started_at := now();
 end if;
 return new;
end; $$;
create trigger record_employer_onboarding_start before insert or update
on public.employer_onboarding for each row execute function public.record_employer_onboarding_start();

create function public.start_employer_onboarding(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 -- Checks trusted employer membership and creates the draft if absent.
 perform public.ensure_employer_onboarding(p_user_id);
 -- Conditional update is atomic: never rewind progress or overwrite the first start time.
 update public.employer_onboarding
 set status = 'in_progress', started_at = coalesce(started_at, now())
 where user_id = p_user_id and status = 'not_started';
end; $$;
revoke all on function public.start_employer_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.start_employer_onboarding(uuid) to service_role;
commit;
