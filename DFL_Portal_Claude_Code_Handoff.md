# DFL Staff Portal — Handoff Brief for Claude Code

Paste this as your opening message in Claude Code, run from the repo root.

---

## 1. Project context

**DFL Staff Portal** — internal web app for DFL Importers (Decasseres Farms Limited), a Jamaican FMCG importer/distributor.

- **Stack:** plain HTML/CSS/JS. No frameworks, no build step, no bundler. Plain `<script>` tags only (not ES modules).
- **Hosting:** GitHub Pages, custom domain **https://dflhq.com** (repo root is the site root — there is no `/app/` prefix).
- **Backend:** Supabase (Postgres + Storage + Auth). Project ID `hzagwndglwhcepsirafi`.
- **Local dev:** VS Code + Live Server.
- **Mobile breakpoint:** 640px. Mobile-first matters — most users are field staff on phones.

**I'm Joel.** I handle backend, database, security, auth, and portal administration. I'm still learning HTML/CSS/JS, so explain new concepts as they come up rather than assuming. Work step by step and tell me what you're changing and why — don't make twenty changes at once.

### Team
| Person | Focus |
|---|---|
| **Joel** (me) | Backend, DB, security, auth, portal admin |
| **Scott** | Rep-focused + sales-management front ends |
| **Travis** | Merchandiser-focused front ends, fleet |

All three of us share one GitHub repo. We're mid-migration to a proper branch + pull request workflow (I'm setting that up separately). Scott and Travis have historically committed straight to `main`, which has caused overwrites. **Please work on branches, not `main`.**

---

## 2. Auth — what's already built and working

Microsoft SSO via Azure/Entra, wired through Supabase Auth. Fully deployed and tested.

- **`/login.html`** — the SSO entry point *and* the OAuth callback receiver (supabase-js auto-detects tokens in the URL, so no separate callback page). Currently sends **everyone** to `/index.html` after login. This needs to become role-aware (see Task 2).
- **`/shared/supabase-client.js`** — creates the single Supabase client, named **`sb`**.
- **`/shared/auth-guard.js`** — reusable session + role checker.
- **`/index.html`** — the rep app (formerly `rep_app.html`). PIN login stripped, now uses the auth guard.
- **`/rep-weekly-plan.html`** — weekly plan form, loaded via iframe inside `index.html`. **No guard on it deliberately** (see Conventions).
- Azure redirect URI and Supabase redirect allow-list are both configured for `https://dflhq.com/login.html`. Don't change these.

### How the guard is used on a page
```html
<!-- 1. In <head>, BEFORE any other <style>: -->
<style>body { visibility: hidden; }</style>

<!-- 2. Roles allowed on THIS page, then the three scripts in order: -->
<script>window.PAGE_ALLOWED_ROLES = ['admin', 'manager'];</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/shared/supabase-client.js"></script>
<script src="/shared/auth-guard.js"></script>
```

The guard fires a `dfl-auth-ready` event when it passes, and exposes `window.DFL_PROFILE`:
```js
document.addEventListener('dfl-auth-ready', (e) => {
  const p = e.detail.profile; // { id, full_name, role, salesperson_id, active }
});
```
It also defines a global `logout()`.

### Provisioning model
A DB trigger `on_auth_user_created` → `handle_new_user()` creates the `profiles` row on someone's **first** sign-in:
1. Email in `admin_emails` → role `admin`, `salesperson_id` null.
2. Else email matches an **active** `reps` row → copies that row's `role` and `salesperson_id`.
3. Else no profile is created → guard treats it as "not provisioned", signs them out, shows a message.

So today, people must exist in `reps` (or `admin_emails`) **before** first login.

---

## 3. Database state (current, verified)

### `reps` — the unified staff table
This used to be reps-only. It now holds **everyone**. (A rename to something like `staff` is deferred — see Deferred Items. Do not rename it as part of any task below.)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | |
| `salesperson_id` | text UNIQUE, nullable | ERP code. Null for non-reps. Multiple nulls OK. |
| `email` | text, nullable | |
| `phone` | text, nullable | Empty for all merch staff currently |
| `area` | text, nullable | Territory. Merch `territory` was migrated into this. |
| `role` | text | CHECK: `rep`, `manager`, `admin`, `merchandiser`, `team_leader`, `warehouse`, `pending` |
| `pin` | text NOT NULL | Default `'0000'`. **Vestigial** — from retired PIN auth. |
| `active` | boolean | Default true |
| `initials` | text, nullable | Cosmetic avatar text for the merch app header |
| `team_lead_id` | uuid, nullable | Self-FK → `reps(id)`. Replaced free-text `team_lead`. |
| `legacy_merch_id` | bigint, unique | Old `merch_app_users.id`. Migration mapping — keep it. |
| `created_at` | timestamptz | |

