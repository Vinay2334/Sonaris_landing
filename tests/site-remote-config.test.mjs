// Coverage for website/site-remote-config.js: validation/mapping of the
// shared hosted document, in-place merge, cache, and the network ->
// fallback load order. Plain node (node --test); no DOM needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Objects cross the vm realm boundary (different Object prototype), so
// compare their JSON shape, not object identity.
const norm = (v) => JSON.parse(JSON.stringify(v));

function loadRemote({ site = {}, fetchImpl = null } = {}) {
  const mem = {};
  const painted = [];
  const events = [];
  const window = {
    SonarisSite: { ...site },
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
    },
  };
  const context = vm.createContext({
    window,
    console,
    URL,
    CustomEvent,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (async () => { throw new Error("no network"); }),
  });
  vm.runInContext(
    readFileSync(new URL("../site-remote-config.js", import.meta.url), "utf8"),
    context,
  );
  const R = window.SonarisSiteRemote;
  const doc = {
    querySelectorAll: (sel) => {
      painted.push(sel);
      return [{ set href(v) { painted.push(v); } }];
    },
    dispatchEvent: (e) => { events.push(e && e.type); },
  };
  return { R, window, mem, painted, events, doc };
}

const GOOD = {
  version: 2,
  backend_base_url: "https://api.example.com",
  supabase_url: "https://xyz.supabase.co",
  supabase_anon_key: "sb_publishable_test",
  site_url: "https://example.com/",
  dodo_checkout_base: "https://test.checkout.dodopayments.com/buy",
  chrome_webstore_url: "https://chromewebstore.google.com/",
};

test("validates the shared document and maps it to SITE keys", () => {
  const { R } = loadRemote();
  assert.deepEqual(norm(R.validateSiteRemoteConfig(GOOD)), {
    BACKEND_BASE_URL: "https://api.example.com",
    SUPABASE_URL: "https://xyz.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test",
    SITE_URL: "https://example.com",
    DODO_CHECKOUT_BASE: "https://test.checkout.dodopayments.com/buy",
    CHROME_WEBSTORE_URL: "https://chromewebstore.google.com",
  });
});

test("drops unknown fields and rejects non-https URLs", () => {
  const { R } = loadRemote();
  const out = R.validateSiteRemoteConfig({
    ...GOOD,
    eval: "alert(1)",
    backend_base_url: "http://evil.example.com",
  });
  assert.ok(!("eval" in out));
  assert.ok(!("BACKEND_BASE_URL" in out));
  assert.equal(out.SUPABASE_URL, GOOD.supabase_url);
  for (const bad of [null, undefined, 42, "https://x", [], "arrays"]) {
    assert.equal(R.validateSiteRemoteConfig(bad), null);
  }
  assert.equal(R.validateSiteRemoteConfig({}), null);
});

test("merges in place so early snapshots see the update", () => {
  const { R, window } = loadRemote({ site: { SITE_URL: "http://localhost:8080" } });
  const snapshot = window.SonarisSite;
  R.applySiteRemote({ SITE_URL: "https://example.com" });
  assert.equal(window.SonarisSite, snapshot);
  assert.equal(snapshot.SITE_URL, "https://example.com");
});

test("network refresh applies, caches, and repaints store links", async () => {
  const { R, window, mem, painted, events, doc } = loadRemote();
  const mapped = await R.refreshSiteRemoteConfig({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => GOOD }),
    doc,
  });
  assert.equal(mapped.SITE_URL, "https://example.com");
  assert.equal(window.SonarisSite.BACKEND_BASE_URL, "https://api.example.com");
  assert.ok(mem.sonarisSiteRemoteConfig.includes("api.example.com"));
  assert.ok(painted.includes("a[data-webstore]"));
  assert.ok(events.includes("sonaris-site-config-updated"));
});

test("network failure keeps the packaged fallback", async () => {
  const { R, window } = loadRemote({ site: { SITE_URL: "http://localhost:8080" } });
  const mapped = await R.refreshSiteRemoteConfig({
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(mapped, null);
  assert.equal(window.SonarisSite.SITE_URL, "http://localhost:8080");
});

test("invalid document does not clobber the fallback", async () => {
  const { R, window } = loadRemote({ site: { SITE_URL: "http://localhost:8080" } });
  const mapped = await R.refreshSiteRemoteConfig({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ evil: 1 }) }),
  });
  assert.equal(mapped, null);
  assert.equal(window.SonarisSite.SITE_URL, "http://localhost:8080");
});
