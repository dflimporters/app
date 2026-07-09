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
//       console.log(e.detail.profile); // { id, full_name, role, salesperson_id, active }
//     });
//
// STEP 4 — Wire any "Log out" link/button to the global logout()
// function this file defines:
//
//     <a href="#" onclick="logout()">Log out</a>
// ============================================================

(async function () {

  const LOGIN_PAGE = '/login.html';

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
    document.body.style.visibility = 'visible';
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
    .select('id, full_name, role, salesperson_id, active')
    .eq('id', user.id)
    .single();

  // No profile row (or the lookup errored) = not provisioned for the portal.
  if (profileError || !profile) {
    await sb.auth.signOut();
    goToLogin('not-provisioned');
    return;
  }

  // Deactivated staff member — treat the same as not provisioned.
  if (profile.active === false) {
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
