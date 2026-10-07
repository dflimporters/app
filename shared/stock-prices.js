// Stock & Prices — read-only browser over stock_items_raw (synced from the ERP
// every ~30 min by sync-stock-items): stock on hand + list price
// (default_price) for every active SKU. Shared by /stock.html (reps) and the
// Stock & Prices sheet in merch.html.
//
// avg_cost is never selected — field staff see availability and list price,
// not margin — and the DB denies the column to clients anyway (selecting it 401s).
//
// The host page owns the chrome (header, close/refresh buttons) and the data
// call, so each page keeps its own auth idiom:
//
//   const stock = DFL_STOCK.mount(el, {
//     get: path => Promise<rows>,   // GET /rest/v1/<path>; must throw on HTTP error
//     fill: true,                   // el is a fixed-height box: pin filters, scroll the list
//     theme: { ink, text, muted, line, card, good, bad, shadow, radius },  // CSS values, may be var(--x)
//     loadingHtml: '<div class="spinner"></div>'
//   });
//   stock.load(force)               // first call loads; force re-fetches
//
// Every id/class it renders is prefixed `dfls-` and every handler is attached
// here, so it can't collide with anything on the host page (see commit
// e6d17be: a copy of this feature once reused merch.html's stock-count ids).
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIMIT = 150;

  const THEME = {
    ink: '#0f2044', text: '#1e293b', muted: '#64748b', line: '#e2e8f0', card: '#fff',
    good: '#1f9d64', bad: '#d64545', shadow: '0 1px 3px rgba(0,0,0,.08)', radius: '10px'
  };

  function injectCss() {
    if (document.getElementById('dfls-css')) return;
    const st = document.createElement('style');
    st.id = 'dfls-css';
    st.textContent =
      '.dfls{font-family:inherit;color:var(--s-text)}' +
      '.dfls.fill{display:flex;flex-direction:column;height:100%;min-height:0}' +
      '.dfls.fill .dfls-list{flex:1;min-height:0;overflow-y:auto;padding-bottom:16px}' +
      '.dfls-q{width:100%;padding:11px 14px;border:1.5px solid var(--s-line);border-radius:var(--s-radius);font-size:14px;font-family:inherit;background:var(--s-card);color:var(--s-text);box-sizing:border-box}' +
      '.dfls-row{display:flex;gap:8px;align-items:center;margin-top:8px}' +
      '.dfls-row select{flex:1;min-width:0;padding:9px;border:1.5px solid var(--s-line);border-radius:var(--s-radius);font-size:13px;font-family:inherit;background:var(--s-card);color:var(--s-text)}' +
      '.dfls-row label{font-size:12px;font-weight:700;color:var(--s-ink);white-space:nowrap;display:flex;align-items:center;gap:5px}' +
      '.dfls-meta{font-size:11px;color:var(--s-muted);margin:10px 2px 8px}' +
      '.dfls-item{background:var(--s-card);border-radius:12px;box-shadow:var(--s-shadow);padding:11px 13px;margin-bottom:8px;display:flex;align-items:center;gap:10px}' +
      '.dfls-nm{font-weight:700;font-size:13px;line-height:1.25;color:var(--s-ink)}' +
      '.dfls-sub{font-size:10px;color:var(--s-muted);margin-top:2px}' +
      '.dfls-r{text-align:right;flex-shrink:0}' +
      '.dfls-n{font-weight:800;font-size:15px}' +
      '.dfls-nl{font-size:9px;color:var(--s-muted);text-transform:uppercase;letter-spacing:.3px}' +
      '.dfls-p{font-size:12px;font-weight:700;color:var(--s-ink);margin-top:3px}' +
      '.dfls-empty{text-align:center;padding:40px 20px;color:var(--s-muted);font-size:13px}';
    document.head.appendChild(st);
  }

  function mount(el, opts) {
    opts = opts || {};
    injectCss();
    const theme = Object.assign({}, THEME, opts.theme || {});
    const loadingHtml = opts.loadingHtml || '<div class="dfls-empty">Loading…</div>';
    let rows = null, synced = null, loading = false;

    el.innerHTML =
      '<div class="dfls' + (opts.fill ? ' fill' : '') + '">' +
        '<div class="dfls-filters">' +
          '<input type="text" class="dfls-q" placeholder="🔍 Search product name or code…" autocomplete="off">' +
          '<div class="dfls-row"><select class="dfls-cls"><option value="">All categories</option></select>' +
          '<label><input type="checkbox" class="dfls-in"> In stock only</label></div>' +
          '<div class="dfls-meta"></div>' +
        '</div>' +
        '<div class="dfls-list">' + loadingHtml + '</div>' +
      '</div>';
    const root = el.firstChild;
    Object.keys(theme).forEach(k => root.style.setProperty('--s-' + k, theme[k]));
    const $ = c => root.querySelector('.dfls-' + c);
    const qEl = $('q'), clsEl = $('cls'), inEl = $('in'), metaEl = $('meta'), listEl = $('list');
    qEl.addEventListener('input', render);
    clsEl.addEventListener('change', render);
    inEl.addEventListener('change', render);

    async function load(force) {
      if (loading) return;
      if (rows && !force) { render(); return; }
      loading = true;
      listEl.innerHTML = loadingHtml;
      try {
        const all = []; let off = 0;
        for (;;) {
          const page = (await opts.get('stock_items_raw?item_status=eq.Active&select=inventory_id,description,item_class,on_hand,default_price,last_synced_at&order=description.asc,inventory_id.asc&limit=1000&offset=' + off)) || [];
          all.push(...page);
          if (page.length < 1000) break;
          off += 1000;
        }
        rows = all.map(r => ({
          id: r.inventory_id, name: (r.description || '').trim(), cls: r.item_class || '',
          stock: Math.round(parseFloat(r.on_hand) || 0), price: parseFloat(r.default_price) || 0
        }));
        synced = all.reduce((m, r) => (r.last_synced_at && (!m || r.last_synced_at > m)) ? r.last_synced_at : m, null);
        const cur = clsEl.value;
        const classes = [...new Set(rows.map(r => r.cls).filter(Boolean))].sort();
        clsEl.innerHTML = '<option value="">All categories</option>' + classes.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
        clsEl.value = cur;
        render();
      } catch (e) {
        console.warn('stock load failed:', e);
        listEl.innerHTML = '<div class="dfls-empty">Could not load stock — check your connection and tap Refresh.</div>';
      } finally { loading = false; }
    }

    function render() {
      if (!rows) return;
      const q = qEl.value.trim().toLowerCase(), cls = clsEl.value, inOnly = inEl.checked;
      const matches = rows.filter(r =>
        (!cls || r.cls === cls) && (!inOnly || r.stock > 0) &&
        (!q || r.name.toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q)));
      const shown = matches.slice(0, LIMIT);
      const asOf = synced ? new Date(synced).toLocaleString('en-JM', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
      metaEl.textContent = matches.length + ' product' + (matches.length === 1 ? '' : 's') +
        (matches.length > LIMIT ? ' — showing the first ' + LIMIT + ', search to narrow' : '') + (asOf ? ' · stock as of ' + asOf : '');
      if (!shown.length) { listEl.innerHTML = '<div class="dfls-empty">No products match.</div>'; return; }
      listEl.innerHTML = shown.map(r => {
        const out = r.stock <= 0;
        return '<div class="dfls-item"><div style="flex:1;min-width:0">' +
          '<div class="dfls-nm">' + esc(r.name || r.id) + '</div>' +
          '<div class="dfls-sub">' + esc(r.id) + (r.cls ? ' · ' + esc(r.cls) : '') + '</div></div>' +
          '<div class="dfls-r"><div class="dfls-n" style="color:' + (out ? 'var(--s-bad)' : 'var(--s-good)') + '">' + (out ? 'Out' : r.stock.toLocaleString()) + '</div>' +
          '<div class="dfls-nl">' + (out ? 'of stock' : 'in stock') + '</div>' +
          '<div class="dfls-p">' + (r.price > 0 ? 'J$' + r.price.toLocaleString('en-JM', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–') + '</div></div></div>';
      }).join('');
    }

    return { load, render };
  }

  window.DFL_STOCK = { mount };
})();
