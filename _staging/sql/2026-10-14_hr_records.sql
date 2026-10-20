-- ============================================================
-- HR Records — employee files, document library, credentials,
-- company items and leave entitlements.
-- ============================================================
-- Pages: /hr/index.html (HR hub: People + Document Library),
--        /hr/employee.html?id=<reps.id> (one person's file),
--        /my-hr.html (each employee's own view).
--
-- Access model
--   * Every table has RLS ON and NO client grants. All reads and writes go
--     through the SECURITY DEFINER RPCs below, each of which re-checks the
--     caller. Same pattern as budget27_* and get_hr_leave().
--   * Employee files (profile, personal docs, credentials, items, leave
--     entitlements): is_hr() only — admins, role 'hr', public.hr_staff.
--   * Document library (role profiles, JDs, policies, templates): is_hr()
--     or is_manager() (admin, manager). Writes are HR only.
--   * Each employee reads their own file through my_employment(), keyed by
--     profiles.rep_id. TRN/NIS come back masked.
--   * Files live in the PRIVATE bucket 'hr-documents' and are opened through
--     short-lived signed URLs. The bucket's SELECT policy asks
--     hr_can_read_object(name) — the same rules as above.
--
-- Scalability: what kinds of document exist is DATA (hr_doc_types), so a new
-- kind (payslip, warning letter, NDA...) is one INSERT, not a code change.
-- Mark a type `required` and every employee's file shows it as "awaiting"
-- until HR uploads one.
--
-- Safe to re-run: every object uses IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- ============================================================

-- ---------- Document types ----------
create table if not exists public.hr_doc_types (
  code        text primary key,
  label       text not null,
  scope       text not null check (scope in ('library','employee','both')),
  icon        text,
  sort        int  not null default 100,
  required    boolean not null default false,   -- shows as "awaiting" on every employee file
  visible_to_employee_default boolean not null default true,
  active      boolean not null default true
);

insert into public.hr_doc_types (code, label, scope, icon, sort, required, visible_to_employee_default) values
  ('contract',        'Employment contract',      'employee', '✍️', 10, true,  true),
  ('job_description', 'Job description',          'both',     '📄', 20, true,  true),
  ('role_profile',    'Role profile & standards', 'library',  '🧭', 25, false, true),
  ('offer_letter',    'Offer letter',             'employee', '📨', 30, false, true),
  ('policy',          'Policy / handbook',        'library',  '📘', 40, false, true),
  ('evaluation',      'Performance evaluation',   'employee', '📋', 50, false, true),
  ('warning',         'Warning / disciplinary',   'employee', '⚠️', 60, false, true),
  ('certificate',     'Certificate / licence',    'employee', '🎓', 70, false, true),
  ('id_document',     'ID document',              'employee', '🪪', 80, false, false),
  ('template',        'Form / template',          'library',  '🗂️', 90, false, false),
  ('other',           'Other',                    'both',     '📎', 99, false, false)
on conflict (code) do nothing;

-- ---------- Documents (library when rep_id is null, otherwise one person's) ----------
create table if not exists public.hr_documents (
  id               uuid primary key default gen_random_uuid(),
  doc_type         text not null references public.hr_doc_types(code),
  title            text not null,
  description      text,
  rep_id           uuid references public.reps(id) on delete cascade,
  applies_to_roles text[] not null default '{}',   -- library only: roles that see it in My Employment
  storage_path     text,                            -- object in bucket hr-documents
  external_url     text,                            -- or a link (e.g. a portal page)
  file_name        text,
  mime_type        text,
  size_bytes       bigint,
  version          text,
  effective_date   date,
  expiry_date      date,
  status           text not null default 'active' check (status in ('draft','active','archived')),
  visible_to_employee boolean not null default true,
  created_by       uuid default auth.uid(),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint hr_documents_has_content check (storage_path is not null or external_url is not null)
);
create index if not exists hr_documents_rep_idx on public.hr_documents(rep_id);
create index if not exists hr_documents_path_idx on public.hr_documents(storage_path);

-- ---------- Employment profile (one row per person, keyed by the roster) ----------
create table if not exists public.hr_employee_profiles (
  rep_id                 uuid primary key references public.reps(id) on delete cascade,
  job_title              text,
  department             text,
  employment_type        text check (employment_type in ('permanent','fixed_term','probation','part_time','temporary','contractor')),
  start_date             date,
  probation_end_date     date,
  contract_end_date      date,
  reports_to             text,
  work_location          text,
  date_of_birth          date,
  personal_email         text,
  home_address           text,
  emergency_contact_name text,
  emergency_contact_relation text,
  emergency_contact_phone text,
  trn                    text,
  nis                    text,
  notes                  text,
  updated_at             timestamptz not null default now(),
  updated_by_name        text
);

-- ---------- Credentials: licences, certificates, permits, police records ----------
create table if not exists public.hr_credentials (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid not null references public.reps(id) on delete cascade,
  category    text not null check (category in ('licence','certificate','permit','police_record','training','other')),
  name        text not null,
  number      text,
  issuer      text,
  issued_on   date,
  expires_on  date,
  document_id uuid references public.hr_documents(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists hr_credentials_rep_idx on public.hr_credentials(rep_id);

-- ---------- Company-issued items ----------
create table if not exists public.hr_assets (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid not null references public.reps(id) on delete cascade,
  item_type   text not null check (item_type in ('phone','sim','uniform','id_card','merch_tools','vehicle','laptop','other')),
  description text,
  identifier  text,          -- serial, IMEI, plate, size...
  issued_on   date,
  returned_on date,
  condition   text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists hr_assets_rep_idx on public.hr_assets(rep_id);

-- ---------- Leave entitlement per person, per year ----------
create table if not exists public.hr_leave_entitlements (
  rep_id     uuid not null references public.reps(id) on delete cascade,
  year       int  not null,
  leave_type text not null check (leave_type in ('vacation','sick','personal')),
  days       numeric not null check (days >= 0),
  notes      text,
  updated_at timestamptz not null default now(),
  updated_by_name text,
  primary key (rep_id, year, leave_type)
);

-- ---------- Lock the tables: RPC access only ----------
alter table public.hr_doc_types          enable row level security;
alter table public.hr_documents          enable row level security;
alter table public.hr_employee_profiles  enable row level security;
alter table public.hr_credentials        enable row level security;
alter table public.hr_assets             enable row level security;
alter table public.hr_leave_entitlements enable row level security;
revoke all on public.hr_doc_types, public.hr_documents, public.hr_employee_profiles,
              public.hr_credentials, public.hr_assets, public.hr_leave_entitlements
  from anon, authenticated;

-- ============================================================
-- Helpers
-- ============================================================

-- The caller's roster id and role.
create or replace function public.hr_my_rep_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.rep_id from profiles p where p.id = auth.uid() and p.active;
$$;

create or replace function public.hr_can_view_library() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr() or public.is_manager();
$$;

-- Leave taken/booked per type for one person and year, from BOTH leave
-- systems: leave_requests (field, requester_id = reps.id) and
-- leave_tracker_records (sales, matched to the roster by salesperson_id or
-- normalised name — the tracker has no roster id).
create or replace function public.hr_leave_used(p_rep uuid, p_year int)
returns table(leave_type text, approved_days numeric, pending_days numeric)
language sql stable security definer set search_path = public as $$
  with me as (select id, name, salesperson_id from reps where id = p_rep),
  lv as (
    select case lower(lr.leave_type) when 'annual' then 'vacation' else lower(lr.leave_type) end lt,
           lr.status st,
           coalesce(lr.days_requested,
             (select count(*)::numeric from generate_series(lr.from_date, lr.to_date, interval '1 day') d
              where extract(isodow from d) < 6)) days
    from leave_requests lr, me
    where lr.requester_id = me.id and extract(year from lr.from_date) = p_year
    union all
    select case lower(coalesce(t.leave_type,'')) when 'annual' then 'vacation' when '' then 'other' else lower(t.leave_type) end,
           case when t.manager_acknowledged_at is not null then 'approved' else 'pending' end,
           (select count(*)::numeric from generate_series(t.start_date, t.end_date, interval '1 day') d
            where extract(isodow from d) < 6)
    from leave_tracker_records t
    join leave_tracker_staff s on s.id = t.staff_id
    join me on (me.salesperson_id is not null and s.salesperson_id = me.salesperson_id)
            or public.hr_norm_name(s.name) = public.hr_norm_name(me.name)
    where extract(year from t.start_date) = p_year
  )
  select lt,
         coalesce(sum(days) filter (where st = 'approved'), 0),
         coalesce(sum(days) filter (where st = 'pending'), 0)
  from lv group by lt;
$$;

-- Leave entitlement + usage as JSON, used by both the HR file and My Employment.
create or replace function public.hr_leave_summary(p_rep uuid, p_year int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'leave_type', t.lt,
           'entitled',   e.days,
           'notes',      e.notes,
           'approved',   coalesce(u.approved_days, 0),
           'pending',    coalesce(u.pending_days, 0),
           'remaining',  case when e.days is null then null else e.days - coalesce(u.approved_days, 0) end
         ) order by t.ord), '[]'::jsonb)
  from (values ('vacation',1),('sick',2),('personal',3)) t(lt, ord)
  left join hr_leave_entitlements e on e.rep_id = p_rep and e.year = p_year and e.leave_type = t.lt
  left join public.hr_leave_used(p_rep, p_year) u on u.leave_type = t.lt;
$$;

-- Library documents that apply to a role (for My Employment and the HR file).
create or replace function public.hr_role_docs(p_role text) returns setof public.hr_documents
language sql stable security definer set search_path = public as $$
  select * from hr_documents
  where rep_id is null and status = 'active' and p_role = any(applies_to_roles)
  order by doc_type, title;
$$;

-- Storage gate: may the caller read this object in hr-documents?
create or replace function public.hr_can_read_object(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr() or exists (
    select 1 from hr_documents d
    where d.storage_path = p_path and d.status = 'active' and (
      (d.rep_id is null and (public.is_manager()
          or (select role from profiles where id = auth.uid()) = any(d.applies_to_roles)))
      or (d.rep_id is not null and d.visible_to_employee and d.rep_id = public.hr_my_rep_id())
    ));
$$;

create or replace function public.hr_mask(p text) returns text
language sql immutable set search_path = public as $$
  select case when p is null or length(p) = 0 then null
              else repeat('•', greatest(length(p) - 3, 0)) || right(p, 3) end;
$$;

create or replace function public.hr_doc_json(d public.hr_documents) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d) || jsonb_build_object(
    'type_label', t.label, 'type_icon', t.icon)
  from hr_doc_types t where t.code = d.doc_type;
$$;

-- ============================================================
-- Reads
-- ============================================================

-- What the caller may do — the hub uses this to decide which tabs to show.
create or replace function public.hr_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('is_hr', public.is_hr(), 'can_library', public.hr_can_view_library());
$$;

create or replace function public.hr_doc_type_list() returns setof public.hr_doc_types
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hr_can_view_library() or public.hr_my_rep_id() is not null) then raise exception 'Not authorised'; end if;
  return query select * from hr_doc_types where active order by sort, label;
end $$;

create or replace function public.hr_library() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hr_can_view_library() then raise exception 'Not authorised'; end if;
  return coalesce((select jsonb_agg(public.hr_doc_json(d) order by t.sort, d.title)
                   from hr_documents d join hr_doc_types t on t.code = d.doc_type
                   where d.rep_id is null and (d.status <> 'draft' or public.is_hr())), '[]'::jsonb);
end $$;

-- One row per person on the roster, with file-completeness flags.
create or replace function public.hr_people(p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y int := extract(year from current_date);
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rep_id', r.id, 'name', r.name, 'role', r.role, 'area', r.area, 'active', r.active,
      'phone', r.phone, 'email', r.email,
      'job_title', ep.job_title, 'department', ep.department, 'employment_type', ep.employment_type,
      'start_date', ep.start_date, 'contract_end_date', ep.contract_end_date,
      'has_profile', ep.rep_id is not null,
      'doc_count', (select count(*) from hr_documents d where d.rep_id = r.id and d.status = 'active'),
      'missing_required', (
        select coalesce(jsonb_agg(t.label order by t.sort), '[]'::jsonb) from hr_doc_types t
        where t.required and t.active
          and not exists (select 1 from hr_documents d where d.rep_id = r.id and d.doc_type = t.code and d.status = 'active')
          and not exists (select 1 from hr_documents d where d.rep_id is null and d.doc_type = t.code
                          and d.status = 'active' and r.role = any(d.applies_to_roles))),
      'creds_expired',  (select count(*) from hr_credentials c where c.rep_id = r.id and c.expires_on < current_date),
      'creds_expiring', (select count(*) from hr_credentials c where c.rep_id = r.id
                           and c.expires_on between current_date and current_date + 60),
      'items_out', (select count(*) from hr_assets a where a.rep_id = r.id and a.returned_on is null),
      'vacation', (select e.v from jsonb_array_elements(public.hr_leave_summary(r.id, y)) as e(v)
                   where e.v->>'leave_type' = 'vacation')
    ) order by r.name)
    from reps r
    left join hr_employee_profiles ep on ep.rep_id = r.id
    where (p_include_inactive or r.active) and r.role is distinct from 'pending'
  ), '[]'::jsonb);
