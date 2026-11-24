alter table public.bookings
  add column reconfirm_status text check (reconfirm_status in ('sent', 'yes', 'no', 'no_reply', 'failed')),
  add column reconfirm_sent_at timestamptz,
  add column reconfirm_answered_at timestamptz;
