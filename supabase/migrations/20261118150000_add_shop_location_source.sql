alter table public.profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
alter table public.profiles
  add constraint profiles_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint profiles_longitude_range check (longitude is null or longitude between -180 and 180);
alter table public.seller_profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_source text;
alter table public.seller_profiles
  add constraint seller_profiles_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint seller_profiles_longitude_range check (longitude is null or longitude between -180 and 180),
  add constraint seller_profiles_location_source_check check (location_source is null or location_source in ('live', 'profile'));