end $$;

-- Everything on one person's file.
create or replace function public.hr_person(p_rep uuid, p_year int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y int := coalesce(p_year, extract(year from current_date)::int);
        r reps%rowtype;
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  select * into r from reps where id = p_rep;
  if not found then raise exception 'Employee not found'; end if;
  return jsonb_build_object(
    'rep', jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'area', r.area, 'active', r.active,
                              'phone', r.phone, 'email', r.email, 'salesperson_id', r.salesperson_id,
                              'team_lead', (select name from reps t where t.id = r.team_lead_id),
                              'has_login', exists (select 1 from profiles p where p.rep_id = r.id)),
    'profile', (select to_jsonb(ep) from hr_employee_profiles ep where ep.rep_id = r.id),
    'documents', coalesce((select jsonb_agg(public.hr_doc_json(d) order by t.sort, d.created_at desc)
                           from hr_documents d join hr_doc_types t on t.code = d.doc_type
                           where d.rep_id = r.id), '[]'::jsonb),
    'role_documents', coalesce((select jsonb_agg(public.hr_doc_json(d)) from public.hr_role_docs(r.role) d), '[]'::jsonb),
    'credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.expires_on nulls last, c.name)
                             from hr_credentials c where c.rep_id = r.id), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(to_jsonb(a) order by a.returned_on nulls first, a.issued_on desc)
                        from hr_assets a where a.rep_id = r.id), '[]'::jsonb),
    'year', y,
    'leave', public.hr_leave_summary(r.id, y),
    'leave_history', coalesce((
       select jsonb_agg(jsonb_build_object('from_date', lr.from_date, 'to_date', lr.to_date,
                 'leave_type', lr.leave_type, 'status', lr.status, 'days', lr.days_requested) order by lr.from_date desc)
       from leave_requests lr where lr.requester_id = r.id), '[]'::jsonb)
  );
