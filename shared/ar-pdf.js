/* AR statement PDF — one salesperson's open items, laid out like the finance
   "DFL Importers - AR Aging" export: A4 landscape, navy title band, a six-cell
   summary strip (age buckets / credits / net), then one block per customer with
   rows shaded by age and a customer total, closing on a GRAND TOTAL.

   Pure drawing code: build(jsPDF, opts) returns a jsPDF document. It does no
   network or DOM work, so my-ar.html loads jsPDF, passes the rows it already
   holds, and saves the result. All measurements are in points and come from the
   original export, so keep them if you change anything.

   opts: { rows, repCode, repName, asOf: 'YYYY-MM-DD' }
   rows: ar_aging_rows fields — doc_type, ref_nbr, customer_id, customer_name,
         doc_date, due_date, terms, amount_doc, balance_doc, balance_jmd,
         is_credit, days_aged, bucket. */
(function () {
  'use strict';

  var PW = 841.89, PH = 595.28;
  var X0 = 36, TW = 769;              // table left edge / width
  var RH = 16.35, GAP = 14, BASE = 10.65, PAD = 3;   // row height, gap between customers, text baseline inside a row, cell padding
  var LIMIT = PH - 40;                // a row may not reach lower than this
  var KEEP = 400;                     // customer blocks taller than this may split across pages
  var COLS = [333, 66, 66, 40, 64, 100, 100];   // Document · Doc date · Due date · Days · Terms · Balance · Original
  var XS = [X0];
  COLS.forEach(function (w) { XS.push(XS[XS.length - 1] + w); });   // 36 369 435 501 541 605 705 805

  var NAVY = [26, 46, 89], NAVY_TXT = [26, 46, 90], WHITE = [255, 255, 255];
  var INK = [20, 20, 20], DIM = [80, 80, 80], FOOT = [120, 120, 120], GRID = [199, 199, 199];
  var BLUE = [232, 240, 250], YEL = [255, 242, 179], ORG = [255, 212, 168], RED = [255, 179, 179], GRN = [230, 245, 237];

  // Money is summed in whole cents so a column of 2-decimal values never drifts.
  function cents(v) { return Math.round((+v || 0) * 100); }
  function money(c) {
    var s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? '-' : '') + s;
  }
  function cmp(a, b) { a = a == null ? '' : String(a); b = b == null ? '' : String(b); return a < b ? -1 : a > b ? 1 : 0; }

  function ageFill(days) { return days > 90 ? RED : days > 60 ? ORG : days > 30 ? YEL : null; }

  function build(jsPDF, o) {
    var doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    function font(style, size, color) { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]); }
    function fill(c, x, y, w, h) { doc.setFillColor(c[0], c[1], c[2]); doc.rect(x, y, w, h, 'F'); }
    function text(s, x, y, align) { doc.text(String(s), x, y, align ? { align: align } : undefined); }

    /* ---- prepare ---- */
    var rows = (o.rows || []).map(function (r) {
      var bd = +r.balance_doc || 0, amt = +r.amount_doc || 0;
      // The aging table keeps the original amount in document currency only;
      // restate it in JMD at the rate implied by the open balance.
      var orig = bd !== 0 ? cents(amt * (+r.balance_jmd || 0) / bd) : cents(amt);
      return { r: r, bal: cents(r.balance_jmd), orig: orig, days: r.days_aged == null ? null : +r.days_aged, credit: !!r.is_credit };
    });

    var map = new Map();
    rows.forEach(function (x) {
      var id = x.r.customer_id, g = map.get(id);
      if (!g) { g = { id: id, name: x.r.customer_name || id, rows: [], bal: 0, orig: 0, over60: 0 }; map.set(id, g); }
      g.rows.push(x); g.bal += x.bal; g.orig += x.orig;
      if (!x.credit && x.days > 60) g.over60 += x.bal;
    });
    var groups = Array.from(map.values()).sort(function (a, b) { return a.name.localeCompare(b.name, 'en') || cmp(a.id, b.id); });
    groups.forEach(function (g) {
      // invoices first (oldest first), then credits and unapplied payments
      g.rows.sort(function (a, b) { return (a.credit - b.credit) || cmp(a.r.doc_date, b.r.doc_date) || cmp(a.r.ref_nbr, b.r.ref_nbr); });
    });

    var sum = { cur: 0, b31: 0, b61: 0, b90: 0, cr: 0, net: 0 };
    rows.forEach(function (x) {
      sum.net += x.bal;
      if (x.credit) { sum.cr += x.bal; return; }
      var b = x.r.bucket;
      if (b === '31-60') sum.b31 += x.bal; else if (b === '61-90') sum.b61 += x.bal; else if (b === '90+') sum.b90 += x.bal; else sum.cur += x.bal;
    });

    /* ---- page 1: title band + summary strip ---- */
    fill(NAVY, 0, 0, PW, 58);
    font('bold', 16, WHITE); text('DFL Importers - AR Aging', X0, 27);
    var who = (o.repName || o.repCode || '') + (o.repName && o.repCode ? ' (' + o.repCode + ')' : '');
    font('normal', 10.5, WHITE);
    text(who + '   |   As of ' + o.asOf + '   |   aged from document date   |   all amounts in JMD', X0, 46);

    var cells = [
      ['Current 0-30', money(sum.cur), null],
      ['31-60 days', money(sum.b31), YEL],
      ['61-90 days', money(sum.b61), ORG],
      ['Over 90', money(sum.b90), RED],
      ['Credits', money(sum.cr), GRN],
      ['Net balance', money(sum.net), null]
    ];
    // Column widths follow the content (5pt padding a side), scaled to fill the page width.
    font('bold', 10, INK);
    var need = cells.map(function (c) { return Math.max(doc.getTextWidth(c[0]), doc.getTextWidth(c[1])) + 10; });
    var needTotal = need.reduce(function (a, b) { return a + b; }, 0);
    var cx = X0;
    cells.forEach(function (c, i) {
      var w = need[i] / needTotal * (PW - 2 * X0);
      fill(NAVY, cx, 72, w, 21.5);
      font('bold', 10, WHITE); text(c[0], cx + w / 2, 85.5, 'center');
      doc.setFillColor((c[2] || WHITE)[0], (c[2] || WHITE)[1], (c[2] || WHITE)[2]);
      doc.setDrawColor(GRID[0], GRID[1], GRID[2]); doc.setLineWidth(0.1);
      doc.rect(cx, 93.5, w, 21.5, 'FD');
      font('bold', 10, DIM); text(c[1], cx + w / 2, 107, 'center');
      cx += w;
    });

    /* ---- table ---- */
    function head(y) {
      fill(NAVY, X0, y, TW, 18);
      font('bold', 9, WHITE);
      var by = y + 12;
      text('Document', XS[0] + PAD, by); text('Doc date', XS[1] + PAD, by); text('Due date', XS[2] + PAD, by);
      text('Days', XS[4] - PAD, by, 'right'); text('Terms', XS[4] + PAD, by);
      text('Balance (JMD)', XS[6] - PAD, by, 'right'); text('Original (JMD)', XS[7] - PAD, by, 'right');
    }

    var y;
    function newPage(withHead) {
      doc.addPage();
      if (withHead) { head(30); y = 48; } else { y = 50; }   // a block continuing from the page before has no head
    }

    function blockHead(g) {
      fill(BLUE, X0, y, TW, RH);
      font('bold', 9, NAVY_TXT); text(g.name + '  (' + g.id + ')', X0 + PAD, y + BASE);
      y += RH;
    }
    function dataRow(x) {
      var r = x.r, c = x.credit ? GRN : ageFill(x.days);
      if (c) fill(c, X0, y, TW, RH);
      font('normal', 9, INK);
      var by = y + BASE;
      text(r.doc_type + ' ' + r.ref_nbr, XS[0] + PAD, by);
      text(r.doc_date || '', XS[1] + PAD, by);
      text(r.due_date || '', XS[2] + PAD, by);
      text(x.credit || x.days == null ? '-' : x.days, XS[4] - PAD, by, 'right');
      text(r.terms || '', XS[4] + PAD, by);
      text(money(x.bal), XS[6] - PAD, by, 'right');
      text(money(x.orig), XS[7] - PAD, by, 'right');
      y += RH;
    }
    function totalRow(g) {
      fill(BLUE, X0, y, TW, RH);
      doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]); doc.setLineWidth(0.6); doc.line(X0, y, X0 + TW, y);
      font('bold', 9, NAVY_TXT);
      text('Customer total' + (g.over60 > 0 ? '   (over 60 days J$' + money(g.over60) + ')' : ''), XS[3] - PAD, y + BASE, 'right');
      text(money(g.bal), XS[6] - PAD, y + BASE, 'right'); text(money(g.orig), XS[7] - PAD, y + BASE, 'right');
      y += RH;
    }

    head(131); y = 149;
    groups.forEach(function (g, i) {
      if (i) y += GAP;
      var h = (g.rows.length + 2) * RH;
      if (y + h > LIMIT) {
        // Doesn't fit here: move a normal-sized customer to a fresh page whole.
        // A very tall one starts where it is, but only if its name and two rows fit.
        if (h <= KEEP || y + 3 * RH > LIMIT) newPage(true);
      }
      blockHead(g);
      g.rows.forEach(function (x) { if (y + RH > LIMIT) newPage(false); dataRow(x); });
      if (y + RH > LIMIT) newPage(false);
      totalRow(g);
    });

    y += GAP;
    if (y + RH > LIMIT) newPage(false);
    font('bold', 9, INK);
    text('GRAND TOTAL', XS[6] - PAD, y + BASE, 'right');
    text(money(groups.reduce(function (a, g) { return a + g.bal; }, 0)), XS[6] - PAD, y + BASE, 'right');
    text(money(groups.reduce(function (a, g) { return a + g.orig; }, 0)), XS[7] - PAD, y + BASE, 'right');

    /* ---- footer on every page ---- */
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      font('normal', 8, FOOT);
      text('Yellow over 30 days, orange over 60, red over 90. Credits in green.', X0, PH - 16);
      text('Page ' + p + ' of ' + n, X0 + TW, PH - 16, 'right');
    }

    doc.setProperties({ title: 'AR Aging - ' + who + ' - ' + o.asOf, subject: 'DFL Importers accounts receivable', creator: 'DFL Staff Portal' });
    return doc;
  }

  // "SBE 28.10.26.pdf" — salesperson code, then the day it was downloaded.
  function filename(code, d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return code + ' ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(-2) + '.pdf';
  }

  window.DFL_ARPDF = { build: build, filename: filename };
})();
