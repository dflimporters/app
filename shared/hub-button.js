// ============================================================
// DFL Staff Portal — Hub Button
// ============================================================
// A single small icon button that takes admin/manager straight to /hub.html
// from inside either field app.
//
// Same audience as the Sales/Merch switcher (section-switcher.js), but a
// DIFFERENT action: the switcher flips between two SIBLING apps, this jumps
// UP to the portal. Kept as its own control rather than a third option
// bolted onto the switcher, so each control keeps one clear meaning.
//
// ------------------------------------------------------------
// STYLING IS SELF-CONTAINED, SAME REASONING AS section-switcher.js / user-menu.js
// ------------------------------------------------------------
// Every visual property is set explicitly here — no var() lookups, no webfont
// dependency — so it renders identically in both apps regardless of their
// different design tokens.
//
// ------------------------------------------------------------
// USAGE
// ------------------------------------------------------------
//   <div data-dfl-hub-button></div>
//   <script src="/shared/hub-button.js"></script>   <!-- after auth-guard.js -->
//
// Several mounts per page are fine, same as section-switcher.js / user-menu.js
// — both apps have more than one header.
// ============================================================

(function () {

  // Same reasoning as section-switcher.js and user-menu.js: a page shown
  // inside an iframe already has its parent's chrome.
  if (window.self !== window.top) return;

  const MOUNT_SELECTOR = '[data-dfl-hub-button]';
  const ALLOWED_ROLES = ['admin', 'manager'];

  const CSS = `
    .dfl-hubbtn {
      appearance: none; -webkit-appearance: none;
      display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box;
      width: 36px; height: 36px; padding: 0; margin: 0;
      border: 1.5px solid rgba(255,255,255,0.22);
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      color: #ffffff;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .dfl-hubbtn:hover { background: rgba(255,255,255,0.24); border-color: rgba(255,255,255,0.4); }
    .dfl-hubbtn svg { display: block; pointer-events: none; }
  `;

  function injectCss() {
    if (document.getElementById('dfl-hubbtn-css')) return;
    const style = document.createElement('style');
    style.id = 'dfl-hubbtn-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Same house glyph already used for the in-app "Home" buttons (Sales'
  // Plan/Customers sub-headers) — reused rather than inventing a second
  // symbol for a closely related idea ("go home" vs "go to the Hub").
  const ICON_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" ' +
    'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>';

  function buildButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dfl-hubbtn';
    btn.title = 'Go to Hub';
    btn.setAttribute('aria-label', 'Go to Hub');
    btn.innerHTML = ICON_SVG;
    btn.addEventListener('click', function () {
      window.location.href = '/hub.html';
    });
    return btn;
  }

  function render(profile) {
    if (!profile || ALLOWED_ROLES.indexOf(profile.role) === -1) return;

    const mounts = document.querySelectorAll(MOUNT_SELECTOR);
    if (!mounts.length) return;

    injectCss();

    Array.prototype.forEach.call(mounts, function (mount) {
      if (mount.querySelector('.dfl-hubbtn')) return; // don't double-render
      mount.appendChild(buildButton());
    });
  }

  // The guard may have already finished before this script runs, in which
  // case the event has been and gone — so check for the profile first.
  if (window.DFL_PROFILE) {
    render(window.DFL_PROFILE);
  } else {
    document.addEventListener('dfl-auth-ready', function (e) {
      render(e.detail.profile);
    });
  }

})();
