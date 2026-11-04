-- Month-end HOD "Month Overview" (one-page slide) for the EA Command Centre.
-- One build = every figure and every narrative fact for a 2026 month, cached as jsonb. The page drafts the
-- sentences itself from these facts.
--
-- Rules (from the approved spec): invoiced_items at line level; revenue = sum(ext_amount) (credits already
-- negative); GP = sum(ext_profit); tran_type INV/CRM/DRM; status not Voided/Rejected; dates on invoice_date with
-- explicit ranges; category = item_class. Budgets: budget_2026_by_cat / budget_2026_by_customer (2026 only, no
-- year column). Chain = 50 ids, Key = 57 ids, everyone else = "All other customers".
--
-- Closed stores: their budget is left out of the channel rows (their ids are not in the Chain/Key lists), so the
-- three channel gaps sum to the total gap apart from that budget. Add an id to closed_ids when a store closes.
-- C000005654 Shoppers Fair Westgate (last invoiced 2026-01-27) is the only one at present.
--
-- PERFORMANCE: aggregate invoiced_items ONE MONTH AT A TIME (lateral). A single 22-month range makes the planner
-- pick idx_invoiced_items_customer_date (random heap reads, ~54s); one month uses idx_ii_invoice_date (~0.25s).
-- That is why the result is cached: a build takes several seconds, far over the anon statement timeout.
--
-- ACCESS: month_overview_build / refresh_month_overview are service_role only. month_overview_cache has RLS on and
-- NO policies, so it is not client-readable. Whether (and how) the EA page may read it is an open decision.

drop function if exists public.month_overview(int, int);

