# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DFL Staff Portal — a static, no-build multi-page site for DFL Importers & Distributors (Decasseres Farms Limited), a Jamaican FMCG importer/distributor. Deployed to `dflhq.com` via GitHub Pages (see `CNAME`); the repo root **is** the site root, so there is no `/app/` prefix in URLs.

There is no `package.json`, no bundler, no framework and no test suite. Every page is a self-contained `.html` file with inline `<style>` and `<script>` tags. Backend is entirely Supabase (Postgres via PostgREST, Auth, Storage, occasionally Realtime). Project ref `hzagwndglwhcepsirafi`.

Mobile breakpoint is **640px** and it matters — most users are field staff on phones.

## Working locally / "running" the app

There is no build or dev-server command. `.claude/launch.json` defines a `dfl-portal` config that serves the repo root on port 3000 (`npx http-server . -p 3000 -c-1`); any static file server works. Do **not** open pages via `file://` — it breaks Supabase auth redirects, and every page uses root-relative paths (`/shared/...`) that only resolve when served from a root.

There is no lint or test command. Verify by loading the page and exercising the feature.

### Testing auth-gated pages without a session

Both `shared/auth-guard.js` and `shared/section-switcher.js` deliberately **no-op inside an iframe**. That gives you a way to exercise a guarded page locally: load it in an iframe, then drive it manually — dispatch a `dfl-auth-ready` CustomEvent with a fake profile, or call the page's own init function. Note `sb` is declared with `const` in a classic script, so it is a *lexical* binding, not a property of `window`: reach it with `frame.contentWindow.eval('sb')`, not `frame.contentWindow.sb`.

For database work, wrap test writes in a `DO $$ ... $$` block that `raise`s on every path — the exception aborts the block, so nothing persists whichever branch runs. To read back a row you just wrote as a non-owner role, `execute 'reset role'` first or RLS will hide it from you.

## Auth

Two sign-in paths, both landing on `/login.html`, which is also the OAuth callback receiver (supabase-js auto-detects tokens in the URL, so there is no separate callback page).

1. **Microsoft SSO** via Azure/Entra — office staff with a DFL email.
2. **Phone + SMS one-time code** — field staff, who mostly have no email address. `signInWithOtp` then `verifyOtp`. There is no password and no separate sign-up: an unrecognised number gets an account automatically (`shouldCreateUser` defaults true).

Azure redirect URI and the Supabase redirect allow-list are both configured for `https://dflhq.com/login.html`. Don't change them.

**SMS delivery needs a provider configured in Supabase.** Without one, only numbers in the dashboard's test-number list receive a code. A "not set up for that number" error is a provider problem, not a code problem.

### Provisioning: `handle_new_user()`

A trigger on `auth.users` insert creates the `profiles` row on first sign-in, in this order:

1. Email in `admin_emails` → role `admin`.
2. Email matches an **active** `reps` row → copy its role, `salesperson_id`, `rep_id`.
3. Phone matches an active `reps` row (both sides run through `normalize_jm_phone`) → same.
4. Phone signup with no match → **`role='pending'`, `active=false`**, parked on `/pending.html` until an admin approves.
5. Email signup with no match → **no profile at all**, treated as "not provisioned". Self-signup is phone-only by design.

`normalize_jm_phone` maps every plausible format to E.164 (`+1876…`/`+1658…`). This matters: Supabase stores `auth.users.phone` **without** a leading `+`, so comparing raw values would silently miss.

### Routing tables: `shared/routes.js`

**One table decides who can open what.** `DFL_PAGE_ROLES` maps path → allowed roles, and `DFL_HOME_BY_ROLE` maps role → landing page. The guard enforces the first, `login.html` uses both to validate `?redirect=`, and `side-nav.js` derives which links to draw from the first. Pure data plus `dflHome()` / `dflCanAccess()` / `dflRolesFor()` — no side effects, safe to load anywhere.

To change who can reach a page, edit that table. **A path not listed has no role restriction** (any signed-in, provisioned user), so a new guarded page is open to all roles until you add it.

This replaced four copies of the same knowledge — a per-page `PAGE_ALLOWED_ROLES`, a table in the guard, `roles:` on every nav item, and a `ROLE_LANDING` map in `login.html`. They drifted: `login.html`'s copy sent `warehouse` to `/index.html`, which rejects `warehouse`, so the guard bounced it back and the two ping-ponged forever behind a blank screen. Every merchandiser and team leader hit it via the bare domain, since `dflhq.com` serves `index.html`.

