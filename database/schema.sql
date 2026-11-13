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
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  image_url text not null,
  status text not null default 'published' check (status in ('draft', 'published', 'paused', 'archived')),
  rating numeric(2, 1) check (rating >= 0 and rating <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price is not null or kind = 'service')
);

create table if not exists public.carts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  user_id uuid not null references public.carts (user_id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  added_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists public.saved_listings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  provider_id uuid references public.seller_profiles (user_id) on delete set null,
  service_title text not null,
  request_type text not null check (request_type in ('Request a quote', 'Ask a question', 'Request a time')),
  preferred_date date,
  area text not null,
  details text not null,
  status text not null default 'new' check (status in ('new', 'responded', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  seed_key text unique,
  title text not null,
  host text not null,
  description text not null default '',
  starts_at timestamptz not null,
  location text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete set null,
  seed_key text unique,
  title text not null check (length(title) between 1 and 160),
  category text not null default '',
  body text not null,
  image_url text,
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 5000),
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden', 'removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('BW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  seller_id uuid references public.seller_profiles (user_id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  seller_subtotal numeric(12, 2) not null check (seller_subtotal >= 0),
  platform_fee numeric(12, 2) not null check (platform_fee >= 0),
  total numeric(12, 2) not null check (total = seller_subtotal + platform_fee),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  seller_id uuid references public.seller_profiles (user_id) on delete set null,
  title_snapshot text not null,
  seller_name_snapshot text not null,
  unit_price numeric(12, 2) not null check (unit_price > 0),
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  provider text not null,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending', 'authorized', 'paid', 'failed', 'refunded')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_reports (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  order_reference text not null,
  issue_type text not null,
  notes text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'general',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists listings_public_search_idx on public.listings (kind, category, created_at desc) where status = 'published';
create index if not exists listings_seller_idx on public.listings (seller_id, updated_at desc);
create index if not exists service_requests_buyer_idx on public.service_requests (buyer_id, created_at desc);
create index if not exists service_requests_provider_idx on public.service_requests (provider_id, created_at desc);
create index if not exists events_start_idx on public.events (starts_at);
create index if not exists community_posts_feed_idx on public.community_posts (created_at desc) where status = 'published';
create index if not exists community_comments_post_idx on public.community_comments (post_id, created_at);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists order_reports_buyer_idx on public.order_reports (buyer_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'account_type', 'buyer');
  requested_name text := coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, display_name)
  values (new.id, requested_name)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'buyer')
  on conflict do nothing;

  if requested_role = 'seller' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'seller')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.handle_seller_profile_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.user_id, 'seller')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists on_seller_profile_created on public.seller_profiles;
create trigger on_seller_profile_created
  after insert on public.seller_profiles
  for each row execute procedure public.handle_seller_profile_created();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists seller_profiles_touch_updated_at on public.seller_profiles;
create trigger seller_profiles_touch_updated_at before update on public.seller_profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists listings_touch_updated_at on public.listings;
create trigger listings_touch_updated_at before update on public.listings
  for each row execute procedure public.touch_updated_at();
drop trigger if exists community_posts_touch_updated_at on public.community_posts;
create trigger community_posts_touch_updated_at before update on public.community_posts
  for each row execute procedure public.touch_updated_at();
drop trigger if exists conversations_touch_updated_at on public.conversations;
create trigger conversations_touch_updated_at before update on public.conversations
  for each row execute procedure public.touch_updated_at();
drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders
  for each row execute procedure public.touch_updated_at();
drop trigger if exists payment_records_touch_updated_at on public.payment_records;
create trigger payment_records_touch_updated_at before update on public.payment_records
  for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.listings enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.saved_listings enable row level security;
alter table public.service_requests enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_records enable row level security;
alter table public.order_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists "Profiles are private to their owner" on public.profiles;
create policy "Profiles are private to their owner" on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Users read their own roles" on public.user_roles;
create policy "Users read their own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Public seller profiles are visible" on public.seller_profiles;
create policy "Public seller profiles are visible" on public.seller_profiles
  for select to anon, authenticated using (is_public or user_id = auth.uid());
