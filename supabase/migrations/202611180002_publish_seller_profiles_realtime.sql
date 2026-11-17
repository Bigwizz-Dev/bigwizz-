-- Let marketplace clients receive opted-in seller location/profile changes.
-- Row Level Security on seller_profiles still controls which profile rows are visible.
alter publication supabase_realtime add table public.seller_profiles;
