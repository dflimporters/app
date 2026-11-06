-- Key Account Hub (Shallet Marsh's 35 key accounts) — portal version.
-- Approved by Scott 2026-11-05. A separate copy of the Chain Store Hub objects (Scott chose a copy over a KAM-aware source). Adds:
--   1. key_hub_data(p_part)  read-only, SECURITY DEFINER, managers/admins only (is_manager()).
--      Same parts as chain_hub_data (ops, sales, skus, period, pskus) for kam = 'Shallet Marsh'.
--      'ops' also returns 'dsheet' (all live deals with tiers, for the deal log).
--      'inv' (own part, loaded after the others): invoiced lines, last 45 days, from invoiced_items (synced through the day,
--      keeps the J$0 free-goods lines apart). Applied as migrations key_hub_portal, key_hub_inv_from_mv (reverted),
--      key_hub_inv_own_part and key_hub_inv_synced_cheap; this file matches the live function.
--   3. key_hub_ticks  — one row per tick key (statuses, statement sent, deal closed, collection status, …).
-- Nothing here writes to any existing table.

create or replace function public.key_hub_data(p_part text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_out json;
begin
  if not public.is_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_part = 'ops' then
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh'),
    oo as (select order_nbr, order_type, status, order_date, sched_shipment, customer, order_total, ordered_qty, created_by, ship_via from sales_orders where customer in (select customer_id from s) and status in ('Open','On Hold','Shipping','Back Order','Credit Hold') and order_date >= current_date - 90),
    sh as (select shipment_nbr, customer_id, order_nbr, status, shipment_date, shipment_value, ship_via, created_on from shipments where customer_id in (select customer_id from s) and shipment_date >= current_date - 90 and shipment_type = 'Shipment')
    select json_build_object(
      'orders', (select json_agg(json_build_array(order_nbr, order_type, status, to_char(order_date,'YYYY-MM-DD'), to_char(sched_shipment,'YYYY-MM-DD'), customer, round(order_total), ordered_qty, created_by, ship_via) order by order_date desc) from oo),
      'lines', (select json_agg(json_build_array(i.order_nbr, i.inventory_id, i.line_description, i.order_qty, i.open_qty, i.qty_on_hand, round(i.unit_price), i.item_class, i.order_status)) from so_ordered_items i where i.order_nbr in (select order_nbr from oo) and i.order_type in (select distinct order_type from oo)),
      'deals', (select json_object_agg(inventory_id, json_build_array(sheet_price, tiers)) from current_deal_items where tiers is not null and inventory_id in (select inventory_id from so_ordered_items where order_nbr in (select order_nbr from oo))),
      'ships', (select json_agg(json_build_array(shipment_nbr, customer_id, order_nbr, status, to_char(shipment_date,'YYYY-MM-DD'), round(shipment_value), ship_via, to_char(created_on at time zone 'America/Jamaica','YYYY-MM-DD')) order by shipment_date desc) from sh where shipment_date >= current_date - 21),
      'short', (select json_agg(json_build_array(sh.customer_id, to_char(sh.shipment_date,'YYYY-MM-DD'), l.order_nbr, l.inventory_id, l.description, l.ordered_qty, l.shipped_qty, round(l.unit_price)) order by sh.shipment_date desc) from shipment_lines l join sh on sh.shipment_nbr = l.shipment_nbr where l.ordered_qty > l.shipped_qty and l.description not ilike '%MOQ%'),
      'ar', (select json_agg(json_build_array(customer_id, doc_type, ref_nbr, to_char(doc_date,'YYYY-MM-DD'), to_char(due_date,'YYYY-MM-DD'), round(balance_jmd), days_aged, is_credit, terms)) from ar_aging_rows where snapshot_id = (select max(id) from ar_aging_snapshots where status = 'complete') and customer_id in (select customer_id from s union select customer_id from customers where parent_account in (select customer_id from s)) and balance_jmd <> 0),
      'pays', (select json_agg(json_build_array(customer_id, to_char(payment_date,'YYYY-MM-DD'), round(rcpt), payment_ref, payment_method) order by payment_date desc) from (select customer_id, payment_date, payment_ref, payment_method, max(payment_receipt_total) rcpt from ar_payments where customer_id in (select customer_id from s) and payment_type = 'Payment' and payment_date >= current_date - 200 and not coalesce(is_missing,false) group by 1,2,3,4) p),
      'dsheet', (select json_agg(json_build_array(inventory_id, description, round(sheet_price), tiers, item_class)) from current_deal_items where tiers is not null),
      'sync', json_build_object('orders',(select max(synced_at) from so_ordered_items),'ship',(select max(synced_at) from shipments),'ar',(select max(completed_at) from ar_aging_snapshots where status = 'complete'),'pay',(select max(synced_at) from ar_payments),'built',now())
    ) into v_out;

  elsif p_part = 'sales' then
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh'),
    m as (select customer_id, d, rep, item_class, sum(rev) rev from mv_sales_explorer where customer_id in (select customer_id from s) and d >= (date_trunc('year', current_date) - interval '1 year')::date group by 1,2,3,4),
    md as (select customer_id, d, rep, sum(rev) rev from m group by 1,2,3)
    select json_build_object('asof', (select max(d) from mv_sales_explorer),
      'stores', (select json_agg(json_build_array(c.customer_id, c.customer_name, c.area, c.parent_account, c.terms, c.phone1, (select string_agg(distinct mm.merchandiser_name, ', ') from merchandiser_map mm where mm.customer_id = c.customer_id), (select string_agg(distinct mm.service_day, ', ') from merchandiser_map mm where mm.customer_id = c.customer_id))) from customers c where c.customer_id in (select customer_id from s)),
      'mon', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(json_build_array(to_char(mo,'YYYY-MM'), r) order by mo) arr from (select customer_id, date_trunc('month',d) mo, round(sum(rev)/1000,1) r from md group by 1,2) a group by 1) b),
      'days', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(to_char(d,'YYYY-MM-DD') order by d) arr from (select customer_id, d from md where d >= current_date - 150 group by 1,2 having sum(rev) > 0) a group by 1) b),
      'rep', (select json_object_agg(customer_id, rep) from (select distinct on (customer_id) customer_id, rep from (select customer_id, rep, sum(rev) r from md where d >= date_trunc('year', current_date) group by 1,2) x order by customer_id, r desc) y),
      'bud', (select json_object_agg(customer_id, arr) from (select customer_id, json_agg(json_build_array(month_number, round(b/1000,1)) order by month_number) arr from (select customer_id, month_number, sum(budget) b from budget_2026 where customer_id in (select customer_id from s) group by 1,2) a group by 1) b),
      'cat', (select json_agg(json_build_array(customer_id, item_class, round(r90/1000,1), round(ly90/1000,1))) from (select customer_id, item_class, sum(rev) filter (where d > current_date-91) r90, sum(rev) filter (where d > current_date-91-364 and d <= current_date-364) ly90 from m group by 1,2) x where abs(coalesce(r90,0)) + abs(coalesce(ly90,0)) > 5000)
    ) into v_out;

  elsif p_part = 'skus' then
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh'),
    m as (select customer_id, d, inventory_id, item_class, description, rev, qty from mv_sales_explorer where customer_id in (select customer_id from s) and d >= current_date - 91 - 364 and coalesce(description,'') not ilike '%MOQ%' and inventory_id is not null),
    k as (select customer_id, inventory_id, sum(rev) filter (where d > current_date-91) r90, sum(rev) filter (where d > current_date-91-364 and d <= current_date-364) ly90, max(d) last_d from m group by 1,2),
    u as (select customer_id, inventory_id, max(description) descr,
            count(distinct date_trunc('month', d)) filter (where d < date_trunc('month', current_date)) nmo,
            sum(qty) filter (where d < date_trunc('month', current_date)) q6,
            sum(qty) filter (where d >= date_trunc('month', current_date)) qm,
            max(d) last_d
          from m where d >= date_trunc('month', current_date) - interval '6 months' group by 1,2)
    select json_build_object(
      'sku', (select json_agg(json_build_array(customer_id, inventory_id, round(coalesce(r90,0)/1000,1), round(coalesce(ly90,0)/1000,1), to_char(last_d,'YYYY-MM-DD'))) from k where coalesce(r90,0) > 3000 or coalesce(ly90,0) > 10000),
      'skud', (select json_object_agg(inventory_id, json_build_array(description, item_class)) from (select distinct on (inventory_id) inventory_id, description, item_class from m where inventory_id in (select inventory_id from k where coalesce(r90,0) > 3000 or coalesce(ly90,0) > 10000) order by inventory_id, d desc) z),
      'usual', (select json_agg(json_build_array(customer_id, inventory_id, descr, round(q6 / 6.0, 1), coalesce(qm, 0), to_char(last_d,'YYYY-MM-DD'), nmo)) from u where nmo >= 3 and q6 > 0)
    ) into v_out;

  elsif p_part = 'period' then
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh'),
    a as (select max(d) asof from mv_sales_explorer),
    m as (select customer_id, item_class, d, rev from mv_sales_explorer, a where customer_id in (select customer_id from s) and (d between date_trunc('year', a.asof)::date and a.asof or d between (date_trunc('year', a.asof) - interval '1 year')::date and (a.asof - interval '1 year')::date)),
    p as (select customer_id, coalesce(item_class,'Unclassified') cls,
            sum(rev) filter (where d >= date_trunc('year',(select asof from a))) ytd,
            sum(rev) filter (where d < date_trunc('year',(select asof from a))) ytdly,
            sum(rev) filter (where d >= date_trunc('month',(select asof from a))) mtd,
            sum(rev) filter (where d < date_trunc('year',(select asof from a)) and d >= (date_trunc('month',(select asof from a)) - interval '1 year')) mtdly
          from m group by 1,2)
    select json_build_object('asof',(select asof from a),'ly_to',(select (asof - interval '1 year')::date from a),
      'pc', (select json_agg(json_build_array(customer_id, cls, round(coalesce(ytd,0)), round(coalesce(ytdly,0)), round(coalesce(mtd,0)), round(coalesce(mtdly,0)))) from p where abs(coalesce(ytd,0)) + abs(coalesce(ytdly,0)) > 0),
      'cb', (select json_agg(json_build_array(customer_id, coalesce(item_class,'Unclassified'), round(b))) from (select customer_id, item_class, sum(budget) b from budget_2026 where month_number = extract(month from (select asof from a))::int and customer_id in (select customer_id from s) group by 1,2 having sum(budget) <> 0) x)
    ) into v_out;

  elsif p_part = 'pskus' then
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh'),
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
    -- invoiced lines, last 45 days, for the deal log. Its own part: the page loads it after the main parts.
    with s as (select customer_id from ask_kam_accounts where kam = 'Shallet Marsh')
    select json_build_object(
      'inv', (select json_agg(json_build_array(customer_id, to_char(invoice_date,'YYYY-MM-DD'), inventory_id, q, fq, p)) from (select customer_id, invoice_date, inventory_id, sum(quantity) filter (where unit_price > 0) q, sum(quantity) filter (where unit_price = 0) fq, round(max(unit_price)) p from invoiced_items where customer_id in (select customer_id from s) and invoice_date >= current_date - 45 and tran_type in ('INV','CRM','DRM') and (invoice_status not in ('Voided','Rejected') or invoice_status is null) and inventory_id is not null group by 1,2,3) iv),
      'inv_synced', (select max(synced_at) from invoiced_items where customer_id in (select customer_id from s) and invoice_date >= current_date - 45)
    ) into v_out;

  else
    raise exception 'unknown part %', p_part using errcode = '22023';
  end if;
  return v_out;
