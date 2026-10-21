-- Optional supporting photos per store-audit section.
-- Applied via apply_migration 'audit_photos' on 2026-10-21.

-- {"shelves_clean": ["https://…/audit-photos/…jpg", …], "pricing_correct": [...]}
alter table public.merch_store_audits
  add column if not exists criterion_photos jsonb not null default '{}'::jsonb;

-- Public bucket, same policy shape as equipment-issue-photos.
insert into storage.buckets (id, name, public)
values ('audit-photos', 'audit-photos', true)
on conflict (id) do nothing;

drop policy if exists "authenticated upload audit photos" on storage.objects;
create policy "authenticated upload audit photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'audit-photos');
drop policy if exists "authenticated read audit photos" on storage.objects;
create policy "authenticated read audit photos" on storage.objects
  for select to authenticated using (bucket_id = 'audit-photos');
drop policy if exists "anon read audit photos" on storage.objects;
create policy "anon read audit photos" on storage.objects
  for select to anon using (bucket_id = 'audit-photos');
-- Lets the auditor remove a photo they just added (× on the thumbnail).
drop policy if exists "authenticated delete own audit photos" on storage.objects;
create policy "authenticated delete own audit photos" on storage.objects
  for delete to authenticated using (bucket_id = 'audit-photos' and owner = auth.uid());

-- HR log carries the photos too (return type changes, so drop + recreate).
drop function if exists public.get_hr_store_audits();
create function public.get_hr_store_audits()
returns table(id uuid, created_at timestamptz, audit_date date, customer_id text, store_name text,
  auditor_name text, auditor_rep_id uuid, auditor_role text,
  merchandiser_name text, merchandiser_rep_id uuid, area text, ba_team_leader text,
  scores jsonb, notes jsonb, overall_notes text, score_pct integer, photos jsonb)
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
         a.criterion_photos
  from merch_store_audits a
  left join reps au  on au.id = a.tl_rep_id
  left join reps ba  on ba.id = a.merchandiser_rep_id
  left join reps btl on btl.id = ba.team_lead_id
  order by a.created_at desc, a.id desc;
end $$;

revoke execute on function public.get_hr_store_audits() from public, anon;
grant execute on function public.get_hr_store_audits() to authenticated;
