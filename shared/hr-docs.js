// ============================================================
// DFL Staff Portal — HR documents helper
// ============================================================
// Shared by /hr/index.html, /hr/employee.html and /my-hr.html, and meant for
// any future page that shows HR documents (JDs, contracts, policies...).
//
// Files live in the PRIVATE Supabase bucket `hr-documents`. Nobody gets a
// public URL: a document opens through a short-lived signed URL, and the
// bucket's SELECT policy (hr_can_read_object) decides who may sign one.
// A document can instead be a link (external_url), e.g. a portal page such
// as /hr/library/brand-ambassador-profile.html.
//
// Pure helpers plus three storage calls. No DOM, no styles. Needs the shared
// `sb` client (shared/supabase-client.js), so load it after auth-guard.js.
//
// Schema and RPCs: _staging/sql/2026-10-14_hr_records.sql
// ============================================================

(function () {
  const BUCKET = 'hr-documents';

  // Display names for role codes. Role codes stay `merchandiser` etc. in the
  // database (see CLAUDE.md, "Display name vs. role code").
  const ROLE_LABEL = {
    merchandiser: 'Brand Ambassador', relief_merchandiser: 'Relief Brand Ambassador',
    tl_merch: 'Team Leader + Brand Ambassador', team_leader: 'Team Leader',
    rep: 'Sales Rep', rep_management: 'Category / Key Account Manager',
    manager: 'Manager', admin: 'Admin', management: 'Management',
    warehouse: 'Warehouse', hr: 'HR'
  };
  // Roles a library document can be published to, in the order HR picks them.
  const PUBLISHABLE_ROLES = ['merchandiser', 'relief_merchandiser', 'tl_merch', 'team_leader',
    'rep', 'rep_management', 'warehouse', 'manager', 'management'];

  const EMPLOYMENT_TYPE = {
    permanent: 'Permanent', fixed_term: 'Fixed-term contract', probation: 'On probation',
    part_time: 'Part-time', temporary: 'Temporary', contractor: 'Contractor'
  };
  const CREDENTIAL_CATEGORY = {
    licence: 'Licence', certificate: 'Certificate', permit: 'Permit',
    police_record: 'Police record', training: 'Training', other: 'Other'
  };
  const ITEM_TYPE = {
    phone: 'Phone', sim: 'SIM card', uniform: 'Uniform', id_card: 'ID card',
    merch_tools: 'Merch tools', vehicle: 'Vehicle', laptop: 'Laptop', other: 'Other'
  };
  const LEAVE_TYPE = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal' };

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Dates arrive as 'YYYY-MM-DD' — keep them as local calendar days.
  function parse(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function fmtDate(s) { return s ? parse(s).toLocaleDateString('en-JM', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function daysUntil(s) {
    if (!s) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((parse(s) - t) / 86400000);
  }
  // 'expired' | 'expiring' (within 60 days) | 'valid' | 'none'
  function expiryState(s) {
    const d = daysUntil(s);
    if (d == null) return 'none';
    if (d < 0) return 'expired';
    if (d <= 60) return 'expiring';
    return 'valid';
  }
  function serviceLength(start) {
    if (!start) return '';
    const s = parse(start), n = new Date();
    let months = (n.getFullYear() - s.getFullYear()) * 12 + (n.getMonth() - s.getMonth());
    if (n.getDate() < s.getDate()) months--;
    if (months < 0) return 'Starts ' + fmtDate(start);
    const y = Math.floor(months / 12), m = months % 12;
    if (!y && !m) return 'Less than a month';
    return [y ? y + (y === 1 ? ' year' : ' years') : '', m ? m + (m === 1 ? ' month' : ' months') : ''].filter(Boolean).join(', ');
  }
  function fileSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function roleLabel(r) { return ROLE_LABEL[r] || r || ''; }

  // True when the HR tables/RPCs haven't been created yet, so a page can show
  // "not switched on yet" instead of a raw error.
  function notReady(error) {
    if (!error) return false;
    return error.code === 'PGRST202' || error.code === '42883' ||
      /could not find the function|does not exist/i.test(error.message || '');
  }

  // Open a document in a new tab. The tab is opened synchronously (inside the
  // click) and pointed at the signed URL afterwards, so popup blockers allow it.
  async function open(doc) {
    if (!doc) return;
    if (doc.external_url) { window.open(doc.external_url, '_blank', 'noopener'); return; }
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
    if (error || !data) {
      if (w) w.close();
      throw new Error('This document could not be opened. You may not have access to it.');
    }
    if (w) w.location = data.signedUrl; else window.location.href = data.signedUrl;
  }

  // Save a document to the device.
  //  * Uploaded file: a signed URL with Supabase's `download` option, which
  //    sends Content-Disposition: attachment under the original file name.
  //  * Portal page (external_url on this site): opens it with #download, and
  //    the page offers itself as a PDF via the browser's print dialog ("Save
  //    as PDF"). See hr/library/*.html.
  async function download(doc) {
    if (!doc) return;
    if (doc.external_url) {
      const sameSite = doc.external_url.charAt(0) === '/';
      window.open(doc.external_url + (sameSite ? '#download' : ''), '_blank', 'noopener');
      return;
    }
    const name = doc.file_name || (doc.title || 'document').replace(/[^A-Za-z0-9 ._-]+/g, '').trim() || 'document';
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300, { download: name });
    if (error || !data) throw new Error('This document could not be downloaded. You may not have access to it.');
    const a = document.createElement('a');
    a.href = data.signedUrl; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Upload a File into a folder ('library' or a reps.id). Returns the fields to
  // store on the hr_documents row.
  async function upload(file, folder) {
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
    const path = `${folder}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream', upsert: false
    });
    if (error) throw new Error('Upload failed: ' + (error.message || error));
    return { storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size };
  }

  async function remove(path) {
    if (!path) return;
    await sb.storage.from(BUCKET).remove([path]);
  }

  window.DFL_HR = {
    BUCKET, ROLE_LABEL, PUBLISHABLE_ROLES, EMPLOYMENT_TYPE, CREDENTIAL_CATEGORY, ITEM_TYPE, LEAVE_TYPE,
    esc, parse, fmtDate, daysUntil, expiryState, serviceLength, fileSize, roleLabel, notReady,
    open, download, upload, remove
  };
})();
