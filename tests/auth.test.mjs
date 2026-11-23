// Coverage for the website auth + checkout helpers (website/auth.js):
// param parsing, session usability, refresh clearing a dead token,
// identity resolution (site session beats URL hints), and Dodo checkout
// URL building. Plain node (node --test); no DOM needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SITE = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SITE_URL: "http://localhost:8080",
  DODO_CHECKOUT_BASE: "https://test.checkout.dodopayments.com/buy",
  PLANS: [{ id: "pro", dodoProductId: "pdt_pro" }],
};

// Objects cross the vm realm boundary (different Object prototype), so
// compare their JSON shape, not object identity.
const norm = (v) => JSON.parse(JSON.stringify(v));

function loadAuth({ fetchImpl = null, stored = {}, origin = "http://localhost:8080" } = {}) {
  const mem = { ...stored };
  const calls = [];
  const window = {
    SonarisSite: { ...SITE },
    location: { origin, href: origin + "/pricing.html" },
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
  };
  const context = vm.createContext({
    window,
    console,
    fetch: fetchImpl ||
      (async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({}) };
      }),
  });
  vm.runInContext(
    readFileSync(new URL("../auth.js", import.meta.url), "utf8"),
    context,
  );
  return { auth: window.SonarisSiteAuth, mem, calls };
}

test("parseParams reads query and hash strings", () => {
  const { auth } = loadAuth();
  assert.deepEqual(norm(auth.parseParams("?next=a%20b&plan=pro")), { next: "a b", plan: "pro" });
  assert.deepEqual(norm(auth.parseParams("#access_token=t&expires_in=3600")), {
    access_token: "t",
    expires_in: "3600",
  });
  assert.deepEqual(norm(auth.parseParams("")), {});
});

test("isUsable accepts live sessions and rejects dead ones", () => {
  const { auth } = loadAuth();
  const live = { access_token: "a", expires_at: Date.now() + 3600 * 1000 };
  assert.equal(auth.isUsable(live), true);
  assert.equal(auth.isUsable({ access_token: "a", expires_at: Date.now() - 1000 }), false);
  assert.equal(auth.isUsable({ access_token: "a", expires_at: Date.now() + 1000 }), false);
  assert.equal(auth.isUsable(null), false);
  assert.equal(auth.isUsable({}), false);
});

test("sessionFromFragment normalizes Google return tokens", () => {
  const { auth } = loadAuth();
  const before = Date.now();
  const s = auth.sessionFromFragment({ access_token: "a", refresh_token: "r", expires_in: "3600" });
  assert.equal(s.access_token, "a");
  assert.equal(s.refresh_token, "r");
  assert.ok(s.expires_at > before);
  assert.equal(auth.sessionFromFragment({}), null);
});

test("resolveIdentity prefers the site session over URL hints", () => {
  const { auth } = loadAuth();
  assert.deepEqual(
    norm(auth.resolveIdentity({
      sessionUser: { id: "u-1", email: "site@example.com" },
      hintEmail: "other@example.com",
      hintUserId: "u-9",
    })),
    { signedIn: true, userId: "u-1", email: "site@example.com" },
  );
  assert.deepEqual(
    norm(auth.resolveIdentity({ hintEmail: "hint@example.com", hintUserId: "u-9" })),
    { signedIn: false, userId: "u-9", email: "hint@example.com" },
  );
});

test("buildCheckoutUrl stamps metadata and prefill", () => {
  const { auth } = loadAuth();
  const url = auth.buildCheckoutUrl(
    { id: "pro", dodoProductId: "pdt_pro" },
    { signedIn: true, userId: "u-1", email: "me@example.com" },
  );
  assert.ok(url.startsWith("https://test.checkout.dodopayments.com/buy/pdt_pro?"));
  assert.ok(url.includes("redirect_url=" + encodeURIComponent("http://localhost:8080/success.html")));
  assert.ok(url.includes("email=" + encodeURIComponent("me@example.com")));
  assert.ok(url.includes("metadata_user_id=u-1"));
  assert.ok(url.includes("metadata_plan_id=pro"));
  assert.equal(auth.buildCheckoutUrl({ id: "pro" }, { userId: "u-1" }), null);
});

test("buildSigninUrl preserves next, plan, and email", () => {
  const { auth } = loadAuth();
  const url = auth.buildSigninUrl("pricing.html?from=extension", {
    plan: "pro",
    email: "me@example.com",
  });
  assert.ok(url.startsWith("signin.html?"));
  assert.ok(url.includes("next=" + encodeURIComponent("pricing.html?from=extension")));
  assert.ok(url.includes("plan=pro"));
  assert.ok(url.includes("email=" + encodeURIComponent("me@example.com")));
});

test("googleAuthorizeUrl points at Supabase with the return page", () => {
  const { auth } = loadAuth();
  const url = auth.googleAuthorizeUrl("http://localhost:8080/signin.html");
  assert.ok(url.includes("/auth/v1/authorize?provider=google"));
  assert.ok(url.includes("redirect_to=" + encodeURIComponent("http://localhost:8080/signin.html")));
});

