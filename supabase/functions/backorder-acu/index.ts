// backorder-acu: applies a saved back-order decision in Acumatica (Scott, 24 Nov).
//   decision 'close' -> SalesOrder action CompleteSalesOrder (DFL/1.0.001 endpoint, body { entity: { id: <order GUID> } })
//   decision 're'    -> SalesOrder action OpenSalesOrder     (Default/24.200.001, by order type + number)
// POST { nbr } with the signed-in user's token. The decision is already saved in ss_hub_ticks (bod_<order>) by the page; this reads it.
// Off unless ss_acu_settings 'backorder_mode' is 'test' (TEST tenant) or 'live'. Result is recorded in ss_backorder_acu.
// Safety: only acts on an order that is still 'Back Order' in Acumatica; one Acumatica session at a time (acu_leases); the caller must be
// allowed to act on that order (ss_backorder_can_act); a 'done' live order is never touched twice.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BASE = 'https://dflimporters.acumatica.com';
const VERSION = '24.200.001';
const GAP_MS = 1000;
const ACTION: Record<string, string> = { close: 'CompleteSalesOrder', re: 'OpenSalesOrder' };
const DFL_SO = '/entity/DFL/1.0.001/SalesOrder';   // custom DFL endpoint: has Complete Order (Default/24.200.001 does not)

const creds = (env: string) => env === 'test'
  ? { user: Deno.env.get('ACU_SHIPVIA_USERNAME') ?? '', pass: Deno.env.get('ACU_SHIPVIA_PASSWORD') ?? '', tenant: Deno.env.get('ACU_SHIPVIA_TENANT') ?? '' }
  : { user: Deno.env.get('ACU_LIVE_USERNAME') ?? Deno.env.get('ACU_SHIPVIA_USERNAME') ?? '', pass: Deno.env.get('ACU_LIVE_PASSWORD') ?? Deno.env.get('ACU_SHIPVIA_PASSWORD') ?? '', tenant: Deno.env.get('ACU_LIVE_TENANT') ?? '' };

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': req.headers.get('Origin') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
});
const v = (f: any) => { const x = f?.value; return typeof x === 'string' ? (x.trim() || null) : (x ?? null); };
const errText = (d: any) => (typeof d === 'string' ? d : String(d?.exceptionMessage ?? d?.message ?? JSON.stringify(d))).slice(0, 300);
const tickKey = (nbr: string) => 'bod_' + nbr.replace(/[^A-Za-z0-9_-]/g, '_');

let cookie = '', last = 0;
const holder = crypto.randomUUID();
async function pace() { const w = last + GAP_MS - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); last = Date.now(); }
async function acu(method: string, path: string, body?: unknown) {
  await pace();
  const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, { method, headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 500); }
  return { status: res.status, ok: res.ok, data, location: res.headers.get('Location') };
}
async function withSession<T>(env: string, fn: () => Promise<T>): Promise<T> {
  const c = creds(env);
  if (!c.user || !c.pass || !c.tenant) throw new Error(`The ${env} Acumatica login is not set up`);
  if (env === 'test' && c.tenant !== 'TEST') throw new Error(`Refusing: the test login points at tenant '${c.tenant}', not TEST`);
  if (env === 'live' && c.tenant === 'TEST') throw new Error('Refusing: the live login points at the TEST tenant');
  const until = Date.now() + 60_000;
  for (;;) {
    const { data, error } = await admin.rpc('acu_lease_take', { p_target: env, p_holder: holder, p_job: 'back order' });
    if (error) throw new Error(`lease: ${error.message}`);
    if (data) break;
    if (Date.now() > until) throw new Error('Acumatica is busy with another job. Try again in a minute.');
    await new Promise(r => setTimeout(r, 2000));
  }
  try {
    await pace();
    const login = await fetch(`${BASE}/entity/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name: c.user, password: c.pass, tenant: c.tenant }) });
    if (!login.ok) throw new Error(`Acumatica sign-in failed: ${login.status}`);
    cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    await login.body?.cancel();
    try { return await fn(); }
    finally { try { await pace(); const lo = await fetch(`${BASE}/entity/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }); await lo.body?.cancel(); } catch { /* ignore */ } }
  } finally { await admin.rpc('acu_lease_drop', { p_target: env, p_holder: holder }); }
}

