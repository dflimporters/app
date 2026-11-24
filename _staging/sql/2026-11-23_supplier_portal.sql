-- ============================================================
-- Supplier portal (2026-11-23)
-- ============================================================
-- Lets a supplier (first: ANSA McAL, Clean & White) see sell-out, stock and
-- inbound shipments for THEIR items only, instead of DFL emailing a monthly
-- stock & sales report.
--
-- Shape:
--   suppliers                 one row per supplier
--   supplier_items            which inventory_ids belong to which supplier
--   supplier_users            supplier staff allowed to sign in (by email)
--   supplier_shipments(+lines) inbound PO / container log, kept by DFL staff
--   profiles.role 'supplier'  provisioned by handle_new_user() from supplier_users
--
-- All tables: RLS on, no client grants. Every read/write goes through the
-- SECURITY DEFINER supplier_* RPCs below, which resolve the caller's supplier
-- server-side (a supplier can never pass someone else's id). DFL staff in
-- supplier_staff_viewer() can preview any supplier.
--
-- Suppliers never see: cost / margin, customer names, rep names.
-- They do see: cases and net sales value (J$, DFL selling price) by SKU,
-- channel (customer class) and area.
--
-- Re-runnable.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.suppliers (
  id          text primary key,             -- slug, e.g. 'ansamcal'
  name        text not null,
  brand_label text,                         -- shown in the header, e.g. 'Clean & White'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.supplier_items (
  supplier_id  text not null references public.suppliers(id) on delete cascade,
  inventory_id text not null,
  -- A by-the-unit selling code (e.g. "475ml MOQ 12", sold per bottle) rolls up
  -- into its case SKU: quantity / units_per_case counts as cases of rollup_to.
  rollup_to      text,
  units_per_case numeric check (units_per_case > 0),
  primary key (supplier_id, inventory_id),
  check ((rollup_to is null) = (units_per_case is null))
);

create table if not exists public.supplier_users (
  email       text primary key check (email = lower(email)),
  supplier_id text not null references public.suppliers(id) on delete cascade,
  full_name   text,
  active      boolean not null default true,
  added_by    uuid,
  added_at    timestamptz not null default now()
);

create table if not exists public.supplier_shipments (
  id            bigint generated always as identity primary key,
  supplier_id   text not null references public.suppliers(id) on delete cascade,
  reference     text not null,              -- PO number
  container_no  text,
  status        text not null default 'ordered'
                check (status in ('ordered','shipped','arrived','received','cancelled')),
  order_date    date,
  ship_date     date,
  eta           date,
  received_date date,
  notes         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);

create table if not exists public.supplier_shipment_lines (
  shipment_id  bigint not null references public.supplier_shipments(id) on delete cascade,
  inventory_id text not null,
  cases        numeric not null check (cases >= 0),
  primary key (shipment_id, inventory_id)
);

alter table public.suppliers               enable row level security;
alter table public.supplier_items          enable row level security;
alter table public.supplier_users          enable row level security;
alter table public.supplier_shipments      enable row level security;
alter table public.supplier_shipment_lines enable row level security;
revoke all on public.suppliers, public.supplier_items, public.supplier_users,
              public.supplier_shipments, public.supplier_shipment_lines
  from anon, authenticated;

-- ---------- seed: ANSA McAL / Clean & White ----------
insert into public.suppliers (id, name, brand_label)
values ('ansamcal', 'ANSA McAL', 'Clean & White')
on conflict (id) do nothing;

insert into public.supplier_items (supplier_id, inventory_id)
select 'ansamcal', inventory_id
from public.stock_items_raw
where description ilike 'clean & white%'
on conflict do nothing;

-- MOQ codes are invoiced per bottle (checked: J$83/unit on 475ml MOQ vs
-- ~J$2,200 per 24-bottle case), so roll them into their case SKU.
update public.supplier_items si set rollup_to = v.to_id, units_per_case = v.upc
from (values ('10003352', '10000678', 24),   -- 475ml MOQ 12  -> 475ml x 24
             ('10003353', '10000679', 12),   -- 950ml MOQ 6   -> 950ml x 12
             ('10003643', '10000677', 4))    -- 4L MOQ 4      -> 4L x 4
     v(id, to_id, upc)
where si.supplier_id = 'ansamcal' and si.inventory_id = v.id;

-- ---------- role ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'rep','manager','admin','merchandiser','team_leader','warehouse','pending','tl_merch',
  'relief_merchandiser','management','rep_management','hr','fleet','sales_support','supplier'
]));

