# tds-core-frontend-pkg

The **base frontend host**, published as a package
(`@tracht-digital-solutions/tds-core-frontend`). It ships the shell (chrome,
pre-paint auth gate, nav), the **base pages** (Dashboard/widget host, user
management, Module = Inventar + Updates, Einstellungen inkl. **E-Mail (SMTP)**
im Admin-Build, Wiki = API-Referenz im
Admin-Build / Hilfe + Handbücher im Portal)
and the **`coreFrontendBase` Astro integration**
— consumed by the **product repos** (`tds-admin-frontend` / `tds-customer-frontend`),
each of which composes this host with its own extension set + deploy pipeline.

> This repo is **not built as an app** anymore — the products are. It's a package
> of raw source (pages/layout/components/lib/styles) + a compiled integration.

## Consuming it (in a product repo)

```ts
// astro.config.mjs
import react from "@astrojs/react";
import node from "@astrojs/node";
import { coreFrontendBase } from "@tracht-digital-solutions/tds-core-frontend/astro";
import { frontendHost } from "@tracht-digital-solutions/tds-frontend-contract/astro";
import { tdsViteBuild } from "@tracht-digital-solutions/tds-shared/astro";
import timeTracker from "@tracht-digital-solutions/tds-ext-time-tracker";

process.env.FRONTEND_TARGET = "admin"; // or "customer"
process.env.PUBLIC_FRONTEND_TARGET = "admin";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone", experimentalDisableStreaming: true }),
  integrations: [react(), coreFrontendBase(), frontendHost({ extensions: [timeTracker] })],
  vite: { build: { ...tdsViteBuild } },
});
```

- `coreFrontendBase()` — `injectRoute`s the seven base pages (`/`, `/users`,
  `/firma`, `/profil`, `/module`, `/einstellungen`, `/wiki`), whose entrypoints
  are this package's subpaths; their
  relative imports (Layout, components, lib, styles) resolve inside the package.
  It also serves `virtual:frontend-modules`: the composed package inventory
  (pinned range + installed version + module name), read from the **product's**
  `package.json` and `node_modules` at build time for the Module page.
  It also enables hover/focus prefetching for internal links; the shared
  `Layout` supplies Astro's `ClientRouter`.
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

## Client-side navigation and cached panel data

The shell renders `<ClientRouter />`, so an internal link fetches the next SSR
document and swaps it into the current page instead of showing a white reload.
The host prefetches links on hover/focus (not on viewport: the rail exposes too
many at once), preserves the toast host, cookie notice and live chat, restores
the runtime theme before each swap, and rebinds the drawer/sidebar to the new
body. A persisted progress bar gives honest feedback when the server render is
not already prefetched.

Extension islands can pair this with
`@tracht-digital-solutions/tds-shared/data`: revisiting a GET-backed screen
paints the tab's previous value immediately and dims/pulses it while a fresh
answer replaces it. Successful mutations call `invalidate(prefix)`; the old
value remains visible, and an older in-flight GET cannot overwrite the save.
The cache is memory-only and starts cold after a full reload.

This host change depends on the shared release that adds `./data`,
`mountNavProgress()` and router-safe theme bootstrap (0.33.0). Release shared
first, then raise the dependency in this repo from `^0.32.0` to `^0.33.0`, and
only then release the host; a locally copied package can hide that clean-install
dependency failure.

## Develop / release

```bash
npm install --no-package-lock   # contract + tds-shared-pkg from GitHub Packages (NPM_TOKEN)
npm run type-check              # tsc --noEmit
npm run test:run                # vitest
npm run build                   # tsup → dist/astro.js (the integration)
```

## Tests

`npm run test:run` — 288 tests over the framework-agnostic half of the host. The
`.astro` shell and the React islands stay on the product build + `astro check`.

| Suite | Pins |
|---|---|
| `src/lib/auth.test.ts` | the **401 backstop** — a 401 is confirmed against `/me`, and only a `/me` that *also* 401s ends the session; one redirect under parallel 401s; the `?next=` round-trip; hint lifecycle incl. blocked storage |
| `src/lib/dashboardLayout.test.ts` | saved-order application, unknown widgets appended **still visible**, the progressive-enhancement promise (no layout / API error / API unreachable all leave every widget visible in authored order), and the **save feedback**: success confirms, a rejected save reports its HTTP status and stays in edit mode, and the initial load stays silent |
| `src/config/target.test.ts` | `PUBLIC_FRONTEND_TARGET` selection, and that the two products get **different** `HINT_PREFIX` values |
| `src/components/ApiReference.test.tsx` | the admin wiki: routes grouped by the **module that mounted them** (not by path segment), an undocumented route still listed and saying so, a doc entry with no route surfaced, filtering that reveals its matches, and a refusal to render a payload version it does not understand |
| `src/components/HelpCenter.test.tsx` | the customer wiki: an empty or absent help API reading as "nothing here yet" rather than as a broken portal, a handbook body fetched only when its article is **opened**, FAQ answers rendered as text, markdown bodies rendered escape-first (an injected `<script>` stays text), and the call going to the **absolute** API host |
| `src/astro.test.ts` | the injected base routes resolve to files that exist, are package subpaths, that no in-app `/login` route returns, that module inventory **degrades** rather than failing a product build, and that all-link prefetch uses hover/focus rather than fetching the whole visible rail |
| `src/layouts/Layout.test.ts` | ClientRouter wiring, persisted toast/cookie/chat/progress chrome, per-swap DOM rebinding versus one-time global services, and the pre-paint gate's theme/canvas contract |
| `src/lib/navDrawer.test.ts` | focus trap and restore, scroll lock, close-on-navigation, rebinding after body swaps, and exactly one document key handler across swaps |
| `src/lib/moduleUpdates.test.ts` | the **0.x caret rule** (`^0.1.1` = `>=0.1.1 <0.2.0`), a prerelease sorting below its release, and that an unparseable range answers `null` — not `false` — so "cannot tell" never renders as "Repin erforderlich" |
| `src/components/ModulesAdmin.test.tsx` | that a repin row offers **no** deploy button, that the confirmation admits one rebuild covers every in-range module, and that a failed dispatch carries its HTTP status |

Two of these guard documented incidents: the blanket `401 → logout` that looped
freshly-logged-in users back to the login, and the stale `dist` that kept
injecting a removed `/login` route and ENOENT-ed the product build.

Push to `main` publishes a `@dev` prerelease; the manual **Release** button
publishes `@latest` + tags. Product repos then repin to the new `^version`.
