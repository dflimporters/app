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
// STEP 2 — Load the scripts in this order. They're plain scripts,
// not modules, so <head> or just before </body> both work:
//
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="/shared/supabase-client.js"></script>
//     <script src="/shared/routes.js"></script>
//     <script src="/shared/auth-guard.js"></script>
//
// Pages do NOT declare which roles may open them. That used to be a
// per-page window.PAGE_ALLOWED_ROLES, which meant the same fact was
// written in two places and could disagree — and when it did, the
// result was an infinite redirect loop. The allow-list now comes from
// DFL_PAGE_ROLES in /shared/routes.js, keyed by path.
//
// To change who can open a page, edit that table. A page whose path
// isn't in the table has no role restriction: any logged-in,
// provisioned staff member passes.
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

// ============================================================
// ROUTING TABLES live in /shared/routes.js
// ============================================================
// DFL_HOME_BY_ROLE, DFL_PAGE_ROLES, dflHome(), dflCanAccess(), dflRolesFor()
// and dflNormalisePath() all come from there. Load it BEFORE this file:
//
//     <script src="/shared/routes.js"></script>
//     <script src="/shared/auth-guard.js"></script>
//
// They were briefly defined in this file, but side-nav.js and login.html need
// them too and neither always loads the guard — so they moved somewhere both
// can reach without dragging the guard's side effects along.
// Terminal state for "you can't be here, and your home is here too". Reached
// only on a config mismatch — but it must exist, because the alternative is the
// redirect loop this file was fixed for. Self-contained styling (no var(), no
// webfont) so it renders the same on any page, same rule as side-nav.js.
function showAccessDenied(profile) {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:24px', 'margin:0', 'box-sizing:border-box',
    'background:#0f2044', 'color:#ffffff',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = 'max-width:380px;width:100%;text-align:center;box-sizing:border-box';

  const h = document.createElement('div');
  h.textContent = 'No access to this page';
  h.style.cssText = 'font-size:19px;font-weight:700;margin:0 0 10px;line-height:1.3';

  const p = document.createElement('div');
  p.textContent = 'Your account (' + ((profile && profile.role) || 'unknown role') +
    ") isn't set up to open this page, and it's also where you'd normally land. " +
    'Please contact an admin.';
  p.style.cssText = 'font-size:13.5px;line-height:1.6;color:rgba(255,255,255,0.7);margin:0 0 22px';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Sign out';
  btn.style.cssText = [
    'appearance:none', '-webkit-appearance:none', 'display:inline-block',
    'padding:10px 22px', 'margin:0', 'border:1px solid rgba(255,255,255,0.35)',
    'border-radius:8px', 'background:transparent', 'color:#ffffff',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    'font-size:13px', 'font-weight:600', 'line-height:1', 'cursor:pointer'
  ].join(';');
  btn.addEventListener('click', function () { logout(); });

  box.appendChild(h); box.appendChild(p); box.appendChild(btn);
  panel.appendChild(box);
  document.body.appendChild(panel);
  document.body.style.visibility = 'visible';
}

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
  // A signed-in merchandiser's tab can get killed and reloaded by the OS mid
  // task (the native camera app backgrounding the page during a shelf photo,
  // or the tab merely sitting behind a phone call, are the reliable ways to
  // trigger this), and immediately after a fresh reload the very first
  // getSession() call has occasionally come back empty even though the
  // session is sitting right there in localStorage — a one-time init race,
  // not an actual sign-out. A single 400ms retry wasn't always enough on
  // slower/low-RAM devices recovering from an OS-level tab kill (reports of
  // being kicked to login right after finishing a store or submitting a
  // photo), so this retries a few times with backoff. Costs nothing for a
  // real sign-out (still lands on login a couple seconds later) but gives a
  // real session more chances to catch up before being treated as gone.
  async function getSessionWithRetry() {
    const delays = [300, 600, 1000];
    let last = await sb.auth.getSession();
    if (last.data && last.data.session) return last;
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      last = await sb.auth.getSession();
      if (last.data && last.data.session) return last;
    }
    return last;
  }
  const { data: sessionData, error: sessionError } = await getSessionWithRetry();

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
  //
  // This used to redirect every rejected user to a hardcoded
  // '/index.html?denied=1'. That page only accepts admin/manager/rep, so a
  // merchandiser, team_leader or warehouse user was sent to a page that
  // rejected them, which redirected them to the same page again — an infinite,
  // silent loop behind a blank screen (body starts visibility:hidden). It hit
  // anyone who reached the site via the bare domain, since dflhq.com serves
  // index.html.
  //
  // Two changes: send people to THEIR OWN home, and never redirect to the page
  // we're already on. The second is the part that makes a loop structurally
  // impossible, even if the tables above are later misconfigured.
  // The allow-list comes from DFL_PAGE_ROLES in /shared/routes.js, keyed by
  // this page's path — pages no longer declare their own. That removes the
  // possibility of a page and the routing table disagreeing, which is what
  // produced the loop in the first place. A path that isn't in the table has
  // no role restriction.
  const allowedRoles = dflRolesFor(window.location.pathname);
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    if (!allowedRoles.includes(profile.role)) {
      const home = dflHome(profile);
      const here = dflNormalisePath(window.location.pathname);

      if (dflNormalisePath(home) === here) {
        // Their own home rejects them — a config mismatch between this page's
        // PAGE_ALLOWED_ROLES and DFL_HOME_BY_ROLE. Redirecting is exactly what
        // caused the original bug, so stop and say so instead.
        showAccessDenied(profile);
        return;
      }

      window.location.href = home;
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

// The routing tables and dflHome()/dflCanAccess() now live at the TOP of this
// file — they have to be defined before the guard IIFE that uses them.
