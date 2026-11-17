create or replace function private.notify_seller_buyer_product_review() returns trigger language plpgsql security definer set search_path='' as $$
declare target_seller uuid; target_title text;
begin
 select l.seller_id,l.title into target_seller,target_title from public.listings l where l.id::text=new.product_key;
 if target_seller is not null then insert into public.notifications(user_id,title,body,kind) values(target_seller,'New product review','A buyer left a '||new.rating||'-star review on '||coalesce(target_title,'your product')||'.','review'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_buyer_product_review() from public,anon,authenticated;
drop trigger if exists notify_seller_buyer_product_review on public.product_reviews;
create trigger notify_seller_buyer_product_review after insert on public.product_reviews for each row execute function private.notify_seller_buyer_product_review();