-- DFL Sales Centre, part 2 (applied 26 Nov 2026 as migrations sales_hub_data_key_groups_stores and sales_hub_data_products_categories_dropped).
-- Everything here is read-only. It extends public.sales_hub_data() (see 2026-11-26_sales_hub.sql) and is applied on top of it by
-- editing the live function text, so the full current definition is best read with pg_get_functiondef('public.sales_hub_data(text,jsonb)'::regprocedure).
--
-- 1. public.sales_hub_channel(): the one place that says which customers are Chain / Key.
--      chain      = ask_kam_accounts, Andrea Skelton (44)  (same lists as the Chain & Key dashboard and the hubs)
--      key        = ask_kam_accounts, Shallet Marsh (35)
--      key_damita = ask_kam_accounts, Damita Samuels-Foster (22)
--      key_other  = active customers whose segment is Key but who are on none of the three lists (14 on 26 Nov), they sit in reps' books
--    The page shows "All key" as key + key_damita + key_other.
-- 2. New parts of sales_hub_data: stores (now with key_other), products (search), product (stock at 71, prices, deal sheet, last sold),
--    categories (budget_2026 vs the Sales Explorer summary, by item class), category (key SKUs behind, from cat_sku_cache),
--    rep_dropped (customers who bought in the last 3 full months but not yet this month, by dominant rep).
-- 3. The orders, backorders and customer parts now read the channel from sales_hub_channel().

create or replace function public.sales_hub_channel()
returns table(customer_id text, ch text, kam text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $f$
  select a.customer_id, case a.kam when 'Andrea Skelton' then 'chain' when 'Shallet Marsh' then 'key' when 'Damita Samuels-Foster' then 'key_damita' else lower(a.channel) end, a.kam
  from public.ask_kam_accounts a
  union all
  select c.customer_id, 'key_other', null::text
  from public.customers c
  where c.segment = 'Key' and c.customer_status = 'Active'
    and not exists (select 1 from public.ask_kam_accounts a where a.customer_id = c.customer_id)
$f$;
revoke all on function public.sales_hub_channel() from public, anon, authenticated;

-- The part bodies (stores, products, product, categories, category, rep_dropped) were added to sales_hub_data with a DO block that
-- rewrites the function text; the exact SQL of each part is in the live function. Key points of each, for review:
--   products     : stock_items_raw (Active) matched on item number prefix or name, stock at warehouse '71' from stock_by_warehouse
--   product      : list price = stock_items_raw.default_price, cost = avg_cost, deal sheet = deal_sheet_items on the sheet with is_current,
--                  back orders and open orders from so_ordered_items (EA rules), last 6 sales from mv_sales_explorer (price = rev / qty)
--   categories   : budget_2026 (month) vs mv_sales_explorer (month to date) by item class, open and back order value by so_ordered_items.item_class,
--                  manager names as on the Category Intelligence page; classes under J$0.5M of both target and sales are left out
--   category     : cat_sku_cache key SKUs for the class where actual_mtd < prorated_target; full-month target = prorated / pct month elapsed
--   rep_dropped  : mv_sales_explorer, 3 full months before this month vs this month, customer belongs to the rep who sold the most to them this year