**Current counts:** 22 reps (20 active), 47 merchandisers, 4 team_leaders, 4 managers, 2 admins.

**Depends on `reps`:** `field_notes.rep_id`, `rep_visit_log.rep_id`, `merch_visit_log.user_id`, `merch_stock_reports.user_id`, `profiles.salesperson_id`, plus **16 Postgres functions** (`get_rep_performance`, `get_rep_merch_activity`, `refresh_rep_dashboard`, `get_q2_leaderboard`, etc.) and every front-end `fetch('/rest/v1/reps?...')` call.

### `profiles` — auth identity
`id` (uuid → `auth.users.id`), `full_name`, `role` (same CHECK as `reps`), `active`, `salesperson_id` (→ `reps.salesperson_id`), `created_at`. RLS on: users can read **only their own row**. No client-side write path.

### Recently completed migration (this is done — context only)
`merch_app_users` was folded into `reps`:
- 52 merch rows copied in (47 merchandisers, 4 team leaders, 1 admin — Travis).
- Oniel Carby existed in **both** tables. He was recently **promoted to sales rep**, so his single `reps` row stays `role='rep'`; he is no longer a team leader. His one merchandiser (Abina Clarke) was reassigned to Susan Blair.
- `team_lead` free-text → `team_lead_id` uuid FK. All 5 teams resolved correctly (11, 11, 15, 10, 0).
- `merch_visit_log.user_id` and `merch_stock_reports.user_id` converted from `bigint` → `uuid`, now FK to `reps(id)`, remapped via `legacy_merch_id`. All 4 existing test rows preserved.
- Both `reps.role` and `profiles.role` CHECK constraints widened.

**`merch_app_users` still exists but has zero dependents.** It's being kept as a read-only snapshot / rollback until the new merch front end works. **Treat it as read-only. Do not write to it. `reps` is the source of truth.** Drop it only once the new merch app is confirmed working.

---

## 4. Conventions and hard-won gotchas

Please respect all of these — each one cost real debugging time.

1. **Client variable is `sb`, never `supabase`.** The supabase-js CDN script creates a global named `supabase` (the library). Naming our client `supabase` too causes a silent `const` redeclaration failure with no error message.

2. **All paths are root-relative:** `/shared/auth-guard.js`, `/login.html`, `/index.html`. There is no `/app/` prefix.