`routes.js` self-checks on load that every role's home accepts that role, and `console.error`s if not.

### The guard: `shared/auth-guard.js`

Usage contract — note there is **no per-page role list**:

```html
<style>body { visibility: hidden; }</style>          <!-- FIRST style rule -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/shared/supabase-client.js"></script>
<script src="/shared/routes.js"></script>
<script src="/shared/auth-guard.js"></script>
```

A rejected user goes to **their own** `dflHome()`, never a hardcoded page — and the guard never redirects to the page it's already on, showing an access-denied panel instead. That loop-breaker is what makes the bug above structurally impossible.

It fires `dfl-auth-ready` on success and exposes `window.DFL_PROFILE`:

```js
document.addEventListener('dfl-auth-ready', (e) => {
  const p = e.detail.profile;  // { id, full_name, role, salesperson_id, rep_id, active }
});
```

It also defines a global `logout()`. **Never define a second `logout()` on a page** — function declarations clobber each other silently, and you'd get a button that clears local state while the user stays signed in.

It no-ops when framed, on the assumption the parent already passed. Prefer simply *not* adding the guard to embedded-only pages (`rep-weekly-plan.html` has none).

### Roles and routing

Roles: `rep`, `manager`, `admin`, `merchandiser`, `team_leader`, `tl_merch`, `relief_merchandiser`, `warehouse`, `management`, `pending`. One role per person. `admin` and `manager` see the same things for now, except `/admin/**`, which is admin-only. `management` is a read-only executive role (Mark Decasseres, Heather Walker-Boyd, Kyle Decasseres) that only lands on the Morning Brief — it's not a superset or subset of `manager`.

| Role | Lands on | Sees Sales/Merch switcher |
|---|---|---|
| `rep` | `/index.html` | No |
| `merchandiser`, `team_leader`, `tl_merch`, `relief_merchandiser` | `/merch.html` | No |
| `manager`, `admin` | `/hub.html` | Yes |
| `warehouse` | `/warehouse.html` | No |
| `management` | `/morning-brief.html` | No |
| `pending` | `/pending.html` | No |

`login.html` honours `?redirect=` (set by the guard when it bounces someone) over role-based landing, and shows messages for `?reason=not-provisioned|inactive`.

## Pages

| Path | Roles | Notes |
|---|---|---|
| `/login.html` | — | Microsoft SSO + phone OTP; also the OAuth callback |
| `/index.html` | rep, manager, admin | Rep app ("My Numbers"). Bottom tab bar toggles `.hidden` sections; Plan/More tabs load other pages in **iframes** |
| `/merch.html` | merchandiser, team_leader, manager, admin | Merch field app — visits, shelf photos, OOS, stock counts |
| `/hub.html` | manager, admin | Landing page: section cards into both apps and the tools |
| `/pending.html` | pending | Holding page; lets them set their own name via `set_pending_name()` |
| `/admin/index.html` | admin | Admin landing |
| `/admin/approvals.html` | admin | Approve pending sign-ups |
| `/management/**` | manager, admin | Shell + 5 embedded dashboards, all individually guarded |
| `/morning-brief.html` | management, manager, admin | Standalone MTD sales dashboard; raw-fetch against `morning_brief_cache` with the anon key |
| `/specials.html`, `/specials-upload.html`, `/rep-weekly-plan.html`, `/field-intel.html` | varies | `rep-weekly-plan.html` is iframe-embedded and has no guard |

## Two parallel Supabase access patterns — check which one a page uses before editing

