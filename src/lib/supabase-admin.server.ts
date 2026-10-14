import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "./server-env.server";

/**
 * The server-key client. This is the ONLY module that reads the server key
 * (S-11); `bun run test:bundle` fails if it reaches the browser.
 *
 * One client per server instance, so `auth.getClaims`' cache of the project's
 * public signing key is reused between requests (D31).
 */
let client: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  if (!client) {
    const env = serverEnv();
    client = createClient(env.supabaseUrl, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
