// Coverage for the My account page helpers in website/auth.js:
// displayName, normalizeQuota, webstoreUrl, and fetchQuota.
// Plain node (node --test); no DOM needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SITE = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SITE_URL: "http://localhost:8080",
  DODO_CHECKOUT_BASE: "https://test.checkout.dodopayments.com/buy",
  BACKEND_BASE_URL: "http://localhost:8000",
  CHROME_WEBSTORE_URL: "https://chromewebstore.google.com/",
};

// Objects cross the vm realm boundary (different Object prototype), so
// compare their JSON shape, not object identity.
const norm = (v) => JSON.parse(JSON.stringify(v));

function loadAuth({ fetchImpl = null, stored = {}, site = SITE } = {}) {
  const mem = { ...stored };
  const calls = [];
  const window = {
    SonarisSite: { ...site },
    location: { origin: "http://localhost:8080", href: "http://localhost:8080/account.html" },
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

function liveSession() {
  return {
    sonarisSiteSession: JSON.stringify({
      access_token: "live",
      refresh_token: "r",
      expires_at: Date.now() + 3600 * 1000,
      user: { id: "u-1", email: "ada@example.com" },
    }),
  };
}

test("displayName prefers first+last, then full_name, then email handle", () => {
  const { auth } = loadAuth();
  assert.equal(
    auth.displayName({ email: "a@x.co", user_metadata: { first_name: "Ada", last_name: "Lovelace" } }),
    "Ada Lovelace",
  );
  assert.equal(
    auth.displayName({ email: "a@x.co", user_metadata: { first_name: "Ada" } }),
    "Ada",
  );
  assert.equal(
    auth.displayName({ email: "a@x.co", user_metadata: { full_name: "Grace Hopper" } }),
    "Grace Hopper",
  );
  assert.equal(auth.displayName({ email: "ada@example.com" }), "ada");
  assert.equal(auth.displayName({}), "there");
  assert.equal(auth.displayName(null), "there");
});

test("normalizeQuota shapes the backend snapshot for rendering", () => {
  const { auth } = loadAuth();
  assert.deepEqual(
    norm(auth.normalizeQuota({
      user_id: "u-1",
      email: "ada@example.com",
      plan: "Pro",
      used_seconds: 125,
      limit_seconds: 60000,
      remaining_seconds: 59875,
    })),
    {
      plan: "Pro",
      usedSeconds: 125,
      limitSeconds: 60000,
      remainingSeconds: 59875,
      email: "ada@example.com",
      userId: "u-1",
    },
  );
});

test("normalizeQuota derives remaining and tolerates gaps", () => {
  const { auth } = loadAuth();
  // Remaining derived when absent; plan object degrades to its name.
  const derived = norm(auth.normalizeQuota({
    plan: { name: "Studio" },
    used_seconds: 60,
    limit_seconds: 240000,
  }));
  assert.equal(derived.plan, "Studio");
  assert.equal(derived.remainingSeconds, 239940);
  // Missing numbers become 0; null snapshot is empty.
  assert.deepEqual(norm(auth.normalizeQuota(null)), {
    plan: "",
    usedSeconds: 0,
    limitSeconds: 0,
    remainingSeconds: 0,
    email: "",
    userId: "",
  });
  assert.equal(norm(auth.normalizeQuota({ limit_seconds: -5 })).limitSeconds, 0);
});

test("webstoreUrl reads config with a store-homepage fallback", () => {
  assert.equal(loadAuth().auth.webstoreUrl(), "https://chromewebstore.google.com/");
  const custom = loadAuth({
    site: { ...SITE, CHROME_WEBSTORE_URL: "https://chromewebstore.google.com/detail/abc" },
  });
  assert.equal(custom.auth.webstoreUrl(), "https://chromewebstore.google.com/detail/abc");
  const missing = loadAuth({ site: { ...SITE, CHROME_WEBSTORE_URL: "" } });
  assert.equal(missing.auth.webstoreUrl(), "https://chromewebstore.google.com/");
});

test("fetchQuota sends the bearer token and returns the snapshot", async () => {
  const seen = {};
  const { auth } = loadAuth({
    stored: liveSession(),
    fetchImpl: async (url, opts) => {
      seen.url = String(url);
      seen.auth = opts && opts.headers && opts.headers.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user_id: "u-1",
          plan: "Pro",
          used_seconds: 10,
          limit_seconds: 60000,
          remaining_seconds: 59990,
        }),
      };
    },
  });
  const snap = await auth.fetchQuota();
  assert.equal(seen.url, "http://localhost:8000/api/v1/me/quota");
  assert.equal(seen.auth, "Bearer live");
  assert.equal(snap.plan, "Pro");
});

test("fetchQuota resolves null when signed out, rejected, or offline", async () => {
  const signedOut = loadAuth();
  assert.equal(await signedOut.auth.fetchQuota(), null);

  const rejected = loadAuth({
    stored: liveSession(),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  assert.equal(await rejected.auth.fetchQuota(), null);

  const offline = loadAuth({
    stored: liveSession(),
    fetchImpl: async () => { throw new Error("down"); },
  });
  assert.equal(await offline.auth.fetchQuota(), null);
});
