drop policy if exists "Sellers read reports for their orders" on public.order_reports;
create policy "Sellers read reports for their orders" on public.order_reports for select to authenticated using (
 exists(select 1 from public.orders o where o.id=order_reports.order_id and o.seller_id=(select auth.uid()))
);

create or replace function private.notify_seller_buyer_review() returns trigger language plpgsql security definer set search_path='' as $$
declare target_seller uuid; target_title text;
begin
 select l.seller_id,l.title into target_seller,target_title from public.listings l where l.id=new.listing_id;
 if target_seller is not null then insert into public.notifications(user_id,title,body,kind) values(target_seller,'New customer review','A buyer left a '||new.rating||'-star review on '||coalesce(target_title,'your listing')||'.','review'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_buyer_review() from public,anon,authenticated;
drop trigger if exists notify_seller_buyer_review on public.listing_reviews;
create trigger notify_seller_buyer_review after insert on public.listing_reviews for each row execute function private.notify_seller_buyer_review();

create or replace function private.notify_seller_order_report() returns trigger language plpgsql security definer set search_path='' as $$
declare target_seller uuid;
begin
 select o.seller_id into target_seller from public.orders o where o.id=new.order_id;
 if target_seller is not null then insert into public.notifications(user_id,title,body,kind) values(target_seller,'Buyer reported an order','A buyer submitted an order report: '||new.issue_type||'.','order_report'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_order_report() from public,anon,authenticated;
drop trigger if exists notify_seller_order_report on public.order_reports;
create trigger notify_seller_order_report after insert on public.order_reports for each row execute function private.notify_seller_order_report();