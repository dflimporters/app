// Deal-sheet maths, shared by the rep app's order builder and /deal-sheet.html.
// Pure functions, no DOM, no network.
//
// A deal tier is { buy, free }: order `buy` cases, get `free` cases on top
// ("10+1"). Tiers are NOT stacked — an order gets the single highest tier whose
// `buy` it reaches (60 cases earns 50+8, not 2x 25+3). The price base is always
// the live Acumatica list price (stock_items_raw.default_price); the sheet's own
// printed price is only kept to show drift, never used to price an order.
(function () {
  function tiersOf(t) {
    return (Array.isArray(t) ? t : []).filter(x => x && x.buy > 0 && x.free > 0)
      .map(x => ({ buy: Number(x.buy), free: Number(x.free) }))
      .sort((a, b) => a.buy - b.buy);
  }

  // Price per case you effectively pay once the free cases are counted.
  function effPrice(list, tier) {
    return tier ? list * tier.buy / (tier.buy + tier.free) : list;
  }

  // What a given order quantity (cases bought) earns.
  function dealFor(tiers, qty) {
    const ts = tiersOf(tiers);
    let hit = null;
    ts.forEach(t => { if (qty >= t.buy) hit = t; });
    const next = ts.find(t => t.buy > qty) || null;
    return { tier: hit, free: hit ? hit.free : 0, next, toNext: next ? next.buy - qty : 0 };
  }

  // Money for one order line. `list` may be null (price unknown).
  // Deals are opt-in: `appliedBuy` is the `buy` of the tier the rep chose to
  // apply (or null). Only that tier — and only while qty still reaches it —
  // counts as free cases. `avail` is the best tier the qty qualifies for that
  // isn't applied yet, i.e. the one to suggest.
  function lineValue(list, tiers, qty, appliedBuy) {
    const d = dealFor(tiers, qty);
    const applied = appliedBuy ? (tiersOf(tiers).find(t => t.buy === appliedBuy && qty >= t.buy) || null) : null;
    const avail = d.tier && (!applied || d.tier.buy > applied.buy) ? d.tier : null;
    const known = list != null && isFinite(list);
    return {
      tier: applied, free: applied ? applied.free : 0,
      avail, availSaved: known && avail ? list * avail.free : null,
      next: d.next, toNext: d.toNext,
      gross: known ? list * qty : null,                  // invoice value of cases bought
      saved: known && applied ? list * applied.free : null,   // value of the free cases
      eff: known ? effPrice(list, applied ? { buy: qty, free: applied.free } : null) : null
    };
  }

  const label = t => t.buy + '+' + t.free;
  const money = n => n == null ? '—' : 'J$' + Math.round(n).toLocaleString('en-JM');

  window.DFL_DEALS = { tiersOf, effPrice, dealFor, lineValue, label, money };
})();