drop policy if exists "Sellers create their own profile" on public.seller_profiles;
create policy "Sellers create their own profile" on public.seller_profiles
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Sellers update their own profile" on public.seller_profiles;
create policy "Sellers update their own profile" on public.seller_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Published listings are public" on public.listings;
create policy "Published listings are public" on public.listings
  for select to anon, authenticated using (status = 'published' or seller_id = auth.uid());
drop policy if exists "Sellers create listings" on public.listings;
create policy "Sellers create listings" on public.listings
  for insert to authenticated with check (
    seller_id = auth.uid()
    and exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'seller')
  );
drop policy if exists "Sellers update their listings" on public.listings;
create policy "Sellers update their listings" on public.listings
  for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "Sellers delete their listings" on public.listings;
create policy "Sellers delete their listings" on public.listings
  for delete to authenticated using (seller_id = auth.uid());

drop policy if exists "Users manage their carts" on public.carts;
create policy "Users manage their carts" on public.carts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users manage their cart items" on public.cart_items;
create policy "Users manage their cart items" on public.cart_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users manage their saved listings" on public.saved_listings;
create policy "Users manage their saved listings" on public.saved_listings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Buyers and assigned sellers read service requests" on public.service_requests;
create policy "Buyers and assigned sellers read service requests" on public.service_requests
  for select to authenticated using (buyer_id = auth.uid() or provider_id = auth.uid());
drop policy if exists "Buyers create service requests" on public.service_requests;
create policy "Buyers create service requests" on public.service_requests
  for insert to authenticated with check (buyer_id = auth.uid());
drop policy if exists "Assigned sellers update service requests" on public.service_requests;
create policy "Assigned sellers update service requests" on public.service_requests
  for update to authenticated using (provider_id = auth.uid()) with check (provider_id = auth.uid());

drop policy if exists "Events are public" on public.events;
create policy "Events are public" on public.events
  for select to anon, authenticated using (true);
drop policy if exists "Users read their event RSVPs" on public.event_rsvps;
create policy "Users read their event RSVPs" on public.event_rsvps
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users manage their event RSVPs" on public.event_rsvps;
create policy "Users manage their event RSVPs" on public.event_rsvps
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Published community posts are public" on public.community_posts;
create policy "Published community posts are public" on public.community_posts
  for select to anon, authenticated using (status = 'published' or author_id = auth.uid());
drop policy if exists "Authenticated users create posts" on public.community_posts;
create policy "Authenticated users create posts" on public.community_posts
  for insert to authenticated with check (author_id = auth.uid() and status = 'pending');
drop policy if exists "Authors update their posts" on public.community_posts;
create policy "Authors update their posts" on public.community_posts
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid() and status = 'pending');
drop policy if exists "Authors delete their posts" on public.community_posts;
create policy "Authors delete their posts" on public.community_posts
  for delete to authenticated using (author_id = auth.uid());
drop policy if exists "Published comments are public" on public.community_comments;
create policy "Published comments are public" on public.community_comments
  for select to anon, authenticated using (status = 'published' or author_id = auth.uid());
drop policy if exists "Users create their own comments" on public.community_comments;
create policy "Users create their own comments" on public.community_comments
  for insert to authenticated with check (author_id = auth.uid() and status = 'pending');
drop policy if exists "Authors update their comments" on public.community_comments;
create policy "Authors update their comments" on public.community_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid() and status = 'pending');
drop policy if exists "Authors delete their comments" on public.community_comments;
create policy "Authors delete their comments" on public.community_comments
  for delete to authenticated using (author_id = auth.uid());

create or replace function public.is_conversation_participant(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = target_conversation and user_id = auth.uid()
  );
$$;

drop policy if exists "Participants read conversations" on public.conversations;
create policy "Participants read conversations" on public.conversations
  for select to authenticated using (public.is_conversation_participant(id));
drop policy if exists "Authenticated users start conversations" on public.conversations;
create policy "Authenticated users start conversations" on public.conversations
  for insert to authenticated with check (true);
drop policy if exists "Participants read conversation members" on public.conversation_participants;
create policy "Participants read conversation members" on public.conversation_participants
  for select to authenticated using (public.is_conversation_participant(conversation_id));
