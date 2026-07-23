# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DFL Staff Portal — a static, no-build multi-page site for DFL Importers & Distributors, deployed to `dflhq.com` (see `CNAME`). There is no `package.json`, no bundler, no framework, and no test suite. Every page is a self-contained `.html` file with inline `<style>` and `<script>` tags. Backend is entirely Supabase (Postgres via PostgREST, Auth, Storage, occasionally Realtime).

## Working locally / "running" the app

There is no build or dev-server command. To preview changes, serve the repo root with any static file server (e.g. `npx serve` or the VS Code Live Server extension) and open the page directly — opening via `file://` will break Supabase auth redirects and some fetch calls. There is no lint or test command to run after changes; verify by loading the page in a browser and exercising the feature.

## Architecture

### Two parallel Supabase access patterns — know which one a page uses before editing it

1. **Shared client** (`shared/supabase-client.js` + `shared/auth-guard.js`): creates one `sb` client via `supabase.createClient()` and uses its fluent API (`sb.from(...)`, `sb.storage.from(...)`, `sb.auth...`). Only a few pages use this end-to-end: `login.html`, `specials-upload.html`, and (for auth only) `index.html`.
2. **Raw fetch to PostgREST**: most pages (the entire `management/` folder, `index.html`'s own data calls, `rep-weekly-plan.html`, `specials.html`, `driver-broadcast.html`, `live-map-viewer.html`) hardcode their own `SUPABASE_URL`/anon-or-publishable key constants at the top of the `<script>` block and call `fetch('${SB_URL}/rest/v1/<table>...', {headers: H})` directly, bypassing supabase-js entirely. Key constant names and even key *formats* differ per file (some use the newer `sb_publishable_...` key, others an older anon JWT) — when adding a new table call to one of these pages, match that file's existing pattern rather than introducing the shared client.

When editing a page, `grep` it first for `createClient(` vs a `SB_URL`/`H` fetch-header pattern so new code matches what's already there.

### Auth is inconsistent by design across sections — check per page, don't assume

- **`shared/auth-guard.js`** is the real (Supabase session + `profiles` table role check) auth guard. Usage contract: set `window.PAGE_ALLOWED_ROLES = [...]` *before* loading it (omit for "any logged-in, active" staff), load the three scripts in order (`supabase-js` CDN → `shared/supabase-client.js` → `shared/auth-guard.js`), hide the page with an inline `<style>body{visibility:hidden}</style>` in `<head>` to avoid a flash of unauthenticated content, and listen for the `dfl-auth-ready` event to get `window.DFL_PROFILE`. It intentionally **no-ops when the page is loaded inside an iframe** (assumes the parent frame already passed the guard) — so an iframed child page should *not* re-include auth-guard.js itself (see `rep-weekly-plan.html`, which relies purely on being embedded inside `index.html`'s already-authenticated iframe and has no auth code of its own).
- **`management/index.html`** is gated by a hardcoded client-side password (`MGMT_PASSWORD` in plaintext JS) — a completely separate, much weaker mechanism than the Supabase auth-guard. It then loads each `management/*.html` file in an iframe tab panel. Individual `management/*.html` files have **no auth of their own** (with one inconsistent exception: `report-viewer.html` has its own separate password prompt) — they trust they're only ever reached through that iframe gate. Don't assume a `management/*.html` file is protected if opened directly by URL — it isn't.
- **`admin/index.html`** is currently just a "coming soon" placeholder with no real functionality.
- Only extend a page's protection by following whichever of these two patterns that section already uses — don't mix them on one page.

### `index.html` is the main rep-facing SPA ("My Numbers")

Bottom tab bar (Home / Customers / Plan / Admin / More) toggles `.hidden` sections in one page rather than navigating. The "Plan" tab and the "More" tab load other top-level pages (`rep-weekly-plan.html`, `specials.html`, `specials-upload.html`) inside iframes — this is the site's composition mechanism in place of client routing or shared components. PIN-based login was previously used for the rep app; it was replaced by the Microsoft/Azure OAuth + `profiles`-table flow in `login.html`/`auth-guard.js`, but the `reps.pin` column and its display in the admin team list are still present — don't assume `pin` is dead just because PIN *auth* was removed.

### No shared UI components

`shared/` only contains the two auth/data JS files above — there is no shared CSS file and no shared nav/component module. The navy/blue color scheme (`--navy`, `--accent`, etc. CSS custom properties), the top nav bar markup, and the mobile hamburger menu are copy-pasted independently into most pages with inconsistent exact values. When changing shared-looking UI (e.g. the nav bar), expect to repeat the edit across every page that has it, not just one source file.

### `_staging/` is mixed — check which kind of file before touching it

- `*_legacy.html` files (`index_legacy.html`, `rep-weekly-plan-form_legacy.html`, `specials-upload_legacy.html`) are superseded predecessors of current root pages — reference only, not linked anywhere live.
- The rest (`assets.html`, `dashboards.html`, `dfl-sales-dashboard.html`, `dfl-worldcup.html`, `dispatch-portal.html`, `forms.html`) are not-yet-deployed drafts. Notably, both `admin/index.html` and `management/index.html` already link to `/dispatch-portal.html`, `/dashboards.html`, `/forms.html`, and `/assets.html` at the **root** — those root files don't exist yet (only the `_staging/` copies do), so those nav links currently 404 in production. When one of these pages is ready to ship, it moves from `_staging/` to the repo root under the same filename referenced by the existing nav links.

### Root-level experimental pages

`driver-broadcast.html` and `live-map-viewer.html` are explicitly marked as feasibility tests (not wired into any nav), using anonymous Supabase clients (`persistSession:false`) against a `location_test_pings` table — plain Postgres inserts + `postgres_changes` Realtime subscriptions (not Supabase's ephemeral broadcast feature, despite the filename), rendered with Leaflet. Treat these as throwaway/experimental unless told otherwise.

### Supabase entities in use (for reference when writing queries)

- **Auth/roster**: `profiles`, `reps`
- **Rep app caches**: `rep_dashboard_cache`, `rep_customer_cache`, `rep_order_status_cache`, `rep_orders_cache`, `precall_cache`, `precall_budget_cache`, `budget_2026`, `key_skus`
- **Weekly plan**: `weekly_plans`
- **Category intel**: `cat_summary_cache`, `cat_rep_cache`, `cat_cust_cache`, `cat_cust_sku_cache`, `cat_sku_cache`, `cat_sku_cust_cache`, `cat_sku_area_cache`, `cat_sku_not_yet_cache`, `working_days_calendar`
- **Key account management**: `kam_cust_cache` (plus reuses several `cat_*` tables above)
- **Merch**: `merchandiser_summary`, `full_year_dashboard`, `merch_store_dashboard`, `store_targets_actual`, `monthly_actuals`
- **Rep performance**: `rep_followups`
- **Reports**: `weekly_reports`
- **Stock**: `stock_snapshots`
- **Specials**: `specials`
- **Realtime tracking test**: `location_test_pings`
- **Dispatch (staging only)**: `delivery_jobs`, `delivery_batches`
- **RPCs**: `refresh_current_month`, `get_sales_by_sku`, `get_q` (staging only)
- **Storage buckets**: `Assets` (public — logos/images), `weekly-reports` (report-viewer uploads)

Most of these are precomputed cache/summary tables read by dashboards rather than raw transactional tables — if a dashboard looks wrong, check whether the cache table is stale before assuming the query is broken.
