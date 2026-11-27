-- Company-wide customer scoreboard for the rep app's Admin → "All accounts" view.
-- One row per customer across every rep: MTD net vs this month's budget, plus
-- YTD actual vs the budget for the full months already closed this year.
-- The client adds the current month's budget pro-rated by selling days, so the
-- YTD target is "where they should be today", not the whole of this month.
-- Managers/admins only (is_manager()).
create or replace function public.get_company_customer_scoreboard()
returns table(
  customer_id text, customer_name text, salespeople text, area text,
  mtd_budget numeric, mtd_net numeric, order_count integer, last_order_date date,
  ytd_budget_prior numeric, ytd_actual numeric
)
language sql stable security definer
set search_path to 'public'
as $$
  with now_jm as (
    select (now() at time zone 'America/Jamaica')::date d
  ), m as (
    select extract(month from d)::int mn, to_char(d,'YYYY') yr from now_jm
  ), mtd as (
    select c.customer_id,
           max(c.customer_name) customer_name,
           string_agg(distinct c.salesperson, ', ') salespeople,
           sum(coalesce(c.monthly_budget,0)) mtd_budget,
           greatest(0, sum(coalesce(c.net_sales,0))) mtd_net,
           sum(coalesce(c.order_count,0))::int order_count,
           max(c.last_order_date) last_order_date
    from rep_customer_cache c group by c.customer_id
  ), bud as (
    select b.customer_id, max(b.customer_name) customer_name, max(b.area) area,
           max(b.salesperson) salesperson,
           sum(b.budget) filter (where b.month_number < (select mn from m)) prior,
           sum(b.budget) filter (where b.month_number = (select mn from m)) cur
    from budget_2026 b group by b.customer_id
  ), act as (
    select a.customer_id, sum(a.actual_amount) ytd
    from monthly_actuals a, m
    where a.period between m.yr||'01' and m.yr||'12'
    group by a.customer_id
  )
  select coalesce(t.customer_id, b.customer_id),
         coalesce(t.customer_name, b.customer_name),
         coalesce(t.salespeople, b.salesperson),
         b.area,
         coalesce(t.mtd_budget, b.cur, 0),
         coalesce(t.mtd_net, 0),
         coalesce(t.order_count, 0),
         t.last_order_date,
         coalesce(b.prior, 0),
         coalesce(a.ytd, 0)
  from mtd t
  full join bud b on b.customer_id = t.customer_id
  left join act a on a.customer_id = coalesce(t.customer_id, b.customer_id)
  where public.is_manager()
$$;

revoke all on function public.get_company_customer_scoreboard() from public, anon;
grant execute on function public.get_company_customer_scoreboard() to authenticated;