drop policy if exists "Users add themselves to conversations" on public.conversation_participants;
create policy "Users add themselves to conversations" on public.conversation_participants
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages" on public.messages
  for select to authenticated using (public.is_conversation_participant(conversation_id));
drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_conversation_participant(conversation_id)
  );
drop policy if exists "Senders update their messages" on public.messages;
create policy "Senders update their messages" on public.messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "Buyers read their orders" on public.orders;
create policy "Buyers read their orders" on public.orders
  for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());
drop policy if exists "Buyers create their orders" on public.orders;
create policy "Buyers create their orders" on public.orders
  for insert to authenticated with check (buyer_id = auth.uid() and status = 'pending');
drop policy if exists "Buyers read their order items" on public.order_items;
create policy "Buyers read their order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders where id = order_id and buyer_id = auth.uid())
    or seller_id = auth.uid()
  );
drop policy if exists "Buyers add items to their pending orders" on public.order_items;
create policy "Buyers add items to their pending orders" on public.order_items
  for insert to authenticated with check (
    exists (select 1 from public.orders where id = order_id and buyer_id = auth.uid() and status = 'pending')
  );
drop policy if exists "Order owners read payment records" on public.payment_records;
create policy "Order owners read payment records" on public.payment_records
  for select to authenticated using (
    exists (select 1 from public.orders where id = order_id and buyer_id = auth.uid())
  );
drop policy if exists "Buyers read their order reports" on public.order_reports;
create policy "Buyers read their order reports" on public.order_reports
  for select to authenticated using (buyer_id = auth.uid());
drop policy if exists "Buyers create their order reports" on public.order_reports;
create policy "Buyers create their order reports" on public.order_reports
  for insert to authenticated with check (buyer_id = auth.uid());

drop policy if exists "Users read their notifications" on public.notifications;
create policy "Users read their notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users update their notifications" on public.notifications;
create policy "Users update their notifications" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Platform settings are readable" on public.platform_settings;
create policy "Platform settings are readable" on public.platform_settings
  for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update on public.seller_profiles to authenticated;
grant select on public.seller_profiles to anon;
grant select, insert, update, delete on public.listings to authenticated;
grant select on public.listings to anon;
grant select, insert, update, delete on public.carts, public.cart_items, public.saved_listings to authenticated;
grant select, insert, update on public.service_requests to authenticated;
grant select on public.events to anon, authenticated;
grant select, insert, delete on public.event_rsvps to authenticated;
grant select, insert, update, delete on public.community_posts, public.community_comments to authenticated;
grant select on public.community_posts, public.community_comments to anon;
grant select, insert on public.conversations, public.conversation_participants to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select, insert on public.orders, public.order_items to authenticated;
grant select on public.payment_records to authenticated;
grant select, insert on public.order_reports to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.platform_settings to anon, authenticated;

