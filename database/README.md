# Bigwizz database

The Supabase schema and demo catalog are in [`schema.sql`](./schema.sql). It creates the marketplace tables, signup profile/role triggers, row-level security policies, listing image bucket, and initial goods, service, event, community, and fee-setting data.

## Current setup

- The Supabase project and schema have been created.
- The static app uses the project's public URL and publishable key from [`../assets/supabase-config.js`](../assets/supabase-config.js). A publishable key is intended for browser use; never place a `service_role` or secret key in this file or in GitHub.
- The app integration is in [`../assets/supabase-app.js`](../assets/supabase-app.js), loaded from [`../index.html`](../index.html).
- Supabase Auth is configured with `https://bigwizz-dev.github.io/bigwizz-/` as the Site URL and allowed redirect URL. Email sign-ups are enabled and email confirmation is required, but the app's sign-in page has been removed. Visitors can browse publicly; account-only features remain unavailable until sign-in is restored.
- The seller-profile role trigger is installed and verified. Its idempotent update is in [`migrations/20261113_add_seller_profile_role_trigger.sql`](./migrations/20261113_add_seller_profile_role_trigger.sql); fresh projects get the same trigger from `schema.sql`.
- GitHub Pages updates only after the changes are pushed to the repository's published branch. A Supabase GitHub connection does not itself publish frontend changes.

The schema enables row-level security on every application table. Never disable those policies to work around an app error.

## Application boundary

Public catalog reads use Supabase. Seller profiles/listings and images, saved listings, carts, event RSVPs, service requests, notifications, and order reports require an authenticated account and are unavailable while sign-in is disabled. Checkout, payment processing, messaging, community posting, seller verification, and payouts are not implemented. `orders` and `payment_records` are data structures only; payment state must be created or updated by a trusted server/Edge Function after integrating a payment provider. Never collect or store card numbers in these tables.

Seed listings use the app's existing `assets/` image paths. New seller images belong in the `listing-images` Storage bucket under a folder named for the seller's auth user ID.
