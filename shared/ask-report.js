// Ask DFL reports — turns the report Claude builds (ask-dfl's build_report tool) into a
// styled page and a matching PowerPoint. Claude only chooses a style and fills blocks with
// numbers it queried; all layout and colour lives here, so every report looks finished.
//
// Report shape: { style, title, subtitle, period, blocks: [...] }
//   style: executive | clean | bold | dark
//   blocks (each may have width 'half' to sit beside the next half block on the page):
//     hero    { value, caption, takeaway, detail, tone }
//     kpis    { items: [{ label, value, note, tone, progress }] }        progress = % of target
//     bars    { title, subtitle, items: [{ label, sublabel, pct, value, delta, tone }], note }
//     chart   { title, subtitle, labels: [], series: [{ name, type: bar|line|target, values: [] }], highlight, note }
//     tiles   { title, subtitle, items: [{ label, value, sub, tone }] }
//     columns { items: [{ title, tone: good|bad|focus|neutral, points: [{ lead, text }] }] }
//     table   { title, columns, rows }                                  rows filled in by the edge function
//     text    { title, body }
//   tone: good | warn | bad | neutral
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = v => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v) && !/^0\d/.test(v) && !/^C\d+$/.test(v));
  const fmt = (v, col) => {
    if (v === null || v === undefined) return '';
    if (!isNum(v)) return String(v);
    const n = Number(v), pct = /%|pct|percent/i.test(col || '');
    const dec = pct || (Math.abs(n) < 100 && !Number.isInteger(n)) ? 1 : 0;
    return n.toLocaleString('en-JM', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  const TONES = ['good', 'warn', 'bad', 'neutral'];
  const tone = t => TONES.includes(t) ? t : 'neutral';

  // One palette per style, shared by the page (CSS variables) and the PowerPoint (hex).
  const THEMES = {
    executive: { name: 'Executive', bg: 'FFFFFF', page: 'EFF2F9', head: '0D1B3E', headText: 'FFFFFF', rule: 'F5A623', ink: '0D1B3E', ink2: '445068', ink3: '7E8AA3', card: 'FFFFFF', line: 'E2E8F2', accent: '326BD3', soft: 'C9D5EE', good: '166534', goodBg: 'EEF8EF', goodBar: '43A047', warn: 'C06500', warnBg: 'FFF6E6', warnBar: 'F5A623', bad: 'C8001A', badBg: 'FDEEEF', badBar: 'E53935', neutral: '326BD3', neutralBg: 'EEF3FC', neutralBar: '326BD3', target: 'F5A623', last: '8A96AD' },
    clean:     { name: 'Clean', bg: 'FFFFFF', page: 'F6F7F9', head: 'FFFFFF', headText: '1A2340', rule: '326BD3', ink: '1A2340', ink2: '4A5578', ink3: '8A95B0', card: 'FFFFFF', line: 'E6E9EF', accent: '326BD3', soft: 'D6E2F7', good: '1A8F4C', goodBg: 'F0F8F3', goodBar: '1A8F4C', warn: 'B7791F', warnBg: 'FBF4E6', warnBar: 'E0A43A', bad: 'C53030', badBg: 'FCEFEF', badBar: 'E05252', neutral: '326BD3', neutralBg: 'F0F4FC', neutralBar: '326BD3', target: '1A2340', last: 'A0AEC0' },
    bold:      { name: 'Bold', bg: 'FFFFFF', page: 'EEF2FB', head: '326BD3', headText: 'FFFFFF', rule: '0D1B3E', ink: '0D1B3E', ink2: '3D4A66', ink3: '7884A0', card: 'FFFFFF', line: 'DDE5F4', accent: '326BD3', soft: 'B9CCF2', good: '0E8A5F', goodBg: 'E3F6EE', goodBar: '12B07A', warn: 'C2700A', warnBg: 'FFF1DD', warnBar: 'FF9F1C', bad: 'D61F45', badBg: 'FDE6EB', badBar: 'F0436A', neutral: '326BD3', neutralBg: 'E8EFFC', neutralBar: '326BD3', target: '0D1B3E', last: '9AA6C0' },
    dark:      { name: 'Dark', bg: '0F1830', page: '0A1124', head: '0A1124', headText: 'FFFFFF', rule: '36C5F0', ink: 'F1F4FA', ink2: 'B5BED3', ink3: '7F8AA6', card: '16213F', line: '24305A', accent: '36C5F0', soft: '2C3E6E', good: '3DDC97', goodBg: '12352E', goodBar: '3DDC97', warn: 'FFC24B', warnBg: '3A3016', warnBar: 'FFC24B', bad: 'FF6B81', badBg: '3B1B2A', badBar: 'FF6B81', neutral: '36C5F0', neutralBg: '14304A', neutralBar: '36C5F0', target: 'FFC24B', last: '7F8AA6' }
  };
  const theme = s => THEMES[s] || THEMES.executive;
  const H = h => '#' + h;

  /* ---------------- page ---------------- */
  function chartSvg(b, T) {
    const labels = (b.labels || []).slice(0, 24), n = labels.length;
    if (!n) return '';
    const series = (b.series || []).filter(s => Array.isArray(s.values));
    const bars = series.filter(s => s.type === 'bar'), lines = series.filter(s => s.type === 'line'), targets = series.filter(s => s.type === 'target');
    const all = series.flatMap(s => s.values.slice(0, n)).map(Number).filter(v => isFinite(v));
    const max = Math.max(1, ...all) * 1.08;
    const W = 560, top = 10, base = 150, slot = W / n, bw = Math.max(6, Math.min(34, slot * 0.62 / Math.max(1, bars.length)));
    const y = v => base - (Number(v) / max) * (base - top);
    let g = `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="${H(T.line)}"/>`;
    bars.forEach((s, si) => s.values.slice(0, n).forEach((v, i) => {
      if (!isFinite(Number(v))) return;
      const x = i * slot + (slot - bw * bars.length) / 2 + si * bw;
      const on = b.highlight === i || b.highlight === labels[i];
      g += `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(base - y(v)).toFixed(1)}" rx="2" fill="${H(si ? T.soft : T.accent)}" opacity="${on || b.highlight == null ? 1 : .55}"/>`;
    }));
    targets.forEach(s => s.values.slice(0, n).forEach((v, i) => {
      if (!isFinite(Number(v))) return;
      const cx = i * slot + slot / 2, w = Math.max(14, bw * bars.length + 6);
      g += `<line x1="${(cx - w / 2).toFixed(1)}" x2="${(cx + w / 2).toFixed(1)}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${H(T.target)}" stroke-width="3" stroke-linecap="round"/>`;
    }));
    lines.forEach((s, li) => {
      const pts = s.values.slice(0, n).map((v, i) => isFinite(Number(v)) ? `${(i * slot + slot / 2).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean);
      g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${H(li ? T.ink3 : T.last)}" stroke-width="1.8" stroke-dasharray="5 3"/>`;
      pts.forEach(p => { const [cx, cy] = p.split(','); g += `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${H(T.card)}" stroke="${H(T.last)}" stroke-width="1.4"/>`; });
    });
    labels.forEach((l, i) => { g += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="${H(T.ink3)}">${esc(String(l).slice(0, 10))}</text>`; });
    const legend = series.map(s => `<span><i class="${s.type}"></i>${esc(s.name)}</span>`).join('');
    return `<svg viewBox="0 0 ${W} ${base + 20}" class="rp-svg" role="img" aria-label="${esc(b.title || 'Chart')}">${g}</svg><div class="rp-legend">${legend}</div>`;
  }

  const blockHtml = {
    hero: b => `<div class="rp-hero"><div class="rp-big t-${tone(b.tone)}">${esc(b.value)}<small>${esc(b.caption)}</small></div>
      <div><p class="rp-take">${esc(b.takeaway)}</p>${b.detail ? `<p class="rp-detail">${esc(b.detail)}</p>` : ''}</div></div>`,
    kpis: b => `<div class="rp-kpis">${(b.items || []).slice(0, 6).map(k => `<div class="rp-k">
      <div class="rp-kl">${esc(k.label)}</div><div class="rp-kv t-${tone(k.tone)}">${esc(k.value)}</div>
      ${isFinite(Number(k.progress)) && k.progress !== null && k.progress !== '' ? `<div class="rp-kbar"><i class="b-${tone(k.tone)}" style="width:${Math.min(100, Math.max(0, Number(k.progress)))}%"></i></div>` : ''}
      ${k.note ? `<div class="rp-kn">${esc(k.note)}</div>` : ''}</div>`).join('')}</div>`,
    bars: b => {
      const items = (b.items || []).slice(0, 14), top = Math.max(100, ...items.map(i => Number(i.pct) || 0));
      return `${head(b)}<div class="rp-bars">${items.map(i => `<div class="rp-br">
        <div class="rp-bn"><b>${esc(i.label)}</b>${i.sublabel ? `<span>${esc(i.sublabel)}</span>` : ''}</div>
        <div class="rp-bt"><div class="rp-bf b-${tone(i.tone)}" style="width:${Math.max(0, Math.min(100, (Number(i.pct) || 0) / top * 100))}%"></div><s style="left:${100 / top * 100}%"></s></div>
        <div class="rp-bp t-${tone(i.tone)}">${isFinite(Number(i.pct)) ? Math.round(Number(i.pct)) + '%' : ''}</div>
        <div class="rp-bv">${esc(i.value)}</div><div class="rp-bd t-${tone(i.tone)}">${esc(i.delta)}</div></div>`).join('')}</div>${note(b)}`;
    },
    chart: (b, T) => `${head(b)}${chartSvg(b, T)}${note(b)}`,
    tiles: b => `${head(b)}<div class="rp-tiles">${(b.items || []).slice(0, 18).map(t => `<div class="rp-tile x-${tone(t.tone)}">
      <div class="rp-tn">${esc(t.label)}</div><div class="rp-tp t-${tone(t.tone)}">${esc(t.value)}</div>${t.sub ? `<div class="rp-ts">${esc(t.sub)}</div>` : ''}</div>`).join('')}</div>`,
    columns: b => `<div class="rp-cols">${(b.items || []).slice(0, 4).map(c => `<div class="rp-col c-${['good', 'bad', 'focus'].includes(c.tone) ? c.tone : 'neutral'}">
      <h3>${esc(c.title)}</h3>${(c.points || []).slice(0, 5).map(p => `<div class="rp-pt">${p.lead ? `<b>${esc(p.lead)}</b> ` : ''}${esc(p.text)}</div>`).join('')}</div>`).join('')}</div>`,
    table: b => {
      const cols = b.columns || [], rows = (b.rows || []).slice(0, 15);
      if (!cols.length) return '';
      const num = cols.map(c => rows.every(r => r[c] === null || isNum(r[c])));
      return `${head(b)}<div class="rp-tw"><table class="rp-tbl"><thead><tr>${cols.map((c, j) => `<th class="${num[j] ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${cols.map((c, j) => `<td class="${num[j] ? 'n' : ''}">${esc(fmt(r[c], c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${(b.rows || []).length > rows.length ? `<div class="rp-note">Top ${rows.length} of ${(b.rows || []).length}. Full list in the Excel download.</div>` : ''}`;
    },
    text: b => `${head(b)}<p class="rp-text">${esc(b.body)}</p>`
  };
  function head(b) { return b.title ? `<h2 class="rp-h">${esc(b.title)}${b.subtitle ? `<span>${esc(b.subtitle)}</span>` : ''}</h2>` : ''; }
  function note(b) { return b.note ? `<div class="rp-note">${esc(b.note)}</div>` : ''; }

  function css(T) {
    return `.rp{--bg:${H(T.bg)};--head:${H(T.head)};--headText:${H(T.headText)};--rule:${H(T.rule)};--ink:${H(T.ink)};--ink2:${H(T.ink2)};--ink3:${H(T.ink3)};--card:${H(T.card)};--line:${H(T.line)};--accent:${H(T.accent)};--soft:${H(T.soft)};
--good:${H(T.good)};--goodBg:${H(T.goodBg)};--goodBar:${H(T.goodBar)};--warn:${H(T.warn)};--warnBg:${H(T.warnBg)};--warnBar:${H(T.warnBar)};--bad:${H(T.bad)};--badBg:${H(T.badBg)};--badBar:${H(T.badBar)};--neutral:${H(T.neutral)};--neutralBg:${H(T.neutralBg)};--neutralBar:${H(T.neutralBar)};--target:${H(T.target)};--last:${H(T.last)}}`;
  }
  const BASE_CSS = `
.rp{background:var(--bg);color:var(--ink);font-family:'Open Sans',Arial,sans-serif;border-radius:12px;overflow:hidden;border:1px solid var(--line);line-height:1.45}
.rp *{box-sizing:border-box}
.rp h1,.rp h2,.rp h3,.rp-big,.rp-kv,.rp-bp,.rp-tp,.rp-take{font-family:'Montserrat',Arial,sans-serif}
.rp-hdr{background:var(--head);color:var(--headText);padding:16px 22px;border-bottom:3px solid var(--rule);display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.rp-hdr h1{font-size:20px;font-weight:800;margin:0;letter-spacing:-.2px}
.rp-hdr .s{font-size:11.5px;opacity:.72;margin-top:3px}
.rp-hdr .p{font-size:11px;opacity:.72;text-align:right}
.rp-body{padding:16px 22px 18px;display:grid;grid-template-columns:1fr 1fr;gap:18px}
.rp-blk{grid-column:1 / -1;min-width:0}.rp-blk.half{grid-column:auto}
.rp-h{font-size:12.5px;font-weight:700;margin:0 0 9px;color:var(--ink)}.rp-h span{font:400 11px 'Open Sans',sans-serif;color:var(--ink3);margin-left:6px}
.t-good{color:var(--good)}.t-warn{color:var(--warn)}.t-bad{color:var(--bad)}.t-neutral{color:var(--accent)}
.b-good{background:var(--goodBar)}.b-warn{background:var(--warnBar)}.b-bad{background:var(--badBar)}.b-neutral{background:var(--neutralBar)}
.rp-hero{display:grid;grid-template-columns:minmax(150px,auto) 1fr;gap:22px;align-items:center;padding-bottom:4px}
.rp-big{font-size:54px;font-weight:800;line-height:.92;letter-spacing:-2px}.rp-big small{display:block;font-size:11px;letter-spacing:0;font-weight:600;color:var(--ink3);margin-top:7px}
.rp-take{font-size:16px;font-weight:600;line-height:1.4;margin:0}.rp-detail{color:var(--ink2);font-size:13px;margin:6px 0 0}
.rp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border:1px solid var(--line);border-radius:10px;background:var(--card)}
.rp-k{padding:11px 15px;border-right:1px solid var(--line)}.rp-k:last-child{border-right:0}
.rp-kl{font-size:10.5px;color:var(--ink3);font-weight:600}.rp-kv{font-size:22px;font-weight:700;margin:3px 0 4px;letter-spacing:-.4px}
.rp-kbar{height:5px;background:var(--line);border-radius:3px;margin:2px 0 5px}.rp-kbar i{display:block;height:100%;border-radius:3px}
.rp-kn{font-size:10.5px;color:var(--ink2);line-height:1.45}
.rp-br{display:grid;grid-template-columns:minmax(110px,1.2fr) 2fr 44px minmax(70px,auto) minmax(56px,auto);gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}
.rp-bn b{display:block;font-size:11.5px;font-weight:600}.rp-bn span{font-size:9.5px;color:var(--ink3)}
.rp-bt{height:10px;background:var(--line);border-radius:5px;position:relative}.rp-bf{height:100%;border-radius:5px}
.rp-bt s{position:absolute;top:-4px;width:2px;height:18px;background:var(--ink);text-decoration:none}
.rp-bp{font-weight:700;font-size:14px;text-align:right}.rp-bv{font-size:11px;font-weight:600}.rp-bd{font-size:11px;font-weight:700;text-align:right}
.half .rp-br{grid-template-columns:1fr 44px auto auto;row-gap:4px}.half .rp-bt{grid-column:1 / -1;order:3}
.rp-note{font-size:10.5px;color:var(--ink2);margin-top:7px}
.rp-svg{width:100%;height:auto;display:block}.rp-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:10px;color:var(--ink3);margin-top:3px}
.rp-legend i{display:inline-block;width:11px;height:8px;border-radius:2px;margin-right:5px;vertical-align:-1px;background:var(--accent)}
.rp-legend i.target{height:3px;background:var(--target);vertical-align:2px}.rp-legend i.line{height:0;background:none;border-top:2px dashed var(--last);vertical-align:3px}
.rp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}
.rp-tile{border-radius:8px;padding:7px 8px 7px;border-top:3px solid}
.x-good{background:var(--goodBg);border-color:var(--goodBar)}.x-warn{background:var(--warnBg);border-color:var(--warnBar)}.x-bad{background:var(--badBg);border-color:var(--badBar)}.x-neutral{background:var(--neutralBg);border-color:var(--neutralBar)}
.rp-tn{font-size:9px;font-weight:700;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rp-tp{font-size:18px;font-weight:700;margin:2px 0 1px}.rp-ts{font-size:9.5px;color:var(--ink2)}
.rp-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.rp-col{border:1px solid var(--line);border-radius:10px;padding:11px 14px;background:var(--card)}
.rp-col h3{font-size:12px;margin:0 0 6px}.c-good{border-left:4px solid var(--goodBar)}.c-bad{border-left:4px solid var(--badBar)}.c-focus{border-left:4px solid var(--accent);background:var(--neutralBg)}.c-neutral{border-left:4px solid var(--line)}
.rp-pt{font-size:11.5px;color:var(--ink2);padding:5px 0;border-top:1px dashed var(--line)}.rp-pt:first-of-type{border-top:0;padding-top:0}.rp-pt b{color:var(--ink)}
.rp-tw{overflow-x:auto}.rp-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.rp-tbl th{background:var(--head);color:var(--headText);text-align:left;padding:6px 9px;font:700 10.5px 'Montserrat',sans-serif;white-space:nowrap}
.rp-tbl td{padding:5px 9px;border-bottom:1px solid var(--line);white-space:nowrap}.rp-tbl .n{text-align:right;font-variant-numeric:tabular-nums}
.rp-text{font-size:13px;color:var(--ink2);margin:0}
.rp-ftr{border-top:1px solid var(--line);padding:7px 22px;font-size:10px;color:var(--ink3)}
/* Clean: airy, hairlines, no boxes */
.rp-clean .rp-hdr{padding:22px 26px 14px;border-bottom:1px solid var(--line)}.rp-clean .rp-hdr h1{font-size:24px;font-weight:700}
.rp-clean .rp-hdr h1::after{content:'';display:block;width:56px;height:3px;background:var(--rule);border-radius:2px;margin:9px 0 2px}
.rp-clean .rp-h span{text-transform:none;letter-spacing:0}
.rp-clean .rp-body{padding:22px 26px;gap:26px}
.rp-clean .rp-kpis{border:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);border-radius:0}.rp-clean .rp-k{padding:14px 18px 14px 0}
.rp-clean .rp-kv{font-weight:600}.rp-clean .rp-big{font-weight:600}
.rp-clean .rp-h{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3)}
.rp-clean .rp-tile{background:transparent;border:1px solid var(--line);border-top-width:3px}
.rp-clean .rp-col{background:transparent;border:0;border-top:2px solid var(--line);border-radius:0;padding:10px 0 0}
.rp-clean .c-good{border-top-color:var(--goodBar)}.rp-clean .c-bad{border-top-color:var(--badBar)}.rp-clean .c-focus{border-top-color:var(--accent);background:transparent}
/* Bold: gradient headline band, floating cards */
.rp-bold{border:0;box-shadow:0 10px 34px rgba(50,107,211,.16)}
.rp-bold .rp-hdr{background:linear-gradient(120deg,#0D1B3E 0%,#326BD3 70%,#4F8BF0 100%);border-bottom:0;padding:22px 26px 18px}.rp-bold .rp-hdr h1{font-size:26px}
.rp-bold .rp-body{background:#F4F7FD;gap:16px}
.rp-bold .rp-hero{background:var(--card);border-radius:16px;padding:18px 22px;box-shadow:0 4px 18px rgba(13,27,62,.07)}.rp-bold .rp-big{font-size:64px}
.rp-bold .rp-kpis{border:0;gap:12px;background:transparent}.rp-bold .rp-k{background:var(--card);border:0;border-radius:14px;box-shadow:0 4px 18px rgba(13,27,62,.07);padding:14px 16px}
.rp-bold .rp-kv{font-size:26px}
.rp-bold .rp-blk:not(:has(.rp-hero)):not(:has(.rp-kpis)):not(:has(.rp-cols)){background:var(--card);border-radius:16px;padding:16px 18px;box-shadow:0 4px 18px rgba(13,27,62,.07)}
.rp-bold .rp-tile{border-radius:12px;border-top:0;border-left:5px solid}.rp-bold .rp-tp{font-size:20px}
.rp-bold .rp-col{border:0;border-radius:14px;box-shadow:0 4px 18px rgba(13,27,62,.07)}.rp-bold .c-good{border-top:5px solid var(--goodBar)}.rp-bold .c-bad{border-top:5px solid var(--badBar)}.rp-bold .c-focus{border-top:5px solid var(--accent)}
/* Dark: dashboard cards with a soft glow */
.rp-dark{border-color:#1E2A4E}
.rp-dark .rp-body{gap:14px}
.rp-dark .rp-blk{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.rp-dark .rp-big{text-shadow:0 0 24px currentColor}
.rp-dark .rp-kpis{background:transparent;border:0;gap:10px}.rp-dark .rp-k{background:#1B2850;border:1px solid var(--line);border-radius:10px}
.rp-dark .rp-blk:has(.rp-kpis){background:transparent;border:0;padding:0}
.rp-dark .rp-tile{border-top-width:2px}.rp-dark .rp-col{background:#1B2850}
.rp-dark .rp-bf{box-shadow:0 0 10px currentColor}
@media (max-width:640px){.rp-body{grid-template-columns:1fr;padding:14px}.rp-blk.half{grid-column:1 / -1}.rp-hero{grid-template-columns:1fr;gap:8px}.rp-big{font-size:42px}
 .rp-br{grid-template-columns:1fr 44px;row-gap:3px}.rp-bt{grid-column:1 / -1;order:3}.rp-bv,.rp-bd{font-size:10.5px}.rp-k{border-right:0;border-bottom:1px solid var(--line)}}`;

  function html(report) {
    const T = theme(report.style), uid = 'rp' + Math.random().toString(36).slice(2, 8);
    const blocks = (report.blocks || []).filter(b => blockHtml[b.type]);
    return `<style>${BASE_CSS}${css(T).replace('.rp{', '#' + uid + '.rp{')}</style>
      <div class="rp rp-${esc(report.style || 'executive')}" id="${uid}">
        <header class="rp-hdr"><div><h1>${esc(report.title)}</h1>${report.subtitle ? `<div class="s">${esc(report.subtitle)}</div>` : ''}</div>
          ${report.period ? `<div class="p">${esc(report.period)}</div>` : ''}</header>
        <div class="rp-body">${blocks.map(b => `<section class="rp-blk ${b.width === 'half' ? 'half' : ''}">${blockHtml[b.type](b, T)}</section>`).join('')}</div>
        <footer class="rp-ftr">Ask DFL · ${new Date().toLocaleDateString('en-JM', { day: 'numeric', month: 'long', year: 'numeric' })} · All figures J$, net of credits</footer>
      </div>`;
  }

  function print(report) {
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print this report.'); return; }
    const T = theme(report.style);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>@page{size:A4 landscape;margin:8mm}body{margin:0;padding:16px;background:${H(T.page)};-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .rp{max-width:1060px;margin:0 auto}@media print{body{padding:0;background:#fff}.rp{border:0}}</style></head>
      <body>${html(report)}<script>document.fonts.ready.then(()=>setTimeout(()=>print(),300))<\/script></body></html>`);
    w.document.close();
  }

  /* ---------------- PowerPoint ---------------- */
  function loadPptx() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function pptx(report, fileName) {
    await loadPptx();
    const T = theme(report.style), HF = 'Montserrat', BF = 'Open Sans';
    const P = new PptxGenJS(); P.layout = 'LAYOUT_WIDE'; P.title = report.title || 'Ask DFL report';   // 13.33 x 7.5 in
    const dated = new Date().toLocaleDateString('en-JM', { day: 'numeric', month: 'long', year: 'numeric' });
    const toneCol = t => T[tone(t)] || T.accent, toneBar = t => T[tone(t) + 'Bar'] || T.accent, toneBg = t => T[tone(t) + 'Bg'] || T.neutralBg;
    const darkHead = T.head !== 'FFFFFF';

    const frame = (title, sub) => {
      const s = P.addSlide(); s.background = { color: T.bg };
      if (darkHead) s.addShape(P.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.05, fill: { color: T.head }, line: { color: T.head } });
      s.addShape(P.ShapeType.rect, { x: 0, y: 1.05, w: 13.33, h: 0.05, fill: { color: T.rule }, line: { color: T.rule } });
      s.addText(title || '', { x: 0.55, y: 0.18, w: 9.6, h: 0.55, fontFace: HF, fontSize: 22, bold: true, color: darkHead ? T.headText : T.ink, fit: 'shrink' });
      if (sub) s.addText(sub, { x: 0.55, y: 0.66, w: 9.6, h: 0.32, fontFace: BF, fontSize: 11, color: darkHead ? T.headText : T.ink3, transparency: darkHead ? 30 : 0 });
      s.addText(report.period || '', { x: 9.6, y: 0.5, w: 3.2, h: 0.4, fontFace: BF, fontSize: 10, align: 'right', color: darkHead ? T.headText : T.ink3, transparency: darkHead ? 30 : 0 });
      s.addText(`Ask DFL · ${dated} · J$`, { x: 0.55, y: 7.05, w: 12.2, h: 0.3, fontFace: BF, fontSize: 9, color: T.ink3 });
      return s;
    };

    // Title slide
    const t = P.addSlide(); t.background = { color: darkHead ? T.head : T.bg };
    if (!darkHead) t.addShape(P.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: T.rule }, line: { color: T.rule } });
    t.addShape(P.ShapeType.rect, { x: 0.8, y: 4.35, w: 1.4, h: 0.08, fill: { color: T.rule }, line: { color: T.rule } });
    t.addImage({ path: '/icon-192x192.png', x: 0.8, y: 0.7, w: 0.8, h: 0.8 });
    t.addText('Ask DFL', { x: 1.75, y: 0.82, w: 5, h: 0.55, fontFace: HF, fontSize: 18, bold: true, color: darkHead ? T.headText : T.ink });
    t.addText(report.title || '', { x: 0.8, y: 2.1, w: 11.8, h: 2.1, fontFace: HF, fontSize: 38, bold: true, color: darkHead ? T.headText : T.ink, valign: 'bottom', fit: 'shrink' });
    t.addText([report.subtitle, report.period].filter(Boolean).join('  ·  '), { x: 0.8, y: 4.6, w: 11.8, h: 0.6, fontFace: BF, fontSize: 15, color: darkHead ? T.headText : T.ink2, transparency: darkHead ? 25 : 0 });
    t.addText(dated, { x: 0.8, y: 6.6, w: 6, h: 0.4, fontFace: BF, fontSize: 11, color: darkHead ? T.headText : T.ink3, transparency: darkHead ? 40 : 0 });

    const blocks = (report.blocks || []).filter(b => blockHtml[b.type]);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'hero' || b.type === 'kpis') {
        // Hero and the KPI row that follows it share one summary slide.
        const hero = b.type === 'hero' ? b : null, kpis = b.type === 'kpis' ? b : (blocks[i + 1] && blocks[i + 1].type === 'kpis' ? blocks[++i] : null);
        const s = frame('Summary', report.subtitle);
        let y = 1.45;
        if (hero) {
          s.addText(hero.value || '', { x: 0.55, y, w: 3.6, h: 1.25, fontFace: HF, fontSize: 60, bold: true, color: toneCol(hero.tone), fit: 'shrink' });
          s.addText(hero.caption || '', { x: 0.55, y: y + 1.25, w: 3.6, h: 0.35, fontFace: BF, fontSize: 11, color: T.ink3 });
          s.addText([{ text: hero.takeaway || '', options: { fontFace: HF, fontSize: 18, bold: true, color: T.ink, breakLine: true } },
                     ...(hero.detail ? [{ text: hero.detail, options: { fontFace: BF, fontSize: 13, color: T.ink2 } }] : [])],
            { x: 4.4, y, w: 8.4, h: 1.6, valign: 'middle', paraSpaceAfter: 6, fit: 'shrink' });
          y += 2.0;
        }
        if (kpis) {
          const items = (kpis.items || []).slice(0, 4), w = (12.2 - 0.2 * (items.length - 1)) / Math.max(1, items.length);
          items.forEach((k, j) => {
            const x = 0.55 + j * (w + 0.2);
            s.addShape(P.ShapeType.roundRect, { x, y, w, h: 2.1, fill: { color: T.card }, line: { color: T.line, width: 1 }, rectRadius: 0.08 });
            s.addText(k.label || '', { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.35, fontFace: BF, fontSize: 11, bold: true, color: T.ink3 });
            s.addText(k.value || '', { x: x + 0.2, y: y + 0.5, w: w - 0.4, h: 0.6, fontFace: HF, fontSize: 26, bold: true, color: toneCol(k.tone), fit: 'shrink' });
            let ny = y + 1.15;
            if (isFinite(Number(k.progress)) && k.progress !== null && k.progress !== '') {
              s.addShape(P.ShapeType.roundRect, { x: x + 0.2, y: ny, w: w - 0.4, h: 0.08, fill: { color: T.line }, line: { color: T.line }, rectRadius: 0.04 });
              s.addShape(P.ShapeType.roundRect, { x: x + 0.2, y: ny, w: Math.max(0.05, (w - 0.4) * Math.min(1, Number(k.progress) / 100)), h: 0.08, fill: { color: toneBar(k.tone) }, line: { color: toneBar(k.tone) }, rectRadius: 0.04 });
              ny += 0.18;
            }
            if (k.note) s.addText(k.note, { x: x + 0.2, y: ny, w: w - 0.4, h: y + 2.0 - ny, fontFace: BF, fontSize: 10.5, color: T.ink2, valign: 'top', fit: 'shrink' });
          });
        }
        continue;
      }
      const s = frame(b.title || ({ columns: 'Takeaways', tiles: 'At a glance', text: 'Notes' }[b.type] || ''), b.subtitle);
      if (b.type === 'bars') {
        const items = (b.items || []).slice(0, 10), top = Math.max(100, ...items.map(x => Number(x.pct) || 0));
        const rowH = Math.min(0.55, 5.0 / Math.max(1, items.length));
        items.forEach((it, j) => {
          const y = 1.45 + j * rowH;
          s.addText([{ text: it.label || '', options: { bold: true, breakLine: !!it.sublabel } }, ...(it.sublabel ? [{ text: it.sublabel, options: { fontSize: 9, color: T.ink3 } }] : [])],
            { x: 0.55, y, w: 3.0, h: rowH, fontFace: BF, fontSize: 12, color: T.ink, valign: 'middle', fit: 'shrink' });
          const bx = 3.7, bw = 5.4, by = y + rowH / 2 - 0.08;
          s.addShape(P.ShapeType.roundRect, { x: bx, y: by, w: bw, h: 0.16, fill: { color: T.line }, line: { color: T.line }, rectRadius: 0.08 });
          s.addShape(P.ShapeType.roundRect, { x: bx, y: by, w: Math.max(0.05, bw * Math.min(1, (Number(it.pct) || 0) / top)), h: 0.16, fill: { color: toneBar(it.tone) }, line: { color: toneBar(it.tone) }, rectRadius: 0.08 });
          s.addShape(P.ShapeType.rect, { x: bx + bw * (100 / top), y: by - 0.07, w: 0.025, h: 0.3, fill: { color: T.ink }, line: { color: T.ink } });
          s.addText(isFinite(Number(it.pct)) ? Math.round(Number(it.pct)) + '%' : '', { x: 9.2, y, w: 0.9, h: rowH, fontFace: HF, fontSize: 15, bold: true, color: toneCol(it.tone), align: 'right', valign: 'middle' });
          s.addText(it.value || '', { x: 10.2, y, w: 1.5, h: rowH, fontFace: BF, fontSize: 11, color: T.ink, valign: 'middle', fit: 'shrink' });
          s.addText(it.delta || '', { x: 11.7, y, w: 1.1, h: rowH, fontFace: BF, fontSize: 11, bold: true, color: toneCol(it.tone), align: 'right', valign: 'middle' });
        });
        if (b.note) s.addText(b.note, { x: 0.55, y: 6.55, w: 12.2, h: 0.4, fontFace: BF, fontSize: 11, color: T.ink2 });
      } else if (b.type === 'chart') {
        const labels = (b.labels || []).map(String), n = labels.length;
        const mk = list => list.map(se => ({ name: se.name || '', labels, values: (se.values || []).slice(0, n).map(v => isFinite(Number(v)) ? Number(v) : 0) }));
        const bars = (b.series || []).filter(x => x.type === 'bar'), lines = (b.series || []).filter(x => x.type !== 'bar');
        const parts = [];
        if (bars.length) parts.push({ type: P.ChartType.bar, data: mk(bars), options: { chartColors: [T.accent, T.soft], barGapWidthPct: 60 } });
        if (lines.length) parts.push({ type: P.ChartType.line, data: mk(lines), options: { chartColors: lines.map(x => x.type === 'target' ? T.target : T.last), lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6 } });
        const opts = { x: 0.55, y: 1.35, w: 12.2, h: b.note ? 5.1 : 5.5, showLegend: true, legendPos: 'b', legendFontFace: BF, legendColor: T.ink2, legendFontSize: 11,
          catAxisLabelColor: T.ink3, valAxisLabelColor: T.ink3, catAxisLabelFontFace: BF, valAxisLabelFontFace: BF, valGridLine: { color: T.line, size: 0.5 }, catAxisLineShow: false, valAxisLineShow: false,
          valAxisLabelFormatCode: '#,##0', plotArea: { fill: { color: T.bg } } };
        if (parts.length > 1) s.addChart(parts, opts);
        else if (parts.length) s.addChart(parts[0].type, parts[0].data, { ...opts, ...parts[0].options });
        if (b.note) s.addText(b.note, { x: 0.55, y: 6.55, w: 12.2, h: 0.4, fontFace: BF, fontSize: 11, color: T.ink2 });
      } else if (b.type === 'tiles') {
        const items = (b.items || []).slice(0, 18), per = items.length > 12 ? 6 : 4, w = (12.2 - 0.2 * (per - 1)) / per, h = items.length > 8 ? 1.5 : 1.75;
        items.forEach((it, j) => {
          const x = 0.55 + (j % per) * (w + 0.2), y = 1.45 + Math.floor(j / per) * (h + 0.2);
          s.addShape(P.ShapeType.rect, { x, y, w, h, fill: { color: toneBg(it.tone) }, line: { color: toneBg(it.tone) } });
          s.addShape(P.ShapeType.rect, { x, y, w, h: 0.07, fill: { color: toneBar(it.tone) }, line: { color: toneBar(it.tone) } });
          s.addText(it.label || '', { x: x + 0.15, y: y + 0.15, w: w - 0.3, h: 0.32, fontFace: BF, fontSize: 10.5, bold: true, color: T.ink2, fit: 'shrink' });
          s.addText(it.value || '', { x: x + 0.15, y: y + 0.45, w: w - 0.3, h: 0.6, fontFace: HF, fontSize: 24, bold: true, color: toneCol(it.tone), fit: 'shrink' });
          if (it.sub) s.addText(it.sub, { x: x + 0.15, y: y + 1.05, w: w - 0.3, h: h - 1.15, fontFace: BF, fontSize: 10, color: T.ink2, valign: 'top', fit: 'shrink' });
        });
      } else if (b.type === 'columns') {
        const cols = (b.items || []).slice(0, 4), w = (12.2 - 0.25 * (cols.length - 1)) / Math.max(1, cols.length);
        cols.forEach((c, j) => {
          const x = 0.55 + j * (w + 0.25), edge = c.tone === 'good' ? T.goodBar : c.tone === 'bad' ? T.badBar : c.tone === 'focus' ? T.accent : T.line;
          s.addShape(P.ShapeType.rect, { x, y: 1.45, w, h: 5.35, fill: { color: c.tone === 'focus' ? T.neutralBg : T.card }, line: { color: T.line, width: 1 } });
          s.addShape(P.ShapeType.rect, { x, y: 1.45, w: 0.08, h: 5.35, fill: { color: edge }, line: { color: edge } });
          s.addText(c.title || '', { x: x + 0.3, y: 1.6, w: w - 0.45, h: 0.45, fontFace: HF, fontSize: 15, bold: true, color: T.ink });
          s.addText((c.points || []).slice(0, 5).map(p => ({ text: (p.lead ? p.lead + ' ' : '') + (p.text || ''), options: { bullet: { indent: 14 }, paraSpaceAfter: 8 } })),
            { x: x + 0.3, y: 2.15, w: w - 0.45, h: 4.5, fontFace: BF, fontSize: 12, color: T.ink2, valign: 'top', fit: 'shrink' });
        });
      } else if (b.type === 'table') {
        const cols = b.columns || [], rows = (b.rows || []).slice(0, 12);
        const num = cols.map(c => rows.every(r => r[c] === null || isNum(r[c])));
        const headRow = cols.map(c => ({ text: c, options: { bold: true, color: T.head === 'FFFFFF' ? 'FFFFFF' : T.headText, fill: { color: T.head === 'FFFFFF' ? T.accent : T.head }, fontFace: HF, fontSize: 11 } }));
        const body = rows.map((r, ri) => cols.map((c, j) => ({ text: fmt(r[c], c), options: { align: num[j] ? 'right' : 'left', fill: { color: ri % 2 ? T.bg : T.card } } })));
        if (cols.length) s.addTable([headRow, ...body], { x: 0.55, y: 1.4, w: 12.2, fontFace: BF, fontSize: 11, color: T.ink, border: { type: 'solid', pt: 0.5, color: T.line }, autoPage: false });
        if ((b.rows || []).length > rows.length) s.addText(`Top ${rows.length} of ${(b.rows || []).length}. The full list is in the Excel download.`, { x: 0.55, y: 6.6, w: 12.2, h: 0.35, fontFace: BF, fontSize: 10, italic: true, color: T.ink2 });
      } else if (b.type === 'text') {
        s.addText(b.body || '', { x: 0.55, y: 1.5, w: 12.2, h: 5.2, fontFace: BF, fontSize: 16, color: T.ink2, valign: 'top', fit: 'shrink' });
      }
    }
    await P.writeFile({ fileName });
  }

  window.AskReport = { html, print, pptx, styles: Object.keys(THEMES) };
})();
