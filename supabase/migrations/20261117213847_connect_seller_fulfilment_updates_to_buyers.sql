drop policy if exists "Sellers update paid order fulfilment status" on public.orders;
create policy "Sellers update paid order fulfilment status" on public.orders for update to authenticated
using (seller_id=(select auth.uid()) and exists(select 1 from public.payment_records p where p.order_id=orders.id and p.status='paid'))
with check (seller_id=(select auth.uid()) and status in ('processing','shipped','completed','cancelled') and exists(select 1 from public.payment_records p where p.order_id=orders.id and p.status='paid'));

create or replace function private.notify_buyer_order_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status then insert into public.notifications(user_id,title,body,kind) values(new.buyer_id,'Order status updated','Order '||new.order_number||' is now marked '||replace(new.status,'_',' ')||'.','order'); end if;
 return new;
end; $$;
revoke all on function private.notify_buyer_order_status() from public,anon,authenticated;
drop trigger if exists notify_buyer_order_status on public.orders;
create trigger notify_buyer_order_status after update of status on public.orders for each row execute function private.notify_buyer_order_status();