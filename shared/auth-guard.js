// ============================================================
// DFL Staff Portal — Auth Guard
// ============================================================
// Include this on any page that requires a logged-in DFL staff
// member. On load, it:
//
//   1. Checks whether there's a logged-in Supabase session.
//      No session  -> redirect to login.html
//   2. Looks up that user's `profiles` row (role, name, etc).
//      No profile  -> not provisioned -> sign out, back to login.html
//      'pending'   -> awaiting admin approval -> pending.html (keeps session)
//      Inactive    -> same treatment as not provisioned
//   3. Checks the profile's role against this page's allow-list.
//      Not allowed -> redirect away from this page
//   4. Otherwise: reveals the page content and makes the profile
//      available to the rest of the page's own JS.
//
// ------------------------------------------------------------
// HOW TO USE THIS ON A PAGE
// ------------------------------------------------------------
//
// STEP 1 — In <head>, BEFORE any other <style> tag, hide the page
// by default. This has to be plain inline CSS (not something set
// by JS later) so there's no flash of content before we've
// confirmed the user is allowed to see it:
//
//     <style>body { visibility: hidden; }</style>
//
// STEP 2 — Set which roles are allowed on THIS page, then load the
// three scripts in order. This can go in <head> or right before
// </body> — doesn't matter, these are plain scripts, not modules:
//
//     <script>window.PAGE_ALLOWED_ROLES = ['admin', 'manager'];</script>
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="/shared/supabase-client.js"></script>
//     <script src="/shared/auth-guard.js"></script>
//
// If you skip setting PAGE_ALLOWED_ROLES, the guard defaults to
// "any logged-in, provisioned staff member" — admin, manager, or
// rep all pass, it just checks they're logged in and have a profile.
//
// STEP 3 — Once the guard passes, it fires a custom event so the
// page's own code can react (e.g. rep_app.html reading its rep's
// salesperson_id once we get to stripping out the PIN login):
//
//     document.addEventListener('dfl-auth-ready', (e) => {
//       console.log(e.detail.profile);
//       // { id, full_name, role, salesperson_id, rep_id, active }
//     });
//
// `rep_id` is the FK to this person's reps roster row — use it to look up
// their name/initials/area/team_lead_id. It can be null (e.g. an admin
// added via admin_emails with no roster row), so guard against that.
//
// STEP 4 — Wire any "Log out" link/button to the global logout()
// function this file defines:
//
//     <a href="#" onclick="logout()">Log out</a>
// ============================================================

(async function () {

  // If this page is running inside an iframe, the PARENT page has
  // already passed the auth guard — anyone who can see this frame is
  // already authenticated. Re-running the guard here is not only
  // redundant, it breaks: session lookup inside a frame can come back
  // empty (frame-scoped storage), making the guard wrongly redirect
  // the iframe to login.html and leaving the embed blank. So when
  // framed, reveal immediately and let the embedded page's own code run.
  if (window.self !== window.top) {
    revealPage();
    return;
  }

  const LOGIN_PAGE = '/login.html';
  const PENDING_PAGE = '/pending.html';

  // Where to send someone whose ROLE isn't allowed on this specific
  // page (they ARE logged in, just not permitted here). For now,
  // everyone gets bounced back to the main app.
  const NOT_ALLOWED_REDIRECT = '/index.html?denied=1';

  function goToLogin(reason) {
    const here = window.location.pathname + window.location.search;
    let url = `${LOGIN_PAGE}?redirect=${encodeURIComponent(here)}`;
    if (reason) url += `&reason=${encodeURIComponent(reason)}`;
    window.location.href = url;
  }

  function revealPage() {
    // Scripts loaded from <head> can run before <body> exists, so
    // document.body may be null here. If so, wait for it to parse.
    if (document.body) {
      document.body.style.visibility = 'visible';
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.style.visibility = 'visible';
      });
    }
  }

  // ---- 1. Is there a session at all? ----
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();

  if (sessionError || !sessionData || !sessionData.session) {
    goToLogin();
    return;
  }

  const user = sessionData.session.user;

  // ---- 2. Look up this user's profile row ----
  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('id, full_name, role, salesperson_id, rep_id, active')
    .eq('id', user.id)
    .single();

  // No profile row (or the lookup errored) = not provisioned for the portal.
  if (profileError || !profile) {
    await sb.auth.signOut();
    goToLogin('not-provisioned');
    return;
  }

  // ---- 2b. Awaiting admin approval ----
  // This MUST come before the active check below: a pending profile is
  // deliberately active = false, so the inactive branch would otherwise
  // sign them straight out instead of letting them reach the holding page.
  // They keep their session so /pending.html can read their profile and
  // let them submit their name.
  if (profile.role === 'pending') {
    // Already on the holding page — fall through so it can render.
    if (window.location.pathname !== PENDING_PAGE) {
      window.location.href = PENDING_PAGE;
      return;
    }
  } else if (profile.active === false) {
    // Deactivated staff member — treat the same as not provisioned.
    await sb.auth.signOut();
    goToLogin('inactive');
    return;
  }

  // ---- 3. Role check, if this page restricts roles ----
  const allowedRoles = window.PAGE_ALLOWED_ROLES; // e.g. ['admin','manager']
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    if (!allowedRoles.includes(profile.role)) {
      window.location.href = NOT_ALLOWED_REDIRECT;
      return;
    }
  }

  // ---- 4. All good — expose the profile, reveal the page ----
  window.DFL_PROFILE = profile;
  revealPage();
  document.dispatchEvent(new CustomEvent('dfl-auth-ready', { detail: { profile } }));

})();

// Global logout helper — wire this to any "Log out" link/button.
async function logout() {
  await sb.auth.signOut();
  window.location.href = '/login.html';
}

// ============================================================
// Where "Home" is, per role.
// ============================================================
// This is the SINGLE SOURCE OF TRUTH for the clickable DFL logo on every page,
// and it mirrors login.html's ROLE_LANDING (which decides where someone goes
// straight after signing in). If you change one, change the other — otherwise
// the logo sends people somewhere sign-in wouldn't.
//
// /shared/side-nav.js calls this for the rail's logo, and both apps call it for
// their header logos. It falls back to /hub.html when the role is unknown.
//
// Note: `warehouse` maps to /index.html to match login.html, but index.html's
// own PAGE_ALLOWED_ROLES does NOT include warehouse — so a warehouse user is
// bounced to /index.html?denied=1 and bounces again. Pre-existing; flagged, not
// fixed here, because changing it is an auth decision rather than a nav one.
const DFL_HOME_BY_ROLE = {
  rep:          '/index.html',
  warehouse:    '/index.html',
  merchandiser: '/merch.html',
  team_leader:  '/merch.html',
  manager:      '/hub.html',
  admin:        '/hub.html',
  pending:      '/pending.html'
};

function dflHome(profile) {
  const p = profile || window.DFL_PROFILE;
  const role = p && p.role;
  return (role && DFL_HOME_BY_ROLE[role]) || '/hub.html';
}
