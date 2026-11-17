alter table public.listings
  add column if not exists stock_quantity integer;

alter table public.listings
  drop constraint if exists listings_stock_quantity_nonnegative;

alter table public.listings
  add constraint listings_stock_quantity_nonnegative
  check (stock_quantity is null or stock_quantity >= 0);
