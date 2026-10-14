import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname || "", "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // PGlite database tests run on their own (supabase/tests).
      "**/tests/**",
      // Playwright's browser tests (bun run test:e2e).
      "e2e/**",
      "**/.{idea,git,cache,output,temp}/**",
      ".claude/**",
    ],
  },
});
