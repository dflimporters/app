-- Rep access to their own AR (My Numbers -> More -> My AR, /my-ar.html).
-- Re-runnable.
--
-- ar_my_rep_code() was a stub returning null ("rep access to their own AR is a
-- later phase"), so every AR policy that keys on it matched nothing for a rep.
-- Filling it in is the whole read-side change: ar_aging_rows, ar_aging_snapshots,
-- ar_payments and ar_month_targets already filter on rep_code = ar_my_rep_code().
--
-- reps.salesperson_id IS the Acumatica salesperson code, and it equals
-- ar_aging_rows.rep_code for every rep who carries AR (ASM, CLH, OC, GB ...).
-- People with no salesperson_id (merchandisers, team leaders) get null, i.e. no
-- AR, exactly as before. Cover (rep_cover) is deliberately NOT extended here.

create or replace function public.ar_my_rep_code()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.salesperson_id
  from public.profiles p
  join public.reps r on r.id = p.rep_id
  where p.id = auth.uid()
    and p.active = true
    and r.active = true
    and r.salesperson_id is not null;
$$;

-- The dispute policies all used ar_can_access_doc(), which was harmless while a
-- rep could never match a document. Now that they can, it would let a rep add,
-- edit or delete the credit-control team's dispute notes on their own invoices.
-- Reps stay read-only: writes go back to the AR-access people (ar_sees_all()),
-- which is exactly who could write before. Read stays on ar_can_access_doc() so
-- a rep can see that one of their invoices is disputed.
drop policy if exists ar_disputes_ins on public.ar_disputes;
drop policy if exists ar_disputes_upd on public.ar_disputes;
drop policy if exists ar_disputes_del on public.ar_disputes;

create policy ar_disputes_ins on public.ar_disputes
  for insert to authenticated with check (public.ar_sees_all());
create policy ar_disputes_upd on public.ar_disputes
  for update to authenticated
  using (public.ar_sees_all()) with check (public.ar_sees_all());
create policy ar_disputes_del on public.ar_disputes
  for delete to authenticated using (public.ar_sees_all());
