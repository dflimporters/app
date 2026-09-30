import { createClient } from 'jsr:@supabase/supabase-js@2';

// Monthly "Merch Commission and TL Incentive" payroll email to HR.
// Cron `send-merch-payroll-email` fires on the 1st of each month (8am Jamaica)
// and sends the month that just ended. One amount per person — Brand
// Ambassador commission + TL incentive + relief incentive — straight from
// get_merch_payroll(), the same RPC behind the management merch dashboard's HR
// Payroll tab, so the email and the screen can never disagree.
//
// Auth: no JWT (verify_jwt=false). The caller must send `x-cron-token` matching
// vault secret `merch_payroll_cron_token` — the cron job reads it from the
// vault at run time, so the token never appears in cron.job.
// Body (optional): { period?: 'YYYYMM', test?: boolean } — test sends to Travis only.
// Source of truth for this file: app/_staging/edge-functions/send-merch-payroll-email/index.ts

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TO = ['paula@dflimporters.com', 'travis@dflimporters.com'];
const TEST_TO = ['travis@dflimporters.com'];
const SUBJECT = 'Merch Commission and TL Incentive';

const POSITION: Record<string, string> = {
  merchandiser: 'Brand Ambassador',
  relief_merchandiser: 'Relief Brand Ambassador',
  team_leader: 'Team Leader',
  tl_merch: 'Team Leader + Brand Ambassador',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: unknown) => Number(v) || 0;
const j$ = (v: unknown) => 'J$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

