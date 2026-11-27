-- Chain Store Hub: Deals tab (Scott, 9 Nov 2026: "like the Key Account Hub"). Approved by Scott. Applied as migration chain_hub_deals.
-- 1. chain_hub_notes accepts a 'deal' note kind:
alter table public.chain_hub_notes drop constraint chain_hub_notes_kind_check;
alter table public.chain_hub_notes add constraint chain_hub_notes_kind_check check (kind in ('note','reason','promise','manager','backup','deal'));
-- 2. chain_hub_data('ops') also returns the deal sheet (read-only), inserted before the 'loads' key:
--      'dsheet', (select json_agg(json_build_array(inventory_id, description, round(sheet_price), tiers, item_class)) from current_deal_items where tiers is not null),
