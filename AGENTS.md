# AGENTS.md — core-frontend

The base frontend host. Read `frontend-contract`'s AGENTS.md first — this repo consumes
that contract.

## What's base vs. extension

**Base (here):** shell/chrome, the pre-paint auth gate (`/me`-confirmed presence
hint — port from `tds-admin`'s `Layout.astro`, DON'T reinvent), nav renderer,
**Dashboard widget host** + per-user layout, Wiki, user management, the settings
framework (the wizard/list shell; individual sections come from extensions),
i18n plumbing, the API fetch wrapper (401→`/me` backstop, cross-frontend SSO).
The shell also mounts the shared `LiveChatCta` bubble (from tds-shared) passing
`FRONTEND_TARGET` as its frontend key — it self-hides unless the live-chat-cta
extension enables this frontend, so it's inert until switched on in the admin.

**Login lives OFF this host.** The login + password-change UI is the central site
`tds-auth-frontend` (`auth.tracht-digital.de`). There is no in-app `/login` route here; the
pre-paint gate and `redirectToLogin`/`logout` bounce to `LOGIN_URL`
(`PUBLIC_LOGIN_URL`, default `https://auth.tracht-digital.de`) with an **absolute**
`?next=`. Because the session cookie is `Domain=.tracht-digital.de`, a login there
is valid here immediately. Critical: the gate must **probe `/me` when there is no
local hint** and seed the hint on success — a missing hint after arriving from the
login site is normal (localStorage is per-origin), so it must NOT redirect on a
missing hint or it loops against the login (which sees the valid cookie and bounces
straight back). Only a 401 from `/me` is a real logout.

**Extensions (other repos):** time-tracker, blog-CMS, website-CMS, contact- and
support-tickets, … They contribute pages/widgets/nav/settings/permissions/i18n
through `frontend-contract` — never edited here.

## Composition (build-time only)

`frontendHost({ extensions: [...] })` in `astro.config.mjs`. No runtime plugin
loading, never `output: "server"`. The shell reads `virtual:frontend-registry`
(nav/permissions/i18n), `virtual:frontend-widgets` and `virtual:frontend-settings`
(components with real imports). Declared in `src/env.d.ts`.

## Two product targets

Admin and customer are the same host with different extension lists. Keep target
differences to the `astro.config` / build env, not forks of the shell. The
**admin** target composes 13 extensions (time-tracker, support-tickets,
contact-tickets, live-chat-cta, website-cms, blog-cms, lexware, customers,
billing, tools, messages, projects, documents); **customer** composes 5
(support-tickets, billing, messages, projects, documents).

**There is exactly ONE panel design, and it is enforced.** `config/target.ts`
may branch on `FRONTEND_TARGET` only for *functional* values (`HINT_PREFIX`,
`LOGIN_URL`) and the wordmark suffix text (`BRAND_SUFFIX` = "Panel"/"Portal").
It must never branch on anything styling-related. The regression check is a
build of both products plus a diff of the design rule sets in
`dist/_astro/Layout.*.css` — they must be identical (134 rules at the time of
writing). Only the Tailwind *utility* sets legitimately differ, because admin
composes more extensions and the `@source` scan therefore generates more
utilities.

## Panel design language

This host is the **`panel` surface** of the shared design library in
tds-shared-pkg. `Layout.astro` sets `<html data-surface="panel">`, and
`styles/global.css` imports `base.css` → `primitives.css` → `app.css` →
`surfaces/panel.css`. The surface layer owns the geometry: 8px buttons/cards,
`0.75rem` chips, flat (no elevation). **Do not hand-author a radius here and do
not re-declare a shared class** — set a token in `surfaces/panel.css` instead.

The shell renders:

| Element | Class | Notes |
|---|---|---|
| mobile top bar (below `lg`) | `.lg:hidden` header | wordmark, `ThemeToggle`, drawer trigger |
| desktop rail (`lg`+) | `.portal-sidebar` | fixed deep-navy in BOTH themes; re-maps `--color-ink/-muted/-line/-soft/-card` + `--nav-hue` *inside* the panel |
| mobile drawer | `.nav-drawer` / `-backdrop` / `-panel` | same navy surface + token remap as the rail |
| active nav | `.nav-item--active` + `aria-current="page"` | resolved from `Astro.url.pathname` |