// Previous calendar month in Jamaica time (UTC-5, no DST).
function previousPeriod(): string {
  const jm = new Date(Date.now() - 5 * 3600 * 1000);
  let y = jm.getUTCFullYear(), m = jm.getUTCMonth(); // m = current month index, so m (1-based) is last month
  if (m === 0) { y -= 1; m = 12; }
  return `${y}${String(m).padStart(2, '0')}`;
}
function periodLabel(p: string): string {
  const d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(4, 6) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: expected } = await admin.rpc('get_secret', { secret_name: 'merch_payroll_cron_token' });
    if (!expected || req.headers.get('x-cron-token') !== expected) return json({ ok: false, error: 'unauthorised' }, 401);

    const body = await req.json().catch(() => ({}));
    const period: string = /^\d{6}$/.test(body?.period || '') ? body.period : previousPeriod();
    const test = !!body?.test;
    const label = periodLabel(period);

    // The daily-merch-summary cron only recalculates the CURRENT month, so the
    // month just closed was last computed the evening before — recompute it now
    // that the final day's invoices have synced.
    const { error: calcErr } = await admin.rpc('calculate_merchandiser_summary', { p_period: period });
    if (calcErr) throw new Error('calculate_merchandiser_summary failed: ' + calcErr.message);

    const { data: rows, error } = await admin.rpc('get_merch_payroll', { p_period: period });
    if (error) throw new Error('get_merch_payroll failed: ' + error.message);

    const all = (rows || []) as any[];
    const earning = all.filter(r => n(r.total_payable) > 0);
    const review = earning.filter(r => r.role === 'unknown' || r.person_name === 'Unassigned');
    const payable = earning.filter(r => !review.includes(r));
    const grand = payable.reduce((s, r) => s + n(r.total_payable), 0);
    const sum = (k: string) => payable.reduce((s, r) => s + n(r[k]), 0);

    const cell = 'padding:7px 10px;border-bottom:1px solid #e5e7eb;';
    const tableRows = payable.map((r, i) => `<tr>
        <td style="${cell}color:#9ca3af;font-size:12px">${i + 1}</td>
        <td style="${cell}font-weight:600">${esc(r.person_name)}</td>
        <td style="${cell}color:#6b7280;font-size:13px">${esc(POSITION[r.role] || r.role)}</td>
        <td style="${cell}text-align:right;font-weight:700;color:#15803d;white-space:nowrap">${j$(r.total_payable)}</td>
      </tr>`).join('');

    const reviewHtml = review.length ? `
      <div style="margin-top:20px;border:1px solid #fcd34d;background:#fffbeb;border-radius:8px;padding:12px 14px">
        <div style="font-weight:700;color:#92400e;font-size:13px;margin-bottom:4px">⚠ Needs review before payment — not included in the total</div>
        <div style="color:#78350f;font-size:12px;margin-bottom:8px">Commission is recorded against these names, but they aren't on the active staff roster (left, renamed, or a placeholder in the store map).</div>
        ${review.map(r => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-top:1px dashed #fde68a"><span>${esc(r.person_name)}</span>&nbsp;&nbsp;<span>${j$(r.total_payable)}</span></div>`).join('')}
      </div>` : '';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a1a2e">
        <div style="background:#1a1a2e;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
          <div style="font-size:12px;color:#94a3b8;letter-spacing:.5px">DFL · HR SUBMISSION · CONFIDENTIAL</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">Merch Commission and TL Incentive — ${esc(label)}</div>
          <div style="font-size:28px;font-weight:800;color:#fbbf24;margin-top:10px">${j$(grand)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${payable.length} people · one amount per person</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:16px 18px;border-radius:0 0 8px 8px">
          <p style="font-size:13px;color:#4b5563;margin:0 0 12px">Each <b>Amount payable</b> is the person's full figure for the month — Brand Ambassador commission, Team Leader incentive and relief incentive already combined. Team Leaders who also merchandise appear <b>once</b>. The attached CSV has the per-person breakdown.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead><tr style="background:#f8fafc">
              <th style="${cell}text-align:left;font-size:11px;color:#6b7280">#</th>
              <th style="${cell}text-align:left;font-size:11px;color:#6b7280">NAME</th>
              <th style="${cell}text-align:left;font-size:11px;color:#6b7280">POSITION</th>
              <th style="${cell}text-align:right;font-size:11px;color:#6b7280">AMOUNT PAYABLE</th>
            </tr></thead>
            <tbody>${tableRows || `<tr><td colspan="4" style="${cell}color:#9ca3af">Nothing payable for this period.</td></tr>`}
              <tr style="background:#1a1a2e;color:#fff">
                <td colspan="3" style="padding:9px 10px;font-weight:700">TOTAL · ${payable.length} people</td>
                <td style="padding:9px 10px;text-align:right;font-weight:800;color:#fbbf24;white-space:nowrap">${j$(grand)}</td>
              </tr>
            </tbody>
          </table>
          <p style="font-size:12px;color:#6b7280;margin:12px 0 0">Made up of ${j$(sum('ba_commission'))} Brand Ambassador commission · ${j$(sum('tl_incentive'))} TL incentive · ${j$(sum('relief_incentive'))} relief incentive.</p>
          ${reviewHtml}
          <p style="font-size:11px;color:#9ca3af;margin-top:20px;line-height:1.5">
            Rates — Brand Ambassador, per store: 0.25% of sales at 80–99% of target; at 100%+ of target, 0.5% of target plus 0.75% of sales above target.
            Team Leader: J$250 per team store at 80–99%, J$1,000 per team store at 100%+ (a TL's own stores are paid through their own commission, not counted twice).
            Relief: J$500 per completed relief visit (full-time relief only).
            Same figures as the HR Payroll tab of the merch dashboard at dflhq.com. Automated monthly email.
          </p>
        </div>
      </div>`;

    const csvRows: unknown[][] = [['Name', 'Position', 'Amount Payable (J$)', 'BA Commission (J$)', 'TL Incentive (J$)', 'Relief Incentive (J$)', 'Period']];
    payable.forEach(r => csvRows.push([r.person_name, POSITION[r.role] || r.role, n(r.total_payable).toFixed(2), n(r.ba_commission).toFixed(2), n(r.tl_incentive).toFixed(2), n(r.relief_incentive).toFixed(2), label]));
    csvRows.push(['TOTAL', '', grand.toFixed(2), sum('ba_commission').toFixed(2), sum('tl_incentive').toFixed(2), sum('relief_incentive').toFixed(2), label]);
    if (review.length) {
      csvRows.push([], ['NEEDS REVIEW - not included in total']);
      review.forEach(r => csvRows.push([r.person_name, 'Not on active roster', n(r.total_payable).toFixed(2), n(r.ba_commission).toFixed(2), n(r.tl_incentive).toFixed(2), n(r.relief_incentive).toFixed(2), label]));
    }
    const csv = csvRows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const csvB64 = btoa(unescape(encodeURIComponent(csv)));

    const { data: keyData, error: secretErr } = await admin.rpc('get_secret', { secret_name: 'resend_api_key' });
    if (secretErr || !keyData) throw new Error('Could not load Resend API key: ' + (secretErr?.message || 'not found'));

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${keyData}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'DFL HR <onboarding@resend.dev>',
        to: test ? TEST_TO : TO,
        subject: (test ? '[TEST] ' : '') + SUBJECT,
        html,
        attachments: [{ filename: `Merch_Commission_TL_Incentive_${period}.csv`, content: csvB64 }],
      }),
    });
    if (!emailRes.ok) throw new Error('Resend API error: ' + (await emailRes.text()));
    const emailData = await emailRes.json();

    return json({ ok: true, period, people: payable.length, total: Math.round(grand * 100) / 100, review: review.length, email_id: emailData.id, test });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
