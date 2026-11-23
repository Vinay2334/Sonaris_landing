// Sonaris site — responsive navbar toggle. No build step.
// Wires any [data-nav-toggle] button to the menu named by its
// aria-controls attribute. Toggles two hooks so one script serves both
// headers: the `hidden` class (Tailwind panel on index.html) and the
// `is-open` class (styles.css nav on the other pages). Never touches the
// `hidden` attribute, which styles.css forces to display:none.
(function () {
  function init() {
    var toggles = document.querySelectorAll("[data-nav-toggle]");
    if (!toggles.length) return;
    toggles.forEach(function (btn) {
      var menuId = btn.getAttribute("aria-controls");
      var menu = menuId ? document.getElementById(menuId) : null;
      if (!menu) return;
      var iconOpen = btn.querySelector("[data-nav-icon-open]");
      var iconClose = btn.querySelector("[data-nav-icon-close]");

      function setOpen(open) {
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        // `is-open` drives the styles.css nav; `hidden` drives the
        // Tailwind panel on index.html. Each page only styles one of
        // them, so toggling both here is safe on either page.
        menu.classList.toggle("is-open", open);
        menu.classList.toggle("hidden", !open);
        if (iconOpen) iconOpen.hidden = open;
        if (iconClose) iconClose.hidden = !open;
      }

      btn.addEventListener("click", function () {
        setOpen(btn.getAttribute("aria-expanded") !== "true");
      });

      // Choosing a link closes the menu so the page isn't left covered.
      menu.addEventListener("click", function (e) {
        if (e.target.closest("a")) setOpen(false);
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
          setOpen(false);
          btn.focus();
        }
      });

      // If the viewport grows to desktop while open, reset to the
      // CSS-driven desktop layout instead of a stale open state.
      var mq = window.matchMedia("(min-width: 768px)");
      function onViewport() {
        if (mq.matches && btn.getAttribute("aria-expanded") === "true") {
          setOpen(false);
        }
      }
      if (mq.addEventListener) mq.addEventListener("change", onViewport);
      else if (mq.addListener) mq.addListener(onViewport);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
