// Days Worked — who worked which days, per pay fortnight, plus the team leader's
// Wednesday payroll submission. Shared by the TL screen in merch.html (own team)
// and the Days Worked tab in management/merch-dashboard.html (every area).
// Data: get_days_worked() / submit_tl_payroll() — _staging/sql/2026-11-11_days_worked.sql.
//
// Rules (agreed with ops, 2026-11-11):
//   • A day worked = at least one store visit logged that day (merch_visit_log).
//   • Pay fortnights are Mon–Sun x2, anchored on Mon 2 Nov 2026.
//   • 10 paid weekdays a fortnight. Public holidays and approved leave count toward
//     the 10, so swapping a weekday for a Saturday is not extra.
//     Extra = days worked − (10 − holiday weekdays − approved-leave weekdays).
//   • TLs submit on Wednesday, before the week ends, so the current fortnight is
//     projected: today and the remaining weekdays are assumed worked.
//   • Relief Brand Ambassadors have no fixed days — every day worked is payable.
//   • History goes back one month (this fortnight + the two before).
//
// Submitting: the TL ticks the dates for each person, picks a reason and a rate per
// day, and submits. The database writes one payable Relief Coverage log row per
// date (relief → 'Relief Assigned', regular BA extra day → 'Extra Day'), which the
// next Relief Coverage pay run picks up at that rate. Dates already payable in the
// log are locked here and skipped by the database.
//
//   const dw = DFL_DAYS.mount(el, {
//     call: (fn, args) => Promise<json>,   // POST /rest/v1/rpc/<fn> as the signed-in user; throws on error
//     mode: 'tl' | 'manager',
//     readOnly: () => bool,                 // hide the submit form (e.g. admin viewing as a TL)
//     theme: { ink, text, muted, line, card, good, warn, bad, accent, shadow, radius }
//   });
//   dw.load(force)
//
// Every id/class is prefixed `dfld-` and every handler is attached here, so it
// can't collide with the host page.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ANCHOR = '2026-11-02';          // keep in step with dw_fortnight_start() in SQL
  const PAID_DAYS = 10;
  const DEFAULT_RATE = 4000;
  // Same list as REASONS in management/relief-coverage.html
  const REASONS = ['Vacation Leave', 'Sick Leave', 'Emergency Leave', 'Backfill for resignation', 'Training', 'Absent', 'Other'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const THEME = {
    ink: '#0f2044', text: '#1e293b', muted: '#64748b', line: '#e2e8f0', card: '#fff',
    good: '#1f9d64', warn: '#b7791f', bad: '#d64545', accent: '#2563eb',
    shadow: '0 1px 3px rgba(0,0,0,.08)', radius: '10px'
  };

  // ── dates as 'YYYY-MM-DD' strings, UTC maths so DST/timezones never shift a day ──
  const toD = s => new Date(s + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = s => toD(s).getUTCDay();
  const diff = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
  const isWeekday = s => { const w = dow(s); return w >= 1 && w <= 5; };
  const fortnightStart = s => addDays(ANCHOR, Math.floor(diff(ANCHOR, s) / 14) * 14);
  const mondayOf = s => addDays(s, -((dow(s) + 6) % 7));
  const short = s => { const d = toD(s); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
  const dayLabel = s => DOW[dow(s)] + ' ' + short(s);
  const range = (a, b) => short(a) + ' – ' + short(b);
  const money = n => 'J$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  // Jamaica has no DST: UTC−5 all year.
  const jmToday = () => iso(new Date(Date.now() - 5 * 3600000));

  function injectCss() {
    if (document.getElementById('dfld-css')) return;
    const st = document.createElement('style');
    st.id = 'dfld-css';
    st.textContent = [
      '.dfld{color:var(--d-text);font-family:inherit;font-size:13px}',
      '.dfld *{box-sizing:border-box}',
      '.dfld-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}',
      '.dfld-chip{border:1.5px solid var(--d-line);background:var(--d-card);color:var(--d-text);border-radius:16px;padding:6px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}',
      '.dfld-chip.on{background:var(--d-ink);border-color:var(--d-ink);color:#fff}',
      '.dfld-sel,.dfld-in{border:1.5px solid var(--d-line);background:var(--d-card);color:var(--d-text);border-radius:8px;padding:7px 9px;font:inherit;font-size:12px;min-width:0}',
      '.dfld-in{width:100%}',
      '.dfld-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}',
      '.dfld-stat{background:var(--d-card);border-radius:var(--d-radius);box-shadow:var(--d-shadow);padding:10px;text-align:center}',
      '.dfld-stat b{display:block;font-size:20px;font-weight:800;color:var(--d-ink)}',
      '.dfld-stat span{font-size:10px;color:var(--d-muted);text-transform:uppercase;letter-spacing:.4px;font-weight:700}',
      '.dfld-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--d-muted);margin:0 0 10px}',
      '.dfld-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:4px}',
      '.dfld-h{font-size:11px;font-weight:800;color:var(--d-muted);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px}',
      '.dfld-card{background:var(--d-card);border-radius:var(--d-radius);box-shadow:var(--d-shadow);padding:10px 12px;margin-bottom:8px}',
      '.dfld-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}',
      '.dfld-nm{font-weight:800;font-size:13px}',
      '.dfld-sub{font-size:11px;color:var(--d-muted);margin-top:1px}',
      '.dfld-nums{text-align:right;font-size:12px;white-space:nowrap}',
      '.dfld-nums b{font-size:15px}',
      '.dfld-badge{display:inline-block;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:800;margin-top:3px}',
      '.dfld-x{background:var(--d-warn);color:#fff}',
      '.dfld-r{background:var(--d-accent);color:#fff}',
      '.dfld-short{color:var(--d-bad);font-size:11px;font-weight:700;margin-top:3px}',
      '.dfld-strip{display:flex;gap:2px}',
      '.dfld-wk{display:flex;gap:2px;flex:1;min-width:0}',
      '.dfld-wk+.dfld-wk{margin-left:5px}',
      '.dfld-c{position:relative;flex:1;min-width:0;height:34px;border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;line-height:1.05;background:#f1f4f8;color:#9aa5b5;border:1.5px solid transparent}',
      '.dfld-c small{font-size:8px;font-weight:700;opacity:.85}',
      '.dfld-c b{font-size:11px}',
      '.dfld-c.worked{background:var(--d-good);color:#fff}',
      '.dfld-c.weekend{background:var(--d-warn);color:#fff}',
      '.dfld-c.assumed{background:transparent;border:1.5px dashed var(--d-good);color:var(--d-good)}',
      '.dfld-c.today{background:transparent;border:1.5px solid var(--d-good);color:var(--d-good)}',
      '.dfld-c.hol{background:#cbd5e1;color:#334155}',
      '.dfld-c.leave{background:#7c3aed;color:#fff}',
      '.dfld-c.lpend{background:transparent;border:1.5px dashed #7c3aed;color:#7c3aed}',
      '.dfld-c.missed{background:#fdecec;color:var(--d-bad)}',
      '.dfld-c.off,.dfld-c.fut{background:transparent;color:#c0c8d4;border:1.5px solid #eef1f5}',
      '.dfld-c.claim::after{content:"";position:absolute;top:2px;right:2px;width:5px;height:5px;border-radius:50%;background:var(--d-accent);box-shadow:0 0 0 1px #fff}',
      // submission form
      '.dfld-form{background:var(--d-card);border-radius:var(--d-radius);box-shadow:var(--d-shadow);padding:12px;margin:4px 0 12px;border-left:4px solid var(--d-accent)}',
      '.dfld-form h3{margin:0;font-size:14px;color:var(--d-ink)}',
      '.dfld-line{border-top:1px solid var(--d-line);padding:10px 0}',
      '.dfld-lhead{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}',
      '.dfld-x-btn{border:none;background:transparent;color:var(--d-muted);font-size:18px;line-height:1;cursor:pointer;padding:0 4px}',
      '.dfld-picks{display:flex;gap:3px;margin:4px 0 8px}',
      '.dfld-picks .dfld-wk{gap:3px}',
      '.dfld-pk{flex:1;min-width:0;height:38px;border-radius:6px;border:1.5px solid var(--d-line);background:var(--d-card);color:var(--d-text);font:inherit;font-size:10px;line-height:1.05;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;position:relative}',
      '.dfld-pk small{font-size:8px;font-weight:700;color:var(--d-muted)}',
      '.dfld-pk b{font-size:11px}',
      '.dfld-pk.wk{border-color:var(--d-good)}',
      '.dfld-pk.wk::after{content:"";position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:var(--d-good)}',
      '.dfld-pk.on{background:var(--d-ink);border-color:var(--d-ink);color:#fff}',
      '.dfld-pk.on small{color:rgba(255,255,255,.75)}',
      '.dfld-pk.lock{background:#eef2f7;border-color:#eef2f7;color:#a3adbb;cursor:not-allowed;text-decoration:line-through}',
      '.dfld-pk.lock small{color:#a3adbb}',
      '.dfld-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
      '.dfld-grid label{font-size:10px;font-weight:700;color:var(--d-muted);text-transform:uppercase;letter-spacing:.3px;display:flex;flex-direction:column;gap:3px}',
      '.dfld-grid label.full{grid-column:1/-1}',
      '.dfld-ltot{font-size:12px;font-weight:800;color:var(--d-ink);text-align:right;white-space:nowrap}',
      '.dfld-gtot{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:2px solid var(--d-line);padding-top:10px;margin-top:4px;font-weight:800}',
      '.dfld-btn{border:none;border-radius:8px;padding:10px 14px;font:inherit;font-weight:800;font-size:13px;cursor:pointer;background:var(--d-ink);color:#fff}',
      '.dfld-btn[disabled]{opacity:.5;cursor:default}',
      '.dfld-btn.ghost{background:transparent;color:var(--d-ink);border:1.5px solid var(--d-line)}',
      '.dfld-note{font-size:11px;color:var(--d-muted)}',
      '.dfld-ok{background:#e8f6ef;color:#14663f;border-radius:8px;padding:8px 10px;font-size:12px;margin:8px 0}',
      '.dfld-due{background:#fff7e6;color:#8a5a00;border-radius:8px;padding:8px 10px;font-size:12px;margin:8px 0}',
      '.dfld-err{background:#fdecec;color:var(--d-bad);border-radius:8px;padding:10px;font-size:12px}',
      '.dfld-empty{color:var(--d-muted);text-align:center;padding:18px;font-size:12px}',
      '.dfld-tbl{width:100%;border-collapse:collapse;font-size:12px}',
      '.dfld-tbl td,.dfld-tbl th{padding:6px 6px;border-top:1px solid var(--d-line);text-align:left;vertical-align:top}',
      '.dfld-tbl th{font-size:10px;text-transform:uppercase;color:var(--d-muted);letter-spacing:.4px;border-top:none}',
      '.dfld-team{font-size:12px;font-weight:800;color:var(--d-ink);margin:16px 0 6px;display:flex;justify-content:space-between}',
      '@media(max-width:640px){.dfld-c{height:32px}.dfld-c small{font-size:7px}.dfld-c b{font-size:10px}.dfld-stat b{font-size:17px}.dfld-pk{height:36px}.dfld-pk b{font-size:10px}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── index the RPC payload ──
  function index(data) {
    const worked = {}, leave = {}, hol = {}, claimed = {};
    (data.days || []).forEach(r => { (worked[r.rep_id] = worked[r.rep_id] || {})[r.d] = r; });
    (data.leave || []).forEach(l => {
      const m = leave[l.rep_id] = leave[l.rep_id] || {};
      for (let d = l.from; d <= l.to; d = addDays(d, 1)) {
        if (!m[d] || l.status === 'approved') m[d] = { status: l.status, type: l.type };
      }
    });
    (data.holidays || []).forEach(h => { hol[h.d] = h.name; });
    (data.claimed || []).forEach(c => { (claimed[c.rep_id] = claimed[c.rep_id] || {})[c.d] = c; });
    return { worked, leave, hol, claimed };
  }

  // One person, one fortnight → day cells + totals.
  function calc(person, fs, ix, today) {
    const relief = person.role === 'relief_merchandiser';
    const w = ix.worked[person.id] || {}, lv = ix.leave[person.id] || {}, cl = ix.claimed[person.id] || {};
    const cells = [];
    let worked = 0, weekend = 0, credited = 0, assumed = 0, missed = 0;
    for (let i = 0; i < 14; i++) {
      const d = addDays(fs, i), wd = isWeekday(d), v = w[d], h = ix.hol[d], l = lv[d];
      const appr = l && l.status === 'approved';
      let st, tip;
      // Holiday / approved-leave weekdays reduce the days owed, worked or not —
      // working on a public holiday is therefore extra.
      if (wd && !relief && (h || (appr && !v))) credited++;
      if (v) {
        worked++; if (!wd) weekend++;
        st = wd && !h ? 'worked' : 'weekend';
        tip = 'worked · ' + plural(v.visits, 'visit') + (v.relief ? ' (' + v.relief + ' relief)' : '') + (h ? ' · public holiday' : '');
      } else if (h && wd) { st = 'hol'; tip = h; }
      else if (appr && wd) { st = 'leave'; tip = 'approved ' + (l.type || '') + ' leave'; }
      else if (d >= today) {
        // Not logged yet: TLs submit mid-week, so remaining weekdays are assumed
        // worked — unless leave is pending for that day.
        if (l && wd) { st = 'lpend'; tip = 'leave requested (pending)'; }
        else if (wd && !relief) { st = d === today ? 'today' : 'assumed'; assumed++; tip = d === today ? 'today — not logged yet (assumed worked)' : 'assumed worked'; }
        else { st = 'fut'; tip = d === today ? 'today' : 'upcoming'; }
      }
      else if (l && wd) { st = 'lpend'; tip = 'leave requested (pending) — not logged'; if (!relief) missed++; }
      else if (wd && !relief) { st = 'missed'; tip = 'no visit logged'; missed++; }
      else { st = 'off'; tip = relief ? 'not worked' : 'off'; }
      if (cl[d]) tip += ' · submitted for pay' + (cl[d].paid ? ' (paid)' : '');
      cells.push({ d, st, tip, claim: !!cl[d] });
    }
    const expected = relief ? null : Math.max(0, PAID_DAYS - credited);
    const extra = relief ? 0 : Math.max(0, worked - expected);
    const extraProj = relief ? 0 : Math.max(0, worked + assumed - expected);
    return { cells, worked, weekend, expected, extra, extraProj, assumed, missed, relief };
  }

  function mount(el, opts) {
    injectCss();
    const t = Object.assign({}, THEME, opts.theme || {});
    el.classList.add('dfld');
    ['ink', 'text', 'muted', 'line', 'card', 'good', 'warn', 'bad', 'accent', 'shadow', 'radius'].forEach(k => el.style.setProperty('--d-' + k, t[k]));
    const mode = opts.mode === 'manager' ? 'manager' : 'tl';
    const readOnly = typeof opts.readOnly === 'function' ? opts.readOnly : () => !!opts.readOnly;

    let data = null, ix = null, today = jmToday(), loaded = false, loading = null;
    // draft = the form being filled in for ui.week: { week, lines:[{id, kind, dates:Set, reason, absent, rate, note}], note }
    const ui = { fs: null, tl: '', q: '', week: null, draft: null, msg: null };

    async function load(force) {
      if (loaded && !force) return render();
      if (loading) return loading;
      el.innerHTML = '<div class="dfld-empty">Loading days worked…</div>';
      today = jmToday();
      const from = addDays(fortnightStart(today), -28);
      loading = opts.call('get_days_worked', { p_from: from, p_to: today }).then(d => {
        data = d || {}; today = data.today || today; ix = index(data); loaded = true;
        if (!ui.fs) ui.fs = fortnightStart(today);
        if (!ui.week) ui.week = mondayOf(today);
        ui.draft = null;
        render();
      }).catch(e => {
        el.innerHTML = '<div class="dfld-err">Could not load days worked: ' + esc((e && e.message) || e) + '</div>';
      }).finally(() => { loading = null; });
      return loading;
    }

    const staffById = () => Object.fromEntries((data.staff || []).map(p => [p.id, p]));
    function fortnights() { const cur = fortnightStart(today); return [cur, addDays(cur, -14), addDays(cur, -28)]; }

    function visibleStaff() {
      let s = (data.staff || []).slice();
      if (mode === 'manager' && ui.tl) s = s.filter(p => (p.team_lead || '—') === ui.tl);
      if (ui.q) { const q = ui.q.toLowerCase(); s = s.filter(p => (p.name + ' ' + (p.area || '') + ' ' + (p.team_lead || '')).toLowerCase().includes(q)); }
      return s;
    }

    function cellHtml(c) {
      const d = toD(c.d);
      return '<div class="dfld-c ' + c.st + (c.claim ? ' claim' : '') + '" title="' + esc(dayLabel(c.d) + ' — ' + c.tip) + '"><small>' + DOW[d.getUTCDay()][0] + '</small><b>' + d.getUTCDate() + '</b></div>';
    }

    function cardHtml(p, r, isCur) {
      const strip = '<div class="dfld-strip"><div class="dfld-wk">' + r.cells.slice(0, 7).map(cellHtml).join('') +
        '</div><div class="dfld-wk">' + r.cells.slice(7).map(cellHtml).join('') + '</div></div>';
      const sub = [p.area, mode === 'manager' ? (p.team_lead ? 'TL ' + p.team_lead : 'No team leader') : (p.on_team === false ? 'Relief cover for your stores' : '')].filter(Boolean).join(' · ');
      let nums;
      if (r.relief) {
        nums = '<b>' + r.worked + '</b> day' + (r.worked === 1 ? '' : 's') + '<br><span class="dfld-badge dfld-r">Relief</span>';
      } else {
        const ex = isCur ? r.extraProj : r.extra;
        nums = '<b>' + r.worked + '</b>/' + r.expected + ' worked' +
          (ex ? '<br><span class="dfld-badge dfld-x">+' + ex + ' extra' + (isCur && r.extraProj !== r.extra ? ' (proj.)' : '') + '</span>' : '') +
          (r.weekend ? '<div class="dfld-sub">' + plural(r.weekend, 'weekend day') + '</div>' : '') +
          (r.missed ? '<div class="dfld-short">' + plural(r.missed, 'weekday') + ' not logged</div>' : '');
      }
      return '<div class="dfld-card"><div class="dfld-top"><div style="min-width:0"><div class="dfld-nm">' + esc(p.name) + '</div><div class="dfld-sub">' + esc(sub) + '</div></div><div class="dfld-nums">' + nums + '</div></div>' + strip + '</div>';
    }

    function render() {
      if (!data) return;
      const fs = ui.fs, fe = addDays(fs, 13), isCur = fs === fortnightStart(today);
      const staff = visibleStaff();
      const rows = staff.map(p => ({ p, r: calc(p, fs, ix, today) }));
      const regular = rows.filter(x => !x.r.relief), relief = rows.filter(x => x.r.relief);
      const totExtra = regular.reduce((s, x) => s + (isCur ? x.r.extraProj : x.r.extra), 0);
      const totRelief = relief.reduce((s, x) => s + x.r.worked, 0);

      let h = '<div class="dfld-bar">' + fortnights().map((f, i) =>
        '<button class="dfld-chip' + (f === fs ? ' on' : '') + '" data-fs="' + f + '">' + (i === 0 ? 'This fortnight · ' : '') + range(f, addDays(f, 13)) + '</button>').join('') + '</div>';

      if (mode === 'manager') {
        const tls = Array.from(new Set((data.staff || []).map(p => p.team_lead || '—'))).sort();
        h += '<div class="dfld-bar"><select class="dfld-sel" data-k="tl"><option value="">All team leaders</option>' +
          tls.map(n => '<option value="' + esc(n) + '"' + (n === ui.tl ? ' selected' : '') + '>' + esc(n === '—' ? 'No team leader' : n) + '</option>').join('') +
          '</select><input class="dfld-sel" data-k="q" placeholder="Search name or area" value="' + esc(ui.q) + '" style="flex:1;min-width:140px"></div>';
      }

      h += '<div class="dfld-stats">' +
        '<div class="dfld-stat"><b>' + regular.length + '</b><span>Brand Ambassadors</span></div>' +
        '<div class="dfld-stat"><b style="color:var(--d-warn)">' + totExtra + '</b><span>Extra days' + (isCur ? ' (proj.)' : '') + '</span></div>' +
        '<div class="dfld-stat"><b style="color:var(--d-accent)">' + totRelief + '</b><span>Relief days</span></div></div>';

      h += '<div class="dfld-legend"><span><i style="background:var(--d-good)"></i>Worked</span><span><i style="background:var(--d-warn)"></i>Weekend / holiday worked</span>' +
        (isCur ? '<span><i style="border:1.5px dashed var(--d-good)"></i>Assumed worked</span>' : '') +
        '<span><i style="background:#fdecec;border:1px solid var(--d-bad)"></i>Not logged</span><span><i style="background:#7c3aed"></i>Leave</span><span><i style="background:#cbd5e1"></i>Public holiday</span>' +
        '<span><i style="background:var(--d-accent);border-radius:50%;width:7px;height:7px;vertical-align:1px"></i>Submitted for pay</span></div>';

      if (isCur) h += '<div class="dfld-note" style="margin:-4px 0 10px">Fortnight ' + range(fs, fe) + '. Extra = days worked over ' + PAID_DAYS + ' (holidays and approved leave count toward the ' + PAID_DAYS + '). Today and the rest of the fortnight’s weekdays are assumed worked.</div>';

      if (mode === 'tl' && isCur && !readOnly()) h += formHtml();

      if (!rows.length) h += '<div class="dfld-empty">No one to show' + (ui.q || ui.tl ? ' for this filter' : '') + '.</div>';
      if (mode === 'manager' && !ui.tl) {
        const groups = {};
        rows.forEach(x => { const k = x.p.team_lead || '—'; (groups[k] = groups[k] || []).push(x); });
        Object.keys(groups).sort().forEach(k => {
          const g = groups[k], gx = g.filter(x => !x.r.relief).reduce((s, x) => s + (isCur ? x.r.extraProj : x.r.extra), 0);
          h += '<div class="dfld-team"><span>' + esc(k === '—' ? 'No team leader' : 'Team ' + k) + '</span><span class="dfld-note">' + g.length + ' people' + (gx ? ' · ' + gx + ' extra' : '') + '</span></div>' +
            g.sort((a, b) => a.r.relief - b.r.relief || a.p.name.localeCompare(b.p.name)).map(x => cardHtml(x.p, x.r, isCur)).join('');
        });
      } else {
        if (regular.length) h += '<div class="dfld-h">Brand Ambassadors</div>' + regular.map(x => cardHtml(x.p, x.r, isCur)).join('');
        if (relief.length) h += '<div class="dfld-h">Relief Brand Ambassadors</div>' + relief.map(x => cardHtml(x.p, x.r, isCur)).join('');
      }

      h += submissionsHtml();
      el.innerHTML = h;
      wire();
    }

    // ── TL payroll submission ──────────────────────────────────────────────
    function subFor(ws) { return (data.submissions || []).find(s => s.week_start === ws && s.tl_rep_id === data.me); }

    // Dates a line may offer: relief → the week, extra day → the week's fortnight.
    function lineDays(kind, ws) {
      const start = kind === 'relief' ? ws : fortnightStart(ws), n = kind === 'relief' ? 7 : 14;
      return Array.from({ length: n }, (_, i) => addDays(start, i));
    }
    // Locked = already payable in the Relief Coverage log, other than this week's own
    // still-unpaid submission rows (those are what a resubmit replaces).
    function locked(id, d, existing) {
      const c = (ix.claimed[id] || {})[d];
      return !!c && (c.paid || !existing || c.submission_id !== existing.id);
    }

    function buildDraft(ws) {
      const existing = subFor(ws), byId = staffById(), fs = fortnightStart(ws);
      const lines = [];
      if (existing && (existing.lines || []).length) {
        existing.lines.forEach(l => { if (byId[l.rep_id]) lines.push({ id: l.rep_id, kind: l.kind, dates: new Set(l.dates || []), reason: l.reason || '', absent: l.absent || '', rate: Number(l.rate) || byId[l.rep_id].rate || DEFAULT_RATE, note: l.note || '' }); });
        return { week: ws, lines, note: existing.note || '' };
      }
      (data.staff || []).forEach(p => {
        const w = ix.worked[p.id] || {};
        if (p.role === 'relief_merchandiser') {
          const dates = lineDays('relief', ws).filter(d => d <= today && w[d] && !locked(p.id, d, existing));
          if (dates.length) lines.push({ id: p.id, kind: 'relief', dates: new Set(dates), reason: '', absent: '', rate: p.rate || DEFAULT_RATE, note: '' });
        } else {
          const r = calc(p, fs, ix, today);
          const days = lineDays('extra', ws);
          const already = days.filter(d => locked(p.id, d, existing)).length;
          let n = Math.max(0, r.extraProj - already);
          if (!n) return;
          // Pick the dates to claim: weekend/holiday days worked first, then the
          // latest weekdays worked, then assumed days — TL can change them.
          const free = days.filter(d => !locked(p.id, d, existing));
          const wkend = free.filter(d => w[d] && (!isWeekday(d) || ix.hol[d])).reverse();
          const wkday = free.filter(d => w[d] && isWeekday(d) && !ix.hol[d]).reverse();
          const ahead = free.filter(d => !w[d] && d >= today && isWeekday(d));
          const pick = wkend.concat(wkday, ahead).slice(0, n);
          lines.push({ id: p.id, kind: 'extra', dates: new Set(pick), reason: 'Extra day worked', absent: '', rate: p.rate || DEFAULT_RATE, note: '' });
        }
      });
      lines.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'relief' ? -1 : 1) || byId[a.id].name.localeCompare(byId[b.id].name));
      return { week: ws, lines, note: '' };
    }

    function lineHtml(l, i, existing) {
      const p = staffById()[l.id], w = ix.worked[l.id] || {};
      const days = lineDays(l.kind, ui.week);
      const pick = d => {
        const lk = locked(l.id, d, existing), on = !lk && l.dates.has(d);
        const tip = dayLabel(d) + (w[d] ? ' — worked' : d > today ? ' — upcoming' : ' — no visit logged') + (lk ? ' · already in Relief Coverage' : '');
        return '<button type="button" class="dfld-pk' + (on ? ' on' : '') + (lk ? ' lock' : '') + (w[d] ? ' wk' : '') + '" data-pick="' + i + '" data-d="' + d + '"' + (lk ? ' disabled' : '') + ' title="' + esc(tip) + '"><small>' + DOW[dow(d)][0] + '</small><b>' + toD(d).getUTCDate() + '</b></button>';
      };
      const picks = l.kind === 'relief'
        ? '<div class="dfld-picks"><div class="dfld-wk">' + days.map(pick).join('') + '</div></div>'
        : '<div class="dfld-picks"><div class="dfld-wk">' + days.slice(0, 7).map(pick).join('') + '</div><div class="dfld-wk">' + days.slice(7).map(pick).join('') + '</div></div>';
      const r = l.kind === 'extra' ? calc(p, fortnightStart(ui.week), ix, today) : null;
      const sub = l.kind === 'relief'
        ? 'Relief · logged ' + (lineDays('relief', ui.week).filter(d => w[d]).map(d => DOW[dow(d)]).join(', ') || 'nothing yet this week')
        : 'Extra days · ' + r.worked + ' worked' + (r.assumed ? ' + ' + r.assumed + ' assumed' : '') + ' of ' + r.expected + ' owed';
      const reason = l.kind === 'relief'
        ? '<label>Reason<select class="dfld-in" data-f="reason" data-i="' + i + '"><option value="">Choose…</option>' + REASONS.map(x => '<option' + (x === l.reason ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
          '<label>Covering for<input class="dfld-in" data-f="absent" data-i="' + i + '" list="dfld-team" placeholder="Who was off?" value="' + esc(l.absent) + '"></label>'
        : '<label class="full">Reason<input class="dfld-in" value="Extra day worked" disabled></label>';
      return '<div class="dfld-line"><div class="dfld-lhead"><div style="min-width:0"><div class="dfld-nm">' + esc(p.name) + '</div><div class="dfld-sub">' + esc(sub) + '</div></div>' +
        '<div style="display:flex;align-items:flex-start;gap:6px"><div class="dfld-ltot" data-ltot="' + i + '"></div><button type="button" class="dfld-x-btn" data-rm="' + i + '" title="Remove">×</button></div></div>' +
        picks + '<div class="dfld-grid">' + reason +
        '<label>Rate per day (J$)<input class="dfld-in" type="number" min="0" step="100" data-f="rate" data-i="' + i + '" value="' + esc(l.rate) + '"></label>' +
        '<label>Note<input class="dfld-in" data-f="note" data-i="' + i + '" placeholder="Optional" value="' + esc(l.note) + '"></label></div></div>';
    }

    function formHtml() {
      const ws = ui.week, we = addDays(ws, 6);
      if (!ui.draft || ui.draft.week !== ws) ui.draft = buildDraft(ws);
      const existing = subFor(ws), dr = ui.draft;
      const inLines = new Set(dr.lines.map(l => l.id));
      const addable = (data.staff || []).filter(p => !inLines.has(p.id));
      const weeks = [mondayOf(today), addDays(mondayOf(today), -7)];

      let h = '<div class="dfld-form"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3>Submit relief &amp; extra days</h3>' +
        '<select class="dfld-sel" data-k="week">' + weeks.map((w, i) => '<option value="' + w + '"' + (w === ws ? ' selected' : '') + '>' + (i === 0 ? 'This week' : 'Last week') + ' · ' + range(w, addDays(w, 6)) + '</option>').join('') + '</select></div>';

      if (ui.msg) h += '<div class="' + (ui.msg.ok ? 'dfld-ok' : 'dfld-err') + '" style="margin:8px 0">' + ui.msg.html + '</div>';
      else if (existing) h += '<div class="dfld-ok">Submitted ' + esc(new Date(existing.submitted_at).toLocaleString('en-JM', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + ' — it’s in Relief Coverage, waiting for the pay run. Submitting again replaces anything not paid yet.</div>';
      else h += '<div class="dfld-due">Not submitted for ' + range(ws, we) + ' yet — due Wednesday ' + short(addDays(ws, 2)) + '. Tap days to add or remove them.</div>';

      h += '<datalist id="dfld-team">' + (data.staff || []).filter(p => p.role !== 'relief_merchandiser').map(p => '<option value="' + esc(p.name) + '">').join('') + '</datalist>';
      h += dr.lines.length ? dr.lines.map((l, i) => lineHtml(l, i, existing)).join('')
        : '<div class="dfld-note" style="padding:10px 0;border-top:1px solid var(--d-line)">No relief or extra days to submit this week. Add someone below if needed.</div>';

      if (addable.length) h += '<div style="padding:8px 0;border-top:1px solid var(--d-line)"><select class="dfld-sel" data-k="add" style="width:100%"><option value="">+ Add someone…</option>' +
        addable.map(p => '<option value="' + p.id + '">' + esc(p.name) + (p.role === 'relief_merchandiser' ? ' (relief)' : ' (extra days)') + '</option>').join('') + '</select></div>';

      h += '<textarea class="dfld-in" data-k="note" rows="2" placeholder="Note for payroll (optional)" style="margin-top:6px;resize:vertical">' + esc(dr.note) + '</textarea>' +
        '<div class="dfld-gtot"><div><div data-gtot></div><div class="dfld-note">Assumes everyone finishes the week.</div></div><button class="dfld-btn" data-act="submit">' + (existing ? 'Resubmit' : 'Submit') + '</button></div></div>';
      return h;
    }

    function lineTotals() {
      const dr = ui.draft; if (!dr) return { days: 0, amt: 0 };
      let days = 0, amt = 0;
      dr.lines.forEach((l, i) => {
        const n = l.dates.size, a = n * (Number(l.rate) || 0);
        days += n; amt += a;
        const e = el.querySelector('[data-ltot="' + i + '"]');
        if (e) e.innerHTML = plural(n, 'day') + '<br>' + money(a);
      });
      const g = el.querySelector('[data-gtot]');
      if (g) g.textContent = plural(days, 'day') + ' · ' + money(amt);
      return { days, amt };
    }

    async function submit(btn) {
      const dr = ui.draft, byId = staffById();
      const lines = dr.lines.filter(l => l.dates.size);
      const noReason = lines.filter(l => l.kind === 'relief' && !l.reason).map(l => byId[l.id].name);
      if (noReason.length) { ui.msg = { ok: false, html: 'Choose a reason for ' + esc(noReason.join(', ')) + '.' }; render(); ui.msg = null; return; }
      const noRate = lines.filter(l => !(Number(l.rate) > 0)).map(l => byId[l.id].name);
      if (noRate.length) { ui.msg = { ok: false, html: 'Enter a rate per day for ' + esc(noRate.join(', ')) + '.' }; render(); ui.msg = null; return; }
      const tot = lineTotals();
      if (!confirm('Submit ' + plural(tot.days, 'day') + ' (' + money(tot.amt) + ') to Relief Coverage for the week of ' + short(dr.week) + '?')) return;
      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        const res = await opts.call('submit_tl_payroll', {
          p_week_start: dr.week, p_note: dr.note || null,
          p_lines: lines.map(l => ({ rep_id: l.id, kind: l.kind, dates: Array.from(l.dates).sort(), reason: l.reason, absent: l.absent, rate: Number(l.rate), note: l.note }))
        }) || {};
        await load(true);
        const sk = res.skipped || [];
        ui.msg = { ok: true, html: 'Sent to Relief Coverage — ' + plural(res.inserted || 0, 'day') + ' logged, waiting for the pay run.' +
          (sk.length ? '<br>Skipped (already in the log): ' + esc(sk.map(s => s.name + ' ' + short(s.date)).join(', ')) : '') };
        render(); ui.msg = null;
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Submit';
        ui.msg = { ok: false, html: 'Could not submit: ' + esc((e && e.message) || e) };
        render(); ui.msg = null;
      }
    }

    // ── history ──
    function submissionsHtml() {
      const subs = data.submissions || [];
      const title = mode === 'manager' ? 'Submitted by team leaders' : 'Your recent submissions';
      let h = '<div class="dfld-h" style="display:flex;justify-content:space-between;align-items:center">' + title +
        (mode === 'manager' && subs.length ? '<button class="dfld-btn ghost" data-act="csv" style="padding:5px 10px;font-size:11px">⬇ CSV</button>' : '') + '</div>';
      const shown = mode === 'manager' && ui.tl ? subs.filter(s => s.tl_name === ui.tl) : subs;
      if (!shown.length) return h + '<div class="dfld-empty">No submissions yet.</div>';
      return h + '<div class="dfld-note" style="margin:-2px 0 6px">Each submission is logged in Relief Coverage and paid through its pay runs.</div>' +
        '<div class="dfld-card" style="overflow-x:auto"><table class="dfld-tbl"><tr><th>Week</th>' + (mode === 'manager' ? '<th>Team leader</th>' : '') + '<th>Who</th><th style="text-align:right">Amount</th></tr>' +
        shown.map(s => {
          const ls = s.lines || [];
          const tot = ls.reduce((a, l) => a + (Number(l.total) || Number(l.days) * Number(l.rate) || 0), 0);
          const who = ls.length ? ls.map(l => esc(l.name) + ' · ' + plural(Number(l.days), 'day') + ' × ' + money(l.rate) +
              '<div class="dfld-note">' + (l.kind === 'extra' ? 'Extra day' : esc(l.reason || 'Relief')) + (l.absent ? ' — covering ' + esc(l.absent) : '') + (l.dates ? ' · ' + esc(l.dates.map(short).join(', ')) : '') + '</div>').join('')
            : '<span class="dfld-note">Nothing claimed</span>';
          return '<tr><td style="white-space:nowrap">' + range(s.week_start, addDays(s.week_start, 6)) + '<div class="dfld-note">sent ' + esc(new Date(s.submitted_at).toLocaleDateString('en-JM', { day: 'numeric', month: 'short' })) + '</div></td>' +
            (mode === 'manager' ? '<td>' + esc(s.tl_name) + '</td>' : '') + '<td>' + who + (s.note ? '<div class="dfld-note" style="margin-top:4px">“' + esc(s.note) + '”</div>' : '') + '</td><td style="text-align:right;white-space:nowrap"><b>' + money(tot) + '</b></td></tr>';
        }).join('') + '</table></div>';
    }

    function csv() {
      const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const out = [['Week start', 'Team leader', 'Name', 'Type', 'Reason', 'Covering for', 'Dates', 'Days', 'Rate per day', 'Total', 'Line note', 'Submission note', 'Submitted at'].map(q).join(',')];
      (data.submissions || []).forEach(s => (s.lines || []).forEach(l => out.push([s.week_start, s.tl_name, l.name, l.kind === 'relief' ? 'Relief' : 'Extra day', l.reason, l.absent, (l.dates || []).join(' '), l.days, l.rate, l.total, l.note, s.note, s.submitted_at].map(q).join(','))));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out.join('\r\n')], { type: 'text/csv' }));
      a.download = 'tl-relief-extra-days-' + today + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    }

    function wire() {
      el.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { ui.fs = b.dataset.fs; render(); });
      const tl = el.querySelector('[data-k=tl]'); if (tl) tl.onchange = () => { ui.tl = tl.value; render(); };
      const q = el.querySelector('[data-k=q]');
      if (q) q.oninput = () => { ui.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const pos = q.selectionStart; render(); const n = el.querySelector('[data-k=q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); };
      const wk = el.querySelector('[data-k=week]'); if (wk) wk.onchange = () => { ui.week = wk.value; ui.draft = null; render(); };
      const cv = el.querySelector('[data-act=csv]'); if (cv) cv.onclick = csv;
      if (!ui.draft || !el.querySelector('.dfld-form')) return;
      const dr = ui.draft;
      el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        const l = dr.lines[+b.dataset.pick], d = b.dataset.d;
        if (l.dates.has(d)) l.dates.delete(d); else l.dates.add(d);
        b.classList.toggle('on', l.dates.has(d)); lineTotals();
      });
      el.querySelectorAll('[data-f]').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
        dr.lines[+i.dataset.i][i.dataset.f] = i.value; lineTotals();
      }));
      el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { dr.lines.splice(+b.dataset.rm, 1); render(); });
      const add = el.querySelector('[data-k=add]');
      if (add) add.onchange = () => {
        const p = staffById()[add.value]; if (!p) return;
        dr.lines.push({ id: p.id, kind: p.role === 'relief_merchandiser' ? 'relief' : 'extra', dates: new Set(), reason: p.role === 'relief_merchandiser' ? '' : 'Extra day worked', absent: '', rate: p.rate || DEFAULT_RATE, note: '' });
        render();
      };
      const note = el.querySelector('[data-k=note]'); if (note) note.oninput = () => { dr.note = note.value; };
      const sb = el.querySelector('[data-act=submit]'); if (sb) sb.onclick = () => submit(sb);
      lineTotals();
    }

    return { load };
  }

  window.DFL_DAYS = { mount, _test: { calc, index, fortnightStart, mondayOf } };
})();
