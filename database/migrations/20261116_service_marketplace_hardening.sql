-- Tighten the marketplace RLS policies and add indexes for the new foreign keys.
drop policy if exists "Matched providers read their service requests" on public.service_requests;
drop policy if exists "Buyers and assigned sellers read service requests" on public.service_requests;
create policy "Buyers and assigned sellers read service requests"
  on public.service_requests for select to authenticated
  using (
    buyer_id = (select auth.uid())
    or provider_id = (select auth.uid())
    or exists (
      select 1 from public.service_request_matches m
      where m.request_id = service_requests.id
        and m.provider_id = (select auth.uid())
    )
  );

drop policy if exists "Buyer selects one provider response" on public.service_request_selections;
create policy "Buyer selects one provider response" on public.service_request_selections
  for insert to authenticated with check (
    buyer_id = (select auth.uid())
    and exists (select 1 from public.service_requests r
      where r.id = service_request_selections.request_id and r.buyer_id = (select auth.uid()))
    and exists (select 1 from public.service_request_matches m
      where m.id = service_request_selections.match_id
        and m.request_id = service_request_selections.request_id
        and m.buyer_id = (select auth.uid())
        and m.provider_id = service_request_selections.provider_id
        and m.status = 'quoted')
  );

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

drop policy if exists "Buyers create matches for their requests" on public.service_request_matches;
create policy "Buyers create matches for their requests"
  on public.service_request_matches for insert to authenticated with check (
    buyer_id = (select auth.uid())
    and exists (select 1 from public.service_requests r
      where r.id = service_request_matches.request_id and r.buyer_id = (select auth.uid()))
    and exists (select 1 from public.seller_profiles p
      where p.user_id = service_request_matches.provider_id
        and p.is_public = true and p.availability_status = 'available')
  );

alter table public.service_request_matches alter column currency set default 'USD';
alter table public.service_bookings alter column currency set default 'USD';

revoke insert on public.service_booking_disputes from authenticated;
grant insert (booking_id,opened_by,issue_type,description) on public.service_booking_disputes to authenticated;

create index if not exists service_bookings_listing_idx on public.service_bookings(listing_id);
create index if not exists service_bookings_match_idx on public.service_bookings(match_id);
create index if not exists service_booking_checkins_buyer_idx on public.service_booking_checkins(buyer_id);
create index if not exists service_booking_checkins_provider_idx on public.service_booking_checkins(provider_id);
create index if not exists service_booking_completions_buyer_idx on public.service_booking_completions(buyer_id);
create index if not exists service_booking_completions_provider_idx on public.service_booking_completions(provider_id);
create index if not exists service_booking_disputes_booking_idx on public.service_booking_disputes(booking_id);
create index if not exists service_booking_disputes_opened_by_idx on public.service_booking_disputes(opened_by);
create index if not exists service_booking_events_booking_idx on public.service_booking_events(booking_id);
create index if not exists service_booking_events_actor_idx on public.service_booking_events(actor_id);
create index if not exists service_request_selections_buyer_idx on public.service_request_selections(buyer_id);
create index if not exists service_request_selections_provider_idx on public.service_request_selections(provider_id);
