-- Store whether a customer needs a service immediately or at a chosen future time.
alter table public.service_requests
  add column if not exists booking_timing text not null default 'now'
    check (booking_timing in ('now','later')),
  add column if not exists preferred_time time;
