-- Bigwizz service marketplace foundation
-- Idempotent schema for scheduling, private provider matching, quotes and protected split payouts.

alter table public.listings
  add column if not exists pricing_mode text not null default 'fixed'
    check (pricing_mode in ('fixed','starting','quote'));

alter table public.seller_profiles
  add column if not exists availability_status text not null default 'available'
    check (availability_status in ('available','busy','offline'));

alter table public.service_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists matching_mode text not null default 'direct'
    check (matching_mode in ('direct','nearby')),
  add column if not exists service_address text not null default '',
  add column if not exists representative_name text,
  add column if not exists representative_phone text;

create table if not exists public.service_request_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  status text not null default 'sent'
    check (status in ('sent','viewed','quoted','accepted','declined','selected','expired')),
  quoted_amount numeric(12,2) check (quoted_amount is null or quoted_amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  response_note text not null default '' check (char_length(response_note) <= 2000),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (request_id,provider_id)
);
create index if not exists service_request_matches_provider_idx
  on public.service_request_matches(provider_id,status,sent_at desc);
create index if not exists service_request_matches_buyer_idx
  on public.service_request_matches(buyer_id,sent_at desc);
alter table public.service_request_matches enable row level security;
drop policy if exists "Buyers and matched providers read service matches" on public.service_request_matches;
create policy "Buyers and matched providers read service matches"
  on public.service_request_matches for select to authenticated
  using (buyer_id = (select auth.uid()) or provider_id = (select auth.uid()));
drop policy if exists "Buyers create matches for their requests" on public.service_request_matches;
create policy "Buyers create matches for their requests"
  on public.service_request_matches for insert to authenticated
  with check (
    buyer_id = (select auth.uid())
    and exists (select 1 from public.service_requests r where r.id = service_request_matches.request_id and r.buyer_id = (select auth.uid()))
    and exists (select 1 from public.seller_profiles p where p.user_id = service_request_matches.provider_id and p.is_public = true and p.availability_status = 'available')
  );
drop policy if exists "Matched providers respond to their matches" on public.service_request_matches;
create policy "Matched providers respond to their matches"
  on public.service_request_matches for update to authenticated
  using (provider_id = (select auth.uid()))
  with check (provider_id = (select auth.uid()));
revoke all on public.service_request_matches from authenticated;
grant select,insert on public.service_request_matches to authenticated;
grant update (status,quoted_amount,currency,response_note,responded_at)
  on public.service_request_matches to authenticated;

drop policy if exists "Matched providers read their service requests" on public.service_requests;
create policy "Matched providers read their service requests"
  on public.service_requests for select to authenticated
  using (exists (
    select 1 from public.service_request_matches m
    where m.request_id = service_requests.id and m.provider_id = (select auth.uid())
  ));

