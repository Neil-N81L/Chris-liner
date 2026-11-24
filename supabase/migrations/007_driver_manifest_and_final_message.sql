-- Already applied to the live database (as driver_manifest and final_trip_message).
-- Driver's cell and the private link to each bus's live passenger list.
alter table vehicles add column if not exists driver_phone text;
alter table trips add column if not exists manifest_token uuid not null default gen_random_uuid();
alter table trips add column if not exists manifest_sent_at timestamptz;
-- When the evening-before trip details went to the passenger.
alter table bookings add column if not exists final_sent_at timestamptz;
