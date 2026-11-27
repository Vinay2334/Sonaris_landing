// Sonaris website — single source of truth for external service wiring.
//
// HOW TO GO LIVE (you do these steps, nothing is downloaded by the agent):
//   1. Dodo Payments dashboard → create 3 monthly Products (Free needs no
//      product — it is the default Supabase plan). Paste each Product ID
//      into PLANS below (format: prod_... or live product slug).
//   2. Nothing to set in Dodo for returns: pricing.js passes
//      <SITE_URL>/success.html as `redirect_url` on every payment link
//      (Dodo appends ?status=...&...).
//   3. Supabase dashboard → Authentication → URL Configuration → Site URL
//      = <SITE_URL>/verify.html, and add it under Redirect URLs.
//      Email template "{{ .ConfirmationURL }}" will then land here.
//      Also add <SITE_URL>/reset-password.html and <SITE_URL>/signin.html
//      under Redirect URLs: the site passes them as `redirect_to` for
//      password-reset emails (auth.js requestPasswordReset) and for the
//      Google sign-in return.
//   4. Serve this folder statically (any static host) and set SITE_URL.
//   5. Point the extension at it — see EXTENSION_WIRING.md.

window.SonarisSite = {
  // Public origin of this site, no trailing slash. Used to build absolute
  // links the extension and Supabase redirect to. Serve this folder on the
  // same port (e.g. `python -m http.server 8080`) so the Dodo `redirect_url`
  // lands back here after test checkout.
  SITE_URL: "https://sonaris.cc/",

  // Supabase project (public anon key only — same values as
  // extensionRTC/src/caption-overlay/lib/supabase-config.js).
  SUPABASE_URL: "https://hsuuleiisdgbidbwkqae.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_namQsShONsZJviiyWtulnA_wZ4NWUPW",

  // Dodo Payments static payment-link base:
  // `https://{checkout,test.checkout}.dodopayments.com/buy/{product_id}`.
  // TEST MODE uses test.checkout.dodopayments.com and test products; LIVE
  // uses checkout.dodopayments.com and live products — switch this base
  // when you go live. Per Dodo's docs, payment links take `redirect_url`
  // (required — where Dodo sends the customer back, appending
  // payment_id/status/email), `email` to pre-fill, and custom fields as
  // `metadata_*` (e.g. metadata_user_id). Native checkout links need no
  // SDK and no npm install.
  DODO_CHECKOUT_BASE: "https://test.checkout.dodopayments.com/buy",

  // FastAPI backend origin (must match where `uvicorn app.main:app`
  // listens). The pricing page fetches the plan catalog and the signed-in
  // user's quota from here; the extension has its own copy of this URL.
  BACKEND_BASE_URL: "https://api.sonaris.cc/",

  // Chrome Web Store listing for the extension (navbar + account page
  // "Install extension" buttons). Points at the store homepage until the
  // listing is live — then replace with the full item URL.
  CHROME_WEBSTORE_URL: "https://chromewebstore.google.com/",

  // Support inbox shown as plain text in every site footer and in
  // the extension menu + sign-in page. Single source of truth for the
  // site; components.js reads it with a hardcoded fallback.
  SUPPORT_EMAIL: "support@sonaris.cc",

  // Plan content (names, prices, features, order, highlight) is NOT
  // configured here: it comes from the `public.plans` table via
  // GET /api/v1/plans, so the dashboard edits it with no redeploy.
  // The Dodo product behind each paid plan is linked server-side via
  // DODO_PLAN_MAP (backend env); the catalog endpoint attaches it per
  // plan as `dodo_product_id`.
};
