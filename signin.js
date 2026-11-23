// Sonaris website sign-in page.
//
// Gate before checkout: with a signed-in session the pricing page stamps
// the account's user id into Dodo metadata, so the webhook attributes the
// payment no matter which email is entered at checkout. Auth goes directly
// to Supabase Auth (same no-build fetch pattern as verify.js) — the
// FastAPI backend only verifies tokens, it never handles passwords.
//
// Entry:  signin.html?next=<url>&plan=<planId>&email=<prefill>
// Google: leaves for Supabase authorize and returns here with fragment
// tokens; `next`/pending plan survive in sessionStorage. After login the
// page continues to a pending plan's Dodo checkout, else to `next`.
(function () {
  var cfg = window.SonarisSite || {};
  var A = window.SonarisSiteAuth || {};
  var RETURN_KEY = "sonarisSigninReturn";

  function $(id) {
    return document.getElementById(id);
  }

  function show(id) {
    ["signin-loading", "signin-form-wrap", "signin-reset-sent", "signin-done"].forEach(function (el) {
      $(el).hidden = el !== id;
    });
  }

  function showError(msg) {
    var el = $("signin-error");
    el.textContent = msg;
    el.hidden = false;
  }

  // Live catalog (DB-driven): the pending plan's Dodo product comes from
  // GET /api/v1/plans, never from static config. Null until loaded (or
  // when the backend is unreachable — then pending plans fall back to
  // `next` instead of stranding the user).
  var catalogPlans = null;
  A.fetchPlans().then(function (plans) {
    catalogPlans = plans;
    if (catalogPlans && state.plan) refreshPlanTitle();
  });

  function planById(id) {
    var plans = catalogPlans || [];
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].id === id) return plans[i];
    }
    return null;
  }

  function refreshPlanTitle() {
    var title = document.getElementById("signin-title");
    var plan = state.plan ? planById(state.plan) : null;
    if (title && plan) title.textContent = "Sign in for " + plan.name;
  }

  function stashReturn(state) {
    try {
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(state));
    } catch (e) {
      /* private mode: query params still carry next/plan */
    }
  }

  function readStash() {
    try {
      var raw = window.sessionStorage.getItem(RETURN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearStash() {
    try {
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  // Where to go after login: a pending plan's Dodo checkout wins (the
  // click that brought the user here), otherwise the `next` page.
  function continueUrl(state, user) {
    var plan = state.plan ? planById(state.plan) : null;
    // A plan without a Dodo product is not purchasable: fall back to next.
    if (plan && plan.dodo_product_id && user) {
      var url = A.buildCheckoutUrl(plan, {
        userId: user.id,
        email: user.email || state.email || "",
      });
      if (url) return url;
    }
    return state.next || "pricing.html";
  }

  function welcome(user, state) {
    $("signin-welcome").textContent =
      "Signed in as " +
      (user.email || "your account") +
      ". Your upgrade will be linked to this account.";
    show("signin-done");
    $("signin-continue").onclick = function () {
      clearStash();
      window.location.href = continueUrl(state, user);
    };
    // One click already brought them here for a plan: keep the momentum
    // but let them see the confirmation first. No auto-redirect — the
    // external checkout jump should always follow a deliberate click.
  }

  var query = A.parseParams(window.location.search);
  var hash = A.parseParams(window.location.hash);
  var state = {
    next: query.next || "pricing.html",
    plan: query.plan || "",
    email: query.email || "",
  };

  // Signed-out link from the pricing account bar: clear the site session,
  // then present the form (next/plan preserved for sign-in again).
  if (query.action === "signout" && !hash.access_token) {
    clearStash();
    A.signOut().then(showForm, showForm);
    return;
  }

  // Google OAuth return: fragment tokens after Supabase redirected back.
  if (hash.access_token) {
    var stash = readStash() || {};
    if (stash.next) state.next = stash.next;
    if (stash.plan) state.plan = stash.plan;
    if (stash.email) state.email = stash.email;
    var session = A.sessionFromFragment(hash);
    A.saveSession(session);
    // Drop the tokens from the address bar (history/bookmarks shouldn't
    // keep bearer tokens), then validate and continue.
    try {
      window.location.hash = "";
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch (e) {
      /* display still works with the hash in place */
    }
    A.ensureUser().then(function (found) {
      if (found) welcome(found.user, state);
      else {
        show("signin-form-wrap");
        showError("Google sign-in didn't return a usable session. Try again.");
      }
    });
    return;
  }

  // Already signed in (own site session): skip the form entirely.
  A.ensureUser().then(function (found) {
    if (found && found.user) {
      welcome(found.user, state);
      return;
    }
    showForm();
  });

  var mode = "signin";

  // Absolute reset-password.html URL for the inbox link. Must be
  // allow-listed in Supabase (Authentication → URL Configuration →
  // Redirect URLs) or Supabase ignores it and uses the Site URL.
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

  function showForm() {
    var form = $("signin-form");
    var emailInput = $("signin-email");
    var passwordInput = $("signin-password");
    var passwordRow = $("signin-password-row");
    var firstNameInput = $("signin-firstname");
    var lastNameInput = $("signin-lastname");
    var nameRow = $("signin-name-row");
    var submitBtn = $("signin-submit");
    var googleBtn = $("signin-google");
    var switchRow = $("signin-switch-row");
    var forgotRow = $("signin-forgot-row");
    var backRow = $("signin-back-row");
    var busy = false;

    show("signin-form-wrap");
    if (state.email) emailInput.value = state.email;
    refreshPlanTitle();

    function setMode(next) {
      mode = next;
      var signup = mode === "signup";
      var reset = mode === "reset";
      nameRow.hidden = !signup;
      firstNameInput.disabled = !signup;
      lastNameInput.disabled = !signup;
      // Reset mode reuses the email field only: the password input is
      // disabled (skipped by reportValidity) and Google/toggle rows hide.
      passwordRow.hidden = reset;
      passwordInput.disabled = reset;
      googleBtn.hidden = reset;
      switchRow.hidden = reset;
      forgotRow.hidden = reset || signup;
      backRow.hidden = !reset;
      passwordInput.autocomplete = signup ? "new-password" : "current-password";
      submitBtn.textContent = reset ? "Send reset link" : signup ? "Create account" : "Sign in";
      $("signin-toggle-message").textContent = signup
        ? "Already have an account?"
        : "Don't have an account?";
      $("signin-toggle").textContent = signup ? "Sign In" : "Sign Up";
      $("signin-error").hidden = true;
    }

    $("signin-toggle").addEventListener("click", function (e) {
      e.preventDefault();
      setMode(mode === "signin" ? "signup" : "signin");
    });
    $("signin-forgot").addEventListener("click", function (e) {
      e.preventDefault();
      setMode("reset");
    });
    $("signin-back").addEventListener("click", function (e) {
      e.preventDefault();
      setMode("signin");
    });
    $("signin-reset-back").addEventListener("click", function () {
      setMode("signin");
      show("signin-form-wrap");
    });
    setMode("signin");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (!form.reportValidity()) return;
      var email = emailInput.value.trim();

      if (mode === "reset") {
        if (!email) {
          showError("Enter your email first.");
          return;
        }
        busy = true;
        submitBtn.disabled = true;
        googleBtn.disabled = true;
        $("signin-error").hidden = true;
        var req = A.requestPasswordReset
          ? A.requestPasswordReset(email, resetRedirectUrl())
          : Promise.reject(new Error("Password reset isn't available right now."));
        req.then(function () {
          $("signin-reset-text").textContent =
            "If an account exists for " + email +
            ", a reset link is on its way — check your inbox (and spam folder).";
          show("signin-reset-sent");
        }).catch(function (err) {
          showError((err && err.message) || "Couldn't send the reset link. Try again.");
        }).then(function () {
          busy = false;
          submitBtn.disabled = false;
          googleBtn.disabled = false;
        });
        return;
      }

      var password = passwordInput.value;
      if (!email || !password) {
        showError("Enter your email and password.");
        return;
      }
      busy = true;
      submitBtn.disabled = true;
      googleBtn.disabled = true;
      $("signin-error").hidden = true;

      var attempt =
        mode === "signup"
          ? A.signUp(email, password, firstNameInput.value.trim(), lastNameInput.value.trim())
          : A.signInWithPassword(email, password);

      attempt.then(function (res) {
        if (!res.session) {
          // Email confirmation is on: no session yet. verify.html
          // handles the inbox link; the user signs in after clicking it.
          setMode("signin");
          showError("Check your inbox to confirm your mail, then sign in.");
          return null;
        }
        return A.ensureUser();
      }).then(function (found) {
        if (found && found.user) welcome(found.user, state);
      }).catch(function (err) {
        showError((err && err.message) || "Sign-in failed. Try again.");
      }).then(function () {
        busy = false;
        submitBtn.disabled = false;
        googleBtn.disabled = false;
      });
    });

    googleBtn.addEventListener("click", function () {
      stashReturn(state);
      // Absolute URL required; must be allow-listed in Supabase
      // (Authentication → URL Configuration → Redirect URLs).
      var here =
        window.location.origin +
        window.location.pathname.replace(/[^/]*$/, "") +
        "signin.html";
      window.location.href = A.googleAuthorizeUrl(here);
    });
  }
})();
