# tds-core-frontend-pkg

The **base frontend host**, published as a package
(`@tracht-digital-solutions/tds-core-frontend`). It ships the shell (chrome,
pre-paint auth gate, nav), the **base pages** (Dashboard/widget host, user
management, Module = Inventar + Updates, Einstellungen, Wiki = FAQ + API-Referenz)
and the **`coreFrontendBase` Astro integration**
— consumed by the **product repos** (`tds-admin-frontend` / `tds-customer-frontend`),
each of which composes this host with its own extension set + deploy pipeline.

> This repo is **not built as an app** anymore — the products are. It's a package
> of raw source (pages/layout/components/lib/styles) + a compiled integration.

## Consuming it (in a product repo)

```ts
// astro.config.mjs
import react from "@astrojs/react";
import { coreFrontendBase } from "@tracht-digital-solutions/tds-core-frontend/astro";
import { frontendHost } from "@tracht-digital-solutions/tds-frontend-contract/astro";
import { tdsViteBuild } from "@tracht-digital-solutions/tds-shared/astro";
import timeTracker from "@tracht-digital-solutions/tds-ext-time-tracker";

process.env.FRONTEND_TARGET = "admin"; // or "customer"
process.env.PUBLIC_FRONTEND_TARGET = "admin";

export default defineConfig({
  output: "static",
  integrations: [react(), coreFrontendBase(), frontendHost({ extensions: [timeTracker] })],
  vite: { build: { ...tdsViteBuild } },
});
```

- `coreFrontendBase()` — `injectRoute`s the base pages (`/`, `/users`, `/module`,
  `/einstellungen`, `/wiki`), whose entrypoints are this package's subpaths; their
  relative imports (Layout, components, lib, styles) resolve inside the package.
  It also serves `virtual:frontend-modules`: the composed package inventory
  (pinned range + installed version + module name), read from the **product's**
  `package.json` and `node_modules` at build time for the Module page.
- `frontendHost({ extensions })` (from `tds-frontend-contract-pkg`) — injects each
  extension's route + the `virtual:frontend-registry` / `-widgets` / `-settings`
  modules the shell reads.
- `FRONTEND_TARGET` picks the shell auth-hint key (`tds_admin_*` vs `tds_customer_*`)
  + brand ("Frontend"/"Portal"); see `src/config/target.ts`.
- The product also needs `postcss.config.mjs` (`@tailwindcss/postcss`) + the peer
  deps (astro, react, tailwind, fonts). **Tailwind v4 note:** `src/styles/global.css`
  carries `@source "../../../"` so the product build scans this package AND every
  extension package in `node_modules` for classes (Tailwind ignores `node_modules`
  by default).

## Develop / release

```bash
npm install --no-package-lock   # contract + tds-shared-pkg from GitHub Packages (NPM_TOKEN)
npm run type-check              # tsc --noEmit
npm run test:run                # vitest
npm run build                   # tsup → dist/astro.js (the integration)
```

## Tests

`npm run test:run` — 123 tests over the framework-agnostic half of the host. The
`.astro` shell and the React islands stay on the product build + `astro check`.

| Suite | Pins |
|---|---|
| `src/lib/auth.test.ts` | the **401 backstop** — a 401 is confirmed against `/me`, and only a `/me` that *also* 401s ends the session; one redirect under parallel 401s; the `?next=` round-trip; hint lifecycle incl. blocked storage |
| `src/lib/dashboardLayout.test.ts` | saved-order application, unknown widgets appended **still visible**, the progressive-enhancement promise (no layout / API error / API unreachable all leave every widget visible in authored order), and the **save feedback**: success confirms, a rejected save reports its HTTP status and stays in edit mode, and the initial load stays silent |
| `src/config/target.test.ts` | `PUBLIC_FRONTEND_TARGET` selection, and that the two products get **different** `HINT_PREFIX` values |
| `src/content/faq.test.ts` | the `/wiki` FAQ: unique anchor-safe ids, per-target scoping, and that questions/answers stay **plain text** (they are interpolated, never `set:html`) |
| `src/astro.test.ts` | the injected base routes resolve to files that exist, are package subpaths, that no in-app `/login` route returns, and that the module inventory **degrades** (declared-but-missing package → a row with an empty version, unreadable root → empty list) rather than failing a product build |
| `src/lib/moduleUpdates.test.ts` | the **0.x caret rule** (`^0.1.1` = `>=0.1.1 <0.2.0`), a prerelease sorting below its release, and that an unparseable range answers `null` — not `false` — so "cannot tell" never renders as "Repin erforderlich" |
| `src/components/ModulesAdmin.test.tsx` | that a repin row offers **no** deploy button, that the confirmation admits one rebuild covers every in-range module, and that a failed dispatch carries its HTTP status |

Two of these guard documented incidents: the blanket `401 → logout` that looped
freshly-logged-in users back to the login, and the stale `dist` that kept
injecting a removed `/login` route and ENOENT-ed the product build.

Push to `main` publishes a `@dev` prerelease; the manual **Release** button
publishes `@latest` + tags. Product repos then repin to the new `^version`.
