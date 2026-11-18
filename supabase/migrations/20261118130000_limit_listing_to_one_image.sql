-- Enforce one product image per listing while preserving the current cover image.
-- Existing galleries are reduced to their first (cover) image before the constraint is added.
update public.listings
set gallery_images = case
  when coalesce(array_length(gallery_images, 1), 0) > 0 then array[gallery_images[1]]
  when image_url is not null then array[image_url]
  else '{}'::text[]
end
where coalesce(array_length(gallery_images, 1), 0) > 1
   or coalesce(array_length(gallery_images, 1), 0) = 0;

alter table public.listings
  drop constraint if exists listings_gallery_images_single_entry;

alter table public.listings
  add constraint listings_gallery_images_single_entry
  check (coalesce(array_length(gallery_images, 1), 0) <= 1);