-- ---------- predicates ----------
-- DFL staff who may preview any supplier's portal.
create or replace function public.supplier_staff_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and active
                   and role in ('admin','manager','management','rep_management'));
$$;

-- DFL staff who may keep the shipment log and supplier logins.
create or replace function public.supplier_staff_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and active
                   and role in ('admin','manager','rep_management'));
$$;

-- Which supplier is this request about? Suppliers: always their own (the
-- argument is ignored). Staff viewers: the one they asked for. Anyone else: error.
create or replace function public.supplier_resolve(p_supplier text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select su.supplier_id into v
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.supplier_users su on su.email = lower(u.email) and su.active
  join public.suppliers s on s.id = su.supplier_id and s.active
  where p.id = auth.uid() and p.role = 'supplier' and p.active;
  if v is not null then return v; end if;

  if public.supplier_staff_viewer() then
    if p_supplier is null or not exists (select 1 from public.suppliers where id = p_supplier) then
      raise exception 'Unknown supplier' using errcode = '22023';
    end if;
    return p_supplier;
  end if;

  raise exception 'Not authorised' using errcode = '42501';
end $$;

-- ---------- provisioning ----------
-- Step 1b added: an email in supplier_users (active) becomes role 'supplier'.
-- Placed after the admin allow-list and the staff roster, so a DFL person can
-- never be downgraded to a supplier by having their email in both.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := lower(new.email);
  v_phone text := public.normalize_jm_phone(new.phone);
  v_name  text := coalesce(new.raw_user_meta_data->>'name',
                           new.raw_user_meta_data->>'full_name',
                           new.email);
  v_rep   public.reps%rowtype;
  v_sup   public.supplier_users%rowtype;
begin
  -- 1. Admin allowlist takes priority (the ONLY way to get role 'admin').
  if v_email is not null and exists (
       select 1 from public.admin_emails a where lower(a.email) = v_email
     ) then
    select * into v_rep
    from public.reps r
    where lower(r.email) = v_email and r.active = true
    limit 1;

    insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
    values (new.id, v_name, 'admin', null, v_rep.id, true)
    on conflict (id) do nothing;
    return new;
  end if;

  -- 2. Match an ACTIVE roster row by email.
  if v_email is not null then
    select * into v_rep
    from public.reps r
    where lower(r.email) = v_email and r.active = true
    limit 1;

    if found then
      if v_rep.role = 'admin' then
        insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
        values (new.id, v_rep.name, 'pending', null, null, false)
        on conflict (id) do nothing;
        return new;
      end if;
      insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
      values (new.id, v_rep.name, v_rep.role, v_rep.salesperson_id, v_rep.id, true)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- 2b. Supplier login (supplier_users, active).
  if v_email is not null then
    select * into v_sup from public.supplier_users su
    where su.email = v_email and su.active;
    if found then
      insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
      values (new.id, coalesce(v_sup.full_name, v_email), 'supplier', null, null, true)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- 3. Otherwise match an ACTIVE roster row by phone (both sides normalised).
  if v_phone is not null then
    select * into v_rep
    from public.reps r
    where public.normalize_jm_phone(r.phone) = v_phone and r.active = true
    limit 1;

    if found then
      if v_rep.role = 'admin' then
        insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
        values (new.id, v_rep.name, 'pending', null, null, false)
        on conflict (id) do nothing;
        return new;
      end if;
      insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
      values (new.id, v_rep.name, v_rep.role, v_rep.salesperson_id, v_rep.id, true)
      on conflict (id) do nothing;
      return new;
    end if;
  end if;

  -- 4a. Phone signup with no roster match: park as pending.
  if new.phone is not null then
    insert into public.profiles (id, full_name, role, salesperson_id, rep_id, active)
    values (new.id,
            nullif(coalesce(new.raw_user_meta_data->>'name',
                            new.raw_user_meta_data->>'full_name'), ''),
            'pending', null, null, false)
    on conflict (id) do nothing;
    return new;
  end if;

  -- 4b. Email signup with no match: no profile (not provisioned).
  return new;
end;
$function$;

-- ---------- the dashboard ----------
-- One call returns everything the page draws. Months are calendar months in
-- Jamaica time; sales = INV + CRM + DRM lines (net of returns), same as the
-- rep dashboards. Customer names are never returned.
create or replace function public.supplier_dashboard(p_supplier text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_sup   text := public.supplier_resolve(p_supplier);
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_from  date := (date_trunc('month', v_today) - interval '24 months')::date;
  v_out   jsonb;
begin
  with codes as (      -- every code we read -> the case SKU it reports as
    select si.inventory_id code, coalesce(si.rollup_to, si.inventory_id) inventory_id,
           coalesce(si.units_per_case, 1) upc
    from public.supplier_items si where si.supplier_id = v_sup
  ),
  items as (           -- the case SKUs shown; stock includes rolled-up codes
    select si.inventory_id, r.description, r.item_status,
           coalesce(r.on_hand, 0) + coalesce((
             select sum(coalesce(r2.on_hand, 0) / c.upc) from codes c
             join public.stock_items_raw r2 on r2.inventory_id = c.code
             where c.inventory_id = si.inventory_id and c.code <> si.inventory_id), 0) on_hand
    from public.supplier_items si
    left join public.stock_items_raw r on r.inventory_id = si.inventory_id
    where si.supplier_id = v_sup and si.rollup_to is null
  ),
  lines as (
    select c.inventory_id,
           (ii.invoice_date at time zone 'UTC')::date d,
           coalesce(ii.quantity, 0) / c.upc q,
           coalesce(ii.ext_amount, 0) v,
           ii.customer_id,
           coalesce(nullif(ii.customer_class, ''), 'OTHER') channel,
           coalesce(nullif(ii.sales_area, ''), 'Unassigned') area
    from public.invoiced_items ii
    join codes c on c.code = ii.inventory_id
    where ii.inventory_id in (select code from codes)
      and ii.tran_type in ('INV','CRM','DRM')
      and ii.invoice_date >= v_from
  ),
  daily90 as (
    select inventory_id, sum(q) / 90.0 avg_daily
    from lines where d > v_today - 90 and d <= v_today
    group by 1
  ),
  snaps as (
    select s.inventory_id, s.snapshot_date d, s.on_hand,
           s.on_hand - lag(s.on_hand) over (partition by s.inventory_id order by s.snapshot_date) delta
    from public.stock_snapshots s
    where s.inventory_id in (select inventory_id from items)
      and s.snapshot_date >= v_today - 400
  ),
  sold_by_day as (
    select inventory_id, d, sum(q) q from lines where d >= v_today - 400 group by 1, 2
  )
  select jsonb_build_object(
    'supplier', (select jsonb_build_object('id', id, 'name', name, 'brand', brand_label)
                 from public.suppliers where id = v_sup),
    'viewer', jsonb_build_object(
       'staff',    public.supplier_staff_viewer(),
       'can_edit', public.supplier_staff_editor()),
    'today', v_today,
    'synced', jsonb_build_object(
       'sales', (select max(synced_at) from public.invoiced_items
                 where invoice_date >= v_today - 7),
       'stock', (select max(last_synced_at) from public.stock_items_raw
                 where inventory_id in (select inventory_id from items))),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.inventory_id, 'name', i.description, 'status', i.item_status,
                'on_hand', round(i.on_hand), 'avg_daily_90', round(coalesce(d.avg_daily, 0)::numeric, 2))
              order by i.description)
              from items i left join daily90 d using (inventory_id)), '[]'),
    -- Same days of last month / same month last year, so month-to-date is
    -- compared like for like (1st .. today's day-of-month).
    'sales_mtd_prior', coalesce((select jsonb_agg(x) from (
        select p.period, l.inventory_id id, round(sum(l.q)) cases, round(sum(l.v)) value
        from (values ('pm', 1), ('ly', 12)) p(period, back)
        join lines l
          on l.d >= (date_trunc('month', v_today) - make_interval(months => p.back))::date
         and l.d <= (v_today - make_interval(months => p.back))::date
        group by 1, 2 order by 1, 2) x), '[]'),
    'sales_monthly', coalesce((select jsonb_agg(x) from (
        select to_char(d, 'YYYY-MM') m, inventory_id id,
               round(sum(q)) cases, round(sum(v)) value
        from lines group by 1, 2 order by 1, 2) x), '[]'),
    'outlets_monthly', coalesce((select jsonb_agg(x) from (
        select to_char(d, 'YYYY-MM') m, count(distinct customer_id) outlets
        from lines where q > 0 group by 1 order by 1) x), '[]'),
    'channel_monthly', coalesce((select jsonb_agg(x) from (
        select to_char(d, 'YYYY-MM') m, channel, round(sum(q)) cases, round(sum(v)) value
        from lines where d >= v_from + interval '12 months' group by 1, 2 order by 1, 2) x), '[]'),
    'area_monthly', coalesce((select jsonb_agg(x) from (
        select to_char(d, 'YYYY-MM') m, area, round(sum(q)) cases, round(sum(v)) value
        from lines where d >= v_from + interval '12 months' group by 1, 2 order by 1, 2) x), '[]'),
    'stock_daily', coalesce((select jsonb_agg(x) from (
        select d, inventory_id id, on_hand from snaps
        where d >= v_today - 180 order by d, inventory_id) x), '[]'),
    -- A jump in on-hand of 250+ cases (returns rarely exceed ~150) = goods received. Estimated
    -- quantity adds back what was invoiced that day.
    'receipts_detected', coalesce((select jsonb_agg(x) from (
        select s.d, s.inventory_id id, round(s.delta + coalesce(sb.q, 0)) cases_est
        from snaps s left join sold_by_day sb using (inventory_id, d)
        where s.delta + coalesce(sb.q, 0) >= 250
        order by s.d desc, s.inventory_id) x), '[]'),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sh.id, 'reference', sh.reference, 'container_no', sh.container_no,
        'status', sh.status, 'order_date', sh.order_date, 'ship_date', sh.ship_date,
        'eta', sh.eta, 'received_date', sh.received_date, 'notes', sh.notes,
        'updated_at', sh.updated_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.inventory_id, 'cases', l.cases)
                           order by l.inventory_id)
                           from public.supplier_shipment_lines l where l.shipment_id = sh.id), '[]'))
        order by coalesce(sh.received_date, sh.eta, sh.ship_date, sh.order_date) desc nulls last, sh.id desc)
        from public.supplier_shipments sh where sh.supplier_id = v_sup), '[]')
  ) into v_out;
  return v_out;