end $$;

-- The signed-in employee's own file. Government IDs come back masked.
create or replace function public.my_employment(p_year int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y int := coalesce(p_year, extract(year from current_date)::int);
        me uuid := public.hr_my_rep_id();
        r reps%rowtype;
begin
  if me is null then
    return jsonb_build_object('linked', false);
  end if;
  select * into r from reps where id = me;
  return jsonb_build_object(
    'linked', true,
    'rep', jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'area', r.area,
                              'phone', r.phone, 'email', r.email,
                              'team_lead', (select name from reps t where t.id = r.team_lead_id)),
    'profile', (select to_jsonb(ep) - 'trn' - 'nis' - 'notes' - 'updated_by_name'
                        || jsonb_build_object('trn_masked', public.hr_mask(ep.trn), 'nis_masked', public.hr_mask(ep.nis))
                from hr_employee_profiles ep where ep.rep_id = me),
    'documents', coalesce((select jsonb_agg(public.hr_doc_json(d) order by t.sort, d.created_at desc)
                           from hr_documents d join hr_doc_types t on t.code = d.doc_type
                           where d.rep_id = me and d.status = 'active' and d.visible_to_employee), '[]'::jsonb),
    'role_documents', coalesce((select jsonb_agg(public.hr_doc_json(d)) from public.hr_role_docs(r.role) d), '[]'::jsonb),
    'credentials', coalesce((select jsonb_agg(to_jsonb(c) - 'notes' order by c.expires_on nulls last)
                             from hr_credentials c where c.rep_id = me), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(to_jsonb(a) - 'notes' order by a.issued_on desc)
                        from hr_assets a where a.rep_id = me and a.returned_on is null), '[]'::jsonb),
    'year', y,
    'leave', public.hr_leave_summary(me, y),
    'leave_history', coalesce((
       select jsonb_agg(jsonb_build_object('from_date', lr.from_date, 'to_date', lr.to_date,
                 'leave_type', lr.leave_type, 'status', lr.status, 'days', lr.days_requested) order by lr.from_date desc)
       from leave_requests lr where lr.requester_id = me), '[]'::jsonb)
  );
