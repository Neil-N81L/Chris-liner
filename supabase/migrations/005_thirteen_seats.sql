-- Chris Liner's Quantum seats 13 passengers (back to front 4-3-3-2-2, driver in the front row).
alter table public.bookings drop constraint bookings_seat_check;
alter table public.bookings add constraint bookings_seat_check check (seat between 1 and 13);