end $$;

-- ---------- shipment log (DFL staff) ----------
create or replace function public.supplier_shipment_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id  bigint := nullif(p->>'id', '')::bigint;
  v_sup text   := p->>'supplier_id';
  l     jsonb;
begin
  if not public.supplier_staff_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers where id = v_sup) then
    raise exception 'Unknown supplier' using errcode = '22023';
  end if;
  if coalesce(trim(p->>'reference'), '') = '' then
    raise exception 'PO / reference is required' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.supplier_shipments (supplier_id, reference, container_no, status,
      order_date, ship_date, eta, received_date, notes, updated_by)
    values (v_sup, trim(p->>'reference'), nullif(trim(p->>'container_no'), ''),
      coalesce(nullif(p->>'status', ''), 'ordered'),
      nullif(p->>'order_date', '')::date, nullif(p->>'ship_date', '')::date,
      nullif(p->>'eta', '')::date, nullif(p->>'received_date', '')::date,
      nullif(trim(p->>'notes'), ''), auth.uid())
    returning id into v_id;
  else
    update public.supplier_shipments set
      reference = trim(p->>'reference'),
      container_no = nullif(trim(p->>'container_no'), ''),
      status = coalesce(nullif(p->>'status', ''), status),
      order_date = nullif(p->>'order_date', '')::date,
      ship_date = nullif(p->>'ship_date', '')::date,
      eta = nullif(p->>'eta', '')::date,
      received_date = nullif(p->>'received_date', '')::date,
      notes = nullif(trim(p->>'notes'), ''),
      updated_by = auth.uid(), updated_at = now()
    where id = v_id and supplier_id = v_sup;
    if not found then raise exception 'Shipment not found' using errcode = '22023'; end if;
    delete from public.supplier_shipment_lines where shipment_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'))
  loop
    if coalesce((l->>'cases')::numeric, 0) > 0 then
      if not exists (select 1 from public.supplier_items
                     where supplier_id = v_sup and inventory_id = l->>'id' and rollup_to is null) then
        raise exception 'Item % is not on this supplier', l->>'id' using errcode = '22023';
      end if;
      insert into public.supplier_shipment_lines (shipment_id, inventory_id, cases)
      values (v_id, l->>'id', (l->>'cases')::numeric)
      on conflict (shipment_id, inventory_id) do update set cases = excluded.cases;
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.supplier_shipment_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.supplier_staff_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  delete from public.supplier_shipments where id = p_id;
end $$;

