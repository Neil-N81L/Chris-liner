-- Staff site access (applied on Supabase as "staff_access", between 005 and 006).
-- Only people listed in public.staff (lower-case email) can read or change bookings and settings.
create table public.staff (
  email text primary key check (email = lower(email)),
  name text not null default '',
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_staff() to authenticated;

create policy "staff read own row" on public.staff for select to authenticated using (public.is_staff());
create policy "staff read bookings" on public.bookings for select to authenticated using (public.is_staff());
create policy "staff add bookings" on public.bookings for insert to authenticated with check (public.is_staff() and source = 'staff');
create policy "staff change bookings" on public.bookings for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff read settings" on public.settings for select to authenticated using (public.is_staff());
create policy "staff change settings" on public.settings for update to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.bookings to authenticated;
grant select, update on public.settings to authenticated;
grant select on public.staff to authenticated;
revoke all on public.bookings, public.settings, public.staff, public.wa_sessions from anon;

alter publication supabase_realtime add table public.bookings;
