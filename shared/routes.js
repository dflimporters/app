// ============================================================
// DFL Staff Portal — Routes
// ============================================================
// THE single source of truth for "who is allowed where" and "where does each
// role belong". Pure data and pure functions — no side effects, no network, no
// DOM. Safe to load on any page, guarded or not.
//
// ------------------------------------------------------------
// WHY THIS FILE EXISTS
// ------------------------------------------------------------
// This knowledge used to live in FOUR places at once:
//
//   1. window.PAGE_ALLOWED_ROLES, declared separately on every page
//   2. a page-roles table inside auth-guard.js
//   3. a `roles:` list on every nav item in side-nav.js
//   4. a role -> landing map duplicated in login.html
//
// They drifted, and the drift caused a real outage: login.html's copy sent
// `warehouse` to /index.html, a page that rejects `warehouse`. The guard
// bounced them back, login sent them again, and the two ping-ponged forever
// behind a blank screen. Every merchandiser and team leader hit the same thing
// via the bare domain, because dflhq.com serves index.html.
//
// One table now. If a page's access rules change, they change HERE, once, and
// the guard, the sign-in redirect and the nav all follow automatically.
//
// ------------------------------------------------------------
// HOW TO USE IT
// ------------------------------------------------------------
// Load it BEFORE auth-guard.js and/or side-nav.js:
//
//     <script src="/shared/routes.js"></script>
//     <script src="/shared/auth-guard.js"></script>
//
// Pages do NOT declare their own allow-list any more. To change who can open a
// page, edit DFL_PAGE_ROLES below.
// ============================================================

// Every role the portal knows about. `pending` is the pre-approval holding
// state; the rest come from reps.role.
const DFL_ROLES = [
  'rep', 'merchandiser', 'team_leader', 'tl_merch', 'manager', 'admin', 'warehouse', 'pending',
  'relief_merchandiser'
];

// ------------------------------------------------------------
// Where each role belongs when it has nowhere more specific to be.
// Used for post-sign-in landing, the clickable logo, and as the destination
// when the guard turns someone away.
// ------------------------------------------------------------
// INVARIANT: every value here MUST accept its own key in DFL_PAGE_ROLES below.
// If a role's home rejects that role, you get an infinite redirect loop. That
// is not hypothetical — it is exactly the bug this file was created to kill.
// There's a self-check at the bottom that shouts in the console if it breaks.
const DFL_HOME_BY_ROLE = {
  rep:          '/index.html',
  merchandiser: '/merch.html',
  team_leader:  '/merch.html',
  tl_merch:     '/merch.html',
  manager:      '/hub.html',
  admin:        '/hub.html',
  warehouse:    '/warehouse.html',
  pending:      '/pending.html',
  relief_merchandiser: '/merch.html'
};

// ------------------------------------------------------------
// Who can open each page.
// ------------------------------------------------------------
// A path that is NOT listed here has no role restriction — any signed-in,
// provisioned staff member can open it. That means a NEW guarded page is open
// to all roles until you add it here.
const DFL_PAGE_ROLES = {
  '/index.html':           ['admin', 'manager', 'rep'],
  '/merch.html':           ['merchandiser', 'team_leader', 'tl_merch', 'manager', 'admin', 'relief_merchandiser'],
  '/hub.html':             ['manager', 'admin'],
  '/warehouse.html':       ['warehouse', 'manager', 'admin'],
  '/admin/index.html':     ['admin'],
  '/admin/approvals.html': ['admin'],
  '/specials-upload.html': ['admin', 'manager'],
  '/specials.html':        ['admin', 'manager', 'rep', 'merchandiser', 'team_leader', 'tl_merch', 'warehouse', 'relief_merchandiser'],
  '/pending.html':         ['pending'],
  '/budget-explorer.html': ['manager', 'admin'],

  // ---- Management ----
  // These used to sit behind a hardcoded plaintext password in
  // management/index.html (MGMT_PASSWORD), while the eight dashboards it embeds
  // had no protection at all and were readable by anyone who guessed the URL.
  // The password is gone; being a signed-in manager or admin IS the gate now.
  // Every child is listed, not just the shell, because each is a real page that
  // can be opened directly.
  '/management/index.html':                 ['manager', 'admin'],
  '/management/category-intel.html':        ['manager', 'admin'],
  '/management/key-account-management.html':['manager', 'admin'],
  '/management/merch-dashboard.html':       ['manager', 'admin'],
  '/management/rep-performance.html':       ['manager', 'admin'],
  '/management/stock-outage-tracker.html':  ['manager', 'admin'],
  '/management/report-upload.html':         ['manager', 'admin'],
  '/management/report-viewer.html':         ['manager', 'admin']
};

// '/', '/foo/' and '/foo/index.html' all name the same page. Query strings and
// hashes are stripped so '/index.html?denied=1' matches '/index.html'.
function dflNormalisePath(path) {
  let p = (path || '/').split('?')[0].split('#')[0];
  if (p === '' || p === '/') return '/index.html';
  if (p.charAt(p.length - 1) === '/') p += 'index.html';
  return p;
}

// Where should this person go? Accepts a profile object or nothing (in which
// case it reads window.DFL_PROFILE).
function dflHome(profile) {
  const p = profile || window.DFL_PROFILE;
  const role = p && p.role;
  return (role && DFL_HOME_BY_ROLE[role]) || '/hub.html';
}

// Can `role` open `path`? Unlisted paths are permitted — see the note above.
function dflCanAccess(role, path) {
  const allowed = DFL_PAGE_ROLES[dflNormalisePath(path)];
  if (!allowed) return true;
  return allowed.indexOf(role) !== -1;
}

// The allow-list for a page, or null when it isn't restricted.
function dflRolesFor(path) {
  return DFL_PAGE_ROLES[dflNormalisePath(path)] || null;
}

// ------------------------------------------------------------
// Self-check: every role's home must accept that role.
// ------------------------------------------------------------
// Cheap insurance against re-introducing the redirect loop. Console-only — it
// must never break a page for a real user, it just makes the mistake loud the
// first time anyone loads the site after a bad edit.
(function () {
  Object.keys(DFL_HOME_BY_ROLE).forEach(function (role) {
    const home = DFL_HOME_BY_ROLE[role];
    if (!dflCanAccess(role, home)) {
      console.error(
        '[DFL routes] BROKEN INVARIANT: role "' + role + '" is sent home to ' +
        home + ', but that page does not accept "' + role + '". ' +
        'This is the redirect-loop bug. Fix DFL_HOME_BY_ROLE or DFL_PAGE_ROLES ' +
        'in /shared/routes.js.'
      );
    }
  });
})();
