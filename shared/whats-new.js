// ============================================================
// DFL Staff Portal — "What's new" popup
// ============================================================
// Shows a one-time "What's new" box when someone opens the rep app
// (/index.html) or the merch app (/merch.html) and there has been an update
// they haven't seen yet. Once they tap "Got it", those notes don't show again
// on that device.
//
// ------------------------------------------------------------
// HOW TO ANNOUNCE AN UPDATE
// ------------------------------------------------------------
// Add an entry to the TOP of DFL_UPDATES below and deploy. That's it.
//
//   {
//     id:    '2026-11-20-order-history',  // unique, never reuse or rename
//     date:  '2026-11-20',                // shown to the user
//     apps:  ['sales'],                   // 'sales' (rep app), 'merch', or both
//     roles: ['tl'],                      // optional — omit for everyone
//     title: 'Order history',
//     items: ['You can now see …', 'Tap … to …'],
//   }
//
// WHO SEES WHAT in the merch app:
//   no roles     → everyone in that app: Brand Ambassadors, relief, AND team
//                  leaders. Use this for general merch news.
//   roles:['tl'] → team leaders only (team_leader + tl_merch), plus
//                  managers/admins so they know what TLs were told.
//   roles:['ba'] → Brand Ambassadors / relief only (plus TL+BA, managers).
// Raw role codes ('rep', 'merchandiser', …) work too. See ROLE_GROUPS.
//
// Write for field staff on a phone: short, plain, what changed and where to
// find it. Plain text only — no HTML (it's escaped anyway).
//
// "Seen" is remembered per device in localStorage (key below), by id. Someone
// who has never opened the app on this device is shown only notes from the
// last FIRST_RUN_DAYS days, not the whole history.
//
// ------------------------------------------------------------
// HOW IT'S WIRED
// ------------------------------------------------------------
// Load AFTER /shared/auth-guard.js on a page that sets window.DFL_SECTION
// ('sales' or 'merch'). It waits for `dfl-auth-ready` so it can filter by
// role, and no-ops inside an iframe (same as section-switcher.js).
// Self-contained styles (prefixed dflwn-), no var() lookups or webfonts, so it
// looks the same in both apps. window.DFL_WHATS_NEW.open() re-shows recent
// notes; the avatar menu (shared/user-menu.js) calls it from "What's new".
// ============================================================

window.DFL_UPDATES = [
  {
    id: '2026-11-20-whats-new-menu',
    date: '2026-11-20',
    apps: ['sales', 'merch'],
    title: 'See these updates again any time',
    items: [
      'Tap the circle with your initials at the top of the screen, then tap What’s new.',
      'It shows the recent app updates, even after you tap Got it.',
    ],
  },
  {
    id: '2026-11-20-covering-for',
    date: '2026-11-20',
    apps: ['merch'],
    roles: ['tl'],
    title: 'Days Worked: cover for more than one person',
    items: [
      'Team leaders: in Days Worked, "Covering for" now lets you pick more than one person.',
      'You can also pick Training, or Someone else… to type a name. Tap × on a name to remove it.',
    ],
  },
  {
    id: '2026-11-13-product-photos',
    date: '2026-11-13',
    apps: ['sales', 'merch'],
    title: 'Product photos in Stock & Prices',
    items: [
      'Products in Stock & Prices now show a photo where we have one.',
      'Tap the photo to see it full size.',
    ],
  },
  {
    id: '2026-11-11-training-course',
    date: '2026-11-11',
    apps: ['merch'],
    title: 'Training course',
    items: [
      'A step-by-step course on using the app is now on your home screen under Training.',
      'Each module ends with a short quiz — answer every question correctly to mark it complete.',
    ],
  },
  {
    id: '2026-11-11-days-worked',
    date: '2026-11-11',
    apps: ['merch'],
    roles: ['tl'],
    title: 'Days Worked & Payroll',
    items: [
      'Team leaders: your TL screen now has Days Worked & Payroll.',
      'Check your team’s days for the fortnight and submit extra and relief days every Wednesday.',
    ],
  },
];

