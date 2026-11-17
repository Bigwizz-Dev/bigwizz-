drop policy if exists "Order owners read payment records" on public.payment_records;
create policy "Order owners read payment records" on public.payment_records for select to authenticated using (
 exists(select 1 from public.orders o where o.id=payment_records.order_id and (o.buyer_id=(select auth.uid()) or o.seller_id=(select auth.uid())))
);