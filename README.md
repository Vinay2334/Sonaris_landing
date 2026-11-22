# Sonaris website — pricing + email verification

Separate static site the extension redirects to. No build step, no npm
packages, no bundler: open the files directly or serve this folder with any
static host.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page: cinema-themed pitch (mock player, filmstrip, where/how, plan teaser re-rendered from the catalog when the backend answers) |
| `pricing.html` (+ `pricing.js`) | Payments page: plan cards rendered from `GET /api/v1/plans` (DB-driven — no redeploy to change them). Checkout is gated behind a site sign-in; buttons go to Dodo hosted links with `metadata_user_id`, or to `signin.html` first when signed out. The signed-in account's current plan is highlighted (from the quota endpoint); cheaper plans show as unavailable |
| `signin.html` (+ `signin.js`) | Site sign-in / sign-up (email + Google) via Supabase Auth directly. Returns to `?next=` afterwards, or straight to a pending plan's Dodo checkout |
| `account.html` (+ `account.js`) | My account: profile (name, email, member since, verification), current plan (live catalog matched by name), and minutes quota with usage bar from `GET /api/v1/me/quota`. Signed-out visitors get a sign-in gate (`?next=account.html`) |
| `verify.html` (+ `verify.js`) | Internal only — reached from Supabase confirmation emails, linked from nowhere on the site (set as Site URL in Supabase) |
| `success.html` | Dodo checkout return page (passed as `redirect_url` on every payment link) |

Shared: `styles.css`, `site-config.js` (service wiring: Supabase project, Dodo base, backend origin, Chrome Web Store URL), `auth.js` (Supabase session, checkout + API URL helpers, plan-state helper for `pricing.js` / `signin.js`, account helpers + store-link painter).

Every navbar carries **My account** (`account.html`) and an **Install extension** button pointing at `CHROME_WEBSTORE_URL` in `site-config.js` — currently the store homepage until the listing is live, then swap in the full item URL. Pages mark the link with `data-webstore`; `auth.js` fills in the href on load so the URL lives in one place.

## Plans (monthly, USD)

| Plan | Price | Minutes/mo | Notes |
|---|---|---|---|
| Starter | $0 | 100 (6,000 s) | Default for every signup (`free` row) |
| Pro | $12 | 1,000 | Most popular |
| Studio | $29 | 4,000 | Teams: 3 seats, shared workspace |

This table mirrors the seed data — the live source is the `public.plans`
table, served by `GET /api/v1/plans` (backend `app/api/plans.py`, migration
`supabase/migrations/20261118000000_plan_catalog.sql`). Edit names, prices,
features, order, or highlight in the Supabase dashboard; the site and the
landing teaser re-render with no redeploy. Keep plan names unique: the site
matches the signed-in account's current plan by name.

Modeled on how caption/meeting extensions tier (limited free minutes →
generous solo plan → team plan). Quota numbers are illustrative — change
them in `pricing.html` AND in the Supabase `plans` rows (migration
`supabase/migrations/20261112000000_auth_quota.sql` seeds `free`; add `pro`
/ `studio` rows, e.g. `insert into public.plans ... values
('pro','Pro',60000,...), ('studio','Studio',240000,...)`).

## Going live (you do this — nothing to install)

1. **Dodo Payments**: with the dashboard **Test Mode toggle ON**, create 2
   monthly products (Pro $12, Studio $29), copy their test product IDs
   into `PLANS` in `site-config.js`. No return-URL setup needed — the page
   sends `success.html` as `redirect_url` on every link. Going live later
   means: new live products, live IDs in `PLANS`, and
   `DODO_CHECKOUT_BASE` back to `https://checkout.dodopayments.com/buy`.
2. **Supabase** → Authentication → URL Configuration: Site URL =
   `…/verify.html` (+ add to Redirect URLs). Keep **Confirm email** on;
   signup links will land on `verify.html`. For Google sign-in on the
   site, also add `…/signin.html` to Redirect URLs (Supabase returns the
   OAuth tokens there).
3. **Serve** this folder (any static host) and set `SITE_URL` in
   `site-config.js`. The backend must allow the site origin
   (`WEBSITE_ORIGINS` in the backend `.env`, includes localhost:8080 by
   default) or the browser blocks the plans/quota fetches.
4. **Extension**: see `EXTENSION_WIRING.md`.

## Local preview

```powershell
# from this folder — Python is already on this machine, no downloads
python -m http.server 8080
# open http://localhost:8080/index.html in a browser
```

## After a payment: webhook (built, needs your secrets to run)

`server_new` has `POST /api/v1/billing/dodo/webhook` (`app/api/billing.py`
+ `app/services/billing.py`, tests in `tests/test_billing.py`). It verifies
the Standard Webhooks signature, maps the Dodo product to a plan via
`DODO_PLAN_MAP`, and sets `profiles.plan_id` — by `metadata_user_id` from
the checkout link first (always present now: pricing gates checkout behind
a site sign-in, so buyers can pay with any email), by matching the Dodo
customer email second.
`subscription.cancelled` / `subscription.expired` drop the account back to
`DODO_FREE_PLAN_ID` (`free`). The quota flow (`authorize`/`commit`) picks
the new plan up automatically on the next session. Only the Dodo product
linkage lives in backend env (`DODO_PLAN_MAP`); everything the pricing
page shows comes from the `plans` table via `GET /api/v1/plans`.

To switch it on: set `DODO_WEBHOOK_SECRET` + `DODO_PLAN_MAP` in the backend
`.env` (see `.env.example`), register the URL in Dodo (Developer →
Webhooks), and apply
`supabase/migrations/20261116000000_billing_plans.sql` so the `pro` /
`studio` rows exist. With no secret the endpoint answers 503.
