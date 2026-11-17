create or replace function private.notify_seller_buyer_comment() returns trigger language plpgsql security definer set search_path='' as $$
declare target_author uuid; target_title text;
begin
 select p.author_id,p.title into target_author,target_title from public.community_posts p where p.id=new.post_id;
 if target_author is not null and target_author<>new.author_id then insert into public.notifications(user_id,title,body,kind) values(target_author,'New buyer comment','A buyer commented on your maker update "'||coalesce(target_title,'Maker update')||'". The comment is awaiting review.','community_comment'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_buyer_comment() from public,anon,authenticated;
drop trigger if exists notify_seller_buyer_comment on public.community_comments;
create trigger notify_seller_buyer_comment after insert on public.community_comments for each row execute function private.notify_seller_buyer_comment();

create or replace function private.notify_seller_buyer_like() returns trigger language plpgsql security definer set search_path='' as $$
declare target_author uuid; target_title text;
begin
 select p.author_id,p.title into target_author,target_title from public.community_posts p where p.id=new.post_id;
 if target_author is not null and target_author<>new.user_id then insert into public.notifications(user_id,title,body,kind) values(target_author,'Your maker update was liked','A buyer liked your maker update "'||coalesce(target_title,'Maker update')||'".','community_like'); end if;
 return new;
end; $$;
revoke all on function private.notify_seller_buyer_like() from public,anon,authenticated;
drop trigger if exists notify_seller_buyer_like on public.community_post_likes;
create trigger notify_seller_buyer_like after insert on public.community_post_likes for each row execute function private.notify_seller_buyer_like();

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='community_post_likes') then alter publication supabase_realtime add table public.community_post_likes; end if;
end $$;