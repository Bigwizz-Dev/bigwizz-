-- Preserve the old "estimate" behavior while making it explicit in the new pricing selector.
update public.listings set pricing_mode = 'quote' where kind = 'service' and price is null;

-- Use init-plan-friendly auth checks for service-request write policies.
drop policy if exists "Assigned sellers update service requests" on public.service_requests;
create policy "Assigned sellers update service requests" on public.service_requests
  for update to authenticated using (provider_id = (select auth.uid()))
  with check (provider_id = (select auth.uid()));

drop policy if exists "Buyers create service requests" on public.service_requests;
create policy "Buyers create service requests" on public.service_requests
  for insert to authenticated with check (buyer_id = (select auth.uid()));