All four of those shared classes had existed **unused** in tds-shared's
`app.css`: the shell rendered a plain paper-coloured column with no active
state and no drawer, which is why the panel looked nothing like the customer
portal. `baseNav` + `navGroups` in the frontmatter feed both the rail and the
drawer, so there is one nav source rather than two hand-kept copies.

The pre-paint auth-gate spinner is a **deliberate fourth copy** of
`.tds-spinner--lg.tds-spinner--primary`: it paints before the CSS bundle loads,
so it cannot use the class. Its geometry/timing and the literal hex fallbacks
are documented as KEEP-IN-SYNC in `Layout.astro`.

> **Gotcha:** never put a multi-line JSX expression comment (`{/* … */}`) in
> `Layout.astro`'s template body. Astro compiles the template to a template
> literal and mis-parses it, failing the build with a bare
> `Expected ")" but found "{"` pointing at the comment's own closing line
> rather than at anything real. Put notes in frontmatter or use an HTML comment.

## Gotchas (carried from the platform)

- Astro can't hydrate a component named only by a string — the widget/settings
  virtual modules carry real imports; render `const W = item.Component; <W />`.
- Keep the frontend **static**; the auth gate is inline `<head>` + `/me` probe.
- Don't hand-author the lightningcss `cssTarget`; spread tds-shared-pkg's
  `tdsViteBuild` once the design system is wired.
- `npm install --no-package-lock` (Windows lockfile is win32-only).

## Per-user dashboard layout

The Dashboard (`src/pages/index.astro`) renders EVERY enabled widget into
`.widget-slot[data-widget]` sections at **build time** (server-side; islands
hydrate as usual). `src/lib/dashboardLayout.ts` then, on load, fetches the user's
saved layout from core-frontend-api (`GET /me/dashboard-layout`) and **reorders +
shows/hides the existing DOM slots** to match — no SSR, no runtime widget
fetching. An "Anpassen" edit mode adds drag-to-reorder (HTML5 DnD from the handle)
+ per-widget visibility checkboxes and persists via `PUT /me/dashboard-layout`.
Progressive enhancement: no saved layout or an unreachable API ⇒ every widget
stays visible in authored order. The edit-mode CSS is an inline `<style>` in the
page (raw, per [[project_astro_inline_script_raw]]); the script is a real module
import (`<script>import { initDashboardLayout }…`), not inline, so no brace trap.

## User management (Nutzerverwaltung)

`UsersAdmin.tsx` is the full editor: list/create/reset-password/delete plus a
per-user form for the admin / support-agent / blog-author flags, account status,
and **company memberships with per-company portal permissions** (the fine-grained
RBAC). Users come from tds-auth-api (`/admin/users`; `PATCH` already accepts
`memberships`, `isSupportAgent`, `isBlogAuthor`, `status`), companies from
tds-customer-api (`GET /customer/admin/customers` via the gateway prefix,
`CUSTOMER_API_URL`). Portal permission keys/labels/presets come from
`tds-shared/permissions` (`PORTAL_PERMISSIONS`) — never inline them. Admins bypass
portal permissions, so their memberships are cleared on save. The company list is
best-effort: unreachable ⇒ ids shown instead of names, editing still works. (No
auth-API change was needed — the endpoints already existed. Avatar/bio/author-
snapshot from the old tds-admin editor are intentionally omitted — they pull in
content-api; add them only if the blog byline needs them here.)

## Status / next

Composition proven end-to-end (routes + nav + hydrated widgets + settings), auth
gate + chrome + tds-shared-pkg wired, Wiki / users (incl. fine-grained permission +
membership editing) / settings pages built, per-user dashboard layout done, both
product targets (admin/customer) build + deploy. Next: move the dashboard-layout
DDL into a base migration once core-frontend-api gains a migrator; optionally port the
author-profile (avatar/bio) editor if the blog byline is managed from here.
