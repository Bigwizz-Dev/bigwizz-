do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='listings') then alter publication supabase_realtime add table public.listings; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='listing_reviews') then alter publication supabase_realtime add table public.listing_reviews; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_reviews') then alter publication supabase_realtime add table public.product_reviews; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_reports') then alter publication supabase_realtime add table public.order_reports; end if;
end $$;