import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "./server-env.server";

export type SessionTokens = { accessToken: string; refreshToken: string };

/**
 * A client acting as the signed-in admin, for the few calls Supabase only
 * allows on the user's own session (two-step setup and codes, password
 * change). Created per call; never stored.
 */
export async function getUserClient(tokens: SessionTokens): Promise<SupabaseClient> {
  const env = serverEnv();
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) throw error;
  return client;
}

/** A client with no session, for sign-in and password reset. */
export function getAnonClient(): SupabaseClient {
  const env = serverEnv();
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
