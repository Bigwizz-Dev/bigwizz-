-- Keep the parent listing stock total synchronized with its colour inventory.
create or replace function public.sync_listing_variant_stock()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  computed_total numeric;
begin
  if new.kind = 'goods'
     and jsonb_typeof(new.variants) = 'array'
     and jsonb_array_length(new.variants) > 0 then
    if exists (
      select 1
      from jsonb_array_elements(new.variants) as variant(value)
      where jsonb_typeof(variant.value) is distinct from 'object'
         or jsonb_typeof(variant.value -> 'colour') is distinct from 'string'
         or btrim(variant.value ->> 'colour') = ''
         or jsonb_typeof(variant.value -> 'stock') is distinct from 'number'
         or (variant.value ->> 'stock') !~ '^(0|[1-9][0-9]*)$'
         or jsonb_typeof(variant.value -> 'image_url') is distinct from 'string'
         or btrim(variant.value ->> 'image_url') = ''
    ) then
      raise exception 'Each colour variant must have a colour, a non-negative whole-number stock quantity, and an image URL.';
    end if;
    if exists (
      select lower(variant.value ->> 'colour')
      from jsonb_array_elements(new.variants) as variant(value)
      group by lower(variant.value ->> 'colour')
      having count(*) > 1
    ) then
      raise exception 'Colour variants must have unique colour names.';
    end if;
    select coalesce(sum((variant.value ->> 'stock')::numeric), 0)
      into computed_total
    from jsonb_array_elements(new.variants) as variant(value);
    if computed_total > 2147483647 then
      raise exception 'The total stock quantity is too large.';
    end if;
    new.stock_quantity := computed_total::integer;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_listing_variant_stock() from public, anon, authenticated;

drop trigger if exists listings_sync_variant_stock on public.listings;
create trigger listings_sync_variant_stock
before insert or update of variants, stock_quantity, kind
on public.listings
for each row
execute function public.sync_listing_variant_stock();
