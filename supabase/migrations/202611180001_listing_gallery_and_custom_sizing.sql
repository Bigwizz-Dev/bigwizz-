-- Bigwizz listing gallery and bespoke apparel sizing support
alter table public.listings
  add column if not exists gallery_images text[] not null default '{}',
  add column if not exists accepts_custom_measurements boolean not null default false;

update public.listings
set gallery_images = array[image_url]
where coalesce(array_length(gallery_images, 1), 0) = 0
  and image_url is not null;