const SO = `/entity/Default/${VERSION}/SalesOrder`;
const getOrder = async (nbr: string) => {
  const f = encodeURIComponent(`OrderType eq 'SO' and OrderNbr eq '${nbr.replace(/'/g, "''")}'`);
  const r = await acu('GET', `${SO}?$filter=${f}&$select=OrderNbr,Status&$top=1`);
  if (!r.ok) throw new Error(`Could not read order ${nbr} (${r.status}): ${errText(r.data)}`);
  const o = Array.isArray(r.data) ? r.data[0] : null;
  return o ? { status: String(v(o.Status) ?? ''), id: typeof o.id === 'string' ? o.id : null } : null;
};
async function runAction(action: string, nbr: string, id: string | null) {
  const r = action === 'CompleteSalesOrder'
    ? await acu('POST', `${DFL_SO}/${action}`, { entity: { id } })
    : await acu('POST', `${SO}/${action}`, { entity: { OrderType: { value: 'SO' }, OrderNbr: { value: nbr } } });
  if (r.status === 204 || r.status === 200) return;
  if (r.status !== 202 || !r.location) throw new Error(`Acumatica refused ${action}: ${r.status} ${errText(r.data)}`);
  for (let i = 0; i < 45; i++) {
    await new Promise(res => setTimeout(res, 1000));
    const p = await acu('GET', r.location);
    if (p.status === 204 || p.status === 200) return;
    if (p.status !== 202) throw new Error(`${action} failed: ${p.status} ${errText(p.data)}`);
  }
  throw new Error(`${action} is still running after 45 seconds. Check the order in Acumatica.`);
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let p: any = {}; try { p = await req.json(); } catch { /* empty */ }
  const nbr = String(p.nbr ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(nbr)) return json({ ok: false, error: 'bad order number' }, 400);
  const { data: u, error: uErr } = token ? await admin.auth.getUser(token) : { data: null, error: true } as any;
  if (uErr || !u?.user) return json({ ok: false, error: 'Sign in first' }, 401);
  const me = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: can } = await me.rpc('ss_backorder_can_act', { p_nbr: nbr });
  if (can !== true) return json({ ok: false, error: 'You cannot act on this back order' }, 403);
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', u.user.id).maybeSingle();
  const actor = prof?.full_name ?? u.user.email ?? 'unknown';

  const { data: ms } = await admin.from('ss_acu_settings').select('v').eq('k', 'backorder_mode').maybeSingle();
  const mode = String(ms?.v ?? 'off');
  if (mode !== 'test' && mode !== 'live') return json({ ok: true, state: 'off' });

  const { data: tk } = await admin.from('ss_hub_ticks').select('v').eq('k', tickKey(nbr)).maybeSingle();
  const decision = tk?.v;
  if (decision !== 'close' && decision !== 're') return json({ ok: true, state: 'none' });   // cleared: nothing to send
  const action = ACTION[decision];

  // claim it: one run per order at a time; a live order that is already done is never touched again
  const { data: ex } = await admin.from('ss_backorder_acu').select('*').eq('nbr', nbr).maybeSingle();
  if (ex && ex.env === 'live' && ex.state === 'done') return json({ ok: true, state: 'done', env: 'live', decision: ex.decision, status_after: ex.status_after, already: true });
  if (ex && ex.state === 'sending' && Date.now() - new Date(ex.at).getTime() < 3 * 60_000) return json({ ok: true, state: 'sending', busy: true });
  if (ex && ex.env === mode && ex.state === 'done' && ex.decision === decision) return json({ ok: true, state: 'done', env: mode, decision, status_after: ex.status_after, already: true });
  const claim = { nbr, decision, action, env: mode, state: 'sending', status_before: null, status_after: null, message: null, by_name: actor, at: new Date().toISOString() };
  const { error: ce } = await admin.from('ss_backorder_acu').upsert(claim, { onConflict: 'nbr' });
  if (ce) return json({ ok: false, error: ce.message }, 500);

  try {
    const res = await withSession(mode, async () => {
      const o = await getOrder(nbr);
      if (!o) return { state: 'skipped', before: null, after: null, message: `Order ${nbr} was not found in Acumatica${mode === 'test' ? ' (TEST)' : ''}.` };
      if (o.status !== 'Back Order') return { state: 'skipped', before: o.status, after: o.status, message: `Order ${nbr} is now ${o.status} in Acumatica, so nothing was changed.` };
      if (action === 'CompleteSalesOrder' && !o.id) throw new Error(`Could not read the Acumatica id of order ${nbr}.`);
      await runAction(action, nbr, o.id);
      const after = await getOrder(nbr);
      return { state: 'done', before: o.status, after: after?.status ?? null, message: null };
    });
    await admin.from('ss_backorder_acu').update({ state: res.state, status_before: res.before, status_after: res.after, message: res.message, at: new Date().toISOString() }).eq('nbr', nbr);
    return json({ ok: true, state: res.state, env: mode, decision, status_after: res.after, message: res.message });
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 400);
    await admin.from('ss_backorder_acu').update({ state: 'failed', message: msg, at: new Date().toISOString() }).eq('nbr', nbr);
    return json({ ok: false, state: 'failed', env: mode, decision, message: msg });
  }
});
