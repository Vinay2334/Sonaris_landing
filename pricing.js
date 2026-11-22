// Pricing page: render plan cards from the live catalog
// (GET /api/v1/plans — DB-driven, no redeploy) and wire checkout.
//
// Signed out: paid buttons detour to signin.html (with ?next= and the
// pending ?plan=), which returns here signed in. Signed in: the account's
// current plan (from the quota endpoint) is highlighted, its button reads
// "Current plan", cheaper plans are disabled (no upgrade path downwards),
// and checkout links carry metadata_user_id so any Dodo email works.
//
// Extension hints (?from=extension&email=&user_id=) only prefill: the site
// session's user is authoritative once signed in.
(function () {
  var cfg = window.CaptifySite || {};
  var A = window.CaptifySiteAuth || {};

  function params() {
    return A.parseParams ? A.parseParams(window.location.search) : {};
  }

  var query = params();
  var knownEmail = query.email || "";
  var knownUserId = query.user_id || "";
  var fromExtension = query.from === "extension";

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function currentUrl() {
    try {
      return window.location.href;
    } catch (e) {
      return "pricing.html";
    }
  }

  // ---- account bar (same as before: session user wins, hints prefill) ----
  function paintAccount(identity) {
    var status = $("account-status");
    var action = $("account-action");
    if (!status || !action) return;
    if (identity.signedIn) {
      status.textContent = "Signed in as " + (identity.email || "your account");
      action.textContent = "Sign out";
      action.href = "signin.html?action=signout&next=" + encodeURIComponent(currentUrl());
    } else {
      status.textContent = "Sign in to link checkout to your account";
      action.textContent = "Sign in";
      action.href = A.buildSigninUrl
        ? A.buildSigninUrl(currentUrl(), { email: knownEmail || identity.email })
        : "signin.html";
    }
  }

  function initialIdentity() {
    var stored = null;
    try {
      stored = A.readStored ? A.readStored() : null;
    } catch (e) {
      stored = null;
    }
    if (stored && A.isUsable && A.isUsable(stored) && stored.user && stored.user.id) {
      return A.resolveIdentity({ sessionUser: stored.user });
    }
    return A.resolveIdentity
      ? A.resolveIdentity({ hintEmail: knownEmail, hintUserId: knownUserId })
      : { signedIn: false, userId: knownUserId, email: knownEmail };
  }

  // ---- card rendering (same visual system as the static page) ----
  function priceNode(priceLabel) {
    var wrap = el("div", "price");
    var parts = String(priceLabel || "").split("/");
    wrap.appendChild(el("span", null, parts[0].trim()));
    if (parts.length > 1) {
      wrap.appendChild(document.createTextNode(" "));
      wrap.appendChild(el("small", null, "/" + parts.slice(1).join("/").trim()));
    }
    return wrap;
  }

  function checkoutHref(plan, identity) {
    if (!plan.dodo_product_id) return null;
    var url = A.buildCheckoutUrl
      ? A.buildCheckoutUrl(plan, identity)
      : null;
    if (url) return { href: url, gated: false };
    return null;
  }

  function signinHref(planId, identity) {
    if (!A.buildSigninUrl) return null;
    return {
      href: A.buildSigninUrl(currentUrl(), {
        plan: planId,
        email: identity.email || knownEmail,
      }),
      gated: true,
    };
  }

  function ctaFor(plan, st, identity) {
    var cta = el("div", "cta");
    // Free-style plan (no Dodo product, no price): no checkout. Extension
    // users close back to the overlay; web visitors sign in / install.
    if (!st.canCheckout && Number(plan.price_monthly_usd || 0) <= 0) {
      var free = el("a", "btn btn-ghost", "Get started free");
      free.href = "#";
      free.addEventListener("click", function (e) {
        if (fromExtension) {
          e.preventDefault();
          window.close();
        }
      });
      cta.appendChild(free);
      return cta;
    }
    if (st.isCurrent) {
      var cur = el("button", "btn btn-ghost", "Current plan");
      cur.type = "button";
      cur.disabled = true;
      cta.appendChild(cur);
      return cta;
    }
    if (st.isCheaper) {
      var down = el("button", "btn btn-ghost", "Downgrade unavailable");
      down.type = "button";
      down.disabled = true;
      down.title =
        "To move to a lower plan, cancel your subscription — it stays active until the end of the billing period.";
      cta.appendChild(down);
      return cta;
    }
    var target = null;
    if (identity.signedIn && identity.userId) {
      target = checkoutHref(plan, identity);
    } else {
      target = signinHref(plan.id, identity);
    }
    if (!target) {
      var na = el("button", "btn btn-ghost", "Checkout not connected yet");
      na.type = "button";
      na.disabled = true;
      cta.appendChild(na);
      return cta;
    }
    var btn = el("a", "btn " + (plan.is_featured ? "btn-primary" : "btn-ghost"), "Upgrade to " + plan.name);
    btn.href = target.href;
    cta.appendChild(btn);
    return cta;
  }

  function planCard(plan, st, identity) {
    var card = el("article", "plan" + (plan.is_featured ? " featured" : ""));
    if (st.isCurrent) {
      card.classList.add("is-current");
      var flag = el("span", "plan-flag plan-flag--current", "Current plan");
      card.appendChild(flag);
    } else if (plan.is_featured) {
      card.appendChild(el("span", "plan-flag", "Most popular"));
    }
    card.appendChild(el("h2", null, plan.name || plan.id));
    card.appendChild(priceNode(plan.price_label));
    if (plan.tagline) card.appendChild(el("p", "tagline", plan.tagline));
    var list = el("ul");
    var minutes = el("li");
    minutes.appendChild(el("strong", null, (plan.minutes || 0).toLocaleString("en-US") + " subtitle minutes"));
    minutes.appendChild(document.createTextNode(" / day"));
    list.appendChild(minutes);
    (plan.features || []).forEach(function (f) {
      list.appendChild(el("li", f.dim ? "dim" : null, f.text));
    });
    card.appendChild(list);
    card.appendChild(ctaFor(plan, st, identity));
    return card;
  }

  function render(plans, states, identity) {
    var box = $("plans");
    if (!box) return;
    box.replaceChildren();
    var byId = {};
    states.forEach(function (s) {
      byId[s.id] = s;
    });
    plans.forEach(function (plan) {
      var st = byId[plan.id] || {
        isCurrent: false,
        isCheaper: false,
        canCheckout: !!plan.dodo_product_id,
      };
      box.appendChild(planCard(plan, st, identity));
    });
    var loading = $("plans-loading");
    if (loading) loading.hidden = true;
    var err = $("plans-error");
    if (err) err.hidden = true;
  }

  function showError() {
    var loading = $("plans-loading");
    if (loading) loading.hidden = true;
    var box = $("plans");
    if (box) box.replaceChildren();
    var err = $("plans-error");
    if (err) err.hidden = false;
  }

  function currentPlanName(identity) {
    // Plan name from the quota endpoint; both sides read the same live
    // table, so matching by name stays consistent across renames.
    if (!identity.signedIn || !A.getAccessToken || !A.quotaUrl) {
      return Promise.resolve(null);
    }
    return A.getAccessToken().then(function (token) {
      if (!token) return null;
      return fetch(A.quotaUrl(), {
        headers: { Authorization: "Bearer " + token },
      }).then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (snap) {
        return (snap && snap.plan) || null;
      }).catch(function () {
        return null;
      });
    }).catch(function () {
      return null;
    });
  }

  // Fast first paint from the stored session / hints, then correct once
  // the live session + quota resolve (same two-phase pattern as before).
  var identity = initialIdentity();
  paintAccount(identity);

  function paint(catalog, planName) {
    var states = A.planStates
      ? A.planStates(catalog, planName)
      : catalog.map(function (p) {
        return { id: p.id, isCurrent: false, isCheaper: false, canCheckout: !!p.dodo_product_id };
      });
    render(catalog, states, identity);
  }

  A.fetchPlans
    ? A.fetchPlans().then(function (catalog) {
      if (!catalog || !catalog.length) {
        showError();
        return;
      }
      paint(catalog, null);
      if (!A.ensureUser) return;
      A.ensureUser().then(function (found) {
        var fresh = found && found.user
          ? A.resolveIdentity({ sessionUser: found.user })
          : A.resolveIdentity({ hintEmail: knownEmail, hintUserId: knownUserId });
        var changed =
          fresh.signedIn !== identity.signedIn || fresh.userId !== identity.userId;
        identity = fresh;
        paintAccount(identity);
        currentPlanName(identity).then(function (planName) {
          if (planName) paint(catalog, planName);
          else if (changed) paint(catalog, null);
        });
      }).catch(function () {
        /* stale buttons stay until the next load */
      });
    })
    : showError();

  var retry = $("plans-retry");
  if (retry) {
    retry.addEventListener("click", function () {
      window.location.reload();
    });
  }
})();
