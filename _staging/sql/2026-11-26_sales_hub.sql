-- DFL Sales Hub (Scott-only page, management/sales-hub.html).
-- ONE read-only function. It writes nothing and changes no tables. Gated by is_price_approver() (Scott only),
-- the same gate as the Sales Explorer. Approved by Scott on 26 Nov 2026.
--
-- Rules copied from refresh_morning_brief() so the numbers match the EA Command Centre:
--   open orders  = order_type 'SO', status 'Open', open_qty > 0, salesperson not null; value = unit_price * open_qty
--   back orders  = order_type 'SO', status 'Back Order', open_qty > 0;                  value = unit_price * open_qty
-- Parts: pulse, reps, orders, backorders, customer, order, search.

create or replace function public.sales_hub_data(p_part text, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_out   jsonb;
  v_now   timestamp := (now() at time zone 'America/Jamaica');
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_ms    date := date_trunc('month', (now() at time zone 'America/Jamaica'))::date;
  v_mn    int  := extract(month from (now() at time zone 'America/Jamaica'))::int;
  v_cid   text;
  v_nbr   text;
  v_snap  bigint;
  v_q     text;
begin
  if not public.is_price_approver() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  p := coalesce(p, '{}'::jsonb);

  -- ───────────────────────── pulse: the tiles ─────────────────────────
  if p_part = 'pulse' then
    select jsonb_build_object(
      'as_at', m.data_as_at_date, 'pace_date', m.pace_date,
      'wd_done', m.working_days_elapsed, 'wd_total', m.total_working_days, 'pace_pct', m.pace_pct,
      'target', m.full_target, 'sales', coalesce(m.net_invoiced_exact, m.net_invoiced), 'ach_pct', m.ach_pct,
      'projected', m.projected_month_end, 'proj_low', m.projected_low, 'proj_high', m.projected_high,
      'refreshed_at', m.refreshed_at,
      'cal_days', extract(day from (date_trunc('month', v_now) + interval '1 month' - interval '1 day'))::int
    ) into v_out
    from public.morning_brief_cache m where m.id = 1;

    select coalesce(v_out, '{}'::jsonb) || jsonb_build_object(
      'open_n',   count(distinct o.order_nbr) filter (where o.status = 'Open' and o.sp is not null),
      'open_v',   round(coalesce(sum(o.v) filter (where o.status = 'Open' and o.sp is not null), 0)),
      'bo_n',     count(distinct o.order_nbr) filter (where o.status = 'Back Order'),
      'bo_v',     round(coalesce(sum(o.v) filter (where o.status = 'Back Order'), 0)),
      'credit_n', count(distinct o.order_nbr) filter (where o.status = 'Credit Hold'),
      'credit_v', round(coalesce(sum(o.v) filter (where o.status = 'Credit Hold'), 0)),
      'hold_n',   count(distinct o.order_nbr) filter (where o.status = 'On Hold'),
      'hold_v',   round(coalesce(sum(o.v) filter (where o.status = 'On Hold'), 0))
    ) into v_out
    from (
      select so.order_nbr, so.status, soi.salesperson as sp, soi.unit_price * soi.open_qty as v
      from public.sales_orders so
      join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
      where so.order_type = 'SO' and soi.open_qty > 0
        and so.status in ('Open', 'Back Order', 'Credit Hold', 'On Hold')
    ) o;
    return v_out;
  end if;

  -- ───────────────────────── reps ─────────────────────────
  if p_part = 'reps' then
    select jsonb_build_object(
      'reps', coalesce(jsonb_agg(jsonb_build_object(
          'name', r.salesperson, 'id', r.salesperson_id, 'area', r.area,
          'target', r.monthly_target, 'sales', r.monthly_actual, 'ach', r.pct_to_target,
          'last_invoice', r.last_invoice_date, 'active', r.active_customers_mtd,
          'open_v', round(coalesce(o.open_v, 0)), 'bo_v', round(coalesce(o.bo_v, 0)),
          'support', s.support) order by r.pct_to_target), '[]'::jsonb),
      'refreshed_at', max(r.refreshed_at))
    into v_out
    from public.rep_dashboard_cache r
    left join (
      select soi.salesperson as sp,
             sum(soi.unit_price * soi.open_qty) filter (where so.status = 'Open') as open_v,
             sum(soi.unit_price * soi.open_qty) filter (where so.status = 'Back Order') as bo_v
      from public.sales_orders so
      join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
      where so.order_type = 'SO' and soi.open_qty > 0 and so.status in ('Open', 'Back Order') and soi.salesperson is not null
      group by soi.salesperson
    ) o on o.sp = r.salesperson
    left join lateral (select s2.support from public.ss_hub_support s2 where r.salesperson = any (s2.reps) limit 1) s on true
    where coalesce(r.monthly_target, 0) > 0 or coalesce(r.monthly_actual, 0) > 0;
    return v_out;
  end if;

  -- ───────────────────────── orders: list and by-area ─────────────────────────
  if p_part = 'orders' then
    with ol as (
      select so.order_nbr, so.status, so.order_date, so.customer, so.customer_name, so.sales_area,
             max(soi.salesperson) as sp, sum(soi.unit_price * soi.open_qty) as v, count(*) as n
      from public.sales_orders so
      join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
      where so.order_type = 'SO' and so.status in ('Open', 'Shipping', 'On Hold', 'Credit Hold')
        and soi.open_qty > 0 and soi.salesperson is not null
      group by so.order_nbr, so.status, so.order_date, so.customer, so.customer_name, so.sales_area
    ),
    k as (select distinct on (customer_id) customer_id, case kam when 'Damita Samuels-Foster' then 'key_damita' when 'Shallet Marsh' then 'key' when 'Andrea Skelton' then 'chain' else lower(channel) end as ch from public.ask_kam_accounts order by customer_id, kam),
    areas as (
      select coalesce(nullif(sales_area, ''), 'Unassigned') as a,
             count(distinct order_nbr) filter (where status = 'Open') as open_n,
             coalesce(sum(v) filter (where status = 'Open'), 0) as open_v,
             count(distinct order_nbr) filter (where status = 'Credit Hold') as credit_n,
             coalesce(sum(v) filter (where status = 'Credit Hold'), 0) as credit_v,
             count(distinct order_nbr) filter (where status = 'On Hold') as hold_n,
             coalesce(sum(v) filter (where status = 'On Hold'), 0) as hold_v
      from ol group by 1
    ),
    boa as (
      select coalesce(nullif(so.sales_area, ''), 'Unassigned') as a,
             count(distinct so.order_nbr) as bo_n, sum(soi.unit_price * soi.open_qty) as bo_v
      from public.sales_orders so
      join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
      where so.status = 'Back Order' and so.order_type = 'SO' and soi.open_qty > 0
      group by 1
    )
    select jsonb_build_object(
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'nbr', o.order_nbr, 'st', o.status, 'date', o.order_date, 'days', greatest(v_today - o.order_date, 0),
          'cid', o.customer, 'cust', o.customer_name, 'rep', o.sp,
          'area', coalesce(nullif(o.sales_area, ''), 'Unassigned'), 'chan', k.ch,
          'v', round(o.v), 'lines', o.n) order by o.v desc)
        from ol o left join k on k.customer_id = o.customer), '[]'::jsonb),
      'areas', coalesce((select jsonb_agg(jsonb_build_object(
          'a', coalesce(ar.a, b.a),
          'open_n', coalesce(ar.open_n, 0), 'open_v', round(coalesce(ar.open_v, 0)),
          'credit_n', coalesce(ar.credit_n, 0), 'credit_v', round(coalesce(ar.credit_v, 0)),
          'hold_n', coalesce(ar.hold_n, 0), 'hold_v', round(coalesce(ar.hold_v, 0)),
          'bo_n', coalesce(b.bo_n, 0), 'bo_v', round(coalesce(b.bo_v, 0))))
        from areas ar full join boa b on b.a = ar.a), '[]'::jsonb)
    ) into v_out;
    return v_out;
  end if;

  -- ───────────────────────── backorders: every open line, with the rep's answer ─────────────────────────
  if p_part = 'backorders' then
    select jsonb_build_object(
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'nbr', so.order_nbr, 'line', soi.line_nbr, 'item', soi.line_description, 'sku', soi.inventory_id,
          'cid', so.customer, 'cust', so.customer_name, 'qty', soi.open_qty, 'price', soi.unit_price,
          'v', round(soi.unit_price * soi.open_qty), 'days', greatest(v_today - so.order_date, 0),
          'rep', soi.salesperson, 'area', coalesce(nullif(so.sales_area, ''), 'Unassigned'), 'chan', lower(k.channel),
          's71', soi.qty_on_hand_71, 'ans', a.decision, 'ans_at', a.at, 'ans_state', a.state) order by so.order_date)
        from public.sales_orders so
        join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
        left join (select distinct on (customer_id) customer_id, case kam when 'Damita Samuels-Foster' then 'key_damita' when 'Shallet Marsh' then 'key' when 'Andrea Skelton' then 'chain' else channel end as channel from public.ask_kam_accounts order by customer_id, kam) k on k.customer_id = so.customer
        left join lateral (select x.decision, x.at, x.state from public.ss_backorder_acu x where x.nbr = so.order_nbr order by x.at desc limit 1) a on true
        where so.status = 'Back Order' and so.order_type = 'SO' and soi.open_qty > 0), '[]'::jsonb),
      'support', coalesce((select jsonb_object_agg(r, s.support) from public.ss_hub_support s, unnest(s.reps) as r), '{}'::jsonb)
    ) into v_out;
    return v_out;
  end if;

  -- ───────────────────────── customer pop-up ─────────────────────────
  if p_part = 'customer' then
    v_cid := p ->> 'id';
    select id into v_snap from public.ar_aging_snapshots where status = 'complete' order by snapshot_date desc, id desc limit 1;
    select jsonb_build_object(
      'id', c.customer_id, 'name', c.customer_name,
      'area', coalesce(nullif(c.sales_area, ''), c.area), 'segment', c.segment, 'terms', c.terms,
      'rep', coalesce((select b.salesperson from public.budget_2026 b where b.customer_id = c.customer_id and b.month_number = v_mn and b.salesperson is not null group by b.salesperson order by sum(b.budget) desc limit 1),
                      (select m.rep from public.mv_sales_explorer m where m.customer_id = c.customer_id order by m.d desc limit 1)),
      'chan', (select case k.kam when 'Damita Samuels-Foster' then 'key_damita' when 'Shallet Marsh' then 'key' when 'Andrea Skelton' then 'chain' else lower(k.channel) end from public.ask_kam_accounts k where k.customer_id = c.customer_id limit 1),
      'credit_limit', cc.credit_limit,
      'credit_hold', exists (select 1 from public.sales_orders x where x.customer = c.customer_id and x.status = 'Credit Hold'),
      'sales', (select round(coalesce(sum(m.rev), 0)) from public.mv_sales_explorer m where m.customer_id = c.customer_id and m.d >= v_ms),
      'target', (select round(coalesce(sum(b.budget), 0)) from public.budget_2026 b where b.customer_id = c.customer_id and b.month_number = v_mn),
      'ar', (select jsonb_build_object(
                'cur',  round(coalesce(sum(a.balance_jmd) filter (where a.bucket = 'Current'), 0)),
                'd60',  round(coalesce(sum(a.balance_jmd) filter (where a.bucket = '31-60'), 0)),
                'd90',  round(coalesce(sum(a.balance_jmd) filter (where a.bucket = '61-90'), 0)),
                'd91',  round(coalesce(sum(a.balance_jmd) filter (where a.bucket = '90+'), 0)),
                'total', round(coalesce(sum(a.balance_jmd), 0)),
                'overdue', round(coalesce(sum(a.balance_jmd) filter (where a.due_date < v_today), 0)))
             from public.ar_aging_rows a where a.snapshot_id = v_snap and a.customer_id = c.customer_id),
      'last_payment', (select jsonb_build_object('date', x.application_date, 'amt', round(x.amount_jmd))
             from public.ar_payments x
             where x.customer_id = c.customer_id and x.payment_type = 'Payment' and coalesce(x.is_missing, false) = false
             order by x.application_date desc nulls last limit 1),
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
                'nbr', q.order_nbr, 'st', q.status, 'date', q.order_date, 'v', round(q.v)) order by q.order_date desc)
             from (select so.order_nbr, so.status, so.order_date, sum(soi.unit_price * soi.open_qty) as v
                   from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
                   where so.customer = c.customer_id and so.order_type = 'SO' and soi.open_qty > 0
                     and so.status in ('Open', 'Shipping', 'On Hold', 'Credit Hold')
                   group by so.order_nbr, so.status, so.order_date) q), '[]'::jsonb),
      'bo', coalesce((select jsonb_agg(jsonb_build_object(
                'nbr', so.order_nbr, 'item', soi.line_description, 'qty', soi.open_qty,
                'days', greatest(v_today - so.order_date, 0), 's71', soi.qty_on_hand_71,
                'ans', (select x.decision from public.ss_backorder_acu x where x.nbr = so.order_nbr order by x.at desc limit 1)) order by so.order_date)
             from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
             where so.customer = c.customer_id and so.status = 'Back Order' and so.order_type = 'SO' and soi.open_qty > 0), '[]'::jsonb)
    ) into v_out
    from public.customers c
    left join public.customer_credit cc on cc.customer_id = c.customer_id
    where c.customer_id = v_cid;
    return v_out;
  end if;

  -- ───────────────────────── order pop-up ─────────────────────────
  if p_part = 'order' then
    v_nbr := p ->> 'nbr';
    select jsonb_build_object(
      'nbr', so.order_nbr, 'st', so.status, 'date', so.order_date, 'days', greatest(v_today - so.order_date, 0),
      'cid', so.customer, 'cust', so.customer_name, 'area', coalesce(nullif(so.sales_area, ''), 'Unassigned'),
      'created_by', so.created_by, 'sched', so.sched_shipment, 'total', round(so.order_total),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
                'sku', soi.inventory_id, 'item', soi.line_description, 'qty', soi.order_qty, 'open', soi.open_qty,
                'price', soi.unit_price, 'ext', round(soi.ext_price), 's71', soi.qty_on_hand_71, 'rep', soi.salesperson) order by soi.line_nbr)
              from public.so_ordered_items soi where soi.order_nbr = so.order_nbr), '[]'::jsonb),
      'customer', public.sales_hub_data('customer', jsonb_build_object('id', so.customer))
    ) into v_out
    from public.sales_orders so where so.order_nbr = v_nbr and so.order_type = 'SO' limit 1;
    return v_out;
  end if;

  -- ───────────────────────── search: orders, customers, reps ─────────────────────────
  if p_part = 'search' then
    v_q := trim(coalesce(p ->> 'q', ''));
    if length(v_q) < 2 then return jsonb_build_object('orders', '[]'::jsonb, 'customers', '[]'::jsonb, 'reps', '[]'::jsonb); end if;
    select jsonb_build_object(
      'orders', coalesce((select jsonb_agg(jsonb_build_object('nbr', x.order_nbr, 'cust', x.customer_name, 'st', x.status, 'v', round(x.order_total)))
                 from (select order_nbr, customer_name, status, order_total from public.sales_orders
                       where order_type = 'SO' and order_nbr like v_q || '%' order by order_date desc limit 6) x), '[]'::jsonb),
      'customers', coalesce((select jsonb_agg(jsonb_build_object('id', x.customer_id, 'name', x.customer_name, 'area', coalesce(nullif(x.sales_area, ''), x.area)))
                 from (select customer_id, customer_name, sales_area, area from public.customers
                       where customer_status = 'Active' and customer_name ilike '%' || v_q || '%' order by customer_name limit 8) x), '[]'::jsonb),
      'reps', coalesce((select jsonb_agg(jsonb_build_object('name', x.salesperson, 'ach', x.pct_to_target))
                 from (select salesperson, pct_to_target from public.rep_dashboard_cache
                       where salesperson ilike '%' || v_q || '%' order by salesperson limit 5) x), '[]'::jsonb)
    ) into v_out;
    return v_out;
  end if;

  -- ───────────────────────── support: what each support person has done today ─────────────────────────
  if p_part = 'support' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'support', s.support, 'full_name', s.full_name, 'reps', to_jsonb(s.reps),
        'acted_today', (select count(*) from (
            select 1 from public.ss_hub_ticks t where t.by_name = s.full_name and (t.at at time zone 'America/Jamaica')::date = v_today
            union all
            select 1 from public.ss_hub_notes n where n.by_name = s.full_name and (n.at at time zone 'America/Jamaica')::date = v_today) x),
        'last_touch', (select max(y.at) from (
            select t.at from public.ss_hub_ticks t where t.by_name = s.full_name
            union all
            select n.at from public.ss_hub_notes n where n.by_name = s.full_name) y),
        'bo_n', (select count(distinct so.order_nbr) from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
                 where so.status = 'Back Order' and so.order_type = 'SO' and soi.open_qty > 0 and soi.salesperson = any (s.reps)),
        'open_n', (select count(distinct so.order_nbr) from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
                 where so.status = 'Open' and so.order_type = 'SO' and soi.open_qty > 0 and soi.salesperson = any (s.reps)),
        'hold_n', (select count(distinct so.order_nbr) from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
                 where so.status in ('Credit Hold', 'On Hold') and so.order_type = 'SO' and soi.open_qty > 0 and soi.salesperson = any (s.reps))
      ) order by s.support), '[]'::jsonb) into v_out
    from public.ss_hub_support s;
    return jsonb_build_object('support', v_out, 'now', now());
  end if;

  -- ───────────────────────── stores: the Chain and Key lists, same ids as the Chain & Key dashboard and the hubs ─────────────────────────
  -- chain = Andrea Skelton (44), key = Shallet Marsh (35), key_damita = Damita Samuels-Foster (22). Applied 26 Nov 2026.
  if p_part = 'stores' then
    with ids as (
      select a.customer_id as cid, a.kam,
             case a.kam when 'Andrea Skelton' then 'chain' when 'Shallet Marsh' then 'key' else 'key_damita' end as grp
      from public.ask_kam_accounts a
      where a.kam in ('Andrea Skelton', 'Shallet Marsh', 'Damita Samuels-Foster')
    ),
    tgt as (select b.customer_id as cid, sum(b.budget) as t from public.budget_2026 b where b.month_number = v_mn and b.customer_id in (select cid from ids) group by 1),
    sal as (select m.customer_id as cid, sum(m.rev) as s from public.mv_sales_explorer m where m.d >= v_ms and m.customer_id in (select cid from ids) group by 1),
    lst as (select m.customer_id as cid, max(m.d) as last_d from public.mv_sales_explorer m where m.d >= v_today - 365 and m.customer_id in (select cid from ids) group by 1),
    oo as (select so.customer as cid, sum(soi.unit_price * soi.open_qty) as v
           from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
           where so.order_type = 'SO' and so.status = 'Open' and soi.open_qty > 0 and soi.salesperson is not null and so.customer in (select cid from ids) group by 1),
    bo as (select so.customer as cid, sum(soi.unit_price * soi.open_qty) as v
           from public.sales_orders so join public.so_ordered_items soi on soi.order_nbr = so.order_nbr
           where so.order_type = 'SO' and so.status = 'Back Order' and soi.open_qty > 0 and so.customer in (select cid from ids) group by 1)
    select jsonb_build_object('stores', coalesce(jsonb_agg(jsonb_build_object(
        'id', i.cid, 'name', c.customer_name, 'grp', i.grp, 'kam', i.kam,
        'target', round(coalesce(tgt.t, 0)), 'sales', round(coalesce(sal.s, 0)),
        'open_v', round(coalesce(oo.v, 0)), 'bo_v', round(coalesce(bo.v, 0)), 'last', lst.last_d) order by c.customer_name), '[]'::jsonb)) into v_out
    from ids i
    left join public.customers c on c.customer_id = i.cid
    left join tgt on tgt.cid = i.cid
    left join sal on sal.cid = i.cid
    left join lst on lst.cid = i.cid
    left join oo on oo.cid = i.cid
    left join bo on bo.cid = i.cid;
    return v_out;
  end if;

  raise exception 'unknown part %', p_part using errcode = '22023';
end
$fn$;

revoke all on function public.sales_hub_data(text, jsonb) from public, anon;
grant execute on function public.sales_hub_data(text, jsonb) to authenticated;
