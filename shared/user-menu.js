// ============================================================
// DFL Staff Portal — User Menu + PWA install
// ============================================================
// Two things live here because they're the same concern: per-user actions that
// used to have nowhere to go.
//
// 1. window.DFLInstall — the whole PWA install story in one place.
// 2. An avatar dropdown for the two field apps (Sales, Merch): name + role,
//    "Install app", "Sign out".
//
// ------------------------------------------------------------
// WHAT THIS REPLACED, AND WHY
// ------------------------------------------------------------
// The install prompt used to be a banner that shoved itself into view: merch
// popped a bar 1.5s after load AND had a fallback that force-showed it after
// 3s whether or not the browser said the app was installable. hub.html had a
// fixed bar across the bottom that covered the side rail. Both were pure
// interruption for something nobody needs twice.
//
// Now installing is a menu item people find when they want it. Nothing appears
// uninvited, and the item hides itself once the app is actually installed.
//
// Sign-out was also inconsistent — Sales had a text button, Merch only had an
// avatar circle you had to guess was clickable. Both now open the same menu.
//
// ------------------------------------------------------------
// STYLING IS SELF-CONTAINED ON PURPOSE
// ------------------------------------------------------------
// Same reasoning as section-switcher.js: the rep app is --navy #0D1B3E with
// Montserrat, the merch app #1B2B5E with a system stack. Every visual property
// is set explicitly here — no var() lookups, no webfont dependency — so the
// menu renders identically in both. Restyle it HERE, not per page.
//
// ------------------------------------------------------------
// USAGE
// ------------------------------------------------------------
//   <div data-dfl-user-menu></div>          <!-- in the page header -->
//   <script src="/shared/user-menu.js"></script>   <!-- after auth-guard.js -->
//
// Several mounts per page are fine (both apps have a header per screen/tab).
// Portal pages don't mount it — side-nav.js already shows identity in the rail
// and calls into window.DFLInstall for its own "Install app" button.
// ============================================================

