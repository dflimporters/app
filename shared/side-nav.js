// ============================================================
// DFL Staff Portal — Side Navigation
// ============================================================
// The portal's single navigation surface. Renders a persistent left rail at
// >=768px (desktop and portrait tablet) and a slim top bar + off-canvas drawer
// below that. It REPLACES the hand-copied <nav> bar, hamburger and
// .nav-mobile-menu that used to live in each portal page.
//
// ------------------------------------------------------------
// WHY THIS IS SHARED AND NOT COPY-PASTED
// ------------------------------------------------------------
// The old top bar existed in eight separate files with drifting values, and
// four of its links (dashboards / forms / assets / dispatch-portal) pointed at
// pages that live in _staging/ and therefore 404. Fixing that meant eight
// identical edits, so it never happened. The link list now exists ONCE, below.
//
// Same self-containment rule as section-switcher.js: every visual property is
// set explicitly here — no var() lookups, no webfont dependency — so the rail
// renders identically regardless of the host page's design tokens. If you
// restyle it, restyle it HERE.
//
// ------------------------------------------------------------
// HOW TO USE IT ON A PAGE
// ------------------------------------------------------------
// 1. Delete the page's own <nav>, .nav-mobile-menu and hamburger JS.
// 2. Load /shared/routes.js first (this file reads DFL_PAGE_ROLES from it to
//    decide which links a role may see), then this, after the auth guard:
//
//        <script src="/shared/routes.js"></script>
//        <script src="/shared/auth-guard.js"></script>   <!-- guarded pages -->
//        <script src="/shared/side-nav.js"></script>
//
// 3. Optionally name the current page for the mobile top bar's title:
//
//        <script>window.DFL_PAGE_TITLE = 'Specials';</script>
//
// The rail pushes page content over by setting padding on <body>, so a page
// needs no wrapper element. Anything the page positions with `position:fixed`
// and `left:0` will sit UNDER the rail and needs its own left offset at
// >=768px — see hub.html's #installBanner for the pattern.
//
// It picks the profile up from the auth guard, and re-renders when
// dfl-auth-ready fires so role-gated items appear as soon as the role is
// known. On a page with no guard it still renders, showing only the items that
// carry no `roles` restriction.
// ============================================================