create table if not exists public.service_request_selections (
  request_id uuid primary key references public.service_requests(id) on delete cascade,
  match_id uuid not null unique references public.service_request_matches(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.service_request_selections enable row level security;
drop policy if exists "Request parties read provider selections" on public.service_request_selections;
create policy "Request parties read provider selections" on public.service_request_selections
  for select to authenticated using (buyer_id = (select auth.uid()) or provider_id = (select auth.uid()));
drop policy if exists "Buyer selects one provider response" on public.service_request_selections;
create policy "Buyer selects one provider response" on public.service_request_selections
  for insert to authenticated with check (
    buyer_id = (select auth.uid())
    and exists (select 1 from public.service_requests r where r.id = service_request_selections.request_id and r.buyer_id = (select auth.uid()))
    and exists (select 1 from public.service_request_matches m
      where m.id = service_request_selections.match_id
        and m.request_id = service_request_selections.request_id
        and m.buyer_id = (select auth.uid())
        and m.provider_id = service_request_selections.provider_id
        and m.status = 'quoted')
  );
grant select,insert on public.service_request_selections to authenticated;

create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number text not null unique default ('BWS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  request_id uuid not null unique references public.service_requests(id) on delete restrict,
  match_id uuid references public.service_request_matches(id) on delete set null,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  provider_id uuid not null references public.seller_profiles(user_id) on delete restrict,
  listing_id uuid references public.listings(id) on delete set null,
  service_title text not null,
  service_address text not null,
  scheduled_at timestamptz,
  representative_name text,
  representative_phone text,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  service_price numeric(12,2) not null check (service_price > 0),
  buyer_fee_rate numeric(5,4) not null default 0.03 check (buyer_fee_rate = 0.03),
  buyer_fee numeric(12,2) not null check (buyer_fee >= 0),
  provider_commission_rate numeric(5,4) not null default 0.05 check (provider_commission_rate = 0.05),
  provider_commission numeric(12,2) not null check (provider_commission >= 0),
  provider_net numeric(12,2) not null check (provider_net >= 0),
  buyer_total numeric(12,2) not null check (buyer_total = service_price + buyer_fee),
  first_payout_amount numeric(12,2) not null check (first_payout_amount >= 0),
  final_payout_amount numeric(12,2) not null check (final_payout_amount >= 0),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','confirmed','provider_en_route','arrived','in_progress','completed','disputed','cancelled','refunded')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','partially_refunded','refunded')),
  payment_provider text,
  payment_reference text,
  first_payout_status text not null default 'locked'
    check (first_payout_status in ('locked','eligible','processing','paid','reversed')),
  final_payout_status text not null default 'locked'
    check (final_payout_status in ('locked','eligible','processing','paid','reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider_net = service_price - provider_commission),
  check (first_payout_amount + final_payout_amount = provider_net)
);
create index if not exists service_bookings_buyer_idx on public.service_bookings(buyer_id,created_at desc);
create index if not exists service_bookings_provider_idx on public.service_bookings(provider_id,scheduled_at desc);
alter table public.service_bookings enable row level security;
drop policy if exists "Booking parties read their service bookings" on public.service_bookings;
create policy "Booking parties read their service bookings" on public.service_bookings
  for select to authenticated using (buyer_id = (select auth.uid()) or provider_id = (select auth.uid()));
grant select on public.service_bookings to authenticated;

create table if not exists public.service_booking_checkins (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.service_bookings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  evidence_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','manual_review')),
  buyer_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists service_booking_checkins_booking_idx on public.service_booking_checkins(booking_id,created_at desc);
alter table public.service_booking_checkins enable row level security;
drop policy if exists "Booking parties read checkins" on public.service_booking_checkins;
create policy "Booking parties read checkins" on public.service_booking_checkins
  for select to authenticated using (buyer_id = (select auth.uid()) or provider_id = (select auth.uid()));
drop policy if exists "Provider submits own booking checkin" on public.service_booking_checkins;
create policy "Provider submits own booking checkin" on public.service_booking_checkins
  for insert to authenticated with check (
    provider_id = (select auth.uid())
    and exists (select 1 from public.service_bookings b
      where b.id = service_booking_checkins.booking_id
        and b.provider_id = (select auth.uid())
        and b.buyer_id = service_booking_checkins.buyer_id
        and b.payment_status = 'paid')
  );
drop policy if exists "Buyer confirms checkin" on public.service_booking_checkins;
create policy "Buyer confirms checkin" on public.service_booking_checkins
  for update to authenticated using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()));
revoke insert,update on public.service_booking_checkins from authenticated;
grant select on public.service_booking_checkins to authenticated;
grant insert (booking_id,buyer_id,provider_id,latitude,longitude,accuracy_m,evidence_url)
  on public.service_booking_checkins to authenticated;
grant update (buyer_confirmed_at) on public.service_booking_checkins to authenticated;

create table if not exists public.service_booking_completions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.service_bookings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.seller_profiles(user_id) on delete cascade,
  completion_note text not null default '' check (char_length(completion_note) <= 2000),
  evidence_urls text[] not null default '{}',
  provider_marked_at timestamptz not null default now(),
  buyer_confirmed_at timestamptz
);
create index if not exists service_booking_completions_booking_idx on public.service_booking_completions(booking_id);
alter table public.service_booking_completions enable row level security;
drop policy if exists "Booking parties read completion records" on public.service_booking_completions;
create policy "Booking parties read completion records" on public.service_booking_completions
  for select to authenticated using (buyer_id = (select auth.uid()) or provider_id = (select auth.uid()));
drop policy if exists "Provider records completion" on public.service_booking_completions;
create policy "Provider records completion" on public.service_booking_completions
  for insert to authenticated with check (
    provider_id = (select auth.uid())
    and exists (select 1 from public.service_bookings b
      where b.id = service_booking_completions.booking_id
        and b.provider_id = (select auth.uid())
        and b.buyer_id = service_booking_completions.buyer_id
        and b.payment_status = 'paid')
  );
drop policy if exists "Buyer confirms service completion" on public.service_booking_completions;
create policy "Buyer confirms service completion" on public.service_booking_completions
  for update to authenticated using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()));
revoke insert,update on public.service_booking_completions from authenticated;
grant select on public.service_booking_completions to authenticated;
grant insert (booking_id,buyer_id,provider_id,completion_note,evidence_urls)
  on public.service_booking_completions to authenticated;
grant update (buyer_confirmed_at) on public.service_booking_completions to authenticated;

create table if not exists public.service_booking_disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.service_bookings(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete cascade,
  issue_type text not null,
  description text not null check (char_length(description) between 3 and 3000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','closed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.service_booking_disputes enable row level security;
drop policy if exists "Booking parties read disputes" on public.service_booking_disputes;
create policy "Booking parties read disputes" on public.service_booking_disputes for select to authenticated
  using (exists (select 1 from public.service_bookings b where b.id = booking_id and (b.buyer_id = (select auth.uid()) or b.provider_id = (select auth.uid()))));
drop policy if exists "Booking parties open disputes" on public.service_booking_disputes;
create policy "Booking parties open disputes" on public.service_booking_disputes for insert to authenticated
  with check (opened_by = (select auth.uid()) and exists (select 1 from public.service_bookings b where b.id = booking_id and (b.buyer_id = (select auth.uid()) or b.provider_id = (select auth.uid()))));
revoke insert on public.service_booking_disputes from authenticated;
grant select on public.service_booking_disputes to authenticated;
grant insert (booking_id,opened_by,issue_type,description) on public.service_booking_disputes to authenticated;

create table if not exists public.service_booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.service_bookings(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.service_booking_events enable row level security;
drop policy if exists "Booking parties read booking events" on public.service_booking_events;
create policy "Booking parties read booking events" on public.service_booking_events for select to authenticated
  using (exists (select 1 from public.service_bookings b where b.id = booking_id and (b.buyer_id = (select auth.uid()) or b.provider_id = (select auth.uid()))));
grant select on public.service_booking_events to authenticated;

drop trigger if exists service_bookings_touch_updated_at on public.service_bookings;
create trigger service_bookings_touch_updated_at before update on public.service_bookings
  for each row execute procedure public.touch_updated_at();