-- ---------- supplier logins (DFL staff) ----------
create or replace function public.supplier_users_list(p_supplier text)
returns table (email text, full_name text, active boolean, added_at timestamptz, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.supplier_staff_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select su.email, su.full_name, su.active, su.added_at, u.last_sign_in_at
    from public.supplier_users su
    left join auth.users u on lower(u.email) = su.email
    where su.supplier_id = p_supplier
    order by su.active desc, su.email;
end $$;

-- Add or re-activate a login. If that email already signed in before it was
-- added (so has no profile), provision it now.
create or replace function public.supplier_user_add(p_supplier text, p_email text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_uid   uuid;
begin
  if not public.supplier_staff_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if v_email like '%@dflimporters.com'
     or exists (select 1 from public.admin_emails where lower(email) = v_email)
     or exists (select 1 from public.reps where lower(email) = v_email) then
    raise exception 'That is a DFL staff email' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier) then
    raise exception 'Unknown supplier' using errcode = '22023';
  end if;

  insert into public.supplier_users (email, supplier_id, full_name, active, added_by)
  values (v_email, p_supplier, nullif(trim(p_name), ''), true, auth.uid())
  on conflict (email) do update
    set supplier_id = excluded.supplier_id,
        full_name = coalesce(excluded.full_name, supplier_users.full_name),
        active = true;

  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is not null then
    insert into public.profiles (id, full_name, role, active)
    values (v_uid, coalesce(nullif(trim(p_name), ''), v_email), 'supplier', true)
    on conflict (id) do update set active = true
      where profiles.role = 'supplier';
  end if;
end $$;

create or replace function public.supplier_user_remove(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if not public.supplier_staff_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.supplier_users set active = false where email = v_email;
  update public.profiles p set active = false
  from auth.users u
  where u.id = p.id and lower(u.email) = v_email and p.role = 'supplier';
end $$;

-- ---------- grants ----------
revoke all on function public.supplier_staff_viewer()             from public, anon;
revoke all on function public.supplier_staff_editor()             from public, anon;
revoke all on function public.supplier_resolve(text)              from public, anon, authenticated;
revoke all on function public.supplier_dashboard(text)            from public, anon;
revoke all on function public.supplier_shipment_save(jsonb)       from public, anon;
revoke all on function public.supplier_shipment_delete(bigint)    from public, anon;
revoke all on function public.supplier_users_list(text)           from public, anon;
revoke all on function public.supplier_user_add(text, text, text) from public, anon;
revoke all on function public.supplier_user_remove(text)          from public, anon;
grant execute on function public.supplier_staff_viewer()             to authenticated;
grant execute on function public.supplier_staff_editor()             to authenticated;
grant execute on function public.supplier_dashboard(text)            to authenticated;
grant execute on function public.supplier_shipment_save(jsonb)       to authenticated;
grant execute on function public.supplier_shipment_delete(bigint)    to authenticated;
grant execute on function public.supplier_users_list(text)           to authenticated;
grant execute on function public.supplier_user_add(text, text, text) to authenticated;
grant execute on function public.supplier_user_remove(text)          to authenticated;