end $$;

-- ============================================================
-- Writes (HR only)
-- ============================================================

create or replace function public.hr_save_profile(p_rep uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  insert into hr_employee_profiles as ep (rep_id) values (p_rep) on conflict (rep_id) do nothing;
  update hr_employee_profiles set
    job_title              = nullif(p->>'job_title',''),
    department             = nullif(p->>'department',''),
    employment_type        = nullif(p->>'employment_type',''),
    start_date             = nullif(p->>'start_date','')::date,
    probation_end_date     = nullif(p->>'probation_end_date','')::date,
    contract_end_date      = nullif(p->>'contract_end_date','')::date,
    reports_to             = nullif(p->>'reports_to',''),
    work_location          = nullif(p->>'work_location',''),
    date_of_birth          = nullif(p->>'date_of_birth','')::date,
    personal_email         = nullif(p->>'personal_email',''),
    home_address           = nullif(p->>'home_address',''),
    emergency_contact_name = nullif(p->>'emergency_contact_name',''),
    emergency_contact_relation = nullif(p->>'emergency_contact_relation',''),
    emergency_contact_phone = nullif(p->>'emergency_contact_phone',''),
    trn                    = nullif(p->>'trn',''),
    nis                    = nullif(p->>'nis',''),
    notes                  = nullif(p->>'notes',''),
    updated_at             = now(),
    updated_by_name        = (select full_name from profiles where id = auth.uid())
  where rep_id = p_rep;
end $$;

-- Insert (no id) or update (id) a document. Library docs have rep_id null.
create or replace function public.hr_save_document(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
        v_roles text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'applies_to_roles','[]'::jsonb))), '{}');
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  if v_id is null then
    insert into hr_documents (doc_type, title, description, rep_id, applies_to_roles, storage_path, external_url,
                              file_name, mime_type, size_bytes, version, effective_date, expiry_date, status,
                              visible_to_employee, created_by_name)
    values (p->>'doc_type', p->>'title', nullif(p->>'description',''), nullif(p->>'rep_id','')::uuid, v_roles,
            nullif(p->>'storage_path',''), nullif(p->>'external_url',''), nullif(p->>'file_name',''),
            nullif(p->>'mime_type',''), nullif(p->>'size_bytes','')::bigint, nullif(p->>'version',''),
            nullif(p->>'effective_date','')::date, nullif(p->>'expiry_date','')::date,
            coalesce(nullif(p->>'status',''),'active'), coalesce((p->>'visible_to_employee')::boolean, true),
            (select full_name from profiles where id = auth.uid()))
    returning id into v_id;
  else
    update hr_documents set
      doc_type = coalesce(p->>'doc_type', doc_type),
      title = coalesce(p->>'title', title),
      description = nullif(p->>'description',''),
      applies_to_roles = v_roles,
      storage_path = coalesce(nullif(p->>'storage_path',''), storage_path),
      external_url = case when p ? 'external_url' then nullif(p->>'external_url','') else external_url end,
      file_name = coalesce(nullif(p->>'file_name',''), file_name),
      mime_type = coalesce(nullif(p->>'mime_type',''), mime_type),
      size_bytes = coalesce(nullif(p->>'size_bytes','')::bigint, size_bytes),
      version = nullif(p->>'version',''),
      effective_date = nullif(p->>'effective_date','')::date,
      expiry_date = nullif(p->>'expiry_date','')::date,
      status = coalesce(nullif(p->>'status',''), status),
      visible_to_employee = coalesce((p->>'visible_to_employee')::boolean, visible_to_employee),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- Returns the storage path so the page can remove the file too.
