create table public.vehicles (
  id serial primary key,
  name text not null,
  reg text not null default '',
  driver text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- One row per bus running a trip: bus_no 1, 2, 3 ... for the same date and direction.
create table public.trips (
  trip_date date not null,
  dir text not null check (dir in ('WHK-OMD', 'OMD-WHK')),
  bus_no int not null default 1 check (bus_no between 1 and 6),
  vehicle_id int references public.vehicles(id),
  primary key (trip_date, dir, bus_no)
);
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
create policy "staff manage vehicles" on public.vehicles for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manage trip buses" on public.trips for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.vehicles, public.trips to authenticated;
grant usage on sequence public.vehicles_id_seq to authenticated;
revoke all on public.vehicles, public.trips from anon;
insert into public.vehicles (name) values ('Quantum 1'), ('Quantum 2');

alter table public.bookings add column bus_no int not null default 1 check (bus_no between 1 and 6);
alter table public.bookings drop constraint no_double_booking;
alter table public.bookings add constraint no_double_booking exclude using gist (
  trip_date with =, dir with =, bus_no with =, seat with =, int4range(from_idx, to_idx) with &&
) where (status = 'confirmed');

update public.settings set data = data || '{"busesPerDay": {"WHK-OMD": 1, "OMD-WHK": 1}}'::jsonb where id = 1;