end $function$;

revoke all on function public.key_hub_data(text) from public, anon;
grant execute on function public.key_hub_data(text) to authenticated;

-- shared notes log
create table if not exists public.key_hub_notes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('note','reason','promise','manager','backup','deal','collect')),
  ref text, c text, sku text, chain text,
  label text, src text, eta date, amount numeric, date date,
  name text, phone text, text text,
  by uuid default auth.uid(), by_name text,
  at timestamptz not null default now()
);
create index if not exists key_hub_notes_at_idx on public.key_hub_notes (at desc);
alter table public.key_hub_notes enable row level security;
drop policy if exists key_hub_notes_read on public.key_hub_notes;
create policy key_hub_notes_read on public.key_hub_notes for select to authenticated using (public.is_manager());
drop policy if exists key_hub_notes_add on public.key_hub_notes;
create policy key_hub_notes_add on public.key_hub_notes for insert to authenticated with check (public.is_manager() and by = auth.uid());
drop policy if exists key_hub_notes_delete on public.key_hub_notes;
create policy key_hub_notes_delete on public.key_hub_notes for delete to authenticated
  using (public.is_manager() and (by = auth.uid() or public.is_price_approver()));

-- ticks: one row per key, latest value wins
create table if not exists public.key_hub_ticks (
  k text primary key,
  v text,
  by uuid default auth.uid(), by_name text,
  at timestamptz not null default now()
);
alter table public.key_hub_ticks enable row level security;
drop policy if exists key_hub_ticks_read on public.key_hub_ticks;
create policy key_hub_ticks_read on public.key_hub_ticks for select to authenticated using (public.is_manager());
drop policy if exists key_hub_ticks_add on public.key_hub_ticks;
create policy key_hub_ticks_add on public.key_hub_ticks for insert to authenticated with check (public.is_manager());
drop policy if exists key_hub_ticks_change on public.key_hub_ticks;
create policy key_hub_ticks_change on public.key_hub_ticks for update to authenticated using (public.is_manager()) with check (public.is_manager());

grant select, insert, delete on public.key_hub_notes to authenticated;
grant select, insert, update on public.key_hub_ticks to authenticated;