3. **`shared/` must NOT start with an underscore.** GitHub Pages runs Jekyll, which excludes `_`-prefixed folders from the published site. `_staging/` keeps its underscore *on purpose* (that's how disabled pages are hidden).

4. **`_staging/` is where un-migrated pages live.** Pages not yet fitted with the auth guard are physically moved out of the site root so they 404 rather than being merely unlinked. Moving a page back into root = enabling it. Currently staged: `assets.html`, `dashboards.html`, `dfl-sales-dashboard.html`, `dfl-worldcup.html`, `dispatch-portal.html`, `forms.html`, `specials.html`, `specials-upload.html`, `auth-test.html`, `sso-test.html`, `admin/`, `management/`, `index-root.html`.

5. **Iframe-embedded pages do not get the auth guard.** They inherit the parent page's protection. `rep-weekly-plan.html` deliberately has no guard for this reason. `auth-guard.js` also no-ops when framed (`window.self !== window.top`) as a safety net, but prefer just not adding the guard to embedded-only pages.

6. **`revealPage()` must be null-safe.** Scripts loaded from `<head>` run before `<body>` exists, so `document.body` can be null. The guard defers to `DOMContentLoaded` if so. Don't regress this — it caused a fully blank page that looked like an auth failure.

7. **Watch for `const` collisions across `<script>` tags.** Everything shares one global scope. `rep-weekly-plan.html` had to rename its local `SUPABASE_URL`/`SUPABASE_KEY` to `PLAN_SB_URL`/`PLAN_SB_KEY` to coexist with the shared client. Check for this whenever adding the shared scripts to an existing page.

8. **Legacy anon JWT keys are still in some files.** Several pages do raw `fetch()` with an old-style anon JWT instead of using `sb`. Both key types work today, but this should eventually be consolidated onto the shared `sb` client and the publishable key. Don't do it as a drive-by; it's its own task.

9. **DDL via migrations, not ad-hoc SQL.** Use `apply_migration` for schema/policy changes so history is preserved; plain `execute_sql` for reads. After a migration error, verify against `pg_policies` / `pg_constraint` directly — errors can be misleading (a migration may have applied despite reporting failure).

10. **Confirm destructive DB changes with me before executing.**

11. **Beware name-based joins.** Several existing joins match on plain text names (`rep_dashboard_cache.salesperson` ↔ `reps.name`, and the old merch `team_lead`). These break silently on a typo or rename. Prefer ID-based joins for anything new.

---

## 5. Design decisions already made

- **Roles:** `rep`, `manager`, `admin`, `merchandiser`, `team_leader`, `warehouse`, `pending`. All distinct. A person holds exactly **one** role — no dual roles.
- **`admin` and `manager` see the same things for now.** They diverge later when a real admin panel gets built. Use `['manager','admin']` wherever both belong.
- **Navigation shape: hub page + switcher inside.** Admins/managers land on a hub of section cards; once inside a section they get a header control to jump between Sales and Merchandising without returning to the hub. Reps/merchandisers never see either — they go straight to their own app.
- **New merch file name: `merch.html`** at the repo root.
- **New-user auth for field staff: phone + password, no SMS/OTP.** Supabase phone signup with confirmations disabled. This means Supabase cannot verify the person owns the number — **admin approval is the only identity check, by design, and I've accepted that.**
- **Self-signup + admin approval flow:** a new phone signup with no matching `reps` row gets `role='pending'`, `active=false`, is asked for their name, and is parked on a holding page until an admin approves them.

### Role → landing routing (target state)
| Role | Lands on | Sees switcher? |
|---|---|---|
| `rep` | `/index.html` (rep app) | No |
| `merchandiser` | `/merch.html` | No |
| `team_leader` | `/merch.html` (team view) | No |
| `manager` | Hub | Yes |
| `admin` | Hub | Yes |
| `warehouse` | Warehouse app (future) | No |
| `pending` | `/pending.html` | No |

### Page role allow-lists (target state)
- `/index.html` → `['rep','manager','admin']`
- `/merch.html` → `['merchandiser','team_leader','manager','admin']`
- Hub → `['manager','admin']`
- `/pending.html` → `['pending']`

---

## 6. Tasks — in dependency order

### Task 1 — Migrate the merch app (biggest piece; do this first)
The merch app arrives as a standalone file from Travis's separate EdgeOne deployment. It is **not in production** — only Travis has been testing it — but it reads/writes the live database. Bring it into the repo as **`/merch.html`**.

What it currently does that must change:
- **Has its own PIN login** (a `merch_app_users` PIN lookup with the anon key, no Supabase Auth session at all). Strip it out entirely — same operation already done on the rep app.
- **Queries `merch_app_users`** for login and for the team roster. Repoint everything to `reps`.
- **Team roster uses free-text name matching:** `merch_app_users?team_lead=eq.<leader's full name>&role=eq.merchandiser&active=eq.true`. Replace with the `team_lead_id` FK.
- **Has a "PIN Directory" admin screen** for sharing PIN codes. PINs are dead under the new auth — remove or repurpose this.
- Needs the standard repo treatment: root-relative paths, shared `sb` client, auth guard, `PAGE_ALLOWED_ROLES`, and a check for `const` name collisions (gotcha #7).

Identity should come from `window.DFL_PROFILE` (via `dfl-auth-ready`), with `reps` supplying `name`, `initials`, `area`, and `team_lead_id`.

Note: `merch_visit_log.user_id` and `merch_stock_reports.user_id` are now **uuid** FKs to `reps(id)`. The app's insert code still sends the old bigint ids and **will fail** until updated.

Also worth reading before building: the existing Postgres function **`get_rep_merch_activity`** — there may already be merchandiser logic server-side that shouldn't be duplicated client-side.

### Task 2 — Role-aware routing in `login.html`
Replace the current "everyone → `/index.html`" with the routing table in section 5. Keep the existing `?redirect=` support (the guard uses it to send people back to the page they originally wanted) and the existing `?reason=` messages (`not-provisioned`, `inactive`). Add handling for `pending`.

### Task 3 — Hub page
`index-root.html` in `_staging` is the old portal homepage (section cards: Specials, Assets, Forms, Dashboards, Management, Dispatch). Revive it as the admin/manager hub rather than building from scratch. Add **Sales** and **Merchandising** cards; filter cards by role; guard it with `['manager','admin']`. Decide with me whether it stays `index-root.html` or gets a clearer name — note `/index.html` is already the rep app, so it can't be `index.html`.

### Task 4 — The section switcher
A small header control, rendered **only** when `DFL_PROFILE.role` is `admin` or `manager`, that flips between `/index.html` and `/merch.html`. Goes in both apps. Keep it visually consistent with existing headers and mobile-safe. Nothing changes for other roles.

### Task 5 — Phone + password signup, pending state, approval
1. Enable Supabase phone auth with confirmations off (I'll do the dashboard config).
2. Add a phone + password sign-up/sign-in path to `login.html` alongside the Microsoft button.
3. Update `handle_new_user()`: currently matches on **email** only. It needs to also match on **phone** when email is null, and — when there's no match at all on a phone signup — create a `pending` profile (`role='pending'`, `active=false`) instead of no profile. Phone formatting must be normalised (Jamaica is `+1876`/`+1658`, E.164) or matching will silently fail.
4. Build `/pending.html` — a holding page telling them access is awaiting approval.
5. Add a narrow RPC so a pending user can set their own name: a `SECURITY DEFINER` function like `set_pending_name(name)` that writes **only** `profiles.full_name`, **only** for `auth.uid()`'s own row, **only** while `role='pending'`. It must have no code path that can touch `role` or `active` — that's what stops self-approval. Do not expose a general client-side update on `profiles`.
6. `auth-guard.js` needs a new branch: `role === 'pending'` → redirect to `/pending.html` (distinct from both "not provisioned" and "wrong role for this page").
7. An approval surface for admins — approving means setting `role` + `active` on `profiles`, and deciding whether it should also create/link a `reps` row (needed if merch roster views read from `reps`, which they currently do). Discuss with me before building.

---

## 7. Deferred / known issues (do not action without asking)

- **Rename `reps` → something general** (e.g. `staff`). Correct in principle, but a rename means updating 16 Postgres function bodies **and** every front-end REST call (`/rest/v1/reps`) in the same deploy, since PostgREST endpoints are table names. High coordination cost, zero data benefit. Deferred deliberately.
- **`field_notes` table** — has Acumatica ERP sync columns (`acumatica_note`, `synced_to_acumatica`, `synced_at`), 0 rows, and no current owner. We are not syncing to Acumatica and likely never will. Candidate for deletion after confirmation.
- **`REP_ZONES` / `REP_STORES`** in `rep-weekly-plan.html` are large hardcoded, name-keyed JS objects (which zones/stores each rep covers). Stale — includes departed staff, missing recent hires. The `reps` table has no zone/store-level data, so fixing this needs a real data model (`rep_zones` / `rep_stores` tables) plus someone supplying current territory assignments. Don't patch it silently.
- **Weekly-plan form rep dropdown** is now fetched live from `reps`, but any logged-in user can still submit as any rep. Tightening it (reps locked to themselves, managers able to submit on behalf) is a deliberate later change.
- **`pin` column** is vestigial across the whole `reps` table. Remove once no app reads it.
- **Legacy anon JWT keys** in several files (gotcha #8).
- **Intune whitelisting** for field phones is being handled separately.

---

## 8. Key constants

```
Site (production)   https://dflhq.com
Supabase URL        https://hzagwndglwhcepsirafi.supabase.co
Supabase project    hzagwndglwhcepsirafi
Publishable key     sb_publishable_5rAinfDT1K9kwEQnqYwlOA_-C5tk_6h
OAuth redirect URI  https://dflhq.com/login.html
Storage bucket      Assets   (subfolders: specials/, brand/)
Logo (white)  https://hzagwndglwhcepsirafi.supabase.co/storage/v1/object/public/Assets/DFL%20Logo%20Blue_White.png
Logo (dark)   https://hzagwndglwhcepsirafi.supabase.co/storage/v1/object/public/Assets/DFL%20Logo%20Blue_Black.png
```

### Brand
```
Primary navy    #0f2044      Accent blue     #2563eb
Secondary navy  #1a3260      Accent bg       #eff6ff
Background      #f0f4f8      Gold (admin)    #fbbf24
Surface         #ffffff      Text            #1e293b
                             Muted text      #64748b
Font: Inter (main portal)
Note: the rep app uses Montserrat / Open Sans intentionally — that's a
deliberate app-level style, not drift. The merch app has its own palette too;
unifying design tokens across all three front ends is an open team decision.
```

---

## 9. How I'd like to work

- **Discuss architecture before building.** Give me options and tradeoffs; I'll pick.
- **Work on a branch**, not `main`. Commit before big changes so there's a rollback point.
- **Explain new concepts** as they come up — I'm learning.
- **Verify, don't assume.** If something "doesn't work", check the actual file on disk and the actual deployed state before theorising. Stale files and browser cache have burned us twice.
- **Confirm destructive DB changes** before executing.

**Start with Task 1**, but discuss your approach with me before you begin editing.
