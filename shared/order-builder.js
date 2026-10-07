// Order builder — the editable draft-order sheet shared by the rep app
// (index.html, per customer) and the merch app (merch.html, from a stock count).
// Nothing is stored: the user edits the draft, then shares or downloads it.
//
//   DFL_ORDER.open({
//     store:   'Store name',                         // header + download filename
//     lines:   [{desc, cls, qty, id, src:['Merch',…]}],   // suggested lines
//     pool:    [{desc, cls, id}],                    // what "Add an item" searches
//     textHeader: '🛒 Order — Store\nRep: …',        // first lines of the shared text
//     pricing: { get: path => Promise<rows> },       // optional: list prices + deal tiers
//                                                     //   (needs /shared/deals.js)
//     allowFree: true,     // no-charge lines ("🎁 Free")
//     chips: true,         // show each line's source chips (Merch / Hot list / …)
//     groupBy: cls => 'Label',   // optional: group lines under sticky category headers
//     classLabel: cls => 'Label',// how a class is shown in search results
//     pinnedSearch: true,  // search pinned above the lines, note pinned below
//                          //   (default: both inline, under the lines)
//     searchPlaceholder, notePlaceholder, emptyText, zIndex,
//     theme: { ink, text, muted, line, card, bg, good, bad, sec }   // CSS values, may be var(--x)
//   });
//
// Lines are keyed by inventory_id where one is known, falling back to the
// normalised description only when a side has no id — so the same product under
// two invoice descriptions is one line, and two different products that happen to
// share a description are two. Pages building their suggestion lists should merge
// through DFL_ORDER.index() for the same reason.
//
// Every id/class is prefixed `dflo-` and every handler is attached here (no
// inline onclick globals), so it can't collide with the host page.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const keyOf = l => l.id ? 'i:' + l.id : 'd:' + norm(l.desc);

  // Id-first de-duplication. find() matches on inventory_id, and on description
  // only when one side has no id.
  function index(items) {
    const byId = new Map(), byDesc = new Map(), list = [];
    const link = x => { if (x.id) byId.set(String(x.id), x); const k = norm(x.desc); if (!byDesc.has(k)) byDesc.set(k, x); };
    const find = (id, desc) => {
      id = id ? String(id) : '';
      if (id && byId.has(id)) return byId.get(id);
      const c = byDesc.get(norm(desc));
      return c && (!id || !c.id) ? c : null;
    };
    const add = x => { list.push(x); link(x); return x; };
    (items || []).forEach(add);
    return { list, find, link, add };
  }

  const THEME = {
    ink: '#0f2044', text: '#1e293b', muted: '#64748b', line: '#e2e8f0', card: '#fff',
    bg: '#fff', good: '#1f9d64', bad: '#d64545', sec: '#F2F4F8'
  };

  function injectCss() {
    if (document.getElementById('dflo-css')) return;
    const st = document.createElement('style');
    st.id = 'dflo-css';
    st.textContent =
      '.dflo{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;font-family:inherit;color:var(--o-text)}' +
      '.dflo *{box-sizing:border-box}' +
      '.dflo-sheet{background:var(--o-bg);border-radius:18px 18px 0 0;width:100%;max-height:92vh;display:flex;flex-direction:column}' +
      '.dflo-hd{flex-shrink:0;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;background:var(--o-ink);border-radius:18px 18px 0 0}' +
      '.dflo-ttl{font-size:15px;font-weight:800;color:#fff}' +
      '.dflo-store{font-size:11px;color:rgba(255,255,255,.65);margin-top:2px}' +
      '.dflo-close{background:rgba(255,255,255,.15);border:none;color:#fff;font-size:20px;width:30px;height:30px;border-radius:50%;cursor:pointer;line-height:1}' +
      '.dflo-top{flex-shrink:0;padding:10px 14px;background:var(--o-card);border-bottom:1px solid var(--o-line)}' +
      '.dflo-top .dflo-results{margin-top:4px;max-height:190px;overflow-y:auto}' +
      '.dflo-body{flex:1;overflow-y:auto;min-height:0}' +
      '.dflo-lbl{padding:12px 16px 4px;font-size:11px;font-weight:700;color:var(--o-muted);text-transform:uppercase;letter-spacing:.4px}' +
      '.dflo-pad{padding:0 16px}' +
      '.dflo-search{width:100%;padding:10px 12px;border:1.5px solid var(--o-line);border-radius:10px;font-size:14px;font-family:inherit;background:var(--o-card);color:var(--o-text);outline:none}' +
      '.dflo-note{width:100%;min-height:48px;border:1.5px solid var(--o-line);border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--o-card);color:var(--o-text);resize:vertical}' +
      '.dflo-ft{flex-shrink:0;padding:10px 14px 12px;background:var(--o-card);border-top:1px solid var(--o-line)}' +
      '.dflo-tot{font-size:12.5px;font-weight:800;color:var(--o-ink)}' +
      '.dflo-saved{font-size:11px;color:var(--o-good);font-weight:700;margin-top:2px}' +
      '.dflo-btns{display:flex;gap:8px;margin-top:8px}' +
      '.dflo-btns button{flex:1;padding:12px;border:none;border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;color:#fff}' +
      '.dflo-btns .dl{background:var(--o-bg);border:1.5px solid var(--o-line);color:var(--o-muted)}' +
      '.dflo-btns .wa{background:#25D366}.dflo-btns .sh{background:var(--o-ink)}' +
      '.dflo-sec{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:7px 16px;background:var(--o-sec);border-bottom:1px solid var(--o-line);font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--o-muted)}' +
      '.dflo-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--o-line);background:var(--o-card)}' +
      '.dflo-row.free{background:#f4fbf7;border-left:3px solid #1f9d64;padding-left:13px}' +
      '.dflo-row.add{cursor:pointer}' +
      '.dflo-name{font-size:13px;font-weight:700;line-height:1.3;color:var(--o-text)}' +
      '.dflo-sub{font-size:11px;color:var(--o-muted);margin-top:3px}' +
      '.dflo-val{font-size:11px;color:var(--o-muted);margin-top:3px}.dflo-val b{color:var(--o-ink)}' +
      '.dflo-src{display:inline-block;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:4px;margin-right:4px;letter-spacing:.2px;background:#f1f5f9;color:var(--o-muted)}' +
      '.dflo-src.merch{background:#fffbeb;color:#a5760a}.dflo-src.hot{background:#fff5f5;color:var(--o-bad)}.dflo-src.rep{background:#f0fdf4;color:var(--o-good)}.dflo-src.key{background:#eef2ff;color:#4338ca}.dflo-src.free{background:#e8f6ee;color:#17724a}' +
      '.dflo-deal{display:inline-block;font-size:10.5px;font-weight:800;color:#17724a;background:#e8f6ee;border:none;border-radius:5px;padding:1px 7px;margin-top:4px;margin-right:4px;font-family:inherit}' +
      '.dflo-deal a{color:#17724a;margin-left:4px}' +
      'button.dflo-deal{cursor:pointer}' +
      '.dflo-deal.sug{color:#7a5a07;background:#fdf1cf}' +
      '.dflo-deal.nxt{color:#2858b8;background:#eef3fd}' +
      '.dflo-deal.gift{background:none;border:1px dashed #9fd5b6}' +
      '.dflo-qty{display:flex;align-items:center;gap:4px;flex-shrink:0}' +
      '.dflo-qty button{width:32px;height:32px;border:1.5px solid var(--o-line);background:var(--o-card);border-radius:9px;font-size:18px;font-weight:700;line-height:1;cursor:pointer;color:var(--o-ink)}' +
      '.dflo-qty input{width:48px;height:32px;text-align:center;border:1.5px solid var(--o-line);border-radius:9px;font-size:15px;font-weight:800;color:var(--o-ink);background:var(--o-card);font-family:inherit}' +
      '.dflo-x{flex-shrink:0;width:30px;height:30px;border:none;background:none;color:var(--o-bad);font-size:20px;line-height:1;cursor:pointer}' +
      '.dflo-btn{height:30px;padding:0 10px;border:1.5px solid var(--o-line);background:var(--o-card);border-radius:8px;font-size:12px;font-weight:800;color:var(--o-ink);cursor:pointer;font-family:inherit;flex-shrink:0}' +
      '.dflo-btn.pri{background:var(--o-ink);color:#fff;border-color:var(--o-ink);border-radius:999px;padding:0 12px}' +
      '.dflo-empty{padding:26px 20px;text-align:center;color:var(--o-muted);font-size:13px;line-height:1.5}';
    document.head.appendChild(st);
  }

  // ---- Pricing & deals (rep app) ------------------------------------------
  // Base price is today's Acumatica list price (stock_items_raw.default_price);
  // deal tiers come from the current deal sheet (view current_deal_items) and are
  // applied as free cases on top of the cases ordered. avg_cost is never read.
  // Cached for the life of the page, across orders.
  let DEALS = null, DEALS_LOADING = null;
  const PRICES = {};
  function loadDeals(get) {
    if (DEALS) return Promise.resolve();
    if (DEALS_LOADING) return DEALS_LOADING;
    DEALS_LOADING = Promise.resolve().then(() => get('current_deal_items?select=inventory_id,tiers,list_price,item_status&limit=1000'))
      .catch(() => []).then(rows => {
        DEALS = {};
        (rows || []).forEach(x => {
          DEALS[x.inventory_id] = { tiers: DFL_DEALS.tiersOf(x.tiers), active: x.item_status === 'Active' };
          if (x.list_price != null) PRICES[x.inventory_id] = parseFloat(x.list_price);
        });
      }).finally(() => { DEALS_LOADING = null; });
    return DEALS_LOADING;
  }
  async function loadPrices(get, ids) {
    const need = [...new Set((ids || []).filter(i => i && !(i in PRICES)))];
    for (let i = 0; i < need.length; i += 100) {
      try {
        const rows = await get('stock_items_raw?inventory_id=in.(' + need.slice(i, i + 100).join(',') + ')&select=inventory_id,default_price');
        (rows || []).forEach(x => { const p = parseFloat(x.default_price); if (p > 0) PRICES[x.inventory_id] = Math.max(PRICES[x.inventory_id] || 0, p); });
      } catch (e) {}
    }
  }

  // ---- The open order -------------------------------------------------------
  let O = null;   // {opts, lines, note, pool, results, root}

  const SRC_CLS = { 'Merch': 'merch', 'Hot list': 'hot', 'Replenish': 'rep', 'Key SKU': 'key' };
  const price = l => (O.opts.pricing && l.id && PRICES[l.id] > 0) ? PRICES[l.id] : null;
  const tiers = l => (l.id && DEALS && DEALS[l.id]) ? DEALS[l.id].tiers : [];
  const NONE = { tier: null, free: 0, avail: null, availSaved: null, next: null, toNext: 0, gross: null, saved: null, eff: null };
  function calc(l) {
    if (!O.opts.pricing) return NONE;
    // No-charge lines never earn or count toward a deal tier and carry no invoice value.
    if (l.free) return Object.assign({}, NONE, { gross: 0, saved: 0 });
    return DFL_DEALS.lineValue(price(l), tiers(l), l.qty, l.dealBuy);
  }
  function totals() {
    let gross = 0, saved = 0, free = 0, unpriced = 0, avail = 0, gift = 0, giftValue = 0, giftUnpriced = 0;
    O.lines.forEach(l => {
      if (l.free) { gift += l.qty; const pr = price(l); if (pr == null) giftUnpriced++; else giftValue += pr * l.qty; return; }
      if (!O.opts.pricing) return;
      const v = calc(l); free += v.free; if (v.avail) avail++; if (v.gross == null) unpriced++; else { gross += v.gross; saved += v.saved; }
    });
    return { gross, saved, free, unpriced, avail, gift, giftValue, giftUnpriced };
  }
  const skuCount = () => new Set(O.lines.map(keyOf)).size;
  const paidCases = () => O.lines.reduce((s, l) => s + (l.free ? 0 : l.qty), 0);

  async function pricing() {
    const o = O; if (!o || !o.opts.pricing) return;
    await loadDeals(o.opts.pricing.get);
    await loadPrices(o.opts.pricing.get, o.lines.map(l => l.id));
    if (O === o) render();
  }

  function open(opts) {
    close();
    injectCss();
    opts = Object.assign({ classLabel: c => c || '' }, opts || {});
    const theme = Object.assign({}, THEME, opts.theme || {});
    // Suggested lines for the same product (same id, or same description where an
    // id is missing) become one line: quantities add up, sources are combined.
    const paid = index(), lines = [];
    (opts.lines || []).forEach(l => {
      const x = { desc: l.desc, cls: l.cls || '', qty: Number(l.qty) || 0, id: l.id ? String(l.id) : '', src: (l.src || []).slice(), free: !!l.free };
      const ex = !x.free && paid.find(x.id, x.desc);
      if (ex) { ex.qty += x.qty; x.src.forEach(s => { if (!ex.src.includes(s)) ex.src.push(s); }); if (!ex.id && x.id) { ex.id = x.id; paid.link(ex); } return; }
      if (!x.free) paid.add(x);
      lines.push(x);
    });
    O = {
      opts, note: '', results: [], lines,
      pool: (opts.pool || []).map(p => ({ desc: p.desc, cls: p.cls || '', id: p.id ? String(p.id) : '' }))
    };
    const search = '<input class="dflo-search" type="text" autocomplete="off" placeholder="' + esc(opts.searchPlaceholder || '🔍 Add an item…') + '">';
    const note = '<textarea class="dflo-note" placeholder="' + esc(opts.notePlaceholder || 'Note (optional)…') + '"></textarea>';
    let h = '<div class="dflo" style="z-index:' + (opts.zIndex || 9996) + '"><div class="dflo-sheet">' +
      '<div class="dflo-hd"><div><div class="dflo-ttl">🛒 Order builder</div><div class="dflo-store">' + esc(opts.store) + '</div></div>' +
      '<button class="dflo-close" data-a="close" aria-label="Close">×</button></div>';
    if (opts.pinnedSearch) {
      h += '<div class="dflo-top">' + search + '<div class="dflo-results"></div></div>' +
        '<div class="dflo-body"><div class="dflo-lines"></div></div>' +
        '<div class="dflo-ft">' + note;
    } else {
      h += '<div class="dflo-body"><div class="dflo-lines"></div>' +
        '<div class="dflo-lbl">Add an item</div><div class="dflo-pad">' + search + '</div><div class="dflo-results"></div>' +
        '<div class="dflo-lbl">Note (optional)</div><div class="dflo-pad" style="padding-bottom:10px">' + note + '</div></div>' +
        '<div class="dflo-ft">';
    }
    h += '<div class="dflo-tot" style="margin-top:' + (opts.pinnedSearch ? '8px' : '0') + '"></div><div class="dflo-saved"></div>' +
      '<div class="dflo-btns"><button class="dl" data-a="dl">⬇ Download</button><button class="wa" data-a="wa">📲 WhatsApp</button><button class="sh" data-a="share">↗ Share</button></div>' +
      '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
    const root = O.root = document.body.lastElementChild;
    Object.keys(theme).forEach(k => root.style.setProperty('--o-' + k, theme[k]));
    root.addEventListener('click', onClick);
    root.addEventListener('change', e => { const i = e.target.dataset.qty; if (i != null) setQty(+i, e.target.value); });
    root.querySelector('.dflo-search').addEventListener('input', e => doSearch(e.target.value));
    root.querySelector('.dflo-note').addEventListener('input', e => { O.note = e.target.value; });
    render();
    pricing();
  }

  function close() {
    if (O && O.root) O.root.remove();
    O = null;
  }

  function onClick(e) {
    const el = e.target.closest('[data-a]'); if (!el || !O) return;
    e.preventDefault();
    const a = el.dataset.a, i = +el.dataset.i, l = O.lines[i];
    switch (a) {
      case 'close': close(); return;
      case 'dl': download(); return;
      case 'wa': if (guard()) window.open('https://wa.me/?text=' + encodeURIComponent(text()), '_blank'); return;
      case 'share': share(); return;
      case 'step': if (l) { l.qty = Math.max(0, l.qty + (+el.dataset.d)); if (l.qty === 0) O.lines.splice(i, 1); render(); } return;
      case 'setq': setQty(i, el.dataset.n); return;
      case 'rm': O.lines.splice(i, 1); render(); return;
      // Deals are opt-in: the user taps Apply. Dropping the qty below an applied tier cancels it.
      case 'deal': if (l) { const v = calc(l); if (v.avail) { l.dealBuy = v.avail.buy; render(); } } return;
      case 'undeal': if (l) { l.dealBuy = null; render(); } return;
      case 'gift': if (l) giftFor(i); return;
      case 'add': { const p = O.results[i]; if (p) pushLine(p.desc, p.cls, p.id, false); return; }
      case 'addfree': { const p = O.results[i]; if (p) pushLine(p.desc, p.cls, p.id, true); return; }
      case 'custom': case 'customfree': {
        const d = (O.root.querySelector('.dflo-search').value || '').trim();
        if (d) pushLine(d, '', '', a === 'customfree');
        return;
      }
    }
  }
  function setQty(i, v) {
    const l = O.lines[i]; if (!l) return;
    const n = Math.round(Number(v));
    if (!(n > 0)) O.lines.splice(i, 1); else l.qty = n;
    render();
  }
  // No-charge lines: a second "free" line for the same product, merged if one exists.
  const findFree = (id, desc) => index(O.lines.filter(x => x.free)).find(id, desc);
  function giftFor(i) {
    const l = O.lines[i], ex = findFree(l.id, l.desc);
    if (ex) ex.qty += 1; else O.lines.splice(i + 1, 0, { desc: l.desc, cls: l.cls, qty: 1, src: ['Free'], id: l.id || '', free: true });
    render();
  }
  function pushLine(desc, cls, id, free) {
    const ex = free ? findFree(id, desc) : null;
    if (ex) ex.qty += 1;
    else O.lines.push({ desc, cls: cls || '', qty: 1, src: [free ? 'Free' : 'Added'], id: id || '', free: !!free });
    const s = O.root.querySelector('.dflo-search'); s.value = '';
    O.results = []; O.root.querySelector('.dflo-results').innerHTML = '';
    render();
    pricing();
  }

  function doSearch(q) {
    const out = O.root.querySelector('.dflo-results');
    q = (q || '').trim().toLowerCase();
    if (q.length < 2) { O.results = []; out.innerHTML = ''; return; }
    const inOrder = index(O.lines.filter(l => !l.free));
    const words = q.split(/\s+/);
    O.results = O.pool.filter(p => !inOrder.find(p.id, p.desc) && words.every(w => p.desc.toLowerCase().includes(w))).slice(0, 8);
    const row = (act, freeAct, i, name, sub) =>
      '<div class="dflo-row add" data-a="' + act + '"' + (i != null ? ' data-i="' + i + '"' : '') + '><div style="flex:1;min-width:0"><div class="dflo-name">' + name + '</div>' +
      (sub ? '<div class="dflo-sub" style="margin-top:1px">' + esc(sub) + '</div>' : '') + '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
      (O.opts.allowFree ? '<button class="dflo-btn" data-a="' + freeAct + '"' + (i != null ? ' data-i="' + i + '"' : '') + '>🎁 Free</button>' : '') +
      '<button class="dflo-btn pri">+ Add</button></div></div>';
    out.innerHTML = O.results.map((p, i) => row('add', 'addfree', i, esc(p.desc), O.opts.classLabel(p.cls))).join('') +
      row('custom', 'customfree', null, 'Add “' + esc(q) + '” as a custom item', '');
  }

  function lineHtml(l, i) {
    const D = window.DFL_DEALS;
    const qty = '<div class="dflo-qty"><button data-a="step" data-i="' + i + '" data-d="-1" aria-label="Less">−</button>' +
      '<input type="number" inputmode="numeric" min="0" step="1" value="' + l.qty + '" data-qty="' + i + '">' +
      '<button data-a="step" data-i="' + i + '" data-d="1" aria-label="More">+</button></div>' +
      '<button class="dflo-x" data-a="rm" data-i="' + i + '" aria-label="Remove">×</button>';
    if (l.free) {
      const pr = price(l);
      return '<div class="dflo-row free"><div style="flex:1;min-width:0"><div class="dflo-name">' + esc(l.desc) + '</div>' +
        '<div class="dflo-sub"><span class="dflo-src free">🎁 FREE</span>No charge' + (pr != null ? ' · worth ' + D.money(pr * l.qty) : '') + '</div></div>' + qty + '</div>';
    }
    let sub = '';
    if (O.opts.chips) sub = '<div class="dflo-sub">' + l.src.map(s => '<span class="dflo-src ' + (SRC_CLS[s] || '') + '">' + esc(s) + '</span>').join('') + esc(l.cls) + '</div>';
    let val = '', deal = '';
    if (O.opts.pricing) {
      const v = calc(l);
      if (v.gross != null) val = '<div class="dflo-val">' + D.money(price(l)) + ' × ' + l.qty + ' = <b>' + D.money(v.gross) + '</b>' + (v.free ? ' · eff. ' + D.money(v.eff) + '/cs' : '') + '</div>';
      else if (DEALS && l.id) val = '<div class="dflo-val">List price not available</div>';
      if (v.tier) deal += '<span class="dflo-deal">🎁 ' + D.label(v.tier) + ' applied · +' + v.free + ' cs free' + (v.saved != null ? ' (worth ' + D.money(v.saved) + ')' : '') + ' <a href="#" data-a="undeal" data-i="' + i + '">remove</a></span>';
      if (v.avail) deal += '<button class="dflo-deal sug" data-a="deal" data-i="' + i + '">💡 ' + (v.tier ? 'Upgrade to ' : 'Qualifies for ') + D.label(v.avail) + ' — apply for +' + v.avail.free + ' cs free' + (v.availSaved != null ? ' (' + D.money(v.availSaved) + ')' : '') + '</button>';
      if (v.next) deal += '<button class="dflo-deal nxt" data-a="setq" data-i="' + i + '" data-n="' + v.next.buy + '">Order ' + v.toNext + ' more for ' + D.label(v.next) + ' (+' + v.next.free + ' free) ›</button>';
    }
    if (O.opts.allowFree) deal += '<button class="dflo-deal gift" data-a="gift" data-i="' + i + '">🎁 Add free cases</button>';
    return '<div class="dflo-row"><div style="flex:1;min-width:0"><div class="dflo-name">' + esc(l.desc) + '</div>' + sub + val + (deal ? '<div>' + deal + '</div>' : '') + '</div>' + qty + '</div>';
  }

  function render() {
    if (!O) return;
    const box = O.root.querySelector('.dflo-lines');
    if (!O.lines.length) {
      box.innerHTML = '<div class="dflo-empty">' + esc(O.opts.emptyText || 'Nothing in this order yet. Add items below.').replace(/\n/g, '<br>') + '</div>';
    } else {
      O.lines.forEach(l => { if (l.dealBuy && l.qty < l.dealBuy) l.dealBuy = null; });
      if (O.opts.groupBy) {
        // Group by category so a long order is easy to scan; each line keeps its own index.
        const groups = {};
        O.lines.forEach((l, i) => { const k = O.opts.groupBy(l.cls); (groups[k] = groups[k] || []).push(i); });
        box.innerHTML = Object.keys(groups).sort().map(k => {
          const g = groups[k], cs = g.reduce((s, i) => s + O.lines[i].qty, 0);
          return '<div class="dflo-sec"><span>' + esc(k) + '</span><span>' + g.length + ' SKU' + (g.length === 1 ? '' : 's') + ' · ' + cs + ' cs</span></div>' +
            g.map(i => lineHtml(O.lines[i], i)).join('');
        }).join('');
      } else {
        box.innerHTML = O.lines.map(lineHtml).join('');
      }
    }
    const T = totals(), D = window.DFL_DEALS, n = skuCount(), fr = T.free + T.gift;
    let s = n + ' SKU' + (n !== 1 ? 's' : '') + ' · ' + paidCases() + ' cs' + (fr ? ' (+' + fr + ' free)' : '');
    if (T.gross > 0) s += ' · ' + D.money(T.gross) + (T.unpriced ? '+' : '');
    O.root.querySelector('.dflo-tot').textContent = s;
    const bits = [];
    if (T.saved > 0) bits.push('Deals applied: ' + D.money(T.saved) + ' of free product');
    if (T.gift > 0) bits.push('🎁 No-charge: ' + T.gift + ' cs' + (T.giftValue > 0 ? ' (' + D.money(T.giftValue) + ')' : ''));
    if (T.avail) bits.push('💡 ' + T.avail + ' deal' + (T.avail > 1 ? 's' : '') + ' available to apply');
    if (T.unpriced) bits.push(T.unpriced + ' item' + (T.unpriced > 1 ? 's' : '') + ' not priced');
    O.root.querySelector('.dflo-saved').textContent = bits.join(' · ');
  }

  function text() {
    const D = window.DFL_DEALS, T = totals(), n = skuCount();
    const paid = O.lines.filter(l => !l.free), free = O.lines.filter(l => l.free);
    const lineTxt = l => {
      const v = calc(l);
      let s = '• ' + l.desc + ' — ' + l.qty + ' cs';
      if (v.gross != null) s += ' @ ' + D.money(price(l)) + ' = ' + D.money(v.gross);
      if (v.tier) s += '\n   🎁 ' + D.label(v.tier) + ' deal: +' + v.free + ' cs free';
      return s;
    };
    return O.opts.textHeader + '\n\n' +
      paid.map(lineTxt).join('\n') +
      (free.length ? '\n\n🎁 No charge:\n' + free.map(l => { const pr = price(l); return '• ' + l.desc + ' — ' + l.qty + ' cs FREE' + (pr != null ? ' (worth ' + D.money(pr * l.qty) + ')' : ''); }).join('\n') : '') +
      '\n\nTotal: ' + n + ' SKU' + (n === 1 ? '' : 's') + ', ' + paidCases() + ' cases' + ((T.free + T.gift) ? ' + ' + (T.free + T.gift) + ' free' : '') +
      (T.gross > 0 ? '\nValue at list price: ' + D.money(T.gross) + (T.unpriced ? ' (+ ' + T.unpriced + ' unpriced item' + (T.unpriced > 1 ? 's' : '') + ')' : '') : '') +
      (T.saved > 0 ? '\nFree product from deals: ' + D.money(T.saved) : '') +
      (T.giftValue > 0 ? '\nNo-charge goods: ' + D.money(T.giftValue) : '') +
      (O.note && O.note.trim() ? '\n\nNote: ' + O.note.trim() : '');
  }

  function guard() { if (!O || !O.lines.length) { alert('Add at least one item to the order first.'); return false; } return true; }
  // navigator.share puts WhatsApp (if installed) alongside every other share target.
  async function share() {
    if (!guard()) return;
    const t = text();
    if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
  }
  function download() {
    if (!guard()) return;
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'order-' + String(O.opts.store || 'store').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  window.DFL_ORDER = { open, close, index, norm, keyOf, text: () => O ? text() : '' };
})();
