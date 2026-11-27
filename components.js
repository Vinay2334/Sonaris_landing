(function () {
  var STORE_FALLBACK = "https://chromewebstore.google.com/";
  var ICON_OPEN = '<svg data-nav-icon-open width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var ICON_CLOSE = '<svg data-nav-icon-close width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" hidden><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function link(href, text, active, key) {
    var cur = active === key ? ' aria-current="page"' : "";
    return '<a href="' + href + '"' + cur + ">" + text + "</a>";
  }

  function headerDefault(active) {
    return (
      '<header class="site-head"><div class="wrap">' +
      '<a class="brand" href="index.html"><img class="brand-mark" src="icons/logo.png" alt="" aria-hidden="true" />Sonaris</a>' +
      '<nav id="site-nav" aria-label="Primary">' +
      link("index.html", "Home", active, "home") +
      link("pricing.html", "Pricing", active, "pricing") +
      link("account.html", "My account", active, "account") +
      '<a data-webstore class="nav-cta" href="' + STORE_FALLBACK + '" target="_blank" rel="noopener">Install extension</a>' +
      "</nav>" +
      '<a data-webstore class="nav-cta" href="' + STORE_FALLBACK + '" target="_blank" rel="noopener">Install extension</a>' +
      '<button type="button" class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">' +
      ICON_OPEN + ICON_CLOSE +
      "</button></div></header>"
    );
  }

  function headerLanding() {
    return (
      '<header class="border-b border-honeyline bg-paper/90">' +
      '<div class="max-w-6xl mx-auto px-5 py-4 flex items-center gap-3">' +
      '<a href="index.html" class="text-lg font-bold no-underline text-cocoa inline-flex items-center">' +
      '<img class="w-8 h-8 rounded-lg mr-2 object-cover shrink-0" src="icons/logo.png" alt="" aria-hidden="true" />Sonaris</a>' +
      '<div class="ml-auto flex items-center gap-2 sm:gap-3">' +
      '<nav class="hidden md:flex items-center gap-5 text-[15px]" aria-label="Primary">' +
      '<a href="#where" class="text-stone-600 hover:text-cocoa no-underline">Where it works</a>' +
      '<a href="#how" class="text-stone-600 hover:text-cocoa no-underline">How it works</a>' +
      '<a href="pricing.html" class="text-stone-600 hover:text-cocoa no-underline">Pricing</a>' +
      '<a href="account.html" class="text-stone-600 hover:text-cocoa no-underline">My account</a>' +
      "</nav>" +
      '<a data-webstore href="' + STORE_FALLBACK + '" target="_blank" rel="noopener" class="hidden md:inline-flex bg-honey text-cocoa font-semibold rounded-full px-3 py-2 sm:px-4 no-underline shadow-cta hover:bg-amber-500 text-sm sm:text-[15px] whitespace-nowrap">Install extension</a>' +
      '<button type="button" data-nav-toggle aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu" class="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-stone-300 text-cocoa hover:border-honeydeep hover:bg-cream">' +
      ICON_OPEN + ICON_CLOSE +
      "</button></div></div>" +
      '<nav id="mobile-menu" aria-label="Mobile" class="hidden md:hidden border-t border-honeyline bg-paper px-5 py-3 flex-col gap-1">' +
      '<a href="#where" class="block py-2.5 text-stone-600 hover:text-cocoa no-underline">Where it works</a>' +
      '<a href="#how" class="block py-2.5 text-stone-600 hover:text-cocoa no-underline">How it works</a>' +
      '<a href="pricing.html" class="block py-2.5 text-stone-600 hover:text-cocoa no-underline">Pricing</a>' +
      '<a href="account.html" class="block py-2.5 text-stone-600 hover:text-cocoa no-underline">My account</a>' +
      '<a data-webstore href="' + STORE_FALLBACK + '" target="_blank" rel="noopener" class="block text-center bg-honey text-cocoa font-semibold rounded-full px-4 py-2.5 no-underline shadow-cta hover:bg-amber-500 mt-2 mb-1">Install extension</a>' +
      "</nav></header>"
    );
  }

  function supportEmail() {
    return (window.SonarisSite && window.SonarisSite.SUPPORT_EMAIL) || "support@sonaris.cc";
  }

  // NOTE: pages using footerDefault (pricing, account, ...) load
  // styles.css, not the Tailwind CDN — so Tailwind classes here have no
  // effect. Markup mirrors the landing footer (tagline left, link
  // group right); the look lives in styles.css (.site-foot), which
  // replicates the landing's honeyline border, stone-500 text, and
  // hover:text-cocoa links. Keep these anchors class-free.
  var POLICY_LINKS = '<a href="terms.html">Terms</a>' +
    '<a href="privacy.html">Privacy</a>' +
    '<a href="refunds.html">Refunds</a>';
  var FOOTERS = {
    "billing-full": {
      tag: "Sonaris · Monthly plans in USD, taxes may apply at checkout · Payments securely processed by Dodo Payments",
      links: '<a href="account.html">My account</a>' + POLICY_LINKS
    },
    billing: {
      tag: "Sonaris · Payments securely processed by Dodo Payments",
      links: '<a href="account.html">My account</a>' + POLICY_LINKS
    },
    verify: { tag: "Sonaris · Email verification", links: "" },
    password: {
      tag: "Sonaris · Password reset",
      links: '<a href="account.html">My account</a>'
    }
  };

  function footerDefault(variant) {
    var f = FOOTERS[variant] || FOOTERS.billing;
    return '<footer class="site-foot"><div class="wrap">' +
      '<span class="foot-tag">' + f.tag + "</span>" +
      '<span class="foot-links">' + f.links +
      "<span>" + supportEmail() + "</span></span>" +
      "</div></footer>";
  }

  function footerLanding() {
    var email = supportEmail();
    return (
      '<footer class="border-t border-honeyline">' +
      '<div class="max-w-6xl mx-auto px-5 py-6 text-sm text-stone-500 flex flex-wrap gap-x-6 gap-y-2">' +
      "<span>Sonaris · Live captions anywhere you watch</span>" +
      '<span class="ml-auto flex flex-wrap gap-x-6 gap-y-2">' +
      '<a href="pricing.html" class="text-stone-500 no-underline hover:text-cocoa">Pricing</a>' +
      '<a href="account.html" class="text-stone-500 no-underline hover:text-cocoa">My account</a>' +
      '<a href="terms.html" class="text-stone-500 no-underline hover:text-cocoa">Terms</a>' +
      '<a href="privacy.html" class="text-stone-500 no-underline hover:text-cocoa">Privacy</a>' +
      '<a href="refunds.html" class="text-stone-500 no-underline hover:text-cocoa">Refunds</a>' +
      '<a data-webstore href="' + STORE_FALLBACK + '" target="_blank" rel="noopener" class="text-stone-500 no-underline hover:text-cocoa">Install extension</a>' +
      '<span>' + email + '</span>' +
      "</span></div></footer>"
    );
  }

  function SiteHeader() { return Reflect.construct(HTMLElement, [], SiteHeader); }
  SiteHeader.prototype = Object.create(HTMLElement.prototype);
  SiteHeader.prototype.connectedCallback = function () {
    if (this.dataset.rendered) return;
    this.dataset.rendered = "1";
    var variant = this.getAttribute("variant") || "default";
    var active = this.getAttribute("active") || "";
    this.innerHTML = variant === "landing" ? headerLanding() : headerDefault(active);
  };

  function SiteFooter() { return Reflect.construct(HTMLElement, [], SiteFooter); }
  SiteFooter.prototype = Object.create(HTMLElement.prototype);
  SiteFooter.prototype.connectedCallback = function () {
    if (this.dataset.rendered) return;
    this.dataset.rendered = "1";
    var variant = this.getAttribute("variant") || "billing";
    this.innerHTML = variant === "landing" ? footerLanding() : footerDefault(variant);
  };

  try {
    customElements.define("site-header", SiteHeader);
    customElements.define("site-footer", SiteFooter);
  } catch (e) {
    /* custom elements unsupported: noscript fallback in pages stays */
  }
})();