test("usable session returns its token without network", async () => {
  const stored = {
    sonarisSiteSession: JSON.stringify({
      access_token: "live",
      refresh_token: "r",
      expires_at: Date.now() + 3600 * 1000,
      user: { id: "u-1" },
    }),
  };
  let fetched = 0;
  const { auth } = loadAuth({
    stored,
    fetchImpl: async () => { fetched++; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  assert.equal(await auth.getAccessToken(), "live");
  assert.equal(fetched, 0);
});

test("planStates highlights current and marks cheaper plans", () => {
  const { auth } = loadAuth();
  const plans = [
    { id: "free", name: "Starter", price_monthly_usd: 0, dodo_product_id: null },
    { id: "pro", name: "Pro", price_monthly_usd: 12, dodo_product_id: "pdt_pro" },
    { id: "studio", name: "Studio", price_monthly_usd: 29, dodo_product_id: "pdt_studio" },
  ];
  assert.deepEqual(norm(auth.planStates(plans, "Pro")), [
    { id: "free", isCurrent: false, isCheaper: true, canCheckout: false },
    { id: "pro", isCurrent: true, isCheaper: false, canCheckout: true },
    { id: "studio", isCurrent: false, isCheaper: false, canCheckout: true },
  ]);
});

test("planStates without a current plan enables everything", () => {
  const { auth } = loadAuth();
  const plans = [
    { id: "free", name: "Starter", price_monthly_usd: 0, dodo_product_id: null },
    { id: "pro", name: "Pro", price_monthly_usd: 12, dodo_product_id: "pdt_pro" },
  ];
  assert.deepEqual(norm(auth.planStates(plans, null)), [
    { id: "free", isCurrent: false, isCheaper: false, canCheckout: false },
    { id: "pro", isCurrent: false, isCheaper: false, canCheckout: true },
  ]);
  // Unknown plan name degrades to signed-out (match by name, same table).
  assert.deepEqual(
    norm(auth.planStates(plans, "Nonexistent")).map((s) => s.isCurrent),
    [false, false],
  );
});

test("buildCheckoutUrl accepts catalog rows (snake_case product id)", () => {
  const { auth } = loadAuth();
  const url = auth.buildCheckoutUrl(
    { id: "pro", dodo_product_id: "pdt_pro" },
    { signedIn: true, userId: "u-1", email: "me@example.com" },
  );
  assert.ok(url.includes("/buy/pdt_pro?"));
  assert.ok(url.includes("metadata_user_id=u-1"));
  assert.equal(auth.buildCheckoutUrl({ id: "pro" }, { userId: "u-1" }), null);
});

test("requestPasswordReset posts to /recover with redirect_to", async () => {
  const seen = [];
  const { auth } = loadAuth({
    fetchImpl: async (url, opts) => {
      seen.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(
    await auth.requestPasswordReset(" me@example.com ", "http://localhost:8080/reset-password.html"),
    true,
  );
  assert.ok(seen[0].url.includes("/auth/v1/recover"));
  assert.ok(seen[0].url.includes("redirect_to=" + encodeURIComponent("http://localhost:8080/reset-password.html")));
  assert.deepEqual(norm(seen[0].body), { email: "me@example.com" });

  await assert.rejects(auth.requestPasswordReset("   ", "http://x/reset"), /email/i);
  const { auth: auth2 } = loadAuth({
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ msg: "bad email" }) }),
  });
  await assert.rejects(auth2.requestPasswordReset("bad", ""), /bad email/);
});

test("exchangeRecoveryToken verifies the token_hash into a session", async () => {
  const seen = [];
  const { auth } = loadAuth({
    fetchImpl: async (url, opts) => {
      seen.push({ url: String(url), body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "rec", refresh_token: "rr", expires_in: 3600 }),
      };
    },
  });
  const session = await auth.exchangeRecoveryToken("hash-123");
  assert.equal(session.access_token, "rec");
  assert.deepEqual(norm(seen[0].body), { type: "recovery", token_hash: "hash-123" });

  const { auth: auth2 } = loadAuth({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  assert.equal(await auth2.exchangeRecoveryToken("stale"), null);
  assert.equal(await auth2.exchangeRecoveryToken(""), null);
  assert.equal(await auth2.exchangeRecoveryToken(null), null);
});

test("updatePassword PUTs the new password with the recovery token", async () => {
  const seen = [];
  const { auth } = loadAuth({
    fetchImpl: async (url, opts) => {
      seen.push({ url: String(url), method: opts.method, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ id: "u-1" }) };
    },
  });
  const user = await auth.updatePassword("rec-token", "newpass1");
  assert.equal(user.id, "u-1");
  assert.ok(seen[0].url.includes("/auth/v1/user"));
  assert.equal(seen[0].method, "PUT");
  assert.equal(seen[0].auth, "Bearer " + "rec-token");
  assert.deepEqual(norm(seen[0].body), { password: "newpass1" });

  await assert.rejects(auth.updatePassword("", "newpass1"), /token/i);
  await assert.rejects(auth.updatePassword("rec-token", "short"), /6 characters/);
  const { auth: auth2 } = loadAuth({
    fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: "weak password" }) }),
  });
  await assert.rejects(auth2.updatePassword("expired", "longenough"), /weak password/);
});

test("stale session refreshes; rejected refresh clears the token", async () => {
  const good = {
    sonarisSiteSession: JSON.stringify({
      access_token: "old",
      refresh_token: "r",
      expires_at: Date.now() - 1000,
      user: { id: "u-1" },
    }),
  };
  const okFetch = async (url) => {
    if (String(url).includes("grant_type=refresh_token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new", refresh_token: "r2", expires_in: 3600 }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const first = loadAuth({ stored: good, fetchImpl: okFetch });
  assert.equal(await first.auth.getAccessToken(), "new");
  assert.equal(JSON.parse(first.mem.sonarisSiteSession).access_token, "new");

  const bad = {
    sonarisSiteSession: JSON.stringify({
      access_token: "old",
      refresh_token: "r",
      expires_at: Date.now() - 1000,
      user: { id: "u-1" },
    }),
  };
  const badFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const second = loadAuth({ stored: bad, fetchImpl: badFetch });
  assert.equal(await second.auth.getAccessToken(), null);
  assert.equal(second.mem.sonarisSiteSession, undefined);
});