create or replace function public.month_overview_build(p_year int, p_month int)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $fn$
with
p as (
  select p_year y, p_month m,
         make_date(p_year, p_month, 1) d0,
         (make_date(p_year, p_month, 1) + interval '1 month')::date d1,
         case when p_month = 1 then p_year - 1 else p_year end py,
         case when p_month = 1 then 12 else p_month - 1 end pm,
         case when p_month = 12 then 1 else p_month + 1 end nm,
         (now() at time zone 'America/Jamaica')::date today
),
k as (
  select
    string_to_array('C000001907,C000001908,C000001909,C000001912,C000001913,C000001915,C000001916,C000001917,C000001920,C000001921,C000001923,C000002297,C000002298,C000003798,C000003799,C000004156,C000004157,C000004158,C000004159,C000004160,C000004161,C000004357,C000004358,C000004359,C000004360,C000004361,C000004362,C000004656,C000004657,C000005455,C000005617,C000005618,C000005619,C000005648,C000005649,C000005650,C000005651,C000005652,C000005653,C000006029,C000006110,C000006386,C000007077,C000009109,C000009381,C000009487,C000003042,C000003043,C000003778,C000004658', ',') chain_ids,
    string_to_array('C000000045,C000000081,C000000243,C000000441,C000000446,C000000554,C000000556,C000000757,C000000758,C000000762,C000000803,C000000942,C000001490,C000001627,C000001656,C000001689,C000001703,C000001704,C000001972,C000002033,C000002034,C000002523,C000002679,C000002680,C000002706,C000002731,C000002734,C000002794,C000002795,C000002896,C000002974,C000002976,C000002990,C000003331,C000003563,C000003674,C000003774,C000003856,C000003934,C000004462,C000004565,C000004664,C000004805,C000004990,C000005049,C000005228,C000005356,C000005577,C000005579,C000005640,C000005697,C000005724,C000005725,C000005934,C000007120,C000009549,C000009557', ',') key_ids,
    array['C000005654']::text[] closed_ids,
    array['FOODSUP','PAPER','PLASTIC','CLEARPACK','FOIL','GARBAGEBAG','HOUSEHOLD','BEVERAGES','ECOBOX','ECOCUP','PROCESSING','SALT']::text[] cats
),
-- Actuals: one row per month x customer x category, last year included (LY month, YTD LY, run-rate months).
mo0 as materialized (
  select extract(year from ms.d0)::int y, extract(month from ms.d0)::int m, a.customer_id, a.cls, a.rev, a.gp
  from p, generate_series(make_date(p.y - 1, 1, 1), p.d0, interval '1 month') ms(d0)
  cross join lateral (
    select i.customer_id, coalesce(i.item_class, '(none)') cls, sum(i.ext_amount) rev, sum(i.ext_profit) gp
    from invoiced_items i
    where i.invoice_date >= ms.d0::date and i.invoice_date < (ms.d0 + interval '1 month')::date
      and i.tran_type in ('INV','CRM','DRM')
      and (i.invoice_status is null or i.invoice_status not in ('Voided','Rejected'))
    group by 1, 2
  ) a
),
mo as materialized (
  select mo0.*, case when mo0.customer_id = any(k.chain_ids) then 'chain'
                     when mo0.customer_id = any(k.key_ids) then 'key' else 'other' end ch
  from mo0, k
),
mo_cls as materialized (select y, m, cls, sum(rev) rev, sum(gp) gp from mo group by 1, 2, 3),
mo_ch  as materialized (select y, m, ch, sum(rev) rev from mo group by 1, 2, 3),
mo_tot as materialized (select y, m, sum(rev) rev, sum(gp) gp from mo group by 1, 2),
cur_cust as materialized (select customer_id, sum(rev) rev from mo, p where mo.y = p.y and mo.m = p.m group by 1),
cur_cc   as materialized (select customer_id, cls, sum(rev) rev from mo, p where mo.y = p.y and mo.m = p.m group by 1, 2),
cur_chcls as materialized (select ch, cls, sum(rev) rev from mo, p where mo.y = p.y and mo.m = p.m group by 1, 2),
-- Anyone who bought a category in any other month of the window (used to find genuinely new buyers).
prior_cc as materialized (
  select distinct customer_id, cls from mo, p where mo.rev > 0 and not (mo.y = p.y and mo.m = p.m)
),
bc as materialized (
  select b.customer_id, b.month_number m, max(b.customer_name) nm, sum(b.budget) bud,
         case when b.customer_id = any(k.chain_ids) then 'chain'
              when b.customer_id = any(k.key_ids) then 'key' else 'other' end ch,
         (b.customer_id = any(k.closed_ids)) closed
  from budget_2026_by_customer b, k
  group by b.customer_id, b.month_number, k.chain_ids, k.key_ids, k.closed_ids
),
bc_m as materialized (select m, sum(bud) bud from bc group by m),
bc_ch as materialized (
  select m, ch, sum(bud) bud, count(*) filter (where bud > 0) stores from bc where not closed group by m, ch
),
cust_names as materialized (select customer_id, max(nm) nm from bc group by 1),
bk as materialized (
  select b.customer_id, b.month_number m, coalesce(b.item_class, '(none)') cls, sum(b.budget) bud
  from budget_2026_by_cat b group by 1, 2, 3
),
bk_cls as materialized (select m, cls, sum(bud) bud from bk group by 1, 2),
wd as (
  select c.total_working_days tot,
         case when p.d1 <= p.today then c.total_working_days else c.working_days_elapsed end done
  from p left join working_days_calendar c on c.year = p.y and c.month_number = p.m
),
wdp as (select c.total_working_days tot from p left join working_days_calendar c on c.year = p.py and c.month_number = p.pm),
wdn as (select c.total_working_days tot from p left join working_days_calendar c on c.year = p.y and c.month_number = p.nm and p.m < 12),
cur as (select coalesce(sum(rev),0) rev, coalesce(sum(gp),0) gp from mo_tot, p where mo_tot.y = p.y and mo_tot.m = p.m),
prv as (select coalesce(sum(rev),0) rev, coalesce(sum(gp),0) gp from mo_tot, p where mo_tot.y = p.py and mo_tot.m = p.pm),
ly  as (select coalesce(sum(rev),0) rev from mo_tot, p where mo_tot.y = p.y - 1 and mo_tot.m = p.m),
ytd as (
  select coalesce(sum(rev) filter (where mo_tot.y = p.y), 0) rev,
         coalesce(sum(rev) filter (where mo_tot.y = p.y - 1 and mo_tot.m <= p.m), 0) ly
  from mo_tot, p where mo_tot.m <= p.m
),
bud as (
  select coalesce(sum(bc_m.bud) filter (where bc_m.m = p.m), 0) cur,
         coalesce(sum(bc_m.bud) filter (where bc_m.m <= p.m), 0) ytd,
         coalesce(sum(bc_m.bud) filter (where bc_m.m = p.nm and p.m < 12), 0) nxt
  from bc_m, p
),
bud_cat as (select coalesce(sum(bud), 0) cur from bk_cls, p where bk_cls.m = p.m),
months as (
  select g.m,
         coalesce((select rev from mo_tot, p where mo_tot.y = p.y and mo_tot.m = g.m), 0) rev,
         coalesce((select bud from bc_m where bc_m.m = g.m), 0) bud,
         coalesce((select rev from mo_tot, p where mo_tot.y = p.y - 1 and mo_tot.m = g.m), 0) ly
  from p, generate_series(1, p.m) g(m)
),
chans as (
  select c.ch,
         coalesce((select rev from mo_ch, p where mo_ch.y = p.y and mo_ch.m = p.m and mo_ch.ch = c.ch), 0) rev,
         coalesce((select bud from bc_ch, p where bc_ch.m = p.m and bc_ch.ch = c.ch), 0) bud,
         coalesce((select stores from bc_ch, p where bc_ch.m = p.m and bc_ch.ch = c.ch), 0) stores,
         case when (select m from p) > 1
              then (select sum(rev) from mo_ch, p where mo_ch.y = p.y and mo_ch.m < p.m and mo_ch.ch = c.ch) / ((select m from p) - 1) end run_avg
  from (values ('other'), ('key'), ('chain')) c(ch)
),
tot_run as (
  select case when p.m > 1 then (select sum(rev) from mo_tot where mo_tot.y = p.y and mo_tot.m < p.m) / (p.m - 1) end avg from p
),
cats as (
  select u.cls,
         coalesce((select rev from mo_cls, p where mo_cls.y = p.y  and mo_cls.m = p.m  and mo_cls.cls = u.cls), 0) rev,
         coalesce((select gp  from mo_cls, p where mo_cls.y = p.y  and mo_cls.m = p.m  and mo_cls.cls = u.cls), 0) gp,
         coalesce((select rev from mo_cls, p where mo_cls.y = p.py and mo_cls.m = p.pm and mo_cls.cls = u.cls), 0) prev_rev,
         coalesce((select gp  from mo_cls, p where mo_cls.y = p.py and mo_cls.m = p.pm and mo_cls.cls = u.cls), 0) prev_gp,
         coalesce((select bud from bk_cls, p where bk_cls.m = p.m and bk_cls.cls = u.cls), 0) bud
  from k, unnest(k.cats) u(cls)
),
other_cls as (
  select coalesce(sum(rev), 0) rev
  from mo_cls, p, k where mo_cls.y = p.y and mo_cls.m = p.m and not (mo_cls.cls = any(k.cats))
),
-- Categories with sales but no budget this month (they inflate the total against budget).
unbud as (
  select c.cls, c.rev
  from mo_cls c, p
  where c.y = p.y and c.m = p.m and c.rev > 0
    and not exists (select 1 from bk_cls b where b.m = p.m and b.cls = c.cls and b.bud > 0)
  order by c.rev desc limit 4
),
acct as (
  select b.customer_id, b.nm, b.ch, b.bud, coalesce(cc.rev, 0) rev,
         case when b.ch <> 'chain' then initcap(b.nm)
              when b.nm ~* '^(progressive|(super )?shoppers fair)' then 'Progressive group'
              when b.nm ~* '^hilo' then 'Hi-Lo'
              when b.nm ~* '^(sampars|select grocers)' then 'Sampars / Select Grocers'
              when b.nm ~* '^megamart' then 'Megamart'
              when b.nm ~* '^super valu' then 'Super Valu'
              when b.nm ~* '^jr.s bargain' then 'JR''s Bargain World'
              when b.nm ~* '^price ?smart' then 'PriceSmart'
              else initcap(b.nm) end banner
  from bc b
  join p on b.m = p.m
  left join cur_cust cc on cc.customer_id = b.customer_id
  where b.ch in ('chain','key') and not b.closed and b.bud > 0
),
top_acct as (
  select jsonb_agg(jsonb_build_object('id', customer_id, 'name', nm, 'ch', ch, 'bud', bud, 'rev', rev, 'gap', rev - bud) order by rev - bud) j
  from (select * from acct order by rev - bud limit 6) t
),
top_banner as (
  select jsonb_agg(jsonb_build_object('banner', banner, 'ch', ch, 'stores', stores, 'bud', bud, 'rev', rev, 'gap', rev - bud) order by rev - bud) j
  from (select banner, min(ch) ch, count(*) stores, sum(bud) bud, sum(rev) rev
        from acct where ch = 'chain' group by banner order by sum(rev) - sum(bud) limit 4) t
),
gapcats as (
  select cls from cats where bud > 0 order by (rev - bud) limit 3
),
-- The three customers furthest behind budget in each of the three deepest category gaps.
cat_cust as (
  select jsonb_object_agg(cls, j) j from (
    select cls, jsonb_agg(jsonb_build_object('name', nm, 'bud', bud, 'rev', rev, 'gap', rev - bud) order by rev - bud) j from (
      select x.*, row_number() over (partition by x.cls order by x.rev - x.bud, x.nm) rn from (
        select g.cls, coalesce(n.nm, b.customer_id) nm, b.bud, coalesce(cc.rev, 0) rev
        from gapcats g
        join (select bk.customer_id, bk.cls, sum(bk.bud) bud from bk, p where bk.m = p.m group by 1, 2) b on b.cls = g.cls
        left join cur_cc cc on cc.customer_id = b.customer_id and cc.cls = b.cls
        left join cust_names n on n.customer_id = b.customer_id
      ) x
    ) y where rn <= 3 group by cls
  ) z
),
-- Channel x category gaps: which products explain the Chain / Key shortfall (closed stores excluded).
ch_cat as (
  select jsonb_object_agg(ch, j) j from (
    select ch, jsonb_agg(jsonb_build_object('cls', cls, 'gap', gap) order by gap) j from (
      select ch, cls, gap, row_number() over (partition by ch order by gap, cls) rn from (
        select c.ch, c.cls, coalesce(a.rev, 0) - c.bud gap
        from (select (case when bk.customer_id = any(k.chain_ids) then 'chain' when bk.customer_id = any(k.key_ids) then 'key' end) ch,
                     bk.cls, sum(bk.bud) bud
              from bk, p, k where bk.m = p.m and not (bk.customer_id = any(k.closed_ids))
              group by 1, 2) c
        left join cur_chcls a on a.ch = c.ch and a.cls = c.cls
        where c.ch is not null
      ) z
    ) y where rn <= 3 group by ch
  ) w
),
-- This month and the one before, commissionable categories only, for the SKU and buyer-count facts.
ii2 as materialized (
  select i.inventory_id, i.description, i.item_class, i.customer_id, i.ext_amount, (i.invoice_date >= p.d0) cur
  from invoiced_items i, p
  where i.invoice_date >= make_date(p.py, p.pm, 1) and i.invoice_date < p.d1
    and i.tran_type in ('INV','CRM','DRM')
    and (i.invoice_status is null or i.invoice_status not in ('Voided','Rejected'))
    and i.item_class = any(array(select unnest(cats) from k))
),
-- SKUs whose buyer count collapsed against the prior month (likely stock-outs).
sku as (
  select jsonb_agg(jsonb_build_object('sku', inventory_id, 'desc', descr, 'cls', cls, 'prev_rev', prev_rev, 'rev', rev,
                                      'prev_buyers', prev_buyers, 'buyers', buyers) order by prev_rev - rev desc) j
  from (
    select inventory_id, max(description) descr, max(item_class) cls,
           coalesce(sum(ext_amount) filter (where cur), 0) rev,
           coalesce(sum(ext_amount) filter (where not cur), 0) prev_rev,
           count(distinct customer_id) filter (where cur and ext_amount > 0) buyers,
           count(distinct customer_id) filter (where not cur and ext_amount > 0) prev_buyers
    from ii2
    group by inventory_id
    having count(distinct customer_id) filter (where not cur and ext_amount > 0) >= 15
       and count(distinct customer_id) filter (where cur and ext_amount > 0)
           <= 0.7 * count(distinct customer_id) filter (where not cur and ext_amount > 0)
       and coalesce(sum(ext_amount) filter (where not cur), 0) - coalesce(sum(ext_amount) filter (where cur), 0) > 1000000
    order by coalesce(sum(ext_amount) filter (where not cur), 0) - coalesce(sum(ext_amount) filter (where cur), 0) desc
    limit 5
  ) t
),
cat_buyers as (
  select jsonb_object_agg(cls, jsonb_build_object('buyers', b, 'prev_buyers', pb)) j from (
    select item_class cls,
           count(distinct customer_id) filter (where cur and ext_amount > 0) b,
           count(distinct customer_id) filter (where not cur and ext_amount > 0) pb
    from ii2 group by item_class
  ) q
),
-- Notable new buyers in the two categories that grew most (no purchase of that category in the window before).
grow as (
  select cls from cats order by (rev - prev_rev) desc limit 2
),
nb as (
  select g.cls, cc.customer_id, coalesce(n.nm, cc.customer_id) nm, cc.rev,
         row_number() over (partition by g.cls order by cc.rev desc, cc.customer_id) rn
  from grow g
  join cur_cc cc on cc.cls = g.cls and cc.rev > 250000
  left join prior_cc pr on pr.customer_id = cc.customer_id and pr.cls = cc.cls
  left join cust_names n on n.customer_id = cc.customer_id
  where pr.customer_id is null
),
new_buyers as (
  select jsonb_object_agg(cls, j) j from (
    select cls, jsonb_agg(jsonb_build_object('name', nm, 'rev', rev) order by rev desc) j from nb where rn <= 3 group by cls
  ) q
),
pipe as (
  select coalesce(sum(open_qty * unit_price), 0) val, count(distinct order_nbr) orders
  from so_ordered_items where open_qty > 0 and order_status in ('Open', 'Shipping')
)
select jsonb_build_object(
  'year', p.y, 'month', p.m, 'next_month', p.nm,
  'complete', p.d1 <= p.today,
  'start', p.d0, 'end_excl', p.d1, 'today', p.today,
  'wd_total', wd.tot, 'wd_done', wd.done, 'wd_prev', wdp.tot, 'wd_next', wdn.tot,
  'rev', cur.rev, 'gp', cur.gp, 'budget', bud.cur, 'budget_by_cat_total', bud_cat.cur,
  'prev_rev', prv.rev, 'prev_gp', prv.gp, 'ly_rev', ly.rev,
  'ytd_rev', ytd.rev, 'ytd_ly', ytd.ly, 'ytd_budget', bud.ytd,
  'next_budget', bud.nxt,
  'avg_prior_months', tot_run.avg,
  'channels', (select jsonb_agg(jsonb_build_object('ch', ch, 'rev', rev, 'bud', bud, 'stores', stores, 'run_avg', run_avg)) from chans),
  'months', (select jsonb_agg(jsonb_build_object('m', m, 'rev', rev, 'bud', bud, 'ly', ly) order by m) from months),
  'cats', (select jsonb_agg(jsonb_build_object('cls', cls, 'rev', rev, 'gp', gp, 'prev_rev', prev_rev, 'prev_gp', prev_gp, 'bud', bud)) from cats),
  'other_classes_rev', other_cls.rev,
  'unbudgeted', (select coalesce(jsonb_agg(jsonb_build_object('cls', cls, 'rev', rev)), '[]'::jsonb) from unbud),
  'top_accounts', coalesce(top_acct.j, '[]'::jsonb),
  'top_banners', coalesce(top_banner.j, '[]'::jsonb),
  'cat_customers', coalesce(cat_cust.j, '{}'::jsonb),
  'chan_cats', coalesce(ch_cat.j, '{}'::jsonb),
  'sku_collapse', coalesce(sku.j, '[]'::jsonb),
  'cat_buyers', coalesce(cat_buyers.j, '{}'::jsonb),
  'new_buyers', coalesce(new_buyers.j, '{}'::jsonb),
  'pipeline', jsonb_build_object('value', pipe.val, 'orders', pipe.orders),
  'built_at', now()
)
from p, wd, wdp, wdn, cur, prv, ly, ytd, bud, bud_cat, tot_run, other_cls, top_acct, top_banner, cat_cust, ch_cat, sku, cat_buyers, new_buyers, pipe
$fn$;

