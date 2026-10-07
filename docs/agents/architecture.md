# Architecture

## Base vs extension

**Base (here):** shell and chrome, the pre-paint auth gate (`/me`-confirmed presence hint), nav renderer,
dashboard widget host and per-user layout, wiki, user and access management, the module page (`/module`), the
settings framework (sections come from extensions), i18n plumbing, and the API fetch wiring (401 → `/me`
backstop, cross-frontend SSO). The shell also mounts tds-shared's `LiveChatCta` bubble with `FRONTEND_TARGET`
as its key; it self-hides unless live-chat-cta enables this frontend.

**Extensions (other repos)** contribute pages, widgets, nav, settings, permissions and i18n through the contract.

## Composition (build time only)

- `frontendHost({ extensions: [...] })` in the product's `astro.config.mjs`. There is no runtime plugin loading.
- `coreFrontendBase()` injects the base pages; `BASE_ROUTE_PATTERNS` (from `./astro`) is the list the products'
  composition tests read.
- **tds-shared is a peer dependency.** As a regular dependency, npm nested a second copy and the shell and the
  extensions ran different versions (two toast hosts, two theme states). `npm ls @tracht-digital-solutions/tds-shared`
  in a product must show exactly one version.
- **The products are server-rendered** (`@astrojs/node`, standalone, under Passenger): extensions are still
  folded in at build time; only rendering moved to request time. That buys honest 404s instead of the vhost's SPA
  fallback (200 + dashboard HTML for every unmatched path).
- Deliberately **not** bought, and not to be "fixed" without a decision:
  - **No page cache.** A panel page is per visitor; `tds-shared/cache` refuses `Set-Cookie` responses.
  - **No server-side session check.** The gate stays a client-side hint confirmed against `/me`. Never Astro
    middleware or `Astro.cookies`: a visitor-dependent server render is one config mistake from going to the
    wrong visitor.

### Error routes

`coreFrontendBase()` injects `/404` and `/500` with `prerender: true`.

- Astro matches the literal route `"/404"`, so an injected route suffices.
- `prerender` makes them plain files that answer when Node is what broke. On any other page it would be a
  staleness bug; `astro.test.ts` asserts the prerendered set is exactly these two.
- Both render `<Layout … bare>` (full `<head>`, no gated chrome), so a mistyped URL isn't bounced to the login.

## Two product targets

Admin and customer are the same host with different extension lists. The admin product composes 15 extensions
(time-tracker, support-tickets, contact-tickets, live-chat-cta, website-cms, blog-cms, lexware, customers,
billing, tools, messages, projects, documents, shop, cards); the customer portal 6 (support-tickets, billing,
messages, projects, documents, shop). Keep differences to the product config and build env, never forks.

