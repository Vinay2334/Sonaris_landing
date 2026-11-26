// My account page: profile (Supabase user), current plan (live catalog
// matched by name, same rule as pricing.js), and minutes quota
// (GET /api/v1/me/quota — see server_new/app/api/quota.py).
//
// Signed out visitors get the sign-in gate (with ?next= back here); the
// profile renders from the session alone, while plan + quota degrade
// gracefully when the backend is unreachable.
(function () {
  var A = window.SonarisSiteAuth || {};

  function $(id) {
    return document.getElementById(id);
  }

  function show(id) {
    ["account-loading", "account-signedout", "account-views"].forEach(
      function (el) {
        $(el).hidden = el !== id;
      },
    );
  }

  function wholeMinutes(seconds) {
    return Math.floor(Number(seconds || 0) / 60);
  }

  function fmtDate(iso) {
    var t = Date.parse(iso || "");
    if (Number.isNaN(t)) return "–";
    try {
      return new Date(t).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return new Date(t).toDateString();
    }
  }

  function paintProfile(user) {
    var name = A.displayName ? A.displayName(user) : user.email || "there";
    $("account-name").textContent = name;
    $("account-email").textContent = user.email || "–";
    $("account-avatar").textContent = (name.trim()[0] || "C").toUpperCase();
    $("account-created").textContent = fmtDate(user.created_at);
    $("account-id").textContent = user.id || "–";
    var badge = $("account-verified");
    if (user.email_confirmed_at) {
      badge.hidden = false;
      badge.textContent = "Email verified";
      badge.classList.add("pill-ok");
      badge.classList.remove("pill-warn");
    } else {
      badge.hidden = false;
      badge.textContent = "Confirm pending";
      badge.classList.add("pill-warn");
      badge.classList.remove("pill-ok");
    }
  }

  function findPlan(catalog, planName) {
    for (var i = 0; i < (catalog || []).length; i++) {
      if (catalog[i] && catalog[i].name === planName) return catalog[i];
    }
    return null;
  }

  function paintPlan(quota, catalog) {
    var match = quota.plan ? findPlan(catalog, quota.plan) : null;
    if (match) {
      $("plan-name").textContent = match.name;
      $("plan-tagline").textContent = match.tagline || "";
      $("plan-price").textContent =
        (match.price_label || "$" + match.price_monthly_usd + " / month") +
        " · " +
        Number(match.minutes || 0).toLocaleString("en-US") +
        " min/day";
    } else {
      // Backend or catalog unreachable: the snapshot alone still names
      // the plan and its minute allowance.
      $("plan-name").textContent = quota.plan || "Free";
      $("plan-tagline").textContent = "Plan details unavailable — showing your live allowance.";
      $("plan-price").textContent =
        Number(wholeMinutes(quota.limitSeconds)).toLocaleString("en-US") +
        " min/day";
    }
  }

  function paintQuota(quota) {
    var used = wholeMinutes(quota.usedSeconds);
    var limit = wholeMinutes(quota.limitSeconds);
    var left = wholeMinutes(quota.remainingSeconds);
    $("quota-used").textContent = used.toLocaleString("en-US");
    $("quota-limit").textContent = limit.toLocaleString("en-US");
    var pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    var fill = $("quota-fill");
    fill.style.width = pct + "%";
    fill.classList.toggle("quota-fill--low", pct >= 85 && limit > 0);
    var bar = $("quota-bar");
    bar.setAttribute("aria-valuenow", String(pct));
    var remaining = $("quota-remaining");
    if (limit <= 0) {
      remaining.textContent = "No minute allowance on this plan.";
    } else if (left <= 0) {
      remaining.textContent = "You've used all " + limit.toLocaleString("en-US") + " minutes — upgrade for more.";
      remaining.classList.add("quota-low");
    } else {
      remaining.textContent = left.toLocaleString("en-US") + " min left today (" + pct + "% used).";
      remaining.classList.toggle("quota-low", pct >= 85);
    }
  }

  function loadUsage() {
    $("quota-body").hidden = true;
    $("quota-error").hidden = true;
    var quotaP = A.fetchQuota
      ? A.fetchQuota().then(function (snap) {
          return A.normalizeQuota ? A.normalizeQuota(snap) : null;
        })
      : Promise.resolve(null);
    var plansP = A.fetchPlans ? A.fetchPlans() : Promise.resolve(null);
    Promise.all([quotaP, plansP]).then(function (results) {
      var quota = results[0];
      var catalog = results[1];
      if (!quota || (!quota.plan && !quota.limitSeconds)) {
        // Signed in, but the snapshot didn't arrive (backend down or
        // token rejected): keep the profile, explain the gap.
        $("quota-body").hidden = true;
        $("quota-error").hidden = false;
        paintPlan(
          { plan: "", limitSeconds: 0 },
          null,
        );
        $("plan-tagline").textContent =
          "Couldn't reach the server — your plan will show here when you're back online.";
        return;
      }
      // Quota email can be fresher than the cached session copy.
      if (quota.email) $("account-email").textContent = quota.email;
      paintPlan(quota, catalog);
      paintQuota(quota);
      wireManageSubscription(quota, catalog);
      $("quota-body").hidden = false;
      $("quota-error").hidden = true;
    });
  }

  // "Manage subscription": one-click Dodo portal for paid plans only.
  // Free users have nothing to cancel, so the button stays hidden. Paid
  // is decided from the live catalog (price > 0); without a catalog the
  // plan name alone degrades to "anything but Free".
  function isPaidPlan(quota, catalog) {
    var match = quota.plan ? findPlan(catalog, quota.plan) : null;
    if (match) return Number(match.price_monthly_usd || 0) > 0;
    var name = String(quota.plan || "").trim().toLowerCase();
    return !!name && name !== "free";
  }

  function supportEmail() {
    try {
      var site = window.SonarisSite || {};
      if (site.SUPPORT_EMAIL) return site.SUPPORT_EMAIL;
    } catch (e) {
      /* fallback below */
    }
    return "support@sonaris.cc";
  }

  function portalReturnUrl() {
    try {
      var path = window.location.pathname.replace(/[^/]*$/, "");
      return window.location.origin + path + "account.html";
    } catch (e) {
      return "";
    }
  }

  function wireManageSubscription(quota, catalog) {
    var btn = $("plan-portal");
    var msg = $("plan-portal-msg");
    if (!btn || btn.dataset.wired) {
      if (btn) btn.hidden = !isPaidPlan(quota, catalog);
      return;
    }
    btn.dataset.wired = "1";
    btn.hidden = !isPaidPlan(quota, catalog);
    btn.addEventListener("click", function () {
      if (!A.createPortalSession) return;
      btn.disabled = true;
      msg.classList.remove("form-error");
      msg.textContent = "Opening the subscription portal…";
      msg.hidden = false;
      A.createPortalSession(portalReturnUrl()).then(function (data) {
        if (data && data.url) {
          window.location.href = data.url;
          return;
        }
        var reason = data && data.reason;
        if (reason === "no_subscription") {
          msg.textContent = "No active subscription found on this account — write to " + supportEmail() + " and we'll sort it out.";
        } else {
          msg.textContent = "Couldn't open the subscription portal. Write to " + supportEmail() + " and we'll help you cancel.";
        }
        msg.classList.add("form-error");
        btn.disabled = false;
      });
    });
  }

  // ---- entry ----
  if (!A.ensureUser) {
    show("account-signedout");
    return;
  }
  A.ensureUser().then(function (found) {
    if (!found || !found.user) {
      var signin = $("account-signin");
      var next = "account.html";
      try {
        next = window.location.pathname.split("/").pop() || next;
      } catch (e) {
        /* relative fallback stays */
      }
      signin.href = A.buildSigninUrl
        ? A.buildSigninUrl(next, {})
        : "signin.html?next=" + encodeURIComponent(next);
      show("account-signedout");
      return;
    }
    paintProfile(found.user);
    show("account-views");
    loadUsage();
    wirePasswordReset(found.user);
  });

  // "Reset password" emails a Supabase recovery link (redirects to
  // reset-password.html — allow-listed in Supabase Redirect URLs).
  function resetRedirectUrl() {
    try {
      return (
        window.location.origin +
        window.location.pathname.replace(/[^/]*$/, "") +
        "reset-password.html"
      );
    } catch (e) {
      return "";
    }
  }

  function wirePasswordReset(user) {
    var btn = $("account-reset");
    var msg = $("account-reset-msg");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", function () {
      var email = (user && user.email) || "";
      if (!email) {
        msg.textContent = "No email on this account — sign out and back in, then try again.";
        msg.classList.add("form-error");
        msg.hidden = false;
        return;
      }
      btn.disabled = true;
      msg.classList.remove("form-error");
      msg.textContent = "Sending reset link…";
      msg.hidden = false;
      var req = A.requestPasswordReset
        ? A.requestPasswordReset(email, resetRedirectUrl())
        : Promise.reject(new Error("Password reset isn't available right now."));
      req.then(function () {
        msg.textContent = "Reset link sent to " + email + " — check your inbox (and spam folder).";
      }).catch(function (err) {
        msg.textContent = (err && err.message) || "Couldn't send the reset link. Try again.";
        msg.classList.add("form-error");
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  var retry = $("quota-retry");
  if (retry) {
    retry.addEventListener("click", loadUsage);
  }

  var signout = $("account-signout");
  if (signout) {
    signout.addEventListener("click", function () {
      signout.disabled = true;
      var done = function () {
        window.location.href = "index.html";
      };
      if (A.signOut) A.signOut().then(done, done);
      else done();
    });
  }
})();
