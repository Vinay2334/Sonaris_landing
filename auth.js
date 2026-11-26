// Shared Supabase Auth + checkout helpers for the Sonaris website.
//
// No SDK, no build step: plain fetch against the Supabase Auth REST API,
// the same pattern as verify.js and the extension's supabase-auth.js.
// Session persists in localStorage across visits and is refreshed before
// expiry. Identity resolution prefers the site's own signed-in session —
// URL hints (?email=, ?user_id=) are only prefill/fallback, never the
// authority for checkout attribution.
(function () {
  var A = (window.SonarisSiteAuth = window.SonarisSiteAuth || {});
  if (A.__loaded) return;
  A.__loaded = true;

  var STORAGE_KEY = "sonarisSiteSession";
  var REFRESH_SKEW_MS = 60 * 1000;

  function cfg() {
    return window.SonarisSite || {};
  }

  function projectUrl() {
    return String(cfg().SUPABASE_URL || "").replace(/\/$/, "");
  }

  function anonKey() {
    return cfg().SUPABASE_ANON_KEY || "";
  }

  function ls() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  // Parse "?a=b&c=d" or "#a=b&c=d" into an object. Used for query strings,
  // Google OAuth returns (fragment tokens), and Dodo return params.
  function parseParams(str) {
    var out = {};
    String(str || "")
      .replace(/^[?#]/, "")
      .split("&")
      .forEach(function (part) {
        var eq = part.indexOf("=");
        var key = eq < 0 ? part : part.slice(0, eq);
        if (!key) return;
        try {
          out[decodeURIComponent(key)] = decodeURIComponent(
            eq < 0 ? "" : part.slice(eq + 1),
          );
        } catch (e) {
          /* keep going */
        }
      });
    return out;
  }

  function readStored() {
    try {
      var raw = ls() && ls().getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStored(session) {
    try {
      if (session) ls().setItem(STORAGE_KEY, JSON.stringify(session));
      else ls().removeItem(STORAGE_KEY);
    } catch (e) {
      /* storage unavailable: memory-only */
    }
  }

  // A stored session is usable when it has a token that is not within the
  // refresh skew window. Pure (no I/O) so pages can decide synchronously.
  function isUsable(session) {
    return !!(
      session &&
      session.access_token &&
      typeof session.expires_at === "number" &&
      session.expires_at - Date.now() > REFRESH_SKEW_MS
    );
  }

  // Normalize the GoTrue fragment tokens (Google OAuth return) into the
  // stored session shape. Pure.
  function sessionFromFragment(params) {
    if (!params || !params.access_token) return null;
    return {
      access_token: params.access_token,
      refresh_token: params.refresh_token || null,
      expires_at: Date.now() + Number(params.expires_in || 3600) * 1000,
      user: null,
    };
  }

  function failMessage(res) {
    return res
      .json()
      .then(function (body) {
        return (
          (body && (body.msg || body.message || body.error_description)) ||
          "Request failed (" + res.status + ")"
        );
      })
      .catch(function () {
        return "Request failed (" + res.status + ")";
      });
  }

  function authHeaders(extra) {
    var h = { apikey: anonKey(), "Content-Type": "application/json" };
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  function toSession(data) {
    if (!data || !data.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
      user: data.user || null,
    };
  }

  // Refresh an expired session. Returns the new session, or null when the
  // backend rejected it (expired/invalid refresh clears the stored token).
  function refreshSession(session) {
    if (!session || !session.refresh_token) return Promise.resolve(null);
    return fetch(projectUrl() + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(function (res) {
      if (!res.ok) {
        writeStored(null);
        return null;
      }
      return res.json().then(function (data) {
        var next = toSession(data);
        writeStored(next);
        return next;
      });
    });
  }

  // Usable access token for the site session, refreshing first when stale.
  // Resolves null when signed out or the refresh was rejected.
  function getAccessToken() {
    var session = readStored();
    if (!session) return Promise.resolve(null);
    if (isUsable(session)) return Promise.resolve(session.access_token);
    return refreshSession(session).then(function (next) {
      return next ? next.access_token : null;
    });
  }

  function fetchUser(accessToken) {
    return fetch(projectUrl() + "/auth/v1/user", {
      headers: authHeaders({ Authorization: "Bearer " + accessToken }),
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).catch(function () {
      return null;
    });
  }

  // Resolve the signed-in user ({ session, user }) or null. Cached profile
  // on the session is used when present; otherwise it is fetched once and
  // saved back so pages can render synchronously next time.
  function ensureUser() {
    return getAccessToken().then(function (token) {
      if (!token) return null;
      var session = readStored();
      if (session && session.user && session.user.id) {
        return { session: session, user: session.user };
      }
      return fetchUser(token).then(function (user) {
        if (!user) return null;
        session = readStored() || session;
        if (session) {
          session.user = user;
          writeStored(session);
        }
        return { session: session, user: user };
      });
    });
  }

  function signInWithPassword(email, password) {
    return fetch(projectUrl() + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: String(email || "").trim(), password: password }),
    }).then(function (res) {
      if (!res.ok) {
        return failMessage(res).then(function (msg) {
          throw new Error(msg);
        });
      }
      return res.json();
    }).then(function (data) {
      var session = toSession(data);
      writeStored(session);
      return { session: session, user: session && session.user };
    });
  }

  // `emailRedirectTo` is the absolute verify.html URL the inbox link
  // should land on (also the Supabase Site URL fallback, and allow-listed
  // under Redirect URLs). Passed as `redirect_to` like the SDK does.
  function signUp(email, password, firstName, lastName, emailRedirectTo) {
    var url = projectUrl() + "/auth/v1/signup";
    if (emailRedirectTo) url += "?redirect_to=" + encodeURIComponent(emailRedirectTo);
    return fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: String(email || "").trim(),
        password: password,
        data: { first_name: firstName, last_name: lastName },
      }),
    }).then(function (res) {
      if (!res.ok) {
        return failMessage(res).then(function (msg) {
          throw new Error(msg);
        });
      }
      return res.json();
    }).then(function (data) {
      // With "confirm email" on there is no session yet: the caller shows
      // "check your inbox" (verify.html handles the link).
      if (!data.access_token) return { session: null, user: data.user || null };
      var session = toSession(data);
      writeStored(session);
      return { session: session, user: session.user };
    });
  }

  // Ask Supabase to email a password-reset link. Resolves true when the
  // request was accepted (Supabase answers 200 even for unknown emails,
  // so callers must not reveal whether the address exists). `redirectTo`
  // is the absolute reset-password.html URL the email link should land
  // on — it must be allow-listed in Supabase (URL Configuration →
  // Redirect URLs). Throws on network/validation failure.
  function requestPasswordReset(email, redirectTo) {
    var clean = String(email || "").trim();
    if (!clean) return Promise.reject(new Error("Enter your email first."));
    function post(url) {
      return fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: clean }),
      });
    }
    function send() {
      var url = projectUrl() + "/auth/v1/recover";
      if (redirectTo) url += "?redirect_to=" + encodeURIComponent(redirectTo);
      return post(url).then(function (res) {
        if (res.ok) return true;
        return failMessage(res).then(function (msg) {
          if (redirectTo && /redirect/i.test(msg)) {
            // Allow-list missing (or similar): retry bare so the link
            // still goes out via the Site URL forwarder (verify.html
            // sends recovery links on to reset-password.html).
            redirectTo = "";
            return send();
          }
          throw new Error(msg);
        });
      });
    }
    return send();
  }

  // Exchange a recovery token from the email link for a session whose
  // token can set a new password. Accepts the `token_hash` Supabase
  // appends to the reset link (POST /auth/v1/verify). Resolves the
  // session or null when the link is invalid/expired/unreachable.
  // Pure I/O wrapper — the page decides whether to keep the session.
  function exchangeRecoveryToken(tokenHash) {
    if (!tokenHash) return Promise.resolve(null);
    return fetch(projectUrl() + "/auth/v1/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (data) {
        return toSession(data);
      });
    }).catch(function () {
      return null;
    });
  }

  // Set a new password with a recovery session token
  // (PUT /auth/v1/user). Resolves the updated user, throws otherwise
  // (weak password, expired token, network failure).
  function updatePassword(accessToken, newPassword) {
    if (!accessToken) return Promise.reject(new Error("This reset link is missing its token. Request a new one."));
    if (!newPassword || String(newPassword).length < 6) {
      return Promise.reject(new Error("Use a password with at least 6 characters."));
    }
    return fetch(projectUrl() + "/auth/v1/user", {
      method: "PUT",
      headers: authHeaders({ Authorization: "Bearer " + accessToken }),
      body: JSON.stringify({ password: newPassword }),
    }).then(function (res) {
      if (!res.ok) {
        return failMessage(res).then(function (msg) {
          throw new Error(msg);
        });
      }
      return res.json();
    });
  }

  function signOut() {
    var session = readStored();
    var token = session && session.access_token;
    writeStored(null);
    // Best-effort server revocation; local state is already cleared.
    if (!token) return Promise.resolve();
    return fetch(projectUrl() + "/auth/v1/logout", {
      method: "POST",
      headers: authHeaders({ Authorization: "Bearer " + token }),
    }).then(function () {}).catch(function () {});
  }

  // Hosted Supabase authorize URL for Google sign-in. The browser leaves
  // the site and returns to redirectTo with fragment tokens.
  function googleAuthorizeUrl(redirectTo) {
    return (
      projectUrl() +
      "/auth/v1/authorize?provider=google" +
      "&redirect_to=" +
      encodeURIComponent(redirectTo)
    );
  }

  // Checkout attribution. The site session's user is authoritative; URL
  // hints only fill gaps (prefill, or visitors the extension sent over).
  // Pure — pages pass what they have and get one answer.
  function resolveIdentity(args) {
    args = args || {};
    if (args.sessionUser && args.sessionUser.id) {
      return {
        signedIn: true,
        userId: String(args.sessionUser.id),
        email: args.sessionUser.email || args.hintEmail || "",
      };
    }
    return {
      signedIn: false,
      userId: args.hintUserId || "",
      email: args.hintEmail || "",
    };
  }

  // Dodo static payment link for a plan. success.html is the required
  // redirect_url; metadata_user_id is what the backend webhook reads back
  // (email first only when no user id is known). Accepts catalog rows
  // (dodo_product_id) as well as plain { id, dodoProductId } objects.
  function buildCheckoutUrl(plan, identity) {
    var productId = plan && (plan.dodo_product_id || plan.dodoProductId);
    if (!plan || !productId) return null;
    var base = String(cfg().DODO_CHECKOUT_BASE || "").replace(/\/$/, "");
    var origin = "";
    try {
      origin = (window.location.origin || String(cfg().SITE_URL || "")).replace(/\/$/, "");
    } catch (e) {
      origin = String(cfg().SITE_URL || "").replace(/\/$/, "");
    }
    var qs = ["redirect_url=" + encodeURIComponent(origin + "/success.html")];
    if (identity && identity.email) {
      qs.push("email=" + encodeURIComponent(identity.email));
    }
    if (identity && identity.userId) {
      qs.push("metadata_user_id=" + encodeURIComponent(identity.userId));
    }
    qs.push("metadata_plan_id=" + encodeURIComponent(plan.id));
    return base + "/" + encodeURIComponent(productId) + "?" + qs.join("&");
  }

  // Sign-in page URL preserving where to continue afterwards. `next` is an
  // absolute-or-root URL the sign-in page redirects back to after login.
  function buildSigninUrl(next, opts) {
    opts = opts || {};
    var qs = ["next=" + encodeURIComponent(next)];
    if (opts.plan) qs.push("plan=" + encodeURIComponent(opts.plan));
    if (opts.email) qs.push("email=" + encodeURIComponent(opts.email));
    return "signin.html?" + qs.join("&");
  }

  function backendUrl() {
    return String(cfg().BACKEND_BASE_URL || "").replace(/\/$/, "");
  }

  // Backend endpoints the pricing page needs (see server_new/app/api).
  function plansUrl() {
    return backendUrl() + "/api/v1/plans";
  }

  function quotaUrl() {
    return backendUrl() + "/api/v1/me/quota";
  }

  function portalUrl() {
    return backendUrl() + "/api/v1/me/subscription/portal";
  }

  // One-click Dodo portal link for the signed-in user. Resolves the
  // backend body ({ ok, url } on success, { ok:false, reason } on a
  // backend refusal) or null when signed out, unreachable, or rejected.
  // The caller redirects to `url` on success and renders the support
  // fallback otherwise.
  function createPortalSession(returnUrl) {
    return getAccessToken().then(function (token) {
      if (!token) return null;
      var body = {};
      if (returnUrl) body.return_url = returnUrl;
      return fetch(portalUrl(), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) return data || { ok: false };
          return data;
        }).catch(function () {
          return res.ok ? null : { ok: false };
        });
      }).catch(function () {
        return null;
      });
    });
  }

  // Public store URL for the extension (single source of truth for the
  // navbar / account "Install extension" buttons; the store homepage
  // until the listing is live — see site-config.js).
  function webstoreUrl() {
    return String(
      cfg().CHROME_WEBSTORE_URL || "https://chromewebstore.google.com/",
    );
  }

  // Point every `a[data-webstore]` link at the store URL. Runs once the
  // DOM is ready; pages only carry the marker attribute, never a copy of
  // the URL. No-op without a DOM (e.g. node tests loading this file).
  function paintWebstoreLinks() {
    try {
      if (typeof document === "undefined" || !document.querySelectorAll) return;
      var url = webstoreUrl();
      var links = document.querySelectorAll("a[data-webstore]");
      for (var i = 0; i < links.length; i++) {
        links[i].href = url;
      }
    } catch (e) {
      /* static href fallback stays */
    }
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", paintWebstoreLinks);
  }

  // Display name for the account page. Prefers the Supabase user_metadata
  // first/last name (set at site sign-up), then full_name (Google), then
  // the email handle. Pure.
  function displayName(user) {
    user = user || {};
    var meta = user.user_metadata || {};
    var first = String(meta.first_name || "").trim();
    var last = String(meta.last_name || "").trim();
    if (first || last) return [first, last].filter(Boolean).join(" ");
    var full = String(meta.full_name || meta.name || "").trim();
    if (full) return full;
    var email = String(user.email || "");
    var at = email.indexOf("@");
    if (at > 0) return email.slice(0, at);
    return "there";
  }

  // Normalize the GET /api/v1/me/quota snapshot for rendering. Tolerant:
  // missing numbers become 0, remaining is derived when absent, and a
  // plan object ({ name }) degrades to its name. Pure.
  function normalizeQuota(snap) {
    snap = snap || {};
    var num = function (v) {
      var n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    };
    var plan = snap.plan;
    if (plan && typeof plan === "object") plan = plan.name || plan.id || "";
    var used = num(
      snap.used_seconds != null ? snap.used_seconds : snap.usedSeconds,
    );
    var limit = num(
      snap.limit_seconds != null ? snap.limit_seconds : snap.limitSeconds,
    );
    var remaining =
      snap.remaining_seconds != null
        ? num(snap.remaining_seconds)
        : snap.remainingSeconds != null
          ? num(snap.remainingSeconds)
          : Math.max(limit - used, 0);
    return {
      plan: String(plan || ""),
      usedSeconds: used,
      limitSeconds: limit,
      remainingSeconds: remaining,
      email: String(snap.email || ""),
      userId: String(snap.user_id || snap.userId || ""),
    };
  }

  // Signed-in user's quota snapshot ({ user_id, email, plan,
  // used_seconds, limit_seconds, remaining_seconds }) or null when signed
  // out / backend unreachable / token rejected.
  function fetchQuota() {
    return getAccessToken().then(function (token) {
      if (!token) return null;
      return fetch(quotaUrl(), {
        headers: { Authorization: "Bearer " + token },
      })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .catch(function () {
          return null;
        });
    });
  }

  // Fetch the live plan catalog (DB-driven, no redeploy). Resolves to the
  // plans array or null when the backend cannot be reached.
  function fetchPlans() {
    return fetch(plansUrl()).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (body) {
      if (!body || !Array.isArray(body.plans)) return null;
      return body.plans;
    }).catch(function () {
      return null;
    });
  }

  // Per-plan UI state for the pricing page. Pure.
  // currentPlanName is the plan name from the quota endpoint (null when
  // signed out). Both sides read the same live table, so name matching
  // stays consistent across renames — keep plan names unique.
  // Returns [{ id, isCurrent, isCheaper, canCheckout }].
  function planStates(plans, currentPlanName) {
    var current = null;
    if (currentPlanName) {
      for (var i = 0; i < (plans || []).length; i++) {
        if (plans[i] && plans[i].name === currentPlanName) {
          current = plans[i];
          break;
        }
      }
    }
    return (plans || []).map(function (p) {
      var isCurrent =
        !!current && p.id === current.id;
      var isCheaper =
        !!current &&
        !isCurrent &&
        Number(p.price_monthly_usd || 0) <
          Number(current.price_monthly_usd || 0);
      return {
        id: p.id,
        isCurrent: isCurrent,
        isCheaper: isCheaper,
        canCheckout: !!p.dodo_product_id,
      };
    });
  }

  A.parseParams = parseParams;
  A.isUsable = isUsable;
  A.sessionFromFragment = sessionFromFragment;
  A.readStored = readStored;
  A.saveSession = writeStored;
  A.resolveIdentity = resolveIdentity;
  A.webstoreUrl = webstoreUrl;
  A.paintWebstoreLinks = paintWebstoreLinks;
  A.displayName = displayName;
  A.normalizeQuota = normalizeQuota;
  A.fetchQuota = fetchQuota;
  A.buildCheckoutUrl = buildCheckoutUrl;
  A.buildSigninUrl = buildSigninUrl;
  A.plansUrl = plansUrl;
  A.quotaUrl = quotaUrl;
  A.portalUrl = portalUrl;
  A.createPortalSession = createPortalSession;
  A.fetchPlans = fetchPlans;
  A.planStates = planStates;
  A.googleAuthorizeUrl = googleAuthorizeUrl;
  A.getAccessToken = getAccessToken;
  A.ensureUser = ensureUser;
  A.signInWithPassword = signInWithPassword;
  A.signUp = signUp;
  A.requestPasswordReset = requestPasswordReset;
  A.exchangeRecoveryToken = exchangeRecoveryToken;
  A.updatePassword = updatePassword;
  A.signOut = signOut;
})();
