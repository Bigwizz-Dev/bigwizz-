-- Set all new marketplace records to Nigerian naira.
alter table public.listings alter column currency set default 'NGN';
alter table public.orders alter column currency set default 'NGN';
alter table public.payment_records alter column currency set default 'NGN';
alter table public.service_request_matches alter column currency set default 'NGN';
alter table public.service_bookings alter column currency set default 'NGN';
