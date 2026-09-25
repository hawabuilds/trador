import {createClient, type SupabaseClient} from "@supabase/supabase-js";

/**
 * The store.
 *
 * Service-role, server-only. The browser never talks to Supabase directly:
 * every read goes through an API route so the three-state filter rule and the
 * keyset paging live in one place rather than being re-derived by each caller.
 *
 * `hasDatabase` is the switch the whole app hangs off. Without credentials the
 * feed falls back to the captured snapshot, which is what makes a fresh
 * checkout work — but the snapshot is a floor, not the store. When this is
 * configured the indexer fills the database and the snapshot stops being read.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** PostgREST lives on `https://*.supabase.co`, not the direct `db.*` host. */
function supabaseRestUrl(url: string): boolean {
  return url.startsWith("https://") && url.includes(".supabase.co");
}

export const hasDatabase = Boolean(supabaseRestUrl(URL) && SERVICE_KEY);

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!hasDatabase) {
    throw new Error("No database configured. Guard with `hasDatabase` first.");
  }

  if (!client) {
    client = createClient(URL, SERVICE_KEY, {
      auth: {persistSession: false, autoRefreshToken: false},
      global: {
        /**
         * Never let a fetch layer cache a store read.
         *
         * Next patches global fetch and will happily serve a cached feed page
         * to a later request, which shows up as a feed that stops updating for
         * some users and not others — the hardest kind of staleness to chase.
         */
        fetch: (input, init) => fetch(input, {...init, cache: "no-store"}),
      },
    });
  }

  return client;
}
