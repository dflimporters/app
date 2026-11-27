-- Sales Support Hub — portal version. Approved by Scott and APPLIED 2026-11-09 as migration ss_hub_portal; this file matches the live objects.
-- Nothing here writes to any existing table. Adds:
--   1. ss_hub_support            who supports which reps (Scott's table, 9 Nov 2026). Read only through the functions below.
--   2. ss_hub_access(p_support)  true for Scott (price approver) / admins, or the support person named on that row.
--   3. ss_hub_supports()         the support books the caller may open (the page's Support picker).
--   4. ss_hub_data(part, support) read-only, SECURITY DEFINER. Parts: ops, sales, skus, period, pskus, inv.
--      Universe = customers whose largest budget this month is with one of the support person's reps (budget_2026);
--      customers with no budget row fall back to their dominant 2026 rep in Sales Explorer. USD accounts left out.
--   5. ss_hub_notes / ss_hub_ticks  shared notes and ticks (same shape as key_hub_*).

-- 1. support → reps
create table if not exists public.ss_hub_support (
  support text primary key,          -- first name shown in the hub
  full_name text,                    -- the support person's portal profile full_name (null until they have an account)
  reps text[] not null               -- salesperson names exactly as in budget_2026 / Sales Explorer
);
alter table public.ss_hub_support enable row level security;   -- no policies: only the SECURITY DEFINER functions read it
insert into public.ss_hub_support (support, full_name, reps) values
  ('Alecia',  null, array['Stacy-Ann Bennett Edwards','Phobea Whorms','Richard Gordon','Clerett Holness','Yanique Desouza']),
  ('Jenelle', null, array['Kimmone Campbell','Tudi-ann Lammie','Kawayne Evans','Antonio Williams','Andrea Skelton']),
  ('Althia',  null, array['Eric Smith','Damita Samuels-Foster','Desrick Simpson','Dionne Rerrie','Garreth Brown','Everton Green','Petronia Tinglin'])
on conflict (support) do nothing;

-- 2. access
create or replace function public.ss_hub_access(p_support text default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_price_approver()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      or exists (select 1 from ss_hub_support s join profiles p on p.full_name = s.full_name
                 where p.id = auth.uid() and (p_support is null or s.support = p_support));
$$;
revoke all on function public.ss_hub_access(text) from public, anon;
grant execute on function public.ss_hub_access(text) to authenticated;

-- 3. which books the caller may open
create or replace function public.ss_hub_supports()
returns table(support text) language sql stable security definer set search_path to 'public' as $$
  select s.support from ss_hub_support s where public.ss_hub_access(s.support)
  order by array_position(array['Alecia','Jenelle','Althia'], s.support), s.support;
$$;
revoke all on function public.ss_hub_supports() from public, anon;
grant execute on function public.ss_hub_supports() to authenticated;

-- the support person's customers (internal: not granted to anyone)
create or replace function public.ss_hub_customers(p_support text)
returns table(customer_id text, rep text) language sql stable security definer set search_path to 'public' as $$
  with r as (select unnest(reps) rep from ss_hub_support where support = p_support),
  bu as (select distinct on (customer_id) customer_id, salesperson rep from (select customer_id, salesperson, sum(budget) b from budget_2026 where month_number = extract(month from current_date)::int group by 1,2) x order by customer_id, b desc),
  dm as (select distinct on (customer_id) customer_id, rep from (select customer_id, rep, sum(rev) r from mv_sales_explorer where d >= date_trunc('year', current_date) group by 1,2) x order by customer_id, r desc)
  select customer_id::text, rep::text from (
    select customer_id, rep from bu where rep in (select rep from r)
    union all select customer_id, rep from dm where rep in (select rep from r) and customer_id not in (select customer_id from bu)) s0
  where customer_id not in ('C000007259','C000009702');
$$;
revoke all on function public.ss_hub_customers(text) from public, anon, authenticated;

-- 4. the data
create or replace function public.ss_hub_data(p_part text, p_support text)
returns json language plpgsql volatile security definer set search_path to 'public' as $function$
-- volatile only because it keeps the customer list in a temp table for the call (one universe lookup per part); it changes no data
declare v_out json;
begin
  if not public.ss_hub_access(p_support) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  create temp table if not exists ss_s (customer_id text, rep text) on commit drop;
  truncate ss_s; insert into ss_s select * from public.ss_hub_customers(p_support);

  if p_part = 'ops' then
    with s as (select customer_id from ss_s),
    oo as (select order_nbr, order_type, status, order_date, sched_shipment, customer, order_total, ordered_qty, created_by, ship_via, shipping_zone, rc_return_codes from sales_orders where customer in (select customer_id from s) and ((order_type = 'SO' and status in ('Open','On Hold','Shipping','Back Order','Credit Hold') and order_date >= current_date - 90) or (order_type = 'RC' and order_date >= current_date - 60))),
    sh as (select shipment_nbr, customer_id, order_nbr, status, shipment_date, shipment_value, ship_via, created_on from shipments where customer_id in (select customer_id from s) and shipment_date >= current_date - 90 and shipment_type = 'Shipment')
    select json_build_object(
      'orders', (select json_agg(json_build_array(order_nbr, order_type, status, to_char(order_date,'YYYY-MM-DD'), to_char(sched_shipment,'YYYY-MM-DD'), customer, round(order_total), ordered_qty, created_by, ship_via, shipping_zone, rc_return_codes) order by order_date desc) from oo),
      'lines', (select json_agg(json_build_array(i.order_nbr, i.inventory_id, i.line_description, i.order_qty, i.open_qty, i.qty_on_hand, round(i.unit_price), i.item_class, i.order_status, round(i.unit_cost), i.qty_on_hand_71, i.qty_on_hand_ash)) from so_ordered_items i join oo on oo.order_nbr = i.order_nbr and oo.order_type = i.order_type),
      'deals', (select json_object_agg(inventory_id, json_build_array(sheet_price, tiers)) from current_deal_items where inventory_id in (select inventory_id from so_ordered_items where order_nbr in (select order_nbr from oo))),
      'inact', (select json_object_agg(inventory_id, st) from (select inventory_id, min(item_status) st from stock_items_raw where inventory_id in (select inventory_id from so_ordered_items where order_nbr in (select order_nbr from oo where order_type = 'SO')) group by 1 having bool_and(item_status <> 'Active')) z),
      'ships', (select json_agg(json_build_array(shipment_nbr, customer_id, order_nbr, status, to_char(shipment_date,'YYYY-MM-DD'), round(shipment_value), ship_via, to_char(created_on at time zone 'America/Jamaica','YYYY-MM-DD')) order by shipment_date desc) from sh where shipment_date >= current_date - 21),
      'short', (select json_agg(json_build_array(sh.customer_id, to_char(sh.shipment_date,'YYYY-MM-DD'), l.order_nbr, l.inventory_id, l.description, l.ordered_qty, l.shipped_qty, round(l.unit_price)) order by sh.shipment_date desc) from shipment_lines l join sh on sh.shipment_nbr = l.shipment_nbr where l.ordered_qty > l.shipped_qty and l.description not ilike '%MOQ%'),
      'loads', (select json_agg(json_build_array(ls.shipment_nbr, l.load_nbr, to_char(l.load_date,'YYYY-MM-DD'), l.ship_via, exists(select 1 from load_events ev where ev.load_id = l.id and ev.kind = 'pick_done'), (l.check_status = 'confirmed' or l.checker_done_at is not null), l.closed_reason, lm.status, lm.claimed_name, lm.claimed_phone)) from load_shipments ls join loads l on l.id = ls.load_id left join lm_loads lm on lm.load_id = l.id where ls.env = 'live' and l.env = 'live' and ls.shipment_nbr in (select shipment_nbr from sh where shipment_date >= current_date - 21)),
      'stops', (select json_agg(json_build_array(si.shipment_nbr, st.status, to_char(st.arrived_at at time zone 'America/Jamaica','YYYY-MM-DD HH24:MI'), to_char(st.completed_at at time zone 'America/Jamaica','YYYY-MM-DD HH24:MI'), st.receiver_name, st.fail_reason, st.fail_note, si.invoice_nbr)) from lm_stop_invoices si join lm_stops st on st.id = si.stop_id where si.shipment_nbr in (select shipment_nbr from sh where shipment_date >= current_date - 21)),
      'sync', json_build_object('orders', (select max(synced_at) from so_ordered_items), 'ship', (select max(synced_at) from shipments), 'built', now())
    ) into v_out;

  elsif p_part = 'sales' then
    with s as (select customer_id from ss_s),
    m as (select customer_id, d, item_class, sum(rev) rev from mv_sales_explorer where customer_id in (select customer_id from s) and d >= (date_trunc('year', current_date) - interval '1 year')::date group by 1,2,3),
    md as (select customer_id, d, sum(rev) rev from m group by 1,2)
    select json_build_object('asof', (select max(d) from mv_sales_explorer),
      'stores', (select json_agg(json_build_array(c.customer_id, c.customer_name, c.area, c.parent_account, c.terms, c.phone1, (select string_agg(distinct mm.merchandiser_name, ', ') from merchandiser_map mm where mm.customer_id = c.customer_id), (select string_agg(distinct mm.service_day, ', ') from merchandiser_map mm where mm.customer_id = c.customer_id))) from customers c where c.customer_id in (select customer_id from s)),
      'mon', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(json_build_array(to_char(mo,'YYYY-MM'), r) order by mo) arr from (select customer_id, date_trunc('month',d) mo, round(sum(rev)/1000,1) r from md group by 1,2) a group by 1) b),
      'days', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(to_char(d,'YYYY-MM-DD') order by d) arr from (select customer_id, d from md where d >= current_date - 150 group by 1,2 having sum(rev) > 0) a group by 1) b),
      'rep', (select json_object_agg(customer_id, rep) from ss_s),
      'reps', (select to_json(reps) from ss_hub_support where support = p_support),
      'repbud', (select json_agg(json_build_array(salesperson, month_number, b)) from (select salesperson, month_number, round(sum(budget)) b from budget_2026 where salesperson in (select unnest(reps) from ss_hub_support where support = p_support) group by 1,2) z),
      'bud', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(json_build_array(month_number, round(b/1000,1)) order by month_number) arr from (select customer_id, month_number, sum(budget) b from budget_2026 where customer_id in (select customer_id from s) group by 1,2) a group by 1) b),
      'cat', (select json_agg(json_build_array(customer_id, item_class, round(r90/1000,1), round(ly90/1000,1))) from (select customer_id, item_class, sum(rev) filter (where d > current_date-91) r90, sum(rev) filter (where d > current_date-91-364 and d <= current_date-364) ly90 from m group by 1,2) x where abs(coalesce(r90,0)) + abs(coalesce(ly90,0)) > 5000)
    ) into v_out;

  elsif p_part = 'skus' then
    with s as (select customer_id from ss_s),
    m as (select customer_id, d, inventory_id, item_class, description, rev, qty from mv_sales_explorer where customer_id in (select customer_id from s) and d >= current_date - 91 - 364 and coalesce(description,'') not ilike '%MOQ%' and inventory_id is not null),
    k as (select customer_id, inventory_id, sum(rev) filter (where d > current_date-91) r90, sum(rev) filter (where d > current_date-91-364 and d <= current_date-364) ly90, max(d) last_d from m group by 1,2),
    u as (select customer_id, inventory_id, max(description) descr,
            count(distinct date_trunc('month', d)) filter (where d < date_trunc('month', current_date)) nmo,
            sum(qty) filter (where d < date_trunc('month', current_date)) q6,
            sum(qty) filter (where d >= date_trunc('month', current_date)) qm, max(d) last_d
          from m where d >= date_trunc('month', current_date) - interval '6 months' group by 1,2)
    select json_build_object(
      'sku', (select json_agg(json_build_array(customer_id, inventory_id, round(coalesce(r90,0)/1000,1), round(coalesce(ly90,0)/1000,1), to_char(last_d,'YYYY-MM-DD'))) from k where coalesce(r90,0) > 3000 or coalesce(ly90,0) > 10000),
      'skud', (select json_object_agg(inventory_id, json_build_array(description, item_class)) from (select distinct on (inventory_id) inventory_id, description, item_class from m where inventory_id in (select inventory_id from k where coalesce(r90,0) > 3000 or coalesce(ly90,0) > 10000) order by inventory_id, d desc) z),
      'usual', (select json_agg(json_build_array(customer_id, inventory_id, descr, round(q6 / 6.0, 1), coalesce(qm, 0), to_char(last_d,'YYYY-MM-DD'), nmo)) from u where nmo >= 3 and q6 > 0)
    ) into v_out;

  elsif p_part = 'period' then
    with s as (select customer_id from ss_s),
    a as (select max(d) asof from mv_sales_explorer),
    m as (select customer_id, item_class, d, rev from mv_sales_explorer, a where customer_id in (select customer_id from s) and (d between date_trunc('year', a.asof)::date and a.asof or d between (date_trunc('year', a.asof) - interval '1 year')::date and (a.asof - interval '1 year')::date)),
    p as (select customer_id, coalesce(item_class,'Unclassified') cls,
            sum(rev) filter (where d >= date_trunc('year',(select asof from a))) ytd,
            sum(rev) filter (where d < date_trunc('year',(select asof from a))) ytdly,
            sum(rev) filter (where d >= date_trunc('month',(select asof from a))) mtd,
            sum(rev) filter (where d < date_trunc('year',(select asof from a)) and d >= (date_trunc('month',(select asof from a)) - interval '1 year')) mtdly
          from m group by 1,2)
    select json_build_object('asof', (select asof from a), 'ly_to', (select (asof - interval '1 year')::date from a),
      'pc', (select json_agg(json_build_array(customer_id, cls, round(coalesce(ytd,0)), round(coalesce(ytdly,0)), round(coalesce(mtd,0)), round(coalesce(mtdly,0)))) from p where abs(coalesce(ytd,0)) + abs(coalesce(ytdly,0)) > 0),
      'cb', (select json_agg(json_build_array(customer_id, coalesce(item_class,'Unclassified'), round(b))) from (select customer_id, item_class, sum(budget) b from budget_2026 where month_number = extract(month from (select asof from a))::int and customer_id in (select customer_id from s) group by 1,2 having sum(budget) <> 0) x),
      -- each rep's sales so far this month (credited to the rep, whoever the customer belongs to)
      'repm', (select json_agg(json_build_array(rep, mtd, n)) from (select v.rep, round(sum(v.rev)) mtd, count(distinct v.customer_id) n from mv_sales_explorer v, a where v.rep in (select unnest(reps) from ss_hub_support where support = p_support) and v.d >= date_trunc('month', a.asof) group by 1) z)
    ) into v_out;

  elsif p_part = 'pskus' then
    with s as (select customer_id from ss_s),
    a as (select max(d) asof from mv_sales_explorer),
    q as (select v.customer_id, v.inventory_id, coalesce(v.item_class,'Unclassified') cls, max(v.description) descr,
            sum(v.rev) filter (where v.d >= date_trunc('year',(select asof from a))) ytd,
            sum(v.rev) filter (where v.d < date_trunc('year',(select asof from a))) ytdly
          from mv_sales_explorer v, a where v.customer_id in (select customer_id from s) and (v.d between date_trunc('year', a.asof)::date and a.asof or v.d between (date_trunc('year', a.asof) - interval '1 year')::date and (a.asof - interval '1 year')::date)
            and v.inventory_id is not null and coalesce(v.description,'') not ilike '%MOQ%' group by 1,2,3)
    select json_build_object(
      'ps', (select json_agg(json_build_array(customer_id, inventory_id, cls, round(coalesce(ytd,0)), round(coalesce(ytdly,0)))) from q where abs(coalesce(ytd,0)) + abs(coalesce(ytdly,0)) >= 100),
      'psd', (select json_object_agg(inventory_id, descr) from (select inventory_id, max(descr) descr from q group by 1) z)
    ) into v_out;

  elsif p_part = 'inv' then
    -- invoiced lines, last 45 days (back orders "likely replaced", short items "sent later"). Loaded after the main parts.
    select json_build_object(
      'inv', (select json_agg(json_build_array(customer_id, to_char(invoice_date,'YYYY-MM-DD'), inventory_id, q, fq, p)) from (select customer_id, invoice_date, inventory_id, sum(quantity) filter (where unit_price > 0) q, sum(quantity) filter (where unit_price = 0) fq, round(max(unit_price)) p from invoiced_items where customer_id in (select customer_id from ss_s) and invoice_date >= current_date - 45 and tran_type in ('INV','CRM','DRM') and (invoice_status not in ('Voided','Rejected') or invoice_status is null) and inventory_id is not null group by 1,2,3) iv)
    ) into v_out;

  else
    raise exception 'unknown part %', p_part using errcode = '22023';
  end if;
  return v_out;
