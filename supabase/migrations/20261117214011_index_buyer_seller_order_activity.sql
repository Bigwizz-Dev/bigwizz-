drop policy if exists "Buyers read their order reports" on public.order_reports;
drop policy if exists "Sellers read reports for their orders" on public.order_reports;
create policy "Order parties read reports" on public.order_reports for select to authenticated
using (buyer_id=(select auth.uid()) or exists(select 1 from public.orders o where o.id=order_reports.order_id and o.seller_id=(select auth.uid())));
create index if not exists cart_items_listing_id_idx on public.cart_items(listing_id);
create index if not exists order_items_listing_id_idx on public.order_items(listing_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_seller_id_idx on public.order_items(seller_id);
create index if not exists order_reports_order_id_idx on public.order_reports(order_id);
create index if not exists orders_seller_id_idx on public.orders(seller_id);