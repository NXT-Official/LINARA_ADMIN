import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import reactPlugin from "eslint-plugin-react";
import tseslint from "typescript-eslint";
import securityPlugin from "eslint-plugin-security";

// Same rules as LINARA web's eslint.config.js (D19), with raw HTML rendering
// raised from a warning to an error (S-15).
export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".nitro",
      ".vinxi",
      ".tanstack",
      ".wrangler",
      ".vercel",
      "node_modules",
      "src/routeTree.gen.ts",
      "playwright-report",
      "test-results",
      ".claude",
    ],
  },
  {
    // Config files, the server entry points and the test runners run in Node.
    files: [
      "*.config.{js,ts}",
      "src/server.ts",
      "src/start.ts",
      "supabase/tests/**/*.mjs",
      "e2e/**/*.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  securityPlugin.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      react: reactPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // A. TanStack Start & SSR boundaries
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use Next.js `server-only`. Rename file to `*.server.ts` or annotate with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // B. Security guardrails
      "no-eval": "error",
      "no-implied-eval": "error",
      // User-entered text is always shown as plain text, never as HTML (S-15).
      "react/no-danger": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "prefer-regex-literals": "error",
    },
  },
  {
    // Same reasoning as LINARA web: the rule can't see TypeScript key types.
    // Review new obj[userInput] writes by hand.
    rules: { "security/detect-object-injection": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "supabase/tests/**/*.mjs", "e2e/**/*.ts", "scripts/**/*.mjs"],
    rules: { "security/detect-non-literal-fs-filename": "off" },
  },
  {
    // Vendored shadcn/ui, kept as generated.
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off", "react/no-danger": "off" },
  },
  eslintPluginPrettier,
);