(function () {
  if (window.self !== window.top) return;

  var STORE_KEY = 'dfl_whats_new_seen';
  var FIRST_RUN_DAYS = 14;
  var SHOW_DELAY_MS = 700; // let the app paint its first screen first
  var shown = false;

  // Named audiences usable in an update's `roles`. Managers/admins are in
  // every group so they see what their staff were told.
  var ROLE_GROUPS = {
    tl: ['team_leader', 'tl_merch', 'manager', 'admin'],
    ba: ['merchandiser', 'relief_merchandiser', 'tl_merch', 'manager', 'admin'],
  };

  function roleMatches(roles, role) {
    if (!roles || !roles.length) return true;
    return roles.some(function (r) {
      return r === role || (ROLE_GROUPS[r] && ROLE_GROUPS[r].indexOf(role) !== -1);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readSeen() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw == null ? null : (JSON.parse(raw) || []);
    } catch (e) { return []; } // storage blocked: behave as "seen nothing new"
  }

  function writeSeen(ids) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(ids)); } catch (e) {}
  }

  function relevant(profile) {
    var app = window.DFL_SECTION;
    var role = profile && profile.role;
    return (window.DFL_UPDATES || []).filter(function (u) {
      if (!u || !u.id || (u.apps && u.apps.indexOf(app) === -1)) return false;
      return roleMatches(u.roles, role);
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  function daysAgo(dateStr) {
    var t = Date.parse(dateStr + 'T12:00:00');
    return isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
  }

  function fmtDate(dateStr) {
    var t = new Date(dateStr + 'T12:00:00');
    if (isNaN(t)) return '';
    return t.toLocaleDateString('en-JM', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function injectStyles() {
    if (document.getElementById('dflwn-styles')) return;
    var css =
      '.dflwn-back{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;animation:dflwn-fade .18s ease-out}' +
      '.dflwn-box{background:#ffffff;color:#1e293b;width:100%;max-width:420px;max-height:min(80vh,620px);display:flex;flex-direction:column;' +
        'border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden;animation:dflwn-pop .2s ease-out}' +
      '.dflwn-head{background:#0f2044;color:#ffffff;padding:18px 20px 16px}' +
      '.dflwn-kicker{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24;margin:0 0 4px}' +
      '.dflwn-title{font-size:20px;font-weight:700;margin:0;line-height:1.25}' +
      '.dflwn-body{padding:6px 20px 8px;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '.dflwn-item{padding:14px 0;border-bottom:1px solid #e2e8f0}' +
      '.dflwn-item:last-child{border-bottom:0}' +
      '.dflwn-item h3{font-size:16px;font-weight:700;margin:0 0 2px;color:#0f2044;line-height:1.3}' +
      '.dflwn-date{font-size:12px;color:#64748b;margin:0 0 8px}' +
      '.dflwn-item ul{margin:0;padding-left:18px}' +
      '.dflwn-item li{font-size:14px;line-height:1.45;margin:0 0 4px}' +
      '.dflwn-empty{font-size:14px;line-height:1.5;color:#64748b;margin:0;padding:18px 0}' +
      '.dflwn-foot{padding:12px 20px 16px;border-top:1px solid #e2e8f0}' +
      '.dflwn-btn{display:block;width:100%;border:0;border-radius:10px;background:#2563eb;color:#ffffff;font:inherit;font-size:16px;font-weight:700;' +
        'padding:13px 16px;cursor:pointer;min-height:48px}' +
      '.dflwn-btn:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}' +
      '@keyframes dflwn-fade{from{opacity:0}to{opacity:1}}' +
      '@keyframes dflwn-pop{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){.dflwn-back,.dflwn-box{animation:none}}';
    var el = document.createElement('style');
    el.id = 'dflwn-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function render(list, onClose) {
    injectStyles();
    var back = document.createElement('div');
    back.className = 'dflwn-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'dflwn-title');
    back.innerHTML =
      '<div class="dflwn-box">' +
        '<div class="dflwn-head"><p class="dflwn-kicker">App update</p>' +
          '<h2 class="dflwn-title" id="dflwn-title">What’s new</h2></div>' +
        '<div class="dflwn-body">' +
          list.map(function (u) {
            return '<div class="dflwn-item"><h3>' + esc(u.title) + '</h3>' +
              '<p class="dflwn-date">' + esc(fmtDate(u.date)) + '</p>' +
              '<ul>' + (u.items || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
          }).join('') +
          (list.length ? '' : '<p class="dflwn-empty">No new updates right now. Check back after the next app update.</p>') +
        '</div>' +
        '<div class="dflwn-foot"><button type="button" class="dflwn-btn">Got it</button></div>' +
      '</div>';

    function close() {
      document.removeEventListener('keydown', onKey);
      if (back.parentNode) back.parentNode.removeChild(back);
      if (onClose) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    back.querySelector('.dflwn-btn').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector('.dflwn-btn').focus();
  }

  function check(profile) {
    if (shown || !profile || profile.role === 'pending') return;
    var list = relevant(profile);
    if (!list.length) return;

    var seen = readSeen();
    if (seen === null) {
      // First time on this device: older notes count as already seen.
      seen = list.filter(function (u) { return daysAgo(u.date) > FIRST_RUN_DAYS; }).map(function (u) { return u.id; });
      writeSeen(seen);
    }
    var unseen = list.filter(function (u) { return seen.indexOf(u.id) === -1; });
    if (!unseen.length) return;

    shown = true;
    setTimeout(function () {
      render(unseen, function () {
        var ids = readSeen() || [];
        unseen.forEach(function (u) { if (ids.indexOf(u.id) === -1) ids.push(u.id); });
        writeSeen(ids);
      });
    }, SHOW_DELAY_MS);
  }

  window.DFL_WHATS_NEW = {
    // Re-show recent notes on demand (the "What's new" item in user-menu.js).
    // Ignores "seen", shows an empty state when there's nothing recent, and
    // marks what it showed as seen so the automatic popup won't repeat it.
    open: function () {
      var list = relevant(window.DFL_PROFILE).filter(function (u) { return daysAgo(u.date) <= 60; }).slice(0, 6);
      shown = true;
      render(list, function () {
        var ids = readSeen() || [];
        list.forEach(function (u) { if (ids.indexOf(u.id) === -1) ids.push(u.id); });
        writeSeen(ids);
      });
    },
    check: check,
  };

  if (window.DFL_PROFILE) {
    check(window.DFL_PROFILE);
  } else {
    document.addEventListener('dfl-auth-ready', function (e) {
      check(e.detail && e.detail.profile);
    });
  }
})();