create or replace function public.hr_delete_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  delete from hr_documents where id = p_id returning storage_path into v_path;
  return v_path;
end $$;

create or replace function public.hr_save_credential(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  if v_id is null then
    insert into hr_credentials (rep_id, category, name, number, issuer, issued_on, expires_on, document_id, notes)
    values ((p->>'rep_id')::uuid, p->>'category', p->>'name', nullif(p->>'number',''), nullif(p->>'issuer',''),
            nullif(p->>'issued_on','')::date, nullif(p->>'expires_on','')::date,
            nullif(p->>'document_id','')::uuid, nullif(p->>'notes',''))
    returning id into v_id;
  else
    update hr_credentials set category = p->>'category', name = p->>'name', number = nullif(p->>'number',''),
      issuer = nullif(p->>'issuer',''), issued_on = nullif(p->>'issued_on','')::date,
      expires_on = nullif(p->>'expires_on','')::date, document_id = nullif(p->>'document_id','')::uuid,
      notes = nullif(p->>'notes',''), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.hr_delete_credential(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  delete from hr_credentials where id = p_id;
end $$;

create or replace function public.hr_save_asset(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  if v_id is null then
    insert into hr_assets (rep_id, item_type, description, identifier, issued_on, returned_on, condition, notes)
    values ((p->>'rep_id')::uuid, p->>'item_type', nullif(p->>'description',''), nullif(p->>'identifier',''),
            nullif(p->>'issued_on','')::date, nullif(p->>'returned_on','')::date,
            nullif(p->>'condition',''), nullif(p->>'notes',''))
    returning id into v_id;
  else
    update hr_assets set item_type = p->>'item_type', description = nullif(p->>'description',''),
      identifier = nullif(p->>'identifier',''), issued_on = nullif(p->>'issued_on','')::date,
      returned_on = nullif(p->>'returned_on','')::date, condition = nullif(p->>'condition',''),
      notes = nullif(p->>'notes',''), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.hr_delete_asset(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  delete from hr_assets where id = p_id;
end $$;

-- p_days null removes the entitlement.
create or replace function public.hr_set_entitlement(p_rep uuid, p_year int, p_type text, p_days numeric, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  if p_days is null then
    delete from hr_leave_entitlements where rep_id = p_rep and year = p_year and leave_type = p_type;
  else
    insert into hr_leave_entitlements (rep_id, year, leave_type, days, notes, updated_by_name)
    values (p_rep, p_year, p_type, p_days, nullif(p_notes,''), (select full_name from profiles where id = auth.uid()))
    on conflict (rep_id, year, leave_type) do update
      set days = excluded.days, notes = excluded.notes, updated_at = now(), updated_by_name = excluded.updated_by_name;
  end if;
end $$;

-- ============================================================
-- Grants: signed-in users only (each function re-checks the caller).
-- Supabase grants EXECUTE to anon directly, so revoke it explicitly.
-- ============================================================
do $$
declare f text;
begin
  foreach f in array array[
    'hr_my_rep_id()', 'hr_can_view_library()', 'hr_leave_used(uuid,int)', 'hr_leave_summary(uuid,int)',
    'hr_role_docs(text)', 'hr_can_read_object(text)', 'hr_doc_json(public.hr_documents)',
    'hr_whoami()', 'hr_doc_type_list()', 'hr_library()', 'hr_people(boolean)', 'hr_person(uuid,int)',
    'my_employment(int)', 'hr_save_profile(uuid,jsonb)', 'hr_save_document(jsonb)', 'hr_delete_document(uuid)',
    'hr_save_credential(jsonb)', 'hr_delete_credential(uuid)', 'hr_save_asset(jsonb)', 'hr_delete_asset(uuid)',
    'hr_set_entitlement(uuid,int,text,numeric,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internal helpers: not callable from the browser at all.
  foreach f in array array['hr_leave_used(uuid,int)', 'hr_leave_summary(uuid,int)', 'hr_role_docs(text)', 'hr_doc_json(public.hr_documents)'] loop
    execute format('revoke execute on function public.%s from authenticated', f);
  end loop;
end $$;

-- ============================================================
-- Private storage bucket
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-documents', 'hr-documents', false, 26214400)   -- 25 MB
on conflict (id) do nothing;

drop policy if exists "hr-documents read"   on storage.objects;
drop policy if exists "hr-documents insert" on storage.objects;
drop policy if exists "hr-documents update" on storage.objects;
drop policy if exists "hr-documents delete" on storage.objects;
create policy "hr-documents read"   on storage.objects for select to authenticated
  using (bucket_id = 'hr-documents' and public.hr_can_read_object(name));
create policy "hr-documents insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-documents' and public.is_hr());
create policy "hr-documents update" on storage.objects for update to authenticated
  using (bucket_id = 'hr-documents' and public.is_hr());
create policy "hr-documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'hr-documents' and public.is_hr());

-- ============================================================
-- Seed: the Brand Ambassador role profile, in the library, visible
-- to every field role in My Employment.
-- ============================================================
insert into public.hr_documents (doc_type, title, description, applies_to_roles, external_url, version, effective_date, created_by_name)
select 'role_profile', 'Brand Ambassador — Expectations, Ideal Profile and Standards',
       'What is expected of every Brand Ambassador: store visits, shelf and planogram standards, replenishment orders, store relationships, communication, commission, evaluation and warnings.',
       array['merchandiser','relief_merchandiser','tl_merch','team_leader'],
       '/hr/library/brand-ambassador-profile.html', 'October 2026', date '2026-10-14', 'HR'
where not exists (select 1 from public.hr_documents where external_url = '/hr/library/brand-ambassador-profile.html');
