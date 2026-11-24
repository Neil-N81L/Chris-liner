-- Kalkrand becomes a stop between Rehoboth and Mariental, so the route has 8 stops (indices 0..7).
alter table public.bookings drop constraint bookings_check;
-- Shift existing bookings to the new stop numbering.
update public.bookings set
  from_idx = from_idx + case when dir = 'WHK-OMD' then (from_idx >= 2)::int else (from_idx >= 5)::int end,
  to_idx   = to_idx   + case when dir = 'WHK-OMD' then (to_idx >= 2)::int else (to_idx >= 5)::int end;
alter table public.bookings add constraint bookings_check check (from_idx >= 0 and to_idx <= 7 and from_idx < to_idx);
-- Kalkrand timing and fallback fare; fixed prices between stops come from fareTable (pair "A|B" in alphabetical order).
update public.settings set data = jsonb_set(jsonb_set(data, '{hours,Kalkrand}', '2.25'), '{fares,Kalkrand}', '200')
  || jsonb_build_object('fareTable', jsonb_build_object(
    'Oranjemund|Windhoek', 600, 'Oranjemund|Rehoboth', 580, 'Rosh Pinah|Windhoek', 580, 'Rehoboth|Rosh Pinah', 570,
    'Kalkrand|Oranjemund', 550, 'Mariental|Oranjemund', 520, 'Keetmanshoop|Oranjemund', 350, 'Keetmanshoop|Rosh Pinah', 350))
  || '{"placeholder": false}'::jsonb,
  updated_at = now() where id = 1;