end $function$;
revoke all on function public.ss_hub_data(text, text) from public, anon;
grant execute on function public.ss_hub_data(text, text) to authenticated;

-- 5. shared notes and ticks (same shape and rules as key_hub_*; anyone with access to a support book)
create table if not exists public.ss_hub_notes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('note','reason','promise','manager','backup')),
  ref text, c text, sku text, chain text,
  label text, src text, eta date, amount numeric, date date,
  name text, phone text, text text,
  by uuid default auth.uid(), by_name text,
  at timestamptz not null default now()
);
create index if not exists ss_hub_notes_at_idx on public.ss_hub_notes (at desc);
alter table public.ss_hub_notes enable row level security;
drop policy if exists ss_hub_notes_read on public.ss_hub_notes;
create policy ss_hub_notes_read on public.ss_hub_notes for select to authenticated using (public.ss_hub_access());
drop policy if exists ss_hub_notes_add on public.ss_hub_notes;
create policy ss_hub_notes_add on public.ss_hub_notes for insert to authenticated with check (public.ss_hub_access() and by = auth.uid());
drop policy if exists ss_hub_notes_delete on public.ss_hub_notes;
create policy ss_hub_notes_delete on public.ss_hub_notes for delete to authenticated using (public.ss_hub_access() and (by = auth.uid() or public.is_price_approver()));

create table if not exists public.ss_hub_ticks (
  k text primary key,
  v text,
  by uuid default auth.uid(), by_name text,
  at timestamptz not null default now()
);
alter table public.ss_hub_ticks enable row level security;
drop policy if exists ss_hub_ticks_read on public.ss_hub_ticks;
create policy ss_hub_ticks_read on public.ss_hub_ticks for select to authenticated using (public.ss_hub_access());
drop policy if exists ss_hub_ticks_add on public.ss_hub_ticks;
create policy ss_hub_ticks_add on public.ss_hub_ticks for insert to authenticated with check (public.ss_hub_access());
drop policy if exists ss_hub_ticks_change on public.ss_hub_ticks;
create policy ss_hub_ticks_change on public.ss_hub_ticks for update to authenticated using (public.ss_hub_access()) with check (public.ss_hub_access());

grant select, insert, delete on public.ss_hub_notes to authenticated;
grant select, insert, update on public.ss_hub_ticks to authenticated;
