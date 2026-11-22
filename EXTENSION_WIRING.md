# Extension → website wiring

Three small extension changes connect the new site. All paths are relative
to the repo root.

## 1. "Upgrade to Pro" opens the payments page — implemented

`user-store.js` → `upgrade()` builds the pricing URL with the account
attached (`sonarisConfig.pricingUrl(email, userId)` → `?from=extension`
`&email=…&user_id=…`) and sends it to the service worker as
`{ type: "sonaris-menu-action", action: "upgrade", url }`, which opens the
tab after allow-listing it against its own `SITE_URL` constant. The relay
exists because content scripts have no `chrome.tabs` — the URL is built
where the account lives (and is covered by
`extensionRTC/tests/user-store.test.mjs`), the worker only opens
same-origin URLs.

Keep the three `SITE_URL` values in sync when deploying:
`website/site-config.js`, `extensionRTC/.../supabase-config.js`,
`extensionRTC/src/service-worker.js`.

## 2. "Check your inbox" points at the verify page

`extensionRTC/src/signin.js` shows `"Check your inbox to confirm your
mail."` after signup-with-confirmation. Append the verify URL so users who
miss the email link know where it lands:

```js
errorLine.textContent =
  "Check your inbox to confirm your mail, then open " +
  "https://YOUR-SITE/verify.html if the link didn't take you there.";
```

Supabase-side (dashboard, no code): Authentication → URL Configuration →
Site URL = `https://YOUR-SITE/verify.html`, added to Redirect URLs.

## 3. New paid plans in Supabase + backend

```sql
insert into public.plans (id, name, quota_limit_seconds, price_label, tagline)
values
  ('pro', 'Pro', 60000, '$12 / month', 'For daily viewers and learners'),
  ('studio', 'Studio', 240000, '$29 / month', 'For teams and heavy use')
on conflict (id) do update set
  quota_limit_seconds = excluded.quota_limit_seconds,
  price_label = excluded.price_label,
  tagline = excluded.tagline;
```

- `60000 s` = 1,000 min, `240000 s` = 4,000 min — matches `website/index.html`.
- No backend quota-code changes needed: `authorize_session` /
  `commit_session_usage` read `plans` live; changing `profiles.plan_id`
  (via the future Dodo webhook) takes effect on the next session and the
  menu re-reads quota on open.
- Dodo product IDs must also be pasted into `website/site-config.js`
  (`PLANS[].dodoProductId`).

## 4. Manifest (only when the site domain is final)

If the extension must call the site (it currently doesn't — it only
opens it in a tab), add `https://YOUR-SITE/*` to `host_permissions` in
`extensionRTC/manifest.json`. Opening a tab needs no permission change.
