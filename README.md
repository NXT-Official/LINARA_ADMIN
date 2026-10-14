# LINARA_ADMIN: Linara Business Console

The business-facing web console for the Linara platform: dashboard, CRM, user
and household lookup, account actions, support tickets, payout triage, AI usage
and the audit log. Used by the client's business team, never by household
managers or helpers.

It is the third Linara app, beside `../LINARA` (household web app, schema owner)
and `../LINARA_MOBILE` (helper app). It shares their Supabase project and owns
only its own `staff_`, `crm_` and `support_` tables.

**Status:** Phase 0 (setup) done. Frontend design in progress on sample data.

Specs, plans, design notes and agent rules are kept in the team's local
documentation vault, not in this repository (see `.gitignore`).

## Stack

The same as LINARA web, at the versions in its `bun.lock` (spec D19):
TanStack Start (Vite 8, Nitro 3), React 19, TanStack Router and Query,
Tailwind CSS v4, shadcn/ui (new-york) on Radix, Supabase JS, Bun, Vitest,
ESLint 9 with `eslint-plugin-security`, Prettier, Playwright. Hosted on Vercel.

## Getting started

Needs [Bun](https://bun.sh/) 1.3+.

```sh
bun install
cp .env.example .env     # fill in the development project's values
bun run dev              # http://localhost:8081 (LINARA web uses 8080)
```

## Scripts

| Command               | Does                                              |
| --------------------- | ------------------------------------------------- |
| `bun run dev`         | Dev server on port 8081                           |
| `bun run build`       | Production build into `.output/`                  |
| `bun run preview`     | Serves the production build                       |
| `bun run lint`        | ESLint, including Prettier and security rules     |
| `bun run format`      | Prettier, writing changes                         |
| `bun run typecheck`   | `tsc --noEmit`                                    |
| `bun run test`        | Vitest unit and security tests                    |
| `bun run test:e2e`    | Playwright at 1280px and 360px                    |

**Definition of done:** `bun run lint`, `bun run typecheck` and `bun run test`
pass (spec §11).

## Environments

| Branch        | Deployment       | Database                               | `APP_ENV`     |
| ------------- | ---------------- | -------------------------------------- | ------------- |
| `development` | Vercel (dev)     | Supabase **linara dev**                | `development` |
| `staging`     | Vercel (staging) | No staging project yet (OQ-10)         | `staging`     |
| `production`  | Vercel (prod)    | Supabase **linara prod**               | `production`  |

Work lands on `development` and is promoted one way: `development` to
`staging` to `production`. Each deployment holds only its own environment's
keys; a production key never goes into a development or staging deployment
(spec S-8, S-26).

The two Supabase projects are shared with LINARA web and LINARA_MOBILE. A
local `.env` always points at **linara dev**.

| Variable                    | Where it is read                    | Since   |
| --------------------------- | ----------------------------------- | ------- |
| `SUPABASE_URL`              | Browser bundle (build time)         | Phase 0 |
| `SUPABASE_ANON_KEY`         | Browser bundle (build time)         | Phase 0 |
| `APP_ENV`                   | Browser bundle (build time)         | Phase 0 |
| `HCAPTCHA_SITE_KEY`         | Browser bundle                      | Phase 1 |
| `SITE_URL`                  | Server only (reset and invite links) | Phase 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, one module (S-11)      | Phase 1 |
| `HCAPTCHA_SECRET`           | Server only                         | Phase 1 |

`.env.example` says where each value comes from. For local development,
hCaptcha's official test keys are already filled in.

## Layout

```
e2e/                  Playwright browser tests
public/               icons and robots.txt (copied from LINARA)
supabase/             SQL for the console's own tables, plus PGlite tests
src/
  routes/             thin route files (TanStack file routes)
  components/ui/      shadcn/ui, ported from LINARA web
  components/shared/  logo, environment badge
  features/<module>/  pages, components, hooks, *.actions.ts server functions
  lib/                env, security headers, utils
```

Branding follows the Linara household app: the same colour tokens, typefaces
and logomark (`src/styles.css`, `src/components/shared/logo.tsx`).
