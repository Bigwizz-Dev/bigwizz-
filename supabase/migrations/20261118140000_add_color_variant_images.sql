-- Add persisted per-colour image URLs for product variants.
alter table public.listings
  add column if not exists colors text[] not null default '{}',
  add column if not exists color_images jsonb not null default '{}'::jsonb;

-- Keep only URLs for colours that remain on the listing and require string values.
update public.listings
set color_images = coalesce((
  select jsonb_object_agg(entry.key, entry.value)
  from jsonb_each(color_images) entry
  where entry.key = any(colors)
    and jsonb_typeof(entry.value) = 'string'
), '{}'::jsonb)
where color_images is not null;
