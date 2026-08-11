# Build brief: Sales Budget Explorer

## Context

DFL currently manages the 2026 sales budget in Excel (`2026_Sales_Budget_V4.xlsm`), sliced manually into separate sheets per dimension (by customer, by rep, by item class, by area/chain). The budget itself already lives in Supabase (`budget_2026`, composite key `customer_id + item_class + salesperson + month_number`). This brief is for a single web page, added to the existing DFL HQ portal (`dflimporters.github.io/app/`), that replaces those static Excel sheets with one interactive view.

**This phase is view-only.** No editing, no write access to any table. A separate tool for the Sales Manager to adjust budget figures is a later phase and is explicitly out of scope here.

## Access

No role-based scoping. Anyone with access to the portal page sees the full budget, unfiltered — do not build per-user row-level restriction, category-based scoping, or a role switcher. Keep this simple.

## Visual design

Must match the existing DFL HQ portal exactly — same CSS, typography, color tokens, header/nav, and component patterns already used elsewhere in `dflimporters.github.io/app/`. Before writing new styles, inspect the existing app's CSS and reuse it. This should look like a native page of the portal, not a bolted-on separate tool.

## Data

Source table: `budget_2026` in the DFL Supabase project (`hzagwndglwhcepsirafi`). Budget numbers only — no actuals, no variance, in this phase.

Confirm before building:
- Exact column names on `budget_2026` (amount column, month_number range/mapping to calendar months)
- Whether "Rep" = the `salesperson` column directly, or needs a join to a reps table for display names
- Whether "Area" and "Segment" (tier) live on `budget_2026` itself or need a join to `customers`
- Row count / expected table size, to decide between client-side aggregation and a Postgres RPC function that does the grouping server-side (preferred if row count is large — pass `group_by` dimension as a param, return pre-aggregated rows)

Totals and rollups (category total, area total, grand total) must always be computed live via `SUM()` over the leaf rows — never stored as separate rows or cached values. This is the main thing that made the old spreadsheet untrustworthy (totals could drift from detail).

**Budget source switcher.** There are two budget tracks: `budget_2026` (operational) and `budget_2026_stretch` (salesperson-facing stretch targets). Add a simple page-level toggle to switch which table the whole page reads from — everything else (dimension picker, split by, time view, drill-down, search, export) works identically against either table, just pointed at a different source. This doesn't need to be more sophisticated than that for v1 (e.g. no side-by-side comparison of the two, no blended view) — just confirm whether `budget_2026_stretch` has the same schema/composite key as `budget_2026` before building, since the rest of the page assumes that shape. Make it visually obvious which track is currently active (it'll be easy to misread a number if someone forgets which one they're looking at). Deeper integration — e.g. showing both at once, or variance between them — can come later.

## Core functionality

**Dimension picker (group by)** — tabs or similar control to re-group the same table by:
- Customer
- Item class
- Sales rep
- Area
- Segment (tier)

One table that re-groups on click, not five separate pages.

**Split by (secondary dimension)** — a dropdown to add a second grouping level on top of the primary one (e.g. rows = Item class, split by = Area, producing a cross-tab or nested row groups). This needs to actually function — in the last mockup it was a non-working stub.

**Time view toggle** — Monthly / Quarterly / YTD / Full year, collapsing the same 12 months of data into fewer columns without a page reload.

**Drill-down** — clicking a row re-groups the table into a child breakdown (e.g. click "Beverages" while grouped by item class → table re-groups by customer, filtered to Beverages only). Breadcrumb shows the path back to "All."

**Search** — filter rows by name, live as you type.

**Export** — button to export the current view (whatever grouping/time view/filter is active) to CSV or XLSX.

**Totals row** — always visible, always a live sum of what's currently displayed.

## Explicitly excluded from this build

- No heatmap/cell shading
- No sparklines or inline mini-charts
- No role switching or scoped visibility
- No editing capability of any kind
- No budget-vs-actuals or variance (budget numbers only)

## Open questions for whoever picks this up

1. Confirm `budget_2026` schema (see Data section above) before writing queries.
2. Decide client-side vs. RPC-based aggregation based on actual row count.
3. Confirm export should be full-fidelity XLSX (formatted) or plain CSV is acceptable for v1.
