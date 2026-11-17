alter table public.order_items add column if not exists variant_size text, add column if not exists variant_color text;

drop policy if exists "Buyers create pending payment records" on public.payment_records;
create policy "Buyers create pending payment records" on public.payment_records for insert to authenticated with check (
 status='pending' and provider='not_configured' and exists (
  select 1 from public.orders o where o.id=payment_records.order_id and o.buyer_id=(select auth.uid()) and o.status='pending' and o.total=payment_records.amount and o.currency=payment_records.currency
 )
);

create or replace function public.checkout_cart()
returns table(order_id uuid,order_number text,seller_id uuid,total numeric,currency text)
language plpgsql security invoker set search_path=''
as $$
declare
 buyer uuid:=auth.uid(); seller_group record; new_order_id uuid; new_order_number text; seller_subtotal numeric; platform_fee numeric;
begin
 if buyer is null then raise exception 'Please sign in before checkout.'; end if;
 if not exists(select 1 from public.cart_items c where c.user_id=buyer) then raise exception 'Your cart is empty.'; end if;
 if exists(select 1 from public.cart_items c left join public.listings l on l.id=c.listing_id where c.user_id=buyer and (l.id is null or l.kind<>'goods' or l.status<>'published' or l.seller_id is null or l.price is null or l.price<=0)) then
  raise exception 'One or more cart items are no longer available. Refresh your cart and try again.';
 end if;
 for seller_group in select l.seller_id,l.currency from public.cart_items c join public.listings l on l.id=c.listing_id where c.user_id=buyer group by l.seller_id,l.currency loop
  select round(sum(l.price*c.quantity),2) into seller_subtotal from public.cart_items c join public.listings l on l.id=c.listing_id where c.user_id=buyer and l.seller_id=seller_group.seller_id and l.currency=seller_group.currency;
  platform_fee:=round(seller_subtotal*0.02,2);
  insert into public.orders(buyer_id,seller_id,status,currency,seller_subtotal,platform_fee,total) values(buyer,seller_group.seller_id,'pending',seller_group.currency,seller_subtotal,platform_fee,seller_subtotal+platform_fee) returning id,public.orders.order_number into new_order_id,new_order_number;
  insert into public.order_items(order_id,listing_id,seller_id,title_snapshot,seller_name_snapshot,unit_price,quantity,variant_size,variant_color)
  select new_order_id,l.id,l.seller_id,l.title,coalesce(l.seller_name,'Bigwizz seller'),l.price,c.quantity,nullif(c.variant_size,''),nullif(c.variant_color,'') from public.cart_items c join public.listings l on l.id=c.listing_id where c.user_id=buyer and l.seller_id=seller_group.seller_id and l.currency=seller_group.currency;
  insert into public.payment_records(order_id,provider,status,amount,currency) values(new_order_id,'not_configured','pending',seller_subtotal+platform_fee,seller_group.currency);
  order_id:=new_order_id; order_number:=new_order_number; seller_id:=seller_group.seller_id; total:=seller_subtotal+platform_fee; currency:=seller_group.currency; return next;
 end loop;
 delete from public.cart_items where user_id=buyer;
end;
$$;
revoke all on function public.checkout_cart() from public,anon;
grant execute on function public.checkout_cart() to authenticated;

create or replace function private.notify_seller_new_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.seller_id is not null then insert into public.notifications(user_id,title,body,kind) values(new.seller_id,'New order received','Order '||new.order_number||' has been placed. Payment is still pending.','order'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_new_order() from public,anon,authenticated;
drop trigger if exists notify_seller_new_order on public.orders;
create trigger notify_seller_new_order after insert on public.orders for each row execute function private.notify_seller_new_order();

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then alter publication supabase_realtime add table public.orders; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_items') then alter publication supabase_realtime add table public.order_items; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='payment_records') then alter publication supabase_realtime add table public.payment_records; end if;
end $$;