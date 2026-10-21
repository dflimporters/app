-- Store audits: admins/managers can edit any audit; sections can be marked
-- Not applicable (POS & promotional display — many stores don't allow POP).
-- Applied via apply_migration 'audit_edit_na' on 2026-10-21.

alter table public.merch_store_audits
  add column if not exists not_applicable text[] not null default '{}',
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text;

-- Editing: admins/managers only (is_manager()). Who did the audit, the store
-- and the date stay as they were — only scores, notes, N/A and photos change.
drop policy if exists "manager update audits" on public.merch_store_audits;
create policy "manager update audits" on public.merch_store_audits
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

create or replace function public.protect_store_audit_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.audit_date := old.audit_date;
  new.customer_id := old.customer_id;
  new.store_name := old.store_name;
  new.tl_name := old.tl_name;
  new.tl_rep_id := old.tl_rep_id;
  new.merchandiser_name := old.merchandiser_name;
  new.merchandiser_rep_id := old.merchandiser_rep_id;
  new.edited_at := now();
  select full_name into new.edited_by from profiles where id = auth.uid();
  return new;
end $$;

drop trigger if exists protect_store_audit_edit on public.merch_store_audits;
create trigger protect_store_audit_edit before update on public.merch_store_audits
  for each row execute function public.protect_store_audit_edit();
revoke execute on function public.protect_store_audit_edit() from public, anon, authenticated;

-- HR log carries N/A and edit stamps (return type changes: drop + recreate).
drop function if exists public.get_hr_store_audits();
create function public.get_hr_store_audits()
returns table(id uuid, created_at timestamptz, audit_date date, customer_id text, store_name text,
  auditor_name text, auditor_rep_id uuid, auditor_role text,
  merchandiser_name text, merchandiser_rep_id uuid, area text, ba_team_leader text,
  scores jsonb, notes jsonb, overall_notes text, score_pct integer, photos jsonb,
  not_applicable text[], edited_at timestamptz, edited_by text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  return query
  select a.id, a.created_at, a.audit_date, a.customer_id, a.store_name,
         coalesce(au.name, a.tl_name), a.tl_rep_id, au.role,
         coalesce(ba.name, a.merchandiser_name), a.merchandiser_rep_id, ba.area, btl.name,
         jsonb_build_object('shelves_clean', a.shelves_clean, 'shelf_presence', a.shelf_presence,
           'facing_correct', a.facing_correct, 'rotation_correct', a.rotation_correct,
           'pricing_correct', a.pricing_correct, 'pos_materials', a.pos_materials),
         jsonb_strip_nulls(jsonb_build_object('shelves_clean', a.shelves_clean_notes, 'shelf_presence', a.shelf_presence_notes,
           'facing_correct', a.facing_notes, 'rotation_correct', a.rotation_notes,
           'pricing_correct', a.pricing_notes, 'pos_materials', a.pos_notes)),
         a.overall_notes,
         (select round(avg(v)/5*100)::int from unnest(array[a.shelves_clean, a.shelf_presence, a.facing_correct,
            a.rotation_correct, a.pricing_correct, a.pos_materials]) v where v > 0),
         a.criterion_photos, a.not_applicable, a.edited_at, a.edited_by
  from merch_store_audits a
  left join reps au  on au.id = a.tl_rep_id
  left join reps ba  on ba.id = a.merchandiser_rep_id
  left join reps btl on btl.id = ba.team_lead_id
  order by a.created_at desc, a.id desc;
end $$;

revoke execute on function public.get_hr_store_audits() from public, anon;
grant execute on function public.get_hr_store_audits() to authenticated;
