// Sonaris password-reset landing page.
//
// Requested from the sign-in page ("Forgot password?") or My account
// ("Reset password"): auth.js POSTs /auth/v1/recover with this page as
// `redirect_to`, so the inbox link lands here. Supabase confirms the
// request server-side and redirects with either:
//   * hash tokens  #access_token=...&type=recovery  (classic link), or
//   * ?token_hash=...&type=recovery                 (newer link), or
//   * ?error=...&error_description=...              (expired / used link)
//
// The token then authorizes PUT /auth/v1/user with the new password.
// No Supabase JS SDK — plain fetch via auth.js, no build step.
(function () {
  var A = window.SonarisSiteAuth || {};

  function $(id) {
    return document.getElementById(id);
  }

  function show(id) {
    ["reset-loading", "reset-form-wrap", "reset-done", "reset-error-state"].forEach(
      function (el) {
        $(el).hidden = el !== id;
      },
    );
  }

  function showErrorState(msg) {
    if (msg) $("reset-error-text").textContent = msg;
    show("reset-error-state");
  }

  function showFormError(msg) {
    var el = $("reset-error");
    el.textContent = msg;
    el.hidden = false;
  }

  var query = A.parseParams ? A.parseParams(window.location.search) : {};
  var hash = A.parseParams ? A.parseParams(window.location.hash) : {};

  // Explicit failure from Supabase (expired / already-used link).
  if (query.error || hash.error) {
    var desc = query.error_description || hash.error_description || hash.error || "";
    if (desc) $("reset-error-text").textContent = desc;
    show("reset-error-state");
    return;
  }

  // Classic link: the token is already in the address bar. Hash tokens
  // in bookmarks/history are bearer tokens, so trade them for a stored
  // session only after the new password is accepted (see submit below).
  var recoveryToken = (hash.type === "recovery" && hash.access_token) ? hash.access_token : null;
  var recoveryRefresh = (hash.type === "recovery" && hash.refresh_token) ? hash.refresh_token : null;
  if (!recoveryToken && hash.access_token) {
    // Live token that didn't land with type=recovery (e.g. a session
    // link opened here): it still authorizes the password update.
    recoveryToken = hash.access_token;
    recoveryRefresh = hash.refresh_token || null;
  }

  function startWithToken(token, refresh) {
    if (!token) {
      showErrorState("");
      return;
    }
    try {
      window.location.hash = "";
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch (e) {
      /* display still works with the hash in place */
    }
    wireForm(token, refresh || null);
    show("reset-form-wrap");
  }

  if (recoveryToken) {
    startWithToken(recoveryToken, recoveryRefresh);
    return;
  }

  // Newer link: exchange the one-time token_hash for a session first.
  // A PKCE `code` without its verifier can't be exchanged, so treat a
  // bare code the same failed way the verify endpoint will.
  var tokenHash = query.token_hash || query.code || null;
  if (tokenHash && A.exchangeRecoveryToken) {
    A.exchangeRecoveryToken(tokenHash).then(function (session) {
      if (session && session.access_token) {
        startWithToken(session.access_token, session.refresh_token);
      } else {
        showErrorState("");
      }
    });
    return;
  }

  // Opened directly with no Supabase params (bookmark, curious click).
  showErrorState("");
  return;

  function wireForm(token, refresh) {
    var form = $("reset-form");
    var passwordInput = $("reset-password");
    var confirmInput = $("reset-confirm");
    var submitBtn = $("reset-submit");
    var busy = false;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (!form.reportValidity()) return;
      var password = passwordInput.value;
      if (!password || password.length < 6) {
        showFormError("Use a password with at least 6 characters.");
        return;
      }
      if (password !== confirmInput.value) {
        showFormError("The two passwords don't match.");
        return;
      }
      busy = true;
      submitBtn.disabled = true;
      $("reset-error").hidden = true;

      var attempt = A.updatePassword
        ? A.updatePassword(token, password)
        : Promise.reject(new Error("Password reset isn't available right now."));
      attempt.then(function (user) {
        // The recovery token proved email ownership: keep the session so
        // the user lands signed in, then continue to their account.
        if (A.saveSession) {
          A.saveSession({
            access_token: token,
            refresh_token: refresh,
            expires_at: Date.now() + 3600 * 1000,
            user: user || null,
          });
        }
        try {
          window.location.hash = "";
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, "", window.location.pathname);
          }
        } catch (err) {
          /* token already cleared from the visible bar above */
        }
        show("reset-done");
      }).catch(function (err) {
        showFormError((err && err.message) || "Couldn't update the password. Request a new link and try again.");
      }).then(function () {
        busy = false;
        submitBtn.disabled = false;
      });
    });
  }
})();
