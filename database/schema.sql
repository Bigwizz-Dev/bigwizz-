create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('buyer', 'seller', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.seller_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  shop_name text not null,
  seller_type text not null check (seller_type in ('Quality goods', 'Professional services', 'Goods and services')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.seller_profiles (user_id) on delete set null,
  seed_key text unique,
  kind text not null check (kind in ('goods', 'service')),
  category text not null,
  title text not null check (length(title) between 1 and 80),
  description text not null,
  seller_name text not null,
  price numeric(12, 2) check (price is null or price > 0),
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  image_url text not null,
  gallery_images text[] not null default '{}' check (coalesce(array_length(gallery_images, 1), 0) <= 1),
  status text not null default 'published' check (status in ('draft', 'published', 'paused', 'archived')),
  rating numeric(2, 1) check (rating >= 0 and rating <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price is not null or kind = 'service')
);

-- Color-specific product variant images (one public URL per color name).
alter table public.listings
  add column if not exists colors text[] not null default '{}',
  add column if not exists color_images jsonb not null default '{}'::jsonb;