`config/target.ts` may branch on `FRONTEND_TARGET` only for functional values (`HINT_PREFIX`, `LOGIN_URL`), the
wordmark suffix (`BRAND_SUFFIX` = "Panel" / "Portal") and the **accent**: `Layout.astro` emits
`<html data-frontend>`, and tds-shared's `surfaces/panel.css` paints the admin product burgundy while the portal
renders the base navy. That is one token block (`[data-surface="panel"][data-frontend="admin"]`, pinned by
tds-shared's `design.test.ts`). **No component branches on the target.** The two builds' design CSS is identical
apart from that rule (utility sets differ because admin composes more extensions).

## Client-side navigation (ClientRouter + SWR)

`Layout.astro` renders `<ClientRouter />` on every page (incl. 404/500). A navigation still server-renders the
destination, but Astro swaps it in without a reload. `coreFrontendBase()` prefetches on hover/focus
(`prefetchAll: true`, `defaultStrategy: "hover"`); never the viewport strategy (the rail exposes ~30 links).

The router replaces `<body>`, which creates four contracts:

- **Root state is copied before the swap.** `themeBootstrapScript` handles `data-theme` on `astro:before-swap`;
  `data-surface` / `data-frontend` arrive server-rendered.
- **DOM bindings are per body, global services per document.** One `astro:page-load` listener calls
  `initNavDrawer()`, `initSidebarCollapse()` and `revealNav()`. The 401 handler, active-company header provider,
  preferences listener, notification poller and progress binding stay outside it (inside, they'd stack per click).
- **Stateful floating islands carry `transition:persist`:** `ToastHost`, `CookieNotice`, `LiveChatCta`. The
  progress bar has a server-rendered counterpart with a stable persist key in every body.
- **The drawer's document key handler is registered once, element handlers per swap** (`lib/navDrawer.ts`).

Extension islands read GET data through `@tracht-digital-solutions/tds-shared/data`: per-tab memory survives
swaps, a revisited list paints its last value then shows `.tds-stale` + `aria-busy` while revalidating.
`invalidate()` after a mutation keeps the visible value. This is authenticated browser data, never the public
sites' `tds-shared/cache`.

## Astro 7 / Vite 8

`src/styles/global.css` must import **`tailwindcss/index.css`**, not bare `tailwindcss`: Vite 8's postcss-import
resolves the specifier before `@tailwindcss/postcss` can expand it (`[postcss] ENOENT … '<root>/tailwindcss'`).
**This file is the products' stylesheet** (they have no `global.css`), so release the host first, then the
products. The "never `@tailwindcss/vite`" rule stands for consistency, even though the plugin works under Vite 8.

## Virtual modules

From the contract: `virtual:frontend-registry` (Layout), `virtual:frontend-widgets` (`pages/index.astro`),
`virtual:frontend-settings` (`pages/einstellungen.astro`), declared in `src/env.d.ts`. Old `virtual:panel-*`
spellings still resolve as deprecated aliases; use `virtual:frontend-*` in new code. The integration is
`tds-core-frontend-base`. The route-wrapper cache is `node_modules/.tds-frontend/routes/`.

This package's own: **`virtual:frontend-modules`**, served by `coreFrontendBase()` for the module page and wiki.

Astro can't hydrate a component named by a string; the widget and settings modules carry real imports
(`const W = item.Component; <W />`).

## Module page (`/module`): read-only inventory

`pages/module.astro` + `components/ModulesAdmin.tsx` show every composed package with its installed frontend
version, its Composer version where there is one, and the product's pinned range.

- **An inventory, not an updater:** the panel never contacts GitHub or a registry and never starts a workflow.
  Repins, builds, releases and deploys stay in the repositories. Don't add update or dispatch controls.
- `coreFrontendBase()` reads the product's `package.json` and `node_modules` at build time and imports each
  extension for its German name and module id. Every step degrades instead of failing; **a product build must
  never break over this page's metadata.**
- The backend half comes from read-only `GET /admin/modules`.
- The nav entry is admin-only; `/admin/modules*` is gated on `isAdmin` server-side.

## Public-site connections live with their CMS resource

There is no central *Site-Verbindungen* section here. Blog, website and tools connections are operated in their
extensions' settings (two-phase one-click pairing per resource). The base CORS editor remains for advanced origin
management; pairing adds the verified HTTPS origin automatically. No connection UI or content write calls GitHub.

## Legacy company list (`lib/companies.ts`)

The user editor needs `{id, name}` per company. `fetchCompanies()` asks the composed `tds-ext-customers` endpoint
(`GET /admin/customers`) first and falls back to legacy `tds-customer-api` (`/customer/admin/customers`); it reads
both `companies` and `customers` body keys.

- **It never throws** (the editor works with ids).
- **A 200 with junk counts as failure** (an empty list would read as "no customers").
- Delete the legacy leg and `CUSTOMER_API_URL` once `tds-customer-api` is retired.

## Build details

- Spread tds-shared's `tdsViteBuild`; don't hand-author `cssTarget`.
- `npm install --no-package-lock` (a Windows lockfile is win32-only).