-- Cache of the built overviews, one row per month. RLS on, no policies = not readable by the client roles.
create table if not exists public.month_overview_cache (
  year      int         not null,
  month     int         not null check (month between 1 and 12),
  data      jsonb       not null,
  built_at  timestamptz not null default now(),
  primary key (year, month)
);
alter table public.month_overview_cache enable row level security;
revoke all on public.month_overview_cache from public, anon, authenticated;

-- Rebuild one month, or (no arguments) this month and last month. Cron calls it hourly.
create or replace function public.refresh_month_overview(p_year int default null, p_month int default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_cur   date := date_trunc('month', v_today)::date;
  v_prev  date := (date_trunc('month', v_today) - interval '1 month')::date;
  d       date;
  n       int := 0;
begin
  for d in
    select x from unnest(case when p_year is null then array[v_prev, v_cur]
                              else array[make_date(p_year, p_month, 1)] end) x
    where extract(year from x) = 2026          -- budgets exist for 2026 only
  loop
    insert into public.month_overview_cache (year, month, data, built_at)
    values (extract(year from d)::int, extract(month from d)::int,
            public.month_overview_build(extract(year from d)::int, extract(month from d)::int), now())
    on conflict (year, month) do update set data = excluded.data, built_at = excluded.built_at;
    n := n + 1;
  end loop;
  return n;
end
$fn$;

revoke all on function public.month_overview_build(int, int) from public, anon, authenticated;
revoke all on function public.refresh_month_overview(int, int) from public, anon, authenticated;

-- ── Read access (applied as migration month_overview_token_reader) ─────────────────────────────────────────
-- The EA Command Centre is a static page on the public key, and this data carries gross profit and account-level
-- gaps, so the cache is NOT readable with the key alone. get_month_overview() answers only when the caller passes
-- a token whose SHA-256 is in month_overview_access. The plaintext token lives only in the local dashboard file
-- (const MO_TOKEN); Supabase holds the hash. To rotate: generate a new random token, insert its sha256 hex here,
-- put the plaintext in the dashboard file, then delete the old row. To revoke: delete the row.
create table if not exists public.month_overview_access (
  token_hash text primary key,
  label      text,
  created_at timestamptz not null default now()
);
alter table public.month_overview_access enable row level security;
revoke all on public.month_overview_access from public, anon, authenticated;

create or replace function public.get_month_overview(p_year int, p_month int, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  r jsonb;
begin
  if p_token is null or not exists (
    select 1 from public.month_overview_access
    where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
  ) then
    raise exception 'invalid token' using errcode = '42501';
  end if;
  select jsonb_build_object('data', c.data, 'built_at', c.built_at) into r
  from public.month_overview_cache c
  where c.year = p_year and c.month = p_month;
  return r;
end
$fn$;

revoke all on function public.get_month_overview(int, int, text) from public;
grant execute on function public.get_month_overview(int, int, text) to anon, authenticated;
-- Row for the local dashboard file's token: insert into public.month_overview_access (token_hash, label) values ('<sha256 hex>', '<label>');
