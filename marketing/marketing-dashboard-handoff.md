# DFL Marketing Dashboard — Handoff Spec

## What this is
A personal ops dashboard + team request-intake tool for Joel Dallas (Marketing
Manager, DFL Importers), hosted at **dflhq.com/marketing**. Built on the same
Supabase project and Microsoft SSO as the rest of dflhq.com — no new
infrastructure, no separate auth system.

## Stack
- **Supabase project:** `hzagwndglwhcepsirafi` (same project as the rest of dflhq.com — sales, gondola, merch, etc.)
- **Schema:** `ops` (new — isolated from `public`, which holds all the sales/ERP-synced data)
- **Auth:** Microsoft SSO via Supabase Auth (`provider: 'azure'`), same pattern as the rest of the site
- **Frontend:** single static HTML file, vanilla JS + `@supabase/supabase-js@2` (UMD build from jsdelivr), no build step
- **Hosting:** GitHub Pages, same as the rest of dflhq.com — deploy at path `/marketing`, not a subdomain

## Files delivered (attached)
- **`marketing.html`** — the real, current build. Deploy this at `dflhq.com/marketing` (rename to `index.html` in that folder, or configure routing). This supersedes the earlier `dashboard.html` test file — don't deploy that one, it has no role-gating.
- `dashboard.html` / `dashboard-wireframe.html` — earlier iterations kept for reference only, not meant for deployment.

## Database — already applied via migrations
Migrations run so far (Supabase migration history, in order):
1. `create_ops_schema_dashboard_tables` — creates `ops` schema, `ops.tasks`, `ops.road_stops`, RLS enabled, owner-scoped policies
2. `grant_ops_schema_access` — **important**: a schema created outside `public` doesn't inherit Supabase's default grants. Had to explicitly `GRANT USAGE ON SCHEMA ops TO authenticated` + table grants + default privileges for future tables. If you add new tables to `ops`, they should inherit these grants automatically — but verify with `has_schema_privilege('authenticated','ops','USAGE')` if anything mysteriously fails silently.
3. `create_roles_and_request_intake_tables` — original pass, created a standalone `ops.user_roles` table (**since dropped**, see next migration)
4. `derive_marketing_roles_from_existing_profiles` — replaced the standalone roles table with a function, `ops.current_user_role()`, that reads the site's *existing* `public.profiles.role` and `public.admin_emails` tables instead of duplicating role data. Logic:
   ```sql
   -- returns 'manager' | 'admin' | 'submitter'
   select case
     when (auth.jwt()->>'email') = 'joeld@dflimporters.com' then 'manager'
     when exists (select 1 from public.profiles p where p.id = auth.uid()
                    and p.role in ('admin','manager','management','rep_management','team_leader'))
       or exists (select 1 from public.admin_emails a where a.email = (auth.jwt()->>'email'))
       then 'admin'
     else 'submitter'
   end;
   ```
   Joel's email is hardcoded and checked first, so it always wins regardless of his `profiles.role` (which happens to also be `admin`). No new user/role table exists anywhere for this feature — it's a pure read of existing site data.

### Table schemas (schema `ops`)

**`ops.tasks`**
```
id uuid pk · title text · bucket text check(active|recurring|waiting|inbox)
project text check(Gondolas|Covebay|Catalogue 2026|Promo Tool|Labels & Barcodes|
  Social|Donations|Christmas Gifting|2027 Plan|Research|Other)
next_action text · waiting_on text · done boolean · owner uuid → auth.users
created_at timestamptz · done_at timestamptz
```
RLS: owner-only (`owner = auth.uid()`), all operations.

**`ops.road_stops`** — Thursday road-day checklist, scoped by week
```
id uuid pk · store_name text · note text · week_of date (Monday of the week)
done boolean · owner uuid → auth.users · created_at timestamptz
```
RLS: owner-only.

**`ops.donation_requests`** and **`ops.promo_requests`** — identical shape except a few fields:
```
id uuid pk · requester_email text · requester_name text
raw_input text          -- the original free-text submission, always populated
status text check(pending_review|approved|declined|more_info_needed)
ai_parsed boolean        -- false until the AI-parsing step (not yet built) runs
created_at timestamptz · reviewed_by text · reviewed_at timestamptz

-- donation_requests only: organization, purpose, amount, currency, needed_by
-- promo_requests only: store, account, brand, promo_type, start_date, end_date
```
These structured columns exist but are **not currently populated by the form** —
the form only writes `raw_input` + requester info. They're there waiting for the
AI-parsing step to fill in.

RLS on both: anyone authenticated can insert their own; the requester or any
`manager`/`admin` (via `ops.current_user_role()`) can select; only
`manager`/`admin` can update status.

## Frontend behavior (`marketing.html`)
One file, three mutually-exclusive views chosen after sign-in based on
`ops.current_user_role()`:

- **`manager`** (Joel only, hardcoded email) → full dashboard: pending
  requests with Approve/Decline, weekly schedule strip (static, not
  data-driven), task board (`ops.tasks`, filterable by bucket, quick-add,
  bucket-move, mark done), Thursday road-day checklist (`ops.road_stops`).
- **`admin`** (anyone with a managerial role in `public.profiles` or listed
  in `public.admin_emails`) → read-only "Management" view: pending-count
  tiles + a scrollable list of recent requests. No edit controls.
- **`submitter`** (everyone else) → only the request form: a
  donation/promotion switcher, one free-text box, submit button. Writes to
  `ops.donation_requests` or `ops.promo_requests` with `raw_input` +
  requester info; `ai_parsed` stays `false`.

Supabase URL and **publishable** key are hardcoded in the file (this is
expected/safe — it's the public anon key, meant to be client-side; all real
access control is RLS + the role function server-side).

## Known gap raised by Joel — needs fixing
**Joel (manager role) currently cannot see the submitter form.** The three
views are exclusive, so once someone resolves to `manager` they only ever see
the full dashboard — there's no way for Joel to preview or use the submission
form himself (e.g. to test it, or to submit his own donation/promo request).

Suggested fix: add a small tab/toggle in the manager view — something like
"My Dashboard" / "Submit a Request" — that lets the `manager` role render the
submitter form on demand, without changing how `admin`/`submitter` routing
works. Simplest version: a button that swaps `managerView` for
`submitterView` client-side (both already exist in the DOM/CSS in
`marketing.html`), no new backend needed.

## Outstanding work (not yet built)
**AI-parsing Edge Function.** The plan: a Supabase Edge Function, called
either right after insert (via a DB webhook/trigger or directly from the
form's submit handler) or on a schedule, that:
1. Reads a `pending_review` / `ai_parsed = false` row from
   `donation_requests` or `promo_requests`
2. Sends `raw_input` to the Claude API (Joel has his own Anthropic API key
   ready, separate from his Claude.ai account — **store it as an Edge
   Function secret, never in client-side code**)
3. Parses the response into the existing structured columns (organization/
   purpose/amount/needed_by for donations; store/account/brand/promo_type/
   dates for promos)
4. Updates the row, sets `ai_parsed = true`

This hasn't been started — no Edge Function exists yet, and the structured
columns are currently always null coming from the form.

## Deployment checklist for whoever ships this
1. Deploy `marketing.html` at `dflhq.com/marketing` (as `index.html` in that path)
2. Confirm Azure AD app registration + Supabase Auth redirect URIs include that path
3. Confirm `ops` schema is in Supabase's **Exposed schemas** list (Project Settings → API) — already done for this project, but flagging in case this gets replicated elsewhere
4. Fix the manager/submitter view toggle (see above) before wider rollout, since Joel is the one who needs to actually test the submission flow
