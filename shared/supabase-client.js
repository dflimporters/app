// ============================================================
// DFL Staff Portal — Shared Supabase Client
// ============================================================
// This file creates ONE connection to Supabase and saves it to a
// variable called `sb`. Every page that talks to Supabase (auth,
// database, or storage) loads this file first, then just uses
// `sb` — instead of every page setting up its own connection.
//
// LOAD ORDER — put these three tags in this order on every page
// that needs Supabase:
//
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="/app/shared/supabase-client.js"></script>
//   <script src="/app/shared/auth-guard.js"></script>   <!-- only on protected pages -->
//
// WHY `sb` AND NOT `supabase`?
// The CDN script (line 1 above) already creates a global variable
// named `supabase` — that's the library itself. If we named our
// own client `supabase` too, we'd silently overwrite it and get
// confusing bugs with no error message. `sb` keeps them separate.
// ============================================================

const SUPABASE_URL = 'https://hzagwndglwhcepsirafi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5rAinfDT1K9kwEQnqYwlOA_-C5tk_6h';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