(function () {

  // Inside an iframe the parent already shows the portal chrome. This matters
  // concretely: specials.html is embedded in the Sales app's "More" tab, and a
  // second full navigation rail inside that frame would be nonsense. Same
  // reasoning as auth-guard.js and section-switcher.js no-opping when framed.
  if (window.self !== window.top) return;

  const RAIL_WIDTH = 240;   // px — keep in sync with the CSS below
  const TOPBAR_H   = 52;    // px — mobile only
  const BREAKPOINT = 768;   // px — rail at/above, drawer below

  const LOGO = 'https://hzagwndglwhcepsirafi.supabase.co/storage/v1/object/public/Assets/DFL%20Logo%20Blue_White.png';

  // ------------------------------------------------------------
  // THE LINK LIST — the portal's information architecture.
  //
  //   href  : a real page. WHO CAN SEE IT IS NOT LISTED HERE — it's derived
  //           from DFL_PAGE_ROLES in /shared/routes.js, the same table the
  //           guard enforces. That's deliberate: a nav item and the page it
  //           points at can no longer disagree, so the rail can't offer a link
  //           that bounces you.
  //   roles : ONLY for entries routes.js can't answer for — i.e. the `soon`
  //           items, which have no href to look up yet.
  //   soon  : renders as a disabled row instead of a link. Use for pages still
  //           sitting in _staging/, which would 404 if linked. To ship one,
  //           move the file to the repo root and swap `soon:true` for an href.
  //   tone  : 'gold' marks the restricted sections, matching hub.html's cards.
  // ------------------------------------------------------------
  const GROUPS = [
    {
      group: null,
      items: [
        { label: 'Hub', href: '/hub.html', icon: '🏠' }
      ]
    },
    {
      group: 'Field Apps',
      items: [
        { label: 'Sales',         href: '/index.html',     icon: '📈' },
        { label: 'Merchandising', href: '/merch.html',     icon: '🛒' },
        { label: 'Warehouse',     href: '/warehouse.html', icon: '📦' }
      ]
    },
    {
      group: 'Tools',
      items: [
        { label: 'Specials & Flyers', href: '/specials.html',        icon: '🎯' },
        { label: 'Manage Specials',   href: '/specials-upload.html', icon: '📤' }
      ]
    },
    {
      group: 'Management',
      tone: 'gold',
      items: [
        // Derived like everything else now — /management/** lost its plaintext
        // password gate and is in DFL_PAGE_ROLES as manager/admin.
        { label: 'Dashboards', href: '/management/', icon: '📊' }
      ]
    },
    {
      group: 'Admin',
      tone: 'gold',
      items: [
        { label: 'Admin Panel',    href: '/admin/',               icon: '🔐' },
        { label: 'User Approvals', href: '/admin/approvals.html', icon: '👤' }
      ]
    },
    {
      group: 'Coming Soon',
      items: [
        { label: 'Dashboards',      icon: '📊', soon: true },
        { label: 'Forms & Links',   icon: '🔗', soon: true },
        { label: 'Assets',          icon: '📁', soon: true },
        { label: 'Dispatch Portal', icon: '🚚', soon: true, roles: ['manager', 'admin'] }
      ]
    }
  ];

  // ------------------------------------------------------------
  // CSS — every property explicit. The `body` rules use a type selector so
  // they beat the `* { padding:0 }` reset most portal pages declare.
  // ------------------------------------------------------------
  const CSS = `
    body.dfl-nav-on {
      padding-left: ${RAIL_WIDTH}px;
      padding-top: 0;
    }
    .dfl-rail {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: ${RAIL_WIDTH}px;
      z-index: 200;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      background: #0f2044;
      border-right: 1px solid rgba(255,255,255,0.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-tap-highlight-color: transparent;
    }

    .dfl-rail__brand {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: 64px;
      flex-shrink: 0;
      padding: 0 18px;
      margin: 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      text-decoration: none;
      background: transparent;
      transition: background 0.15s;
    }
    .dfl-rail__brand:hover { background: rgba(255,255,255,0.06); }
    .dfl-rail__brand img {
      height: 26px;
      width: auto;
      display: block;
      margin: 0;
      border: 0;
    }

    .dfl-rail__scroll {
      flex: 1;
      min-height: 0;
      box-sizing: border-box;
      padding: 14px 10px 10px;
      margin: 0;
    }

    .dfl-rail__grouplabel {
      display: block;
      box-sizing: border-box;
      margin: 16px 0 6px;
      padding: 0 10px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.35);
      line-height: 1.4;
    }
    .dfl-rail__grouplabel--gold { color: rgba(251,191,36,0.6); }
    .dfl-rail__grouplabel:first-child { margin-top: 0; }

    .dfl-rail__link,
    .dfl-rail__soon {
      display: flex;
      align-items: center;
      gap: 11px;
      box-sizing: border-box;
      width: 100%;
      margin: 1px 0;
      padding: 9px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: rgba(255,255,255,0.68);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13.5px;
      font-weight: 500;
      line-height: 1.3;
      letter-spacing: 0;
      text-align: left;
      text-decoration: none;
      text-transform: none;
      position: relative;
      transition: background 0.15s, color 0.15s;
    }
    .dfl-rail__link:hover { background: rgba(255,255,255,0.09); color: #ffffff; }
    .dfl-rail__link--gold { color: #fbbf24; }
    .dfl-rail__link--gold:hover { background: rgba(251,191,36,0.14); color: #fef3c7; }

    .dfl-rail__link[aria-current="page"] {
      background: rgba(255,255,255,0.14);
      color: #ffffff;
      font-weight: 600;
      cursor: default;
    }
    .dfl-rail__link[aria-current="page"]::before {
      content: '';
      position: absolute;
      left: -10px;
      top: 7px;
      bottom: 7px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: #2563eb;
    }
    .dfl-rail__link--gold[aria-current="page"] {
      background: rgba(251,191,36,0.16);
      color: #fef3c7;
    }
    .dfl-rail__link--gold[aria-current="page"]::before { background: #fbbf24; }

    /* Pages still in _staging/. Shown greyed rather than hidden so the roadmap
       stays visible — same intent as hub.html's .card.soon tiles. */
    .dfl-rail__soon {
      color: rgba(255,255,255,0.3);
      cursor: not-allowed;
    }
    .dfl-rail__soontag {
      margin-left: auto;
      padding: 2px 6px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 20px;
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.32);
      white-space: nowrap;
    }

    .dfl-rail__ico {
      width: 18px;
      flex-shrink: 0;
      font-size: 14px;
      line-height: 1;
      text-align: center;
      font-style: normal;
    }

    .dfl-rail__foot {
      flex-shrink: 0;
      box-sizing: border-box;
      padding: 12px 18px calc(14px + env(safe-area-inset-bottom, 0px));
      margin: 0;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .dfl-rail__who {
      display: block;
      margin: 0 0 9px;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.4;
      color: rgba(255,255,255,0.5);
      word-break: break-word;
    }
    .dfl-rail__who b {
      display: block;
      font-weight: 600;
      color: rgba(255,255,255,0.8);
    }
    .dfl-rail__out {
      appearance: none;
      -webkit-appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      min-height: 32px;
      margin: 0;
      padding: 6px 12px;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 7px;
      background: transparent;
      color: rgba(255,255,255,0.62);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.1px;
      text-align: center;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .dfl-rail__out:hover { color: #ffffff; border-color: rgba(255,255,255,0.45); }

    /* ---- Mobile top bar + drawer scrim: hidden at rail widths ---- */
    .dfl-topbar { display: none; }
    .dfl-scrim { display: none; }

    @media (max-width: ${BREAKPOINT - 1}px) {
      body.dfl-nav-on {
        padding-left: 0;
        padding-top: ${TOPBAR_H}px;
      }

      .dfl-rail {
        width: 268px;
        max-width: 84vw;
        transform: translateX(-100%);
        transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: none;
      }
      .dfl-rail.dfl-rail--open {
        transform: translateX(0);
        box-shadow: 4px 0 24px rgba(0,0,0,0.35);
      }

      .dfl-topbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 190;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        height: ${TOPBAR_H}px;
        margin: 0;
        padding: 0 14px;
        background: #0f2044;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .dfl-burger {
        appearance: none;
        -webkit-appearance: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 5px;
        box-sizing: border-box;
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        margin: 0;
        padding: 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        cursor: pointer;
      }
      .dfl-burger span {
        display: block;
        width: 20px;
        height: 2px;
        margin: 0;
        border-radius: 2px;
        background: rgba(255,255,255,0.85);
        transition: transform 0.24s, opacity 0.24s;
      }
      .dfl-burger.dfl-burger--open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
      .dfl-burger.dfl-burger--open span:nth-child(2) { opacity: 0; }
      .dfl-burger.dfl-burger--open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

      .dfl-topbar__brand {
        display: flex;
        align-items: center;
        margin: 0;
        padding: 0;
        text-decoration: none;
      }
      .dfl-topbar__brand img {
        height: 22px;
        width: auto;
        display: block;
        margin: 0;
        border: 0;
      }
      .dfl-topbar__title {
        margin: 0;
        padding: 0;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.1px;
        color: rgba(255,255,255,0.92);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dfl-scrim {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 195;
        margin: 0;
        padding: 0;
        border: 0;
        background: rgba(6,12,30,0.55);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.24s;
      }
      .dfl-scrim.dfl-scrim--open { opacity: 1; pointer-events: auto; }
    }
  `;

  function injectCss() {
    if (document.getElementById('dfl-sidenav-css')) return;
    const style = document.createElement('style');
    style.id = 'dfl-sidenav-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------

  // '/management/index.html' and '/management/' are the same place. Normalise
  // so the active-item match doesn't depend on which form a link used.
  function normalise(path) {
    let p = (path || '/').replace(/index\.html$/, '');
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p === '' ? '/' : p;
  }

  function homeFor(profile) {
    return dflHome({ role: roleOf(profile) });
  }

  // There used to be a DFL_NAV_FALLBACK_ROLE escape hatch here, because
  // management/** was gated by a plaintext password instead of the auth guard
  // and so had no DFL_PROFILE for the rail to read. That password is gone and
  // every page carrying the rail is properly guarded, so the hatch went too.
  function roleOf(profile) {
    return (profile && profile.role) || null;
  }

  // An explicit `roles` list wins (soon items, /management/**). Otherwise ask
  // routes.js whether this role could actually open the href — so the rail
  // shows exactly what the guard would let through, by construction.
  function visible(item, role) {
    if (item.roles) {
      if (!role) return false;                  // no role known — hide gated
      return item.roles.indexOf(role) !== -1;
    }
    if (item.href) {
      if (!role) return false;
      return dflCanAccess(role, item.href);
    }
    return true;                                // no href, no roles — always on
  }

  // ------------------------------------------------------------
  // Rendering. Idempotent: called once immediately (so a page with no auth
  // guard still gets a rail) and again on dfl-auth-ready with the real role.
  // ------------------------------------------------------------
  function buildLinks(profile) {
    const here = normalise(window.location.pathname);
    const role = roleOf(profile);
    const frag = document.createDocumentFragment();

    GROUPS.forEach(function (g) {
      const items = g.items.filter(function (it) { return visible(it, role); });
      if (!items.length) return;

      if (g.group) {
        const lbl = document.createElement('span');
        lbl.className = 'dfl-rail__grouplabel' +
          (g.tone === 'gold' ? ' dfl-rail__grouplabel--gold' : '');
        lbl.textContent = g.group;
        frag.appendChild(lbl);
      }

      items.forEach(function (it) {
        const ico = document.createElement('i');
        ico.className = 'dfl-rail__ico';
        ico.setAttribute('aria-hidden', 'true');
        ico.textContent = it.icon || '•';

        const txt = document.createElement('span');
        txt.textContent = it.label;

        // Staged page — a <span>, not a link, so it can't be clicked or focused.
        if (it.soon) {
          const row = document.createElement('span');
          row.className = 'dfl-rail__soon';
          row.appendChild(ico);
          row.appendChild(txt);
          const tag = document.createElement('span');
          tag.className = 'dfl-rail__soontag';
          tag.textContent = 'Soon';
          row.appendChild(tag);
          frag.appendChild(row);
          return;
        }

        const isHere = normalise(it.href) === here;
        // The current page is a <span> too — clicking it would just reload.
        const row = document.createElement(isHere ? 'span' : 'a');
        row.className = 'dfl-rail__link' +
          (g.tone === 'gold' ? ' dfl-rail__link--gold' : '');
        if (isHere) row.setAttribute('aria-current', 'page');
        else row.href = it.href;
        row.appendChild(ico);
        row.appendChild(txt);
        frag.appendChild(row);
      });
    });

    return frag;
  }

  function render(profile) {
    const home = homeFor(profile);

    // ---- rail ----
    let rail = document.getElementById('dfl-rail');
    if (!rail) {
      rail = document.createElement('aside');
      rail.id = 'dfl-rail';
      rail.className = 'dfl-rail';
      rail.setAttribute('aria-label', 'Portal navigation');
      document.body.appendChild(rail);
    }
    rail.textContent = '';

    const brand = document.createElement('a');
    brand.className = 'dfl-rail__brand';
    brand.href = home;
    brand.setAttribute('aria-label', 'DFL — go to home');
    const brandImg = document.createElement('img');
    brandImg.src = LOGO;
    brandImg.alt = 'DFL';
    brand.appendChild(brandImg);
    rail.appendChild(brand);

    const scroll = document.createElement('nav');
    scroll.className = 'dfl-rail__scroll';
    scroll.appendChild(buildLinks(profile));
    rail.appendChild(scroll);

    const foot = document.createElement('div');
    foot.className = 'dfl-rail__foot';
    if (profile) {
      const who = document.createElement('span');
      who.className = 'dfl-rail__who';
      const nm = document.createElement('b');
      nm.textContent = profile.full_name || 'Signed in';
      who.appendChild(nm);
      who.appendChild(document.createTextNode(profile.role || ''));
      foot.appendChild(who);
    }
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'dfl-rail__out';
    out.textContent = 'Sign out';
    // logout() is the global from auth-guard.js. Guarded because an unguarded
    // page (or one where the CDN script failed) won't have defined it.
    out.addEventListener('click', function () {
      if (typeof window.logout === 'function') window.logout();
      else window.location.href = '/login.html';
    });
    foot.appendChild(out);
    rail.appendChild(foot);

    // ---- mobile top bar ----
    let bar = document.getElementById('dfl-topbar');
    if (!bar) {
      bar = document.createElement('header');
      bar.id = 'dfl-topbar';
      bar.className = 'dfl-topbar';
      document.body.appendChild(bar);
    }
    bar.textContent = '';

    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'dfl-burger';
    burger.setAttribute('aria-label', 'Open navigation');
    burger.setAttribute('aria-expanded', 'false');
    burger.appendChild(document.createElement('span'));
    burger.appendChild(document.createElement('span'));
    burger.appendChild(document.createElement('span'));
    bar.appendChild(burger);

    const barBrand = document.createElement('a');
    barBrand.className = 'dfl-topbar__brand';
    barBrand.href = home;
    barBrand.setAttribute('aria-label', 'DFL — go to home');
    const barImg = document.createElement('img');
    barImg.src = LOGO;
    barImg.alt = 'DFL';
    barBrand.appendChild(barImg);
    bar.appendChild(barBrand);

    const title = document.createElement('span');
    title.className = 'dfl-topbar__title';
    title.textContent = window.DFL_PAGE_TITLE || 'Staff Portal';
    bar.appendChild(title);

    // ---- scrim ----
    let scrim = document.getElementById('dfl-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'dfl-scrim';
      scrim.className = 'dfl-scrim';
      document.body.appendChild(scrim);
    }

    // ---- drawer wiring ----
    function setOpen(open) {
      rail.classList.toggle('dfl-rail--open', open);
      scrim.classList.toggle('dfl-scrim--open', open);
      burger.classList.toggle('dfl-burger--open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    burger.addEventListener('click', function () {
      setOpen(!rail.classList.contains('dfl-rail--open'));
    });
    scrim.addEventListener('click', function () { setOpen(false); });
    // Tapping a destination should close the drawer even though the new page
    // is about to load — the old one stays visible during navigation.
    scroll.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });

    document.body.classList.add('dfl-nav-on');
  }

  // ------------------------------------------------------------
  // Boot. Scripts in <head> can run before <body> exists, so defer if needed —
  // same null-safety concern as auth-guard.js's revealPage().
  // ------------------------------------------------------------
  function boot() {
    injectCss();
    render(window.DFL_PROFILE || null);
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);

  // Re-render once the role is known, so gated items appear. On a guarded page
  // the body is still visibility:hidden at this point, so the pre-role render
  // is never seen.
  document.addEventListener('dfl-auth-ready', function (e) {
    if (!document.body) return;
    injectCss();
    render(e.detail.profile);
  });

  // Escape closes the mobile drawer.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const rail = document.getElementById('dfl-rail');
    if (rail && rail.classList.contains('dfl-rail--open')) {
      rail.classList.remove('dfl-rail--open');
      const scrim = document.getElementById('dfl-scrim');
      const burger = document.querySelector('.dfl-burger');
      if (scrim) scrim.classList.remove('dfl-scrim--open');
      if (burger) {
        burger.classList.remove('dfl-burger--open');
        burger.setAttribute('aria-expanded', 'false');
      }
    }
  });

})();
