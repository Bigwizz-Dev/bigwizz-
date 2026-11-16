-- Enforce the agreed 3% buyer fee, 5% provider commission and 50/50 provider-net split.
alter table public.service_bookings
  drop constraint if exists service_bookings_buyer_fee_calculation_check,
  drop constraint if exists service_bookings_provider_commission_calculation_check,
  drop constraint if exists service_bookings_first_payout_half_check,
  add constraint service_bookings_buyer_fee_calculation_check
    check (buyer_fee = round(service_price * buyer_fee_rate, 2)),
  add constraint service_bookings_provider_commission_calculation_check
    check (provider_commission = round(service_price * provider_commission_rate, 2)),
  add constraint service_bookings_first_payout_half_check
    check (first_payout_amount = round(provider_net / 2, 2));
