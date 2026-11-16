create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null check (char_length(trim(body)) between 1 and 500),
  reviewer_name text not null default 'Customer' check (char_length(reviewer_name) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_reviews_one_per_user unique (product_key,user_id)
);
create index if not exists product_reviews_product_created_idx on public.product_reviews(product_key,created_at desc);
alter table public.product_reviews enable row level security;
grant select on public.product_reviews to anon, authenticated;
grant insert, update, delete on public.product_reviews to authenticated;
drop policy if exists "Product reviews are public" on public.product_reviews;
create policy "Product reviews are public" on public.product_reviews for select to anon, authenticated using (true);
drop policy if exists "Customers create their own product reviews" on public.product_reviews;
create policy "Customers create their own product reviews" on public.product_reviews for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Customers update their own product reviews" on public.product_reviews;
create policy "Customers update their own product reviews" on public.product_reviews for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Customers delete their own product reviews" on public.product_reviews;
create policy "Customers delete their own product reviews" on public.product_reviews for delete to authenticated using (user_id = (select auth.uid()));