-- Per-colour inventory for marketplace listings.
-- listings.stock_quantity remains the aggregate total for fast availability checks.
alter table public.listings
  add column if not exists variants jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listings_variants_is_array'
      and conrelid = 'public.listings'::regclass
  ) then
    alter table public.listings
      add constraint listings_variants_is_array
      check (jsonb_typeof(variants) = 'array');
  end if;
end $$;

comment on column public.listings.variants is
  'Colour inventory variants: [{colour, stock, image_url}]. stock_quantity stores aggregate total stock.';

-- Safe backfill only when exactly one colour exists; never guess how a shared
-- stock total should be split across multiple colours.
update public.listings
set variants = jsonb_build_array(
  jsonb_build_object(
    'colour', colors[1],
    'stock', stock_quantity,
    'image_url', coalesce(color_images ->> colors[1], image_url)
  )
)
where kind = 'goods'
  and cardinality(colors) = 1
  and stock_quantity is not null
  and stock_quantity > 0
  and jsonb_array_length(variants) = 0;