1. **Shared client** (`shared/supabase-client.js` + `auth-guard.js`): one `sb` client via `supabase.createClient()`, used through its fluent API (`sb.from(...)`, `sb.rpc(...)`, `sb.auth...`). Used by `login.html`, `pending.html`, `hub.html`, `admin/*.html`, `specials-upload.html`, and for auth on `index.html`.
2. **Raw fetch to PostgREST**: most other pages (all of `management/`, `index.html`'s own data calls, `rep-weekly-plan.html`, `specials.html`) declare their own `SUPABASE_URL`/key constants and call `fetch('${SB_URL}/rest/v1/<table>...')`. Constant names and even key *formats* differ per file — some use `sb_publishable_...`, others an older anon JWT.

`merch.html` is a hybrid worth understanding: it kept the raw-fetch idiom but renamed its helpers to `rest()` / `restRpc()`, which pull the **signed-in user's access token** from the shared client. So its requests arrive as role `authenticated`, not `anon`.

`grep` a page for `createClient(` vs an `SB_URL`/`H` fetch pattern before adding calls, and match what's there.

## Conventions and hard-won gotchas

1. **The client variable is `sb`, never `supabase`.** The CDN script creates a global named `supabase` (the library). A page-level `const sb` also collides with any local *function* named `sb` — that was a real bug in the merch app, and a duplicate declaration is a SyntaxError that blanks the whole page with no useful error.
2. **All paths are root-relative:** `/shared/auth-guard.js`, `/login.html`. Never `./`.
3. **`shared/` must NOT start with an underscore.** Jekyll excludes `_`-prefixed folders from the published site. `_staging/` keeps its underscore *on purpose*.
4. **`_staging/` is where un-migrated pages live** — physically out of the site root so they 404 rather than being merely unlinked. Moving a file back to root enables it.
5. **Watch for `const` collisions across `<script>` tags.** Everything shares one global scope. `rep-weekly-plan.html` had to rename its `SUPABASE_URL`/`SUPABASE_KEY` to `PLAN_SB_*` to coexist with the shared client.
6. **`revealPage()` must stay null-safe.** Head scripts run before `<body>` exists; the guard defers to `DOMContentLoaded`. Regressing this produces a blank page that looks like an auth failure.
7. **Beware name-based joins — still live.** `rep_dashboard_cache.salesperson` ↔ `reps.name`, `merchandiser_summary.merchandiser_name`, and the RPCs `get_merch_stores(p_name)` / `get_merch_store_perf(p_name, p_month)` all match on **name text**. A rename or typo breaks them silently, and a duplicate roster row orphans someone's data. Prefer ID joins for anything new.
8. **Legacy anon JWT keys remain in several files.** Both key types work today; consolidating is its own task, not a drive-by.
9. **DDL via `apply_migration`, not ad-hoc `execute_sql`.** After a migration error, verify against `pg_policies` / `pg_proc` directly — errors can mislead, and a migration may have applied despite reporting failure.
10. **Revoking `anon` needs to be explicit.** Supabase grants EXECUTE on public functions to `anon` and `authenticated` *directly*, so `revoke ... from public` does not remove it. Trigger functions like `handle_new_user` are a special case — Postgres refuses to call them directly (`0A000`), so an anon grant on those is unexploitable.
11. **Confirm destructive DB changes before executing.**

## Database

### Core identity

- **`profiles`** — `id` (→ `auth.users.id`), `full_name`, `role`, `active`, `salesperson_id`, `rep_id`. RLS: users read **only their own row**; there is **no client write path at all**. Anything an admin needs to read or change goes through a `SECURITY DEFINER` RPC.
- **`reps`** — the unified staff roster for *everyone*, not just reps: `id`, `name`, `salesperson_id` (unique, null for non-reps), `email`, `phone`, `area`, `role`, `active`, `initials`, `team_lead_id` (self-FK), `legacy_merch_id`, `pin`. Roughly 22 reps, 47 merchandisers, 4 team leaders, 4 managers.
  - **`reps` currently has RLS DISABLED** — the whole roster, including phone and email, is readable by anyone with the anon key. Known exposure, not yet addressed. New admin code should go through an RPC so it keeps working when this is closed.
  - `profiles.rep_id` → `reps(id)` is the canonical login↔roster link. It has a **partial unique index** (`WHERE rep_id IS NOT NULL`), so one roster row can back only one login.
  - `pin` is vestigial from retired PIN auth. Still `NOT NULL DEFAULT '0000'`, still displayed in the admin team list. Don't assume it's dead.
  - A rename to `staff` is deferred deliberately: 16 Postgres functions and every `/rest/v1/reps` call would have to change in the same deploy.
- **`admin_emails`** — the admin allow-list. RLS on, no policies.
- **`merch_app_users`** — superseded by `reps`, zero dependents, kept as a rollback snapshot. **Read-only. Do not write to it.**

### Admin RPCs (all `SECURITY DEFINER`, all re-check `is_dfl_admin()`)

- `is_dfl_admin()` — caller is an active admin
- `list_pending_signups()` — pending profiles + phone (read from `auth.users`, since `profiles` has no phone column)
- `list_linkable_reps()` — active roster rows not already linked, excluding `admin`/`pending`
- `list_staff_form_options()` — team leads and in-use areas for the create form
- `find_similar_reps(name)` — duplicate guard, `pg_trgm`; searches **all** roster rows including inactive and already-linked
- `approve_pending_user(user_id, rep_id)` — link an existing roster row
- `approve_and_create_staff(user_id, name, role, area, team_lead_id, salesperson_id)` — create a roster row and approve, in one transaction
- `set_pending_name(name)` — the only thing a pending user may write; touches `full_name` only, on their own row, only while `role='pending'`

**The role is always derived from the roster row, never sent by the client**, so `profiles.role` and `reps.role` cannot disagree — and neither approval path can mint an `admin`.

### Other tables in use

- **Rep app caches**: `rep_dashboard_cache`, `rep_customer_cache`, `rep_order_status_cache`, `rep_orders_cache`, `precall_cache`, `precall_budget_cache`, `budget_2026`, `key_skus`
- **Weekly plan**: `weekly_plans`
- **Category intel**: `cat_summary_cache`, `cat_rep_cache`, `cat_cust_cache`, `cat_cust_sku_cache`, `cat_sku_cache`, `cat_sku_cust_cache`, `cat_sku_area_cache`, `cat_sku_not_yet_cache`, `working_days_calendar`
- **Key accounts**: `kam_cust_cache`
- **Merch**: `merchandiser_summary`, `merchandiser_map`, `full_year_dashboard`, `merch_store_dashboard`, `store_targets_actual`, `monthly_actuals`, `merch_visit_log`, `merch_stock_reports`, `merch_stock_counts`, `merchandiser_evaluations`
- **Other**: `rep_followups`, `weekly_reports`, `stock_snapshots`, `specials`, `field_notes`, `rep_visit_log`, `location_test_pings`
- **Storage buckets**: `Assets` (public), `weekly-reports`, `shelf-photos`

Most `*_cache` / `*_summary` tables are precomputed. If a dashboard looks wrong, check whether the cache is stale before assuming the query is broken.

### RLS note for merch tables

`merch_visit_log`, `merch_stock_reports`, `merch_stock_counts`, `merchandiser_summary`, `merchandiser_map`, `store_targets_actual` and the `shelf-photos` bucket each carry **both** an `anon` policy (for the older raw-fetch dashboards) and an `authenticated` policy (for `merch.html`). Both are permissive (`USING true`) — they mirror the pre-existing posture rather than tightening it. Don't delete the `anon` ones; `management/` still depends on them.

`shelf-photos` has **no DELETE policy for any role**, so the merch app's "remove photo" silently fails and orphans the object. Pre-existing; fixing it properly needs ownership scoping.

## Auth is now uniform — one guard, one table

Every guarded page uses `shared/auth-guard.js` and takes its allow-list from `DFL_PAGE_ROLES` in `shared/routes.js`. There are no per-section auth mechanisms left.

- **`management/**`** — `manager`, `admin`. The old `MGMT_PASSWORD` hardcoded plaintext gate is gone, along with the gap it left: `management/index.html` still loads each dashboard in an iframe tab panel, but **all eight of those files now carry the guard themselves**, so they're protected when opened directly too. The guard no-ops when framed, so embedding still works.
- **`admin/**`** — `admin`.
- **`login.html`** loads `routes.js` only, never the guard — guarding the sign-in page would be circular.
- Genuinely unguarded, on purpose: `rep-weekly-plan.html` (iframe-embedded only) and `field-intel.html` (deliberately standalone).

**Don't add a new auth mechanism.** If a page needs different access, add it to `DFL_PAGE_ROLES`.

## No shared UI components

`shared/` holds five JS files (`supabase-client.js`, `routes.js`, `auth-guard.js`, `side-nav.js`, `section-switcher.js`) and **no CSS**. `side-nav.js` is the exception to the rule below — it renders the portal's left rail on every portal page, fully self-styled. The navy/blue palette, nav bar markup and mobile hamburger are copy-pasted independently into most pages with inconsistent exact values — the rep app is `--navy #0D1B3E` with Montserrat/Open Sans, the merch app `#1B2B5E` with a system stack, the portal pages `#0f2044` with Inter. Changing shared-looking UI means repeating the edit per page.

`shared/section-switcher.js` is the one exception and shows the pattern for future shared widgets: it renders the admin/manager Sales↔Merch control into every `[data-dfl-switcher]` mount, and sets **every** visual property explicitly — no `var()` lookups, no webfont dependency — precisely so it renders identically in two apps with different design tokens.

## `_staging/` is mixed — check which kind of file before touching it

- `*_legacy.html` (`index_legacy.html`, `rep-weekly-plan-form_legacy.html`, `specials-upload_legacy.html`) are superseded predecessors, reference only. `index_legacy.html` was the old portal homepage and is the ancestor of `hub.html`.
- The rest (`assets.html`, `dashboards.html`, `dfl-sales-dashboard.html`, `dfl-worldcup.html`, `dispatch-portal.html`, `forms.html`) are not-yet-deployed drafts. `hub.html` renders cards for four of them as disabled "Coming soon" tiles; to ship one, move the file to the repo root and turn its tile back into a link.

## Root-level experimental pages

`driver-broadcast.html` and `live-map-viewer.html` are feasibility tests, not wired into any nav, using anonymous clients (`persistSession:false`) against `location_test_pings` — plain inserts plus `postgres_changes` Realtime (not Supabase's broadcast feature, despite the filename), rendered with Leaflet. Treat as throwaway unless told otherwise.

## Key constants

```
Site                https://dflhq.com
Supabase URL        https://hzagwndglwhcepsirafi.supabase.co
Supabase project    hzagwndglwhcepsirafi
Publishable key     sb_publishable_5rAinfDT1K9kwEQnqYwlOA_-C5tk_6h
OAuth redirect      https://dflhq.com/login.html
Storage bucket      Assets (subfolders: specials/, brand/)
Logo (white)  https://hzagwndglwhcepsirafi.supabase.co/storage/v1/object/public/Assets/DFL%20Logo%20Blue_White.png
Logo (dark)   https://hzagwndglwhcepsirafi.supabase.co/storage/v1/object/public/Assets/DFL%20Logo%20Blue_Black.png
```

### Brand (portal pages)

```
Primary navy    #0f2044      Accent blue     #2563eb
Secondary navy  #1a3260      Accent bg       #eff6ff
Background      #f0f4f8      Gold (admin)    #fbbf24
Surface         #ffffff      Text            #1e293b
                             Muted text      #64748b
Font: Inter
```

The rep and merch apps use their own palettes and fonts intentionally. Unifying design tokens across all three front ends is an open team decision.

## Deployment

`main` is the published branch; pushing to it deploys to `dflhq.com`. **`main` is protected and requires a pull request** — direct pushes are rejected. Day-to-day work goes on `dev`.

`_config.yml` exists only to keep `CLAUDE.md` and the handoff brief out of the built site. Jekyll's `exclude` **replaces** its default list rather than extending it, which is why the defaults are restated there.

## Known issues / deferred (don't action without asking)

- **`reps` has RLS disabled** — whole roster readable with the anon key.
- **`shelf-photos` has no DELETE policy** — "remove photo" fails silently.
- **Name-keyed joins and RPCs** (gotcha 7) — the largest remaining source of silent breakage.
- **A newly created merchandiser has no stores.** Assignments live in `merchandiser_map` / `store_targets_actual`, keyed by name; creating a roster row grants access but leaves the app empty until those are added.
- **The AI voice-note summariser in `merch.html` is a disabled stub.** It called `api.anthropic.com` from the browser with no key. Re-enabling needs a Supabase Edge Function to hold the key server-side; plain Web Speech voice-to-text still works.
- **Service worker registration is commented out in `merch.html`** (`sw-merch.js` was never brought into the repo). Root `sw.js` is network-first and never populates its cache, so it is effectively a passthrough.
- **`REP_ZONES` / `REP_STORES`** in `rep-weekly-plan.html` are large hardcoded name-keyed JS objects, now stale. Fixing needs a real data model plus current territory assignments.
- **The weekly-plan rep dropdown** is fetched live from `reps`, but any logged-in user can still submit as any rep.
- **`field_notes`** has Acumatica sync columns, 0 rows, no owner. Candidate for deletion after confirmation.
- **`pin` column** is vestigial across `reps`.
- **Legacy anon JWTs** in several files (gotcha 8).
