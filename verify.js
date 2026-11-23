// Supabase email-verification landing page.
//
// Supabase dashboard → Authentication → URL Configuration → Site URL must be
// this page (verify.html). When the user clicks the "Confirm your mail"
// link, Supabase confirms the address server-side and redirects here with
// either:
//   * hash tokens  #access_token=...&type=signup  (implicit confirm link), or
//   * ?code=...                                   (PKCE confirm link), or
//   * ?error=...&error_description=...            (expired / used link)
//
// No Supabase JS SDK is used — plain fetch against the Auth REST API, so
// this page needs no build step and no npm install.
(function () {
  var cfg = window.SonarisSite || {};

  function show(id) {
    ["verify-loading", "verify-ok", "verify-error"].forEach(function (el) {
      document.getElementById(el).hidden = el !== id;
    });
  }

  function parse(str) {
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
            eq < 0 ? "" : part.slice(eq + 1)
          );
        } catch (e) { /* keep going */ }
      });
    return out;
  }

  function projectUrl() {
    return String(cfg.SUPABASE_URL || "").replace(/\/$/, "");
  }

  // Validate an access token by asking Supabase who it belongs to.
  // Returns the user object, or null when the token is not usable.
  function checkToken(accessToken) {
    return fetch(projectUrl() + "/auth/v1/user", {
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY || "",
        Authorization: "Bearer " + accessToken,
      },
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).catch(function () {
      return null;
    });
  }

  var query = parse(location.search);
  var hash = parse(location.hash);

  // Recovery links belong on reset-password.html. When its `redirect_to`
  // isn't allow-listed yet, Supabase falls back to this page (the Site
  // URL) — forward everything recovery-typed (tokens and errors alike)
  // so the reset page renders the right state instead of stranding the
  // user on an "Email verified" page that changes no password.
  if (query.type === "recovery" || hash.type === "recovery") {
    var target = "reset-password.html" + location.search + location.hash;
    try {
      location.replace(target);
    } catch (e) {
      location.href = target;
    }
    return;
  }

  // Explicit failure from Supabase (expired / already-used link).
  if (query.error || hash.error) {
    var desc =
      query.error_description || hash.error_description || hash.error || "";
    if (desc) document.getElementById("verify-error-text").textContent = desc;
    show("verify-error");
    return;
  }

  var accessToken = hash.access_token || query.access_token || null;
  var type = hash.type || query.type || "";

  if (accessToken) {
    // Implicit confirm link: prove the token is live, then celebrate.
    checkToken(accessToken).then(function (user) {
      if (user && (user.email_confirmed_at || type === "signup" || type === "email")) {
        show("verify-ok");
      } else if (user) {
        // Live session token (e.g. invite/recovery landing here): the
        // address is reachable and owned — treat as verified.
        show("verify-ok");
      } else {
        show("verify-error");
      }
    });
    return;
  }

  if (query.code || query.token_hash) {
    // PKCE / token-hash link: Supabase already confirmed the address before
    // redirecting (this page is the Site URL). The code can only be
    // exchanged together with the verifier stored where signup started
    // (the extension), so there is nothing left to do here.
    show("verify-ok");
    return;
  }

  // Opened directly with no Supabase params (bookmark, curious click):
  // nothing to confirm — say so plainly instead of spinning forever.
  show("verify-error");
})();