insert into public.listings (seed_key, kind, category, title, description, seller_name, price, image_url, seller_id, rating, rating_count)
values
  ('goods-tote', 'goods', 'Style', 'Handwoven everyday tote', 'Small-batch', 'Mara Studio', 38.00, 'assets/product-tote.jpg', null, 4.9, 18),
  ('goods-oak-table', 'goods', 'Home', 'Solid oak side table', 'Made to order · Local pickup', 'Northwood Works', 145.00, 'assets/oak-table.jpg', null, 5.0, 9),
  ('goods-linen-cushion', 'goods', 'Home', 'Natural linen cushion set', 'Set of 2 · Easy-care fabric', 'Soft Corner', 52.00, 'assets/linen-cushion.jpg', null, 4.8, 24),
  ('goods-ceramic-set', 'goods', 'Style', 'Custom ceramic breakfast set', 'Hand-finished · Made locally', 'Clay & Current', 64.00, 'assets/ceramic-set.jpg', null, 4.9, 11),
  ('goods-cotton-scarf', 'goods', 'Style', 'Hand-dyed cotton scarf', 'Natural dyes · Gift-ready', 'Indigo Day', 42.00, 'assets/cotton-scarf.jpg', null, 4.7, 16),
  ('service-home-cleaning', 'service', 'Home care', 'Home cleaning', 'Recurring or one-time cleans with a written checklist and clear scope.', 'Bright Nest Co.', 45.00, 'assets/home-cleaning.jpg', null, 4.9, 30),
  ('service-pest-control', 'service', 'Home care', 'Pest control', 'Licensed local specialists explain the treatment, safety steps, and follow-up.', 'ClearHome Pest Care', null, 'assets/pest-control.jpg', null, 4.8, 21),
  ('service-home-repairs', 'service', 'Repairs', 'Home repairs', 'Book a vetted professional for small repairs, installation, and assembly.', 'Fixwell Services', 35.00, 'assets/home-repairs.jpg', null, 4.8, 17),
  ('service-plant-care', 'service', 'Wellness', 'Plant care', 'Get practical help keeping your indoor plants healthy and thriving.', 'Green Thumb Home', 30.00, 'assets/plant-care.jpg', null, 4.9, 14),
  ('service-product-photography', 'service', 'Creative', 'Product photography', 'Work with local creatives on a brief, delivery date, and usage rights.', 'Frame & Light Studio', 90.00, 'assets/product-photography.jpg', null, 5.0, 8),
  ('service-wellness-coaching', 'service', 'Wellness', 'Wellness coaching', 'Explore a qualified provider''s experience and agree on goals before booking.', 'Grounded Practice', 55.00, 'assets/wellness-coaching.jpg', null, 4.9, 12)
on conflict (seed_key) do update set
  kind = excluded.kind,
  category = excluded.category,
  title = excluded.title,
  description = excluded.description,
  seller_name = excluded.seller_name,
  price = excluded.price,
  image_url = excluded.image_url,
  rating = excluded.rating,
  rating_count = excluded.rating_count;

insert into public.events (seed_key, title, host, description, starts_at, location)
values
  ('event-studio-tour', 'From clay to cup: a live studio tour', 'Clay & Current · Maker demo', 'A guided look at a local ceramic studio.', '2027-06-14 18:00:00+00', 'Online'),
  ('event-styling-qa', 'Small-space styling Q&A', 'Northwood Works · Ask a maker', 'Bring your questions for a neighborhood maker.', '2027-06-16 11:30:00+00', 'Online'),
  ('event-neighborhood-pros', 'Meet your neighborhood home pros', 'Bigwizz Local · Community meetup', 'Meet local professionals and ask about their work.', '2027-06-19 17:00:00+00', 'Local meetup')
on conflict (seed_key) do update set
  title = excluded.title,
  host = excluded.host,
  description = excluded.description,
  starts_at = excluded.starts_at,
  location = excluded.location;

insert into public.community_posts (seed_key, title, category, body, image_url, status)
values
  ('post-entryway-recommendations', 'Any recommendations for a small entryway?', 'Home & living', 'Looking for durable, locally made storage ideas. What has worked well for you?', 'assets/oak-table.jpg', 'published'),
  ('post-natural-dyes', 'Behind the scenes: natural fabric dyes', 'Makers & craft', 'Sharing notes from this week''s indigo batch and answering questions about care.', 'assets/cotton-scarf.jpg', 'published'),
  ('post-home-pros', 'Reliable home pros in the neighborhood', 'Recommendations', 'What do you look for when booking a new service provider?', 'assets/home-repairs.jpg', 'published')
on conflict (seed_key) do update set
  title = excluded.title,
  category = excluded.category,
  body = excluded.body,
  image_url = excluded.image_url,
  status = excluded.status;

insert into public.platform_settings (key, value)
values ('buyer_fee_rate', '{"rate": 0.02, "currency": "USD"}'::jsonb)
on conflict (key) do update set value = excluded.value;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Listing images are public" on storage.objects;
create policy "Listing images are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'listing-images');
drop policy if exists "Sellers upload their listing images" on storage.objects;
create policy "Sellers upload their listing images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Sellers update their listing images" on storage.objects;
create policy "Sellers update their listing images" on storage.objects
  for update to authenticated using (
    bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Sellers delete their listing images" on storage.objects;
create policy "Sellers delete their listing images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
