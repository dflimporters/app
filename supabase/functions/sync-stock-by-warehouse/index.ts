// sync-stock-by-warehouse: stock on hand per item per warehouse, from the Acumatica generic
// inquiry DB-StorageDetailsByItemWarehouseLocation (one row per item x warehouse x location;
// we keep the warehouse-level quantities, one row per item x warehouse). Upserts
// public.stock_by_warehouse, then deletes rows this run didn't see (stock moved out).
// Only the scheduled job (Vault dispatch_cron_token) may run it.
// Cron: sync-stock-by-warehouse (every 30 min, 6am-6pm Jamaica, Mon-Sat) + sync-stock-by-warehouse-night.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GI = 'https://dflimporters.acumatica.com/odata/dfl%20importers/DB-StorageDetailsByItemWarehouseLocation';
const USER = Deno.env.get('ACUMATICA_USERNAME') ?? '';
const PASS = Deno.env.get('ACUMATICA_PASSWORD') ?? '';
const PAGE = 1000;
const FIELDS = 'InventoryID,InventoryDescription,WarehouseID,WarehouseDescription,QtyOnHandinWarehouse,QtyAvailableinWarehouse,QtyAvailableforShippinginWarehouse,LastModifiedDateofWarehouseQty';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const auth = 'Basic ' + btoa(`${USER}:${PASS}`);
const num = (v: unknown) => { const n = parseFloat(String(v ?? '')); return isNaN(n) ? 0 : n; };
const txt = (v: unknown) => (v == null ? null : String(v).trim() || null);

async function fetchPage(skip: number): Promise<any[]> {
  const url = `${GI}?$format=json&$top=${PAGE}&$skip=${skip}&$select=${FIELDS}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    const body = await res.text();
    if (res.ok && body.trim()) return JSON.parse(body).value ?? [];
    if (attempt >= 3) throw new Error(`Acumatica ${res.status} at skip=${skip}, body ${body.length} chars: ${body.slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 3000 * attempt));   // Acumatica sometimes answers empty while busy
  }
}

async function run() {
  const started = new Date().toISOString();
  const rows = new Map<string, Record<string, unknown>>();
  for (let skip = 0; ; skip += PAGE) {
    const page = await fetchPage(skip);
    for (const r of page) {
      const item = txt(r.InventoryID), wh = txt(r.WarehouseID);
      const onHand = num(r.QtyOnHandinWarehouse), avail = num(r.QtyAvailableinWarehouse);
      if (!item || !wh || (onHand === 0 && avail === 0)) continue;   // no row means zero in that warehouse
      // The GI repeats warehouse quantities on each location row; keep one per item x warehouse.
      rows.set(`${item}|${wh}`, {
        inventory_id: item, warehouse_id: wh, warehouse_name: txt(r.WarehouseDescription), description: txt(r.InventoryDescription),
        on_hand: onHand, available: avail, available_to_ship: num(r.QtyAvailableforShippinginWarehouse),
        qty_changed_at: r.LastModifiedDateofWarehouseQty ? `${r.LastModifiedDateofWarehouseQty}Z` : null,
        synced_at: started,
      });
    }
    if (page.length < PAGE) break;
  }
  const all = [...rows.values()];
  if (!all.length) throw new Error('Acumatica returned no stock rows; leaving the table as it is.');
  for (let i = 0; i < all.length; i += 1000) {
    const { error } = await sb.from('stock_by_warehouse').upsert(all.slice(i, i + 1000), { onConflict: 'inventory_id,warehouse_id' });
    if (error) throw new Error('Upsert failed: ' + error.message);
  }
  const { error: delErr } = await sb.from('stock_by_warehouse').delete().lt('synced_at', started);
  if (delErr) throw new Error('Cleanup failed: ' + delErr.message);
  console.log(`sync-stock-by-warehouse: ${all.length} item x warehouse rows`);
  return all.length;
}

Deno.serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: ok } = token ? await sb.rpc('dispatch_cron_ok', { p_token: token }) : { data: false };
  if (!ok) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  try {
    const n = await run();
    return new Response(JSON.stringify({ success: true, rows: n }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sync-stock-by-warehouse failed:', e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