(function () {

  // ============================================================
  // PART 1 — install plumbing (window.DFLInstall)
  // ============================================================
  // Registered immediately, at file scope: beforeinstallprompt can fire before
  // any DOM is ready, and if we miss it the event is gone for that page load.

  let deferredPrompt = null;
  const listeners = [];

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    // Stop Chrome's own mini-infobar; we surface it in the menu instead.
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    try { localStorage.setItem('dfl-pwa-installed', '1'); } catch (e) {}
    notify();
  });

  window.DFLInstall = {
    // Already running as an installed app, or we've seen it installed before.
    installed: function () {
      if (isStandalone()) return true;
      try { return localStorage.getItem('dfl-pwa-installed') === '1'; }
      catch (e) { return false; }
    },

    // Worth offering at all? iOS never fires beforeinstallprompt but CAN be
    // installed manually, so it still counts — we just show instructions.
    offerable: function () {
      return !this.installed() && (deferredPrompt !== null || isIOS());
    },

    // True when the browser gave us a real prompt to fire.
    hasPrompt: function () { return deferredPrompt !== null; },

    // Returns 'prompted' | 'manual' — 'manual' means the caller should show
    // instructions because this browser has no programmatic install.
    run: function () {
      if (deferredPrompt) {
        const p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        p.userChoice.then(function (r) {
          if (r && r.outcome === 'accepted') {
            try { localStorage.setItem('dfl-pwa-installed', '1'); } catch (e) {}
          }
          notify();
        });
        return 'prompted';
      }
      return 'manual';
    },

    instructions: function () {
      return isIOS()
        ? 'In Safari: tap the Share button, then “Add to Home Screen”.'
        : 'In Chrome: tap the ⋮ menu, then “Install app” or “Add to Home screen”.';
    },

    // Called when install availability changes, so menus can re-render.
    onChange: function (fn) { listeners.push(fn); }
  };


  // ============================================================
  // PART 2 — the avatar dropdown
  // ============================================================

  if (window.self !== window.top) return;   // embedded pages inherit the parent's chrome

  const MOUNT_SELECTOR = '[data-dfl-user-menu]';

  const CSS = `
    .dfl-um { position: relative; display: inline-flex; flex-shrink: 0; }
    .dfl-um__btn {
      appearance: none; -webkit-appearance: none;
      display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box;
      width: 36px; height: 36px; padding: 0; margin: 0;
      border: 1.5px solid rgba(255,255,255,0.22);
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; font-weight: 700; line-height: 1;
      letter-spacing: 0.2px; text-transform: uppercase;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .dfl-um__btn:hover { background: rgba(255,255,255,0.24); border-color: rgba(255,255,255,0.4); }
    .dfl-um__btn[aria-expanded="true"] { background: #ffffff; color: #0f2044; border-color: #ffffff; }

    .dfl-um__panel {
      position: absolute; top: calc(100% + 8px); right: 0;
      z-index: 1000;
      min-width: 220px; max-width: 280px;
      box-sizing: border-box;
      padding: 6px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: left;
      display: none;
    }
    .dfl-um__panel.open { display: block; }

    .dfl-um__who {
      padding: 9px 11px 10px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 5px;
    }
    .dfl-um__name {
      display: block;
      font-size: 13px; font-weight: 700; color: #1e293b;
      line-height: 1.3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dfl-um__role {
      display: block; margin-top: 2px;
      font-size: 11px; font-weight: 600; color: #64748b;
      text-transform: capitalize; letter-spacing: 0.2px;
    }

    .dfl-um__item {
      appearance: none; -webkit-appearance: none;
      display: flex; align-items: center; gap: 9px;
      box-sizing: border-box;
      width: 100%; padding: 9px 11px; margin: 0;
      border: 0; border-radius: 7px;
      background: transparent;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; font-weight: 500; line-height: 1.3;
      text-align: left; text-decoration: none;
      cursor: pointer;
    }
    .dfl-um__item:hover { background: #f0f4f8; }
    .dfl-um__item--danger { color: #dc2626; }
    .dfl-um__item--danger:hover { background: #fef2f2; }
    .dfl-um__ico { font-size: 14px; line-height: 1; flex-shrink: 0; width: 16px; text-align: center; }

    .dfl-um__hint {
      padding: 9px 11px 10px;
      font-size: 12px; font-weight: 400; color: #64748b; line-height: 1.5;
      background: #f8fafc; border-radius: 7px; margin-top: 4px;
    }
  `;

  function injectCss() {
    if (document.getElementById('dfl-um-css')) return;
    const style = document.createElement('style');
    style.id = 'dfl-um-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase();
  }

  function closeAll() {
    const open = document.querySelectorAll('.dfl-um__panel.open');
    Array.prototype.forEach.call(open, function (p) {
      p.classList.remove('open');
      const btn = p.parentNode.querySelector('.dfl-um__btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function buildMenu(profile) {
    const wrap = document.createElement('div');
    wrap.className = 'dfl-um';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dfl-um__btn';
    btn.textContent = initials(profile && profile.full_name);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Account menu');

    const panel = document.createElement('div');
    panel.className = 'dfl-um__panel';

    // --- who ---
    const who = document.createElement('div');
    who.className = 'dfl-um__who';
    const nm = document.createElement('span');
    nm.className = 'dfl-um__name';
    nm.textContent = (profile && profile.full_name) || 'Signed in';
    who.appendChild(nm);
    if (profile && profile.role) {
      const rl = document.createElement('span');
      rl.className = 'dfl-um__role';
      rl.textContent = String(profile.role).replace(/_/g, ' ');
      who.appendChild(rl);
    }
    panel.appendChild(who);

    // --- install (only when it's actually on offer) ---
    const install = document.createElement('button');
    install.type = 'button';
    install.className = 'dfl-um__item';
    install.innerHTML = '<span class="dfl-um__ico">⬇️</span><span>Install app</span>';
    install.addEventListener('click', function () {
      if (window.DFLInstall.run() === 'manual') {
        // No programmatic install (iOS Safari) — tell them how, in place.
        let hint = panel.querySelector('.dfl-um__hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'dfl-um__hint';
          panel.appendChild(hint);
        }
        hint.textContent = window.DFLInstall.instructions();
      } else {
        closeAll();
      }
    });
    panel.appendChild(install);

    function syncInstall() {
      install.style.display = window.DFLInstall.offerable() ? '' : 'none';
    }
    syncInstall();
    window.DFLInstall.onChange(syncInstall);

    // --- sign out ---
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'dfl-um__item dfl-um__item--danger';
    out.innerHTML = '<span class="dfl-um__ico">↩</span><span>Sign out</span>';
    out.addEventListener('click', function () {
      // logout() is the global from auth-guard.js. Guarded in case a page
      // loaded without it (or the CDN script failed).
      if (typeof window.logout === 'function') window.logout();
      else window.location.href = '/login.html';
    });
    panel.appendChild(out);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = panel.classList.contains('open');
      closeAll();
      if (!isOpen) {
        panel.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return wrap;
  }

  function render(profile) {
    const mounts = document.querySelectorAll(MOUNT_SELECTOR);
    if (!mounts.length) return;
    injectCss();
    Array.prototype.forEach.call(mounts, function (mount) {
      if (mount.querySelector('.dfl-um')) return;   // don't double-render
      mount.appendChild(buildMenu(profile));
    });
  }

  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });

  // The guard may have finished before this script ran, in which case the
  // event has already been and gone — so check for the profile first.
  if (window.DFL_PROFILE) {
    render(window.DFL_PROFILE);
  } else {
    document.addEventListener('dfl-auth-ready', function (e) {
      render(e.detail.profile);
    });
  }

})();
