-- APPLIED 18 Nov 2026 with Scott's OK as migration hubs_order_checks. Read-only changes to the ops part of chain_hub_data and key_hub_data
-- (same four additions as the Sales Support Hub got in migrations ss_hub_portal, ss_hub_lowp and ss_hub_listprice):
--   1. lines: three more columns at the END (so nothing shifts): unit cost, qty on hand at 71, qty on hand at Ashenheim.
--      Needed for: below-cost price checks, the transfers list and the out-of-stock list.
--   2. deals: list price as a third value: [sheet_price, tiers, list_price]. A line at or above list is never "below the deal price".
--   3. inact: items on those orders that are no longer Active ("item not carried").
--   4. lowp: the lowest price each store was invoiced each item in the last 6 months (chain and key stores keep their own price levels,
--      so a price they usually get is not flagged).
-- The function is re-created from its live text with four exact one-place replacements; it raises an error and changes nothing if any
-- piece is not found exactly once. Old pages ignore the extra values. Expected extra time on the ops part: well under 1 second each
-- (44 and 35 stores).
do $$
declare fn text; d text;
        inact text := $q$'inact', (select json_object_agg(inventory_id, st) from (select inventory_id, min(item_status) st from stock_items_raw where inventory_id in (select inventory_id from so_ordered_items where order_nbr in (select order_nbr from oo where order_type='SO')) group by 1 having bool_and(item_status <> 'Active')) z),
$q$;
        lowp text := $q$'lowp', (select json_agg(json_build_array(customer_id, inventory_id, p, d)) from (select ii.customer_id, ii.inventory_id, round(min(ii.unit_price)) p, to_char(max(ii.invoice_date),'YYYY-MM-DD') d from invoiced_items ii join (select distinct oo.customer, i.inventory_id from so_ordered_items i join oo on oo.order_nbr = i.order_nbr and oo.order_type = i.order_type where oo.order_type = 'SO' and i.unit_price > 0) ol on ol.customer = ii.customer_id and ol.inventory_id = ii.inventory_id where ii.invoice_date >= current_date - 183 and ii.tran_type = 'INV' and ii.unit_price > 0 and (ii.invoice_status not in ('Voided','Rejected') or ii.invoice_status is null) group by 1,2) lp),
$q$;
begin
  foreach fn in array array['chain_hub_data','key_hub_data'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = fn and p.pronamespace = 'public'::regnamespace;
      if (length(d) - length(replace(d, 'i.item_class, i.order_status))', ''))) / length('i.item_class, i.order_status))') <> 1
         or (length(d) - length(replace(d, 'json_build_array(sheet_price, tiers))', ''))) / length('json_build_array(sheet_price, tiers))') <> 1
         or (length(d) - length(replace(d, '''sync'',', ''))) / length('''sync'',') <> 1 then
        raise exception '% is not in the expected shape', fn;
      end if;
    d := replace(d, 'i.item_class, i.order_status))', 'i.item_class, i.order_status, round(i.unit_cost), i.qty_on_hand_71, i.qty_on_hand_ash))');
    d := replace(d, 'json_build_array(sheet_price, tiers))', 'json_build_array(sheet_price, tiers, list_price))');
    d := replace(d, '''sync'',', inact || lowp || '''sync'',');
    execute d;
  end loop;
end $$;
