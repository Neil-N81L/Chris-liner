-- Chris Liner bookings store, shared by the WhatsApp bot and the staff app.
create extension if not exists btree_gist;

create table public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  trip_date date not null,
  dir text not null check (dir in ('WHK-OMD', 'OMD-WHK')),
  seat int not null check (seat between 1 and 14),
  from_idx int not null,
  to_idx int not null,
  name text not null,
  phone text not null,
  fare numeric not null default 0,
  pickup text not null default '',
  notes text not null default '',
  paid boolean not null default false,
  method text not null default '',
  source text not null default 'staff' check (source in ('staff', 'whatsapp')),
  wa_id text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (from_idx >= 0 and to_idx <= 6 and from_idx < to_idx),
  -- A seat can't be sold twice on overlapping stretches of the same trip.
  constraint no_double_booking exclude using gist (
    trip_date with =, dir with =, seat with =, int4range(from_idx, to_idx) with &&
  ) where (status = 'confirmed')
);
create index bookings_trip_idx on public.bookings (trip_date, dir);
create index bookings_wa_idx on public.bookings (wa_id);

create table public.wa_sessions (
  wa_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Only the server (service role) touches these tables.
alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.wa_sessions enable row level security;

insert into public.settings (id, data) values (1, '{
  "placeholder": true,
  "fares": {"Windhoek": 0, "Rehoboth": 100, "Mariental": 250, "Keetmanshoop": 400, "Aus": 500, "Rosh Pinah": 550, "Oranjemund": 600},
  "hours": {"Windhoek": 0, "Rehoboth": 1, "Mariental": 3.25, "Keetmanshoop": 5.5, "Aus": 8, "Rosh Pinah": 10, "Oranjemund": 11},
  "minFare": 100,
  "WHK-OMD": {"time": "07:00", "point": "Windhoek (pick-up point to be confirmed)"},
  "OMD-WHK": {"time": "07:00", "point": "Oranjemund (pick-up point to be confirmed)"},
  "payment": "Pay cash when you board, or EFT before the trip (bank details to be added). Use your booking reference as the payment reference.",
  "staffPhones": "081 331 1175 / 081 295 7277"
}'::jsonb);
