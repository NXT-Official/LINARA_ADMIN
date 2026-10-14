import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Passing '' as the third argument loads every variable, not only VITE_*.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // 8080 is LINARA web's dev server; the console runs beside it.
    server: { port: 8081 },
    preview: { port: 8081 },
    resolve: { tsconfigPaths: true },
    // Baked into the client bundle at build time. Only public values belong here:
    // the server key is read at request time by src/lib/supabase-admin.server.ts (S-11).
    define: {
      "process.env.SUPABASE_URL": JSON.stringify(env.SUPABASE_URL),
      "process.env.SUPABASE_ANON_KEY": JSON.stringify(env.SUPABASE_ANON_KEY),
      "process.env.APP_ENV": JSON.stringify(env.APP_ENV),
    },
    plugins: [
      tailwindcss(),
      nitro(),
      // Entries are auto-resolved from src/: router.tsx, start.ts, server.ts.
      tanstackStart(),
      // Must come after tanstackStart so Start's transforms run first.
      viteReact(),
    ],
  };
});
