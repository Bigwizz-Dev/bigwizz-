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

drop trigger if exists on_seller_profile_created on public.seller_profiles;
create trigger on_seller_profile_created
  after insert on public.seller_profiles
  for each row execute procedure public.handle_seller_profile_created();
