// ============================================================
// DFL Staff Portal — Section Switcher
// ============================================================
// A small segmented control that flips between the Sales app (/index.html)
// and the Merchandising app (/merch.html). It renders ONLY for `admin` and
// `manager`. Reps, merchandisers and team leaders never see it — they get one
// app and stay in it.
//
// ------------------------------------------------------------
// WHY THIS IS A SHARED FILE AND NOT COPY-PASTED CSS
// ------------------------------------------------------------
// The two apps have genuinely different design tokens — the rep app's --navy
// is #0D1B3E with Montserrat/Open Sans, the merch app's is #1B2B5E with a
// system font stack. Pasting the same markup into both would inherit those
// differences and drift further on every edit.
//
// So this control is deliberately SELF-CONTAINED: every visual property it
// relies on (colour, font, size, spacing, radius) is set explicitly here, with
// no var() lookups and no webfont dependency. That's what makes it render
// pixel-identically in both apps. If you restyle it, restyle it HERE — that's
// the whole point of the file.
//
// ------------------------------------------------------------
// HOW TO USE IT ON A PAGE
// ------------------------------------------------------------
// 1. Put an empty mount point where the control should appear, usually in the
//    page's header next to the sign-out button:
//
//        <div data-dfl-switcher></div>
//
//    You can add SEVERAL — both apps swap between screens/tabs that each have
//    their own header, and the control is rendered into every mount. (The merch
//    app routes admins to its admin screen, so a single mount in the
//    merchandiser header would be invisible to the very people who need it.)
//
// 2. Load this AFTER /shared/auth-guard.js:
//
//        <script src="/shared/section-switcher.js"></script>
//
// 3. Tell it which app it's sitting in, so the right side is highlighted:
//
//        <script>window.DFL_SECTION = 'sales';</script>   // or 'merch'
//
// It picks up the profile from the auth guard, so no wiring beyond that. If
// the mount point is missing it does nothing (no error).
// ============================================================

(function () {

  // Inside an iframe the parent frame already shows its own chrome — a second
  // switcher in an embedded page would be a duplicate control. Same reasoning
  // as auth-guard.js no-opping when framed.
  if (window.self !== window.top) return;

  const MOUNT_SELECTOR = '[data-dfl-switcher]';
  const ALLOWED_ROLES = ['admin', 'manager'];

  const SECTIONS = [
    { key: 'sales', label: 'Sales', href: '/index.html' },
    { key: 'merch', label: 'Merch', href: '/merch.html' }
  ];

  // Every property is explicit so neither app's `button {}` / `* {}` rules can
  // bleed in and make the two renderings differ.
  const CSS = `
    .dfl-switch {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      margin: 0;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 8px;
      box-sizing: border-box;
      flex-shrink: 0;
      vertical-align: middle;
      -webkit-tap-highlight-color: transparent;
    }
    .dfl-switch__btn {
      appearance: none;
      -webkit-appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-height: 28px;
      padding: 5px 12px;
      margin: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: rgba(255,255,255,0.72);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.1px;
      text-align: center;
      text-decoration: none;
      text-transform: none;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .dfl-switch__btn:hover { color: #fff; background: rgba(255,255,255,0.10); }
    .dfl-switch__btn[aria-current="page"] {
      background: #ffffff;
      color: #0f2044;
      font-weight: 700;
      cursor: default;
      box-shadow: 0 1px 2px rgba(0,0,0,0.12);
    }
    .dfl-switch__btn[aria-current="page"]:hover { background: #ffffff; color: #0f2044; }
  `;

  function injectCss() {
    if (document.getElementById('dfl-switch-css')) return;
    const style = document.createElement('style');
    style.id = 'dfl-switch-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function buildControl(current) {
    const nav = document.createElement('nav');
    nav.className = 'dfl-switch';
    nav.setAttribute('aria-label', 'Switch section');

    SECTIONS.forEach(function (s) {
      const isCurrent = s.key === current;
      // The active side is a <span>, not a link — clicking it would be a
      // pointless reload of the page you're already on.
      const el = document.createElement(isCurrent ? 'span' : 'a');
      el.className = 'dfl-switch__btn';
      el.textContent = s.label;
      if (isCurrent) {
        el.setAttribute('aria-current', 'page');
      } else {
        el.href = s.href;
      }
      nav.appendChild(el);
    });

    return nav;
  }

  function render(profile) {
    if (!profile || ALLOWED_ROLES.indexOf(profile.role) === -1) return;

    const mounts = document.querySelectorAll(MOUNT_SELECTOR);
    if (!mounts.length) return;

    // Which app are we in? Explicit flag wins; otherwise infer from the path
    // so the control still highlights correctly if the flag is forgotten.
    const current = window.DFL_SECTION ||
      (window.location.pathname.indexOf('merch') !== -1 ? 'merch' : 'sales');

    injectCss();

    // A fresh control per mount — a single node can only live in one place.
    Array.prototype.forEach.call(mounts, function (mount) {
      if (mount.querySelector('.dfl-switch')) return; // don't double-render
      mount.appendChild(buildControl(current));
    });
  }

  // The guard may have already finished before this script runs, in which case
  // the event has been and gone — so check for the profile first, then listen.
  if (window.DFL_PROFILE) {
    render(window.DFL_PROFILE);
  } else {
    document.addEventListener('dfl-auth-ready', function (e) {
      render(e.detail.profile);
    });
  }

})();
