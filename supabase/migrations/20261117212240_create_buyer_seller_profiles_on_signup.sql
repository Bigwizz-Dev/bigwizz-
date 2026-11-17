create or replace function private.handle_new_bigwizz_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_role text;
  display_name_value text;
begin
  chosen_role := case
    when coalesce(new.raw_user_meta_data ->> 'account_type', 'buyer') = 'seller' then 'seller'
    else 'buyer'
  end;
  display_name_value := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Bigwizz member');

  insert into public.profiles (id, display_name, country, state, city, area)
  values (
    new.id,
    display_name_value,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'country'), ''), 'Nigeria'),
    nullif(btrim(new.raw_user_meta_data ->> 'state'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'city'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'area'), '')
  )
  on conflict (id) do nothing;

  if chosen_role = 'seller' then
    insert into public.seller_profiles (user_id, shop_name, seller_type, offering_description, country, state, city, area)
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'shop_name'), ''), display_name_value || '''s Shop'),
      'Goods and services',
      '',
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'country'), ''), 'Nigeria'),
      nullif(btrim(new.raw_user_meta_data ->> 'state'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'city'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'area'), '')
    )
    on conflict (user_id) do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'buyer')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_bigwizz_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_bigwizz on auth.users;
create trigger on_auth_user_created_bigwizz
after insert on auth.users
for each row execute function private.handle_new_bigwizz_user();
