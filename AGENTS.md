# AGENTS.md — core-frontend

The base frontend host. Read `frontend-contract`'s AGENTS.md first — this repo consumes
that contract.

## What's base vs. extension

**Base (here):** shell/chrome, the pre-paint auth gate (`/me`-confirmed presence
hint — port from `tds-admin`'s `Layout.astro`, DON'T reinvent), nav renderer,
**Dashboard widget host** + per-user layout, Wiki, user management, the **Module
page** (`/module` — composed inventory + updates, see below), the settings
framework (the wizard/list shell; individual sections come from extensions),
i18n plumbing, the API fetch wrapper (401→`/me` backstop, cross-frontend SSO).
The shell also mounts the shared `LiveChatCta` bubble (from tds-shared) passing
`FRONTEND_TARGET` as its frontend key — it self-hides unless the live-chat-cta
extension enables this frontend, so it's inert until switched on in the admin.

**The shell owns the ONE `ToastHost`** (`Layout.astro`, next to `CookieNotice`,
`client:idle`, mounted even in `bare` mode — the gate page is where a failure
most needs to be visible). Never mount a second one anywhere, in this repo or in
an extension: a second host doubles every toast (it detects this, renders
nothing and warns, but don't rely on that). Everything else just *raises*
toasts — `toast.success/…danger` from `tds-shared/toast` (plain TS) or from
`tds-shared/components` (islands). Which primitive to use when — toast vs.
in-flow `.tds-alert` vs. `.status-pill` — is the rule in tds-shared's AGENTS.md;
the short version is that anything the user must **read or copy** (a temporary
password) never goes in a toast, which is why `UsersAdmin` still keeps its
in-flow notice for exactly those two cases.

**Login lives OFF this host.** The login + password-change UI is the central site
`tds-auth-frontend` (`auth.tracht-digital.de`). There is no in-app `/login` route here; the
pre-paint gate and `redirectToLogin`/`logout` bounce to `LOGIN_URL`
(`PUBLIC_LOGIN_URL`, default `https://auth.tracht-digital.de`) with an **absolute**
`?next=`. Because the session cookie is `Domain=.tracht-digital.de`, a login there
is valid here immediately — but the login page no longer *says* so: that copy was
removed there on purpose, and the explanation now lives in the `/wiki` FAQ (see
below), i.e. behind the login where the people it concerns already are. Critical:
the gate must **probe `/me` when there is no
local hint** and seed the hint on success — a missing hint after arriving from the
login site is normal (localStorage is per-origin), so it must NOT redirect on a
missing hint or it loops against the login (which sees the valid cookie and bounces
straight back). Only a 401 from `/me` **that a `/refresh` cannot revive** is a real
logout — see below.

**A `/me` 401 is not the end: try `/refresh` first.** "30 Tage angemeldet bleiben"
(`tds-auth-api`) issues a rotating remember-me cookie and keeps the session JWT
short-lived on purpose, because downstream services verify the JWT against the
JWKS and never consult the auth database — a long JWT would be a long
*non-revocable* credential. Staying signed in is therefore an exchange at
`POST /refresh`, and **the panels are the only place that exchange happens**.
Both the pre-paint gate in `Layout.astro` and `frontendFetch`'s backstop attempt
it exactly once before redirecting; a remembered device would otherwise still be
bounced to the login every hour. A 200 from `/refresh` is re-confirmed against
`/me` rather than trusted, so a token that did not stick as a cookie cannot read
as a live session.

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

**ONE panel design, ONE accent axis.** `config/target.ts` may branch on
`FRONTEND_TARGET` only for *functional* values (`HINT_PREFIX`, `LOGIN_URL`), the
wordmark suffix text (`BRAND_SUFFIX` = "Panel"/"Portal"), and — since 0.13.0 —
the **accent hue**, which `Layout.astro` emits as `<html data-frontend>` and
tds-shared's `surfaces/panel.css` turns into a colour: **the management
frontend reads the brand burgundy, the customer portal reads the brand navy**,
so a user with both open knows which surface they are on — and, more to the
point, knows when they are holding management rights.

> **Reversed in tds-shared 0.20.1 / host 0.18.1.** It used to be navy for
> admin and teal for the portal. The portal's teal is gone: the portal now IS
> the base panel, and ADMIN is the block that overrides. Notes describing a
> teal customer portal are stale.

That is the *whole* difference. It is one token block in `panel.css`
(`[data-surface="panel"][data-frontend="admin"]`, custom properties only,
pinned by `design.test.ts`) — **no component anywhere branches on the target**,
and `target.ts` still carries no class names, no conditional components and no
second layout. Everything else about the two products stays identical.

The old regression check — diffing the design rule sets in
`dist/_astro/Layout.*.css` for **zero** differences — therefore no longer holds
verbatim: the two builds now legitimately differ by that one token block. The
check is "identical **apart from** the `[data-frontend="admin"]` rule".
(Tailwind *utility* sets have always differed legitimately, because admin
composes more extensions and the `@source` scan generates more utilities.)

## Panel design language

This host is the **`panel` surface** of the shared design library in
tds-shared-pkg. `Layout.astro` sets `<html data-surface="panel" data-frontend=…>`,
and `styles/global.css` imports `base.css` → `primitives.css` → `app.css` →
`surfaces/panel.css`. The surface layer owns the geometry: 8px buttons/cards,
`0.75rem` chips, and (since tds-shared 0.15.0) a **soft resting elevation** that
lifts on hover. **Do not hand-author a radius or a colour here and do not
re-declare a shared class** — set a token in `surfaces/panel.css` instead.

The shell renders:

| Element | Class | Notes |
|---|---|---|
| mobile top bar (below `lg`) | `.lg:hidden` header | wordmark, `ThemeToggle`, compact `UserMenu`, drawer trigger |
| **desktop top bar (`lg`+)** | `.panel-topbar` | `ThemeToggle` + `UserMenu`, right-aligned. Sits in a COLUMN wrapper with `<main>`, not beside the rail |
| desktop rail (`lg`+) | `.portal-sidebar` | gradient dark panel in BOTH themes; re-maps `--color-ink/-muted/-line/-soft/-card` + `--nav-hue` *inside* the panel |
| rail head / foot | `.sidebar-head` / `.sidebar-foot` | wordmark + collapse toggle; target label (the `ThemeToggle` moved to the top bar — two toggles would be two controls for one setting) |
| mobile drawer | `.nav-drawer` / `-backdrop` / `-panel` | same surface + token remap as the rail |
| nav row | `.nav-item` + `.nav-item__icon` / `__label` | icon/label grid; hue from the section's `--nav-hue` |
| active nav | `.nav-item--active` + `aria-current="page"` | resolved from `Astro.url.pathname` |
| page canvas | `.panel-main` | accent-tinted canvas + one radial glow |
| widget slot | `.widget-slot` + `.widget-slot__icon` | carries `--tds-widget-hue` |

Those shared classes had existed **unused** in tds-shared's `app.css`: the shell
rendered a plain paper-coloured column with no active state and no drawer, which
is why the panel looked nothing like the customer portal.

**Colour is assigned in `lib/panelHues.ts`, not in the markup.** `app.css` has
always read `--nav-hue` (and, since 0.15.0, `--tds-widget-hue`) and *nothing
ever set either*, so the rail was one grey column and the dashboard a grid of
identical white cards. `hueForKey()` maps nav-group keys and widget ids to the
categorical palette, with a stable string hash as the fallback so a brand-new
extension is colour-coded on its first build. Deriving it from ids the
extensions already declare is deliberate: putting `hue`/`icon` on
`WidgetManifest` would mean a `frontend-contract` minor plus a release of all 13
extension repos before one pixel changed. If extensions ever need to override
their own colour, that is an additive contract minor and this becomes the
fallback.

**The section hue must reach the items by INHERITANCE (0.13.1).** `NavList`
sets `--nav-hue` inline on `.nav-group`; the items below read it. tds-shared
0.15.0 also declared `--nav-hue` on `.nav-item` itself, which silently won —
an element's own declaration beats an inherited value regardless of the
ancestor's specificity, and an inline style on the PARENT never competes — so
every active row rendered in `--color-primary` (navy on the navy rail, 1.11:1)
and none of the colour-coding below reached the UI at all. Fixed in tds-shared
0.15.1, which also derives `--nav-ink` (the hue lifted toward white) because
the categorical palette is tuned for dark text on a light canvas. Two
consequences here: `NavList` omits the `style` attribute entirely when a
section has no hue, so the rail's white fallback applies instead of an
invalid `--nav-hue: undefined`; and **every nav group must be mapped in
`HUES`** — `tools` was missing, and its hashed fallback happened to land on
the same violet as `content`, so two adjacent zones read as one. A test pins
one-distinct-hue-per-group.

**A distinct token name is not a distinct colour (0.18.1).** That test compares
hue *names*, so it stayed green while two zones rendered the same red.
`verwaltung` is mapped to `var(--tds-panel-accent)`, and tds-shared 0.20.1
moved the **admin** accent to the brand burgundy — which put it ΔE 12 from
`--color-cat-rose`, where `tools` sat. `tools` now reads `--color-info`, the
one hue no nav group had claimed. Two guards, because neither repo can see the
other: `panelHues.test.ts` pins the mapping here, and tds-shared's
`design.test.ts` measures the resulting palette separation (ΔE > 15 for every
admin zone pair, both themes). **Whenever the panel accent moves, re-check the
categorical zones against it** — contrast tests will not catch this, since two
identical reds both clear AA against the rail perfectly well.

**Nav icons come from the manifest.** `NavEntry.icon` has been in the contract
from the start and every extension declares one (`life-buoy`, `receipt`,
`folder-kanban`, …); the shell's nav mapping used to copy `{href, label, id}`
and silently drop it. `components/Icon.astro` is the icon set the contract
refers to — a hand-inlined Lucide path map, **no dependency**, server-rendered,
with a `square` fallback so an unknown key still lines up in the grid rather
than collapsing the column. Add a glyph by adding a key to its `PATHS`.

**Nav group keys are normalised.** Groups arrive as bare ids and
`.nav-group-label` uppercases them, so the rail used to read
"SUPPORT / ABRECHNUNG / CONTENT / WORK" — raw identifiers in a German/English
mix. `normaliseGroup()` folds case/whitespace (so an extension writing
"Verwaltung" joins the base shell's own section instead of growing a duplicate
heading with one orphaned link under it) and `groupLabel()` maps them to German.

**The collapsed rail is a real feature now.** `.portal-sidebar.collapsed` had
exactly one rule in `app.css` — hide the active indicator — and no shell ever
rendered a control to add the class, so it was unreachable half-styled dead
code. `lib/sidebarCollapse.ts` is the control: it persists to `localStorage`
(per device, not per user — it is a viewport preference, so it does not belong
in the `/me` dashboard-layout record), suppresses the width transition when
restoring on load, labels the *action* rather than the state, and no-ops both
when the rail is absent (the `bare` layout) and when storage throws.

**The drawer traps focus, returns it, and closes on navigation.** It used to
do none of the three: opening it left focus on the page behind, Tab walked
straight out into content the backdrop covers, and closing dropped focus to the
top of the document. It also stayed visibly open for the whole of a navigation,
because every nav entry is a full page load in an MPA and nothing closed it.
Two details worth keeping: the focusable list is recomputed per keystroke
rather than cached (the `ThemeToggle` inside the drawer hydrates late, so a
list taken at load time is already wrong), and **the Escape handler returns
early unless the drawer is open** — unconditionally, it also fired for an
Escape inside a `<dialog>` and cleared `body.style.overflow`, releasing a
scroll lock that belonged to someone else.

**Dashboard reorder: the buttons are the control, the drag is a shortcut.**
HTML5 drag-and-drop does not fire on a touch screen and was never reachable by
keyboard, so on a phone edit mode offered the visibility checkboxes and no way
to reorder at all. `[data-widget-move]` up/down buttons call the same
`insertBefore` the drag does, restore focus to the pressed button (re-inserting
the node drops it to the body) and report the new position through a
single polite live region — not a toast, which would stack one visible
notification per press. The reorder counts hidden slots as positions, because
edit mode still renders them; skipping them would make a press look like a
no-op. The drag stays for the mouse, where it is the quicker gesture.

> The whole `.widget-slot__controls` block used to carry `aria-hidden="true"`
> while containing a **focusable checkbox** — an ARIA violation that made
> widget visibility unoperable with a screen reader on every device, not just
> a phone. Only the decorative ⠿ handle is hidden now.

**The rail and the drawer render the same two components — keep it that way.**
`baseNav` + `navGroups` are folded into one resolved `navSections` model in the
frontmatter, and both places render `<NavList sections={navSections} />` and
`<BrandWordmark />` (`src/components/`). They previously shared the *data* but
hand-copied the *markup*, and the copies had already drifted: only the rail set
`data-nav`, so anything keying off that attribute silently worked on desktop
only. Both nav blocks are now byte-identical in the built HTML — that is the
cheap regression check:

```bash
grep -o 'data-nav="[^"]*"' dist/index.html | sort | uniq -c   # every key: exactly 2
```

Match the **quoted** attribute, and count per key rather than in total. A bare
`grep -c data-nav` also catches the drawer's three `data-nav-drawer-close`
buttons, so the total is legitimately *odd* (admin 17×2+3 = 37, customer
9×2+3 = 21) — read as "must be even" it looks like a drift that isn't there.

- `NavList` takes active state **pre-resolved** (`item.active`), not a
  path-matching callback, so the `trailingSlash`/`build.format` normalisation
  rules stay in `Layout.astro`'s `isActive` only.
- `BrandWordmark` is the **only** consumer of `BRAND_SUFFIX` in the shell — the
  single per-target value, and it is *text*, not styling. Don't reintroduce the
  import into `Layout.astro`, and don't add target-dependent styling anywhere
  (see "Two product targets").
- It is deliberately **local to this repo, not promoted to tds-shared-pkg**:
  `.brand-wordmark` is already the shared abstraction, and every other surface
  uses it at a different size/colour, so a shared component would just forward
  `class`.

The no-flash theme bootstrap is **not** hand-written here — it is
`themeBootstrapScript` from `tds-shared/astro`, injected as
`<script is:inline set:html={themeBootstrapScript} />`. It must stay `is:inline`
and must stay **before** the pre-paint gate below it, because the gate's spinner
paints in the theme's colours; a theme applied after it flashes the wrong
backdrop. Never wrap it in a template body (`{…}`) — see the gotcha below.

The pre-paint auth-gate spinner is a **deliberate fourth copy** of
`.tds-spinner--lg.tds-spinner--primary`: it paints before the CSS bundle loads,
so it cannot use the class. Its geometry/timing and the literal hex fallbacks
are documented as KEEP-IN-SYNC in `Layout.astro`. Note the gate backdrop paints
**`--tds-panel-canvas`, not `--color-paper`** — the page sits on the tinted
canvas since tds-shared 0.15.0, so painting plain paper would step colour the
moment the bundle lands.

> **Gotcha:** never put a multi-line JSX expression comment (`{/* … */}`) in
> `Layout.astro`'s template body. Astro compiles the template to a template
> literal and mis-parses it, failing the build with a bare
> `Expected ")" but found "{"` pointing at the comment's own closing line
> rather than at anything real. Put notes in frontmatter or use an HTML comment.

## The company list is the last legacy dependency (`lib/companies.ts`)

The user editor needs `{id, name}` per company for membership editing. That list
used to come **only** from the legacy `tds-customer-api`
(`GET /customer/admin/customers`) — the single live dependency keeping that
service alive (`tds-core-frontend-api#8`).

`fetchCompanies()` now asks the composed `tds-ext-customers` endpoint
(`GET /admin/customers`, identical payload) first and falls back to the legacy
one. It reads **both** body keys — the composed extension emits `companies` AND
`customers` for the length of the rename, the legacy API only ever emits
`customers`; reading one of them alone breaks at a different moment depending on
which one you pick. **The fallback is deliberate, not indecision:** the composed frontend
service cannot boot until `services/frontend/.env` + the `tds_frontend` DB exist,
so a straight switch would have broken membership editing *today* to fix it
*later*. With the fallback the call works on both sides of go-live and the legacy
leg simply stops being reached — no second deploy needed to finish the migration.

Two properties worth keeping when this is eventually simplified:

- **It never throws.** The editor works without names (it shows ids), so a list
  outage must not take user management down with it.
- **A 200 carrying junk counts as a failure.** Taken at face value, a non-list
  body renders an *empty* company list, which reads as "no customers exist"
  rather than as a fault — strictly worse than a 500.

Delete the legacy leg and `CUSTOMER_API_URL` once `tds-customer-api` is retired.

## Astro 7 / Vite 8 — the one thing that had to change

The host and both products run **Astro 7** (since 2026-08-06; Astro 6.4.8 was the
last 6.x and carried five unpatched advisories). Almost nothing broke — no
experimental config, no content collections, no remark/rehype, no `src/fetch.ts`.

One thing did: **`src/styles/global.css` must import `tailwindcss/index.css`, not
the bare `tailwindcss`.** Under Vite 8 the built-in postcss-import step resolves
that specifier *before* `@tailwindcss/postcss` can expand it, and a bare package
name is not a file — the build dies with
`[postcss] ENOENT: … open '<root>/tailwindcss'`. Astro 6 / Vite 7 accepted the
bare form.

**This file is the products' stylesheet.** They have no `global.css` of their own;
they consume this one out of `node_modules`. So a product cannot move to Astro 7
until this package is *published* with the fix — release the host first, then the
products. (Verified the hard way: `tds-admin-frontend` fails with exactly that
ENOENT while resolving an older host.)

The repo-wide "never `@tailwindcss/vite`" rule **still stands**, but its original
justification is gone: it existed because Vite 7 + rolldown broke the plugin's
resolver (withastro/astro#16542), and the plugin builds fine under Vite 8. It was
re-tested on 2026-08-06 and kept anyway — both routes work, and staying on one
setup keeps the posture tests meaningful. Don't reintroduce it as a "fix";
nothing is broken.

## Nav: base entries, groups and external links

`baseNav` in `Layout.astro` is the shell's own nav, and each entry may name a
`group` to join an extension's section instead of the base one. Two rules are
load-bearing:

- **Group order is seeded by the base group, then by extension first-appearance.**
  Base entries that name another group are therefore merged *after* the extension
  loop — bucketing them up front would let a base entry create (and so reorder)
  a section.
- **A base entry never invents a group.** If the extensions did not create it,
  the entry is dropped: a section heading with one link under it and nothing else
  reads as a bug, not as a feature.

`external: true` marks a link to another property. It renders `target="_blank"`
plus `rel="noopener noreferrer"` and appends "(neuer Tab)" to the tooltip. The
public tools site (`tools.tracht-digital.de`) is the current example, joining the
`tools` group beside the tools extension's own catalog editor — hence the label
"Tools-Website", because those two sit one click apart. Note this differs from
the public sites, which link siblings in the SAME tab: someone in the panel is
mid-task, and replacing their working context loses their place.

## Module page (`/module`) — inventory + updates

`pages/module.astro` + `components/ModulesAdmin.tsx`. Shows every composed
package with its installed version, its Composer (backend) version, the version
the registry currently publishes, and the range the product pins — plus the
buttons that put a newer version into service.

**An "update" is a deploy, and there is no way around that.** Composition is a
build step: the products are composed during `astro build` and the API is
assembled into one bundle. So a module has TWO halves on TWO pipelines — the npm
package a product build composes and the Composer package the gateway bundle
assembles — which is why the table shows both versions. A green frontend version
says nothing about the PHP side.

**The per-row button is deliberately honest about its scope.** CI installs with
`npm install --no-package-lock`, so ONE rebuild re-resolves EVERY caret range:
pressing "Aktualisieren" on one row updates every module that has a newer version
inside its pinned line. The confirmation says exactly that. And when the newest
version falls *outside* the pin (a crossed 0.x minor), the row offers **no button
at all** — it names the replacement range instead, because no rebuild will deliver
it. `lib/moduleUpdates.ts` is where that verdict is computed; its 0.x caret rule
(`^0.1.1` = `>=0.1.1 <0.2.0`) is the whole reason `update` and `repin` are two
different answers.

**Where the inventory comes from.** `coreFrontendBase()` reads the PRODUCT's
`package.json` (pinned ranges) + its `node_modules` (installed versions) at build
time and dynamically imports each extension for its German name and module id,
then serves the result as `virtual:frontend-modules`. A static build has no other
way to know what it was composed from. Every step degrades instead of failing —
an unreadable root yields an empty list, an unimportable manifest falls back to a
name derived from the package. **A product build must never break over an admin
page's metadata.**

**Automatic updates** are configured under *Einstellungen → Module & Deployment*
and executed by the API (`AutoUpdater`), not here — the panel only renders the
state and offers "Jetzt prüfen und aktualisieren". Two properties are worth
remembering: it dispatches the **frontend** rebuild only (the backend target
would ship every repo's unreleased `main`), and it acts only on in-range updates.
See `tds-core-frontend-api`'s AGENTS.md for the scheduling model.

The nav entry is admin-target-only; the route is injected into both products
because there is one route list, and every `/admin/modules*` route is gated on
`isAdmin` server-side regardless of who finds the URL.

## Virtual modules (renamed)

The shell imports three build-time virtual modules from `frontend-contract`:
`virtual:frontend-registry` (Layout), `virtual:frontend-widgets`
(`pages/index.astro`), `virtual:frontend-settings` (`pages/einstellungen.astro`),
declared in `src/env.d.ts`. They were `virtual:panel-*` — the last `panel-`
names in the SDK. The contract still resolves the old spellings as deprecated
aliases, so **don't "fix" a stale `virtual:panel-*` reference by assuming it is
broken** — it works; it is just not canonical. Use `virtual:frontend-*` in new
code. The integration is `tds-core-frontend-base` (was `tds-core-panel-base`).

A fourth one is this package's OWN: **`virtual:frontend-modules`**, served by
`coreFrontendBase()` (not the contract) and consumed by `pages/module.astro`.

The generated route-wrapper cache is `node_modules/.tds-frontend/routes/` (was
`.tds-panel/`). Build artifact — an old sibling directory may linger locally.

## Tests

`npm run test:run` (vitest). DOM suites opt into jsdom via a
`@vitest-environment` docblock; the rest run in node. 159 tests covering
`lib/auth`, `lib/dashboardLayout`, `lib/notificationFeed`, `lib/moduleUpdates`,
`config/target`, `astro.ts` and `components/ModulesAdmin` — the `.astro` shell
and the remaining islands stay on the product build + `astro check`.

- **`notificationFeed.test.ts` is mostly about restraint, not features.** The
  poller runs on every page, forever, in every open tab, so the assertions that
  matter are the negative ones: a hidden tab does not poll, a 401/403 stops it
  instead of retrying, a transport failure never raises a toast, and the cursor
  advances (or the same event is announced forever).

- **`moduleUpdates.test.ts` pins the 0.x caret rule numerically.** Getting it
  wrong inverts a promise rather than breaking a render: the admin presses
  "Aktualisieren", the pipeline runs green, and nothing changes. The PHP twin
  (`VersionRange`) is asserted separately in the API repo — change one, change
  the other.
- **`ModulesAdmin.test.tsx` guards the promises, not the layout** — that a
  repin row offers no deploy button, that the confirmation admits one rebuild
  covers every in-range module, and that a failed dispatch carries its HTTP
  status.

- **`auth.test.ts` is the 401-backstop guard.** Injecting a blanket
  `redirectToLogin()` into `onUnauthorized` fails
  `returns a scoped 401 to the caller when /me still succeeds` and
  `keeps the hint intact after a scoped 401` — verified. Do not "simplify" that
  probe away; it is the fix for the loop described in the root CLAUDE.md.
- **`redirectToLogin` latches on a module-level `redirecting` flag**, so each
  test re-imports through `vi.resetModules()`. Without that the latch leaks and
  later tests see zero redirects.
- **`target.test.ts` pins that the two products get different `HINT_PREFIX`
  values.** localStorage is per-origin, so a shared prefix would let a stale
  admin hint reveal the portal shell before `/me` answers.
- **`astro.test.ts` checks every injected entrypoint exists on disk.** That is
  the stale-`dist` bug: a removed page left in `BASE_ROUTES` ENOENTs the
  *product* build, far from the cause.
- The dashboard tests assert the progressive-enhancement promise directly —
  no layout, an API error and an unreachable API must all leave every widget
  visible in authored order.

## Gotchas (carried from the platform)

- Astro can't hydrate a component named only by a string — the widget/settings
  virtual modules carry real imports; render `const W = item.Component; <W />`.
- Keep the frontend **static**; the auth gate is inline `<head>` + `/me` probe.
- Don't hand-author the lightningcss `cssTarget`; spread tds-shared-pkg's
  `tdsViteBuild` once the design system is wired.
- `npm install --no-package-lock` (Windows lockfile is win32-only).

## Type-checking extension islands (`npm run type-check:extensions`)

**Nothing in the normal pipeline type-checks an extension's `.tsx`.** Three gaps
line up to make that true, and each one looks like a gate while being none:

- The **product** repos have no `src/`, so `astro check` there prints
  `Result (0 files)`. A green product `type-check` says nothing about the 13
  extensions it composed.
- **`astro build` strips types with esbuild** rather than checking them, so a
  type error in an island builds green. (Syntax errors *do* fail, which is why
  the JSX-comment traps were caught and type slips were not.)
- The **extension** repos don't install `tds-shared` — it's a peer dependency —
  so `tsc` inside one cannot resolve its own imports and fails on 22 files for
  reasons that have nothing to do with the code.

`tsconfig.extcheck.json` here closes it: it checks every sibling
`tds-ext-*-pkg/islands/**/*.tsx` against **this** repo's installed deps, with a
`paths` block because the files sit outside the package directory. Run it after
touching any island. It needs the full working root, so it is a local tool, not
CI — and it is excluded from the published package.

## Profile menu (`components/UserMenu.tsx`) + `/profil`

The shell's identity control, top-right. Before it, the panel had **no desktop
header at all**: `<main>` began straight at the page content, nothing anywhere
said which account you were using, and `logout()` sat in `lib/auth.ts` imported
by nothing.

- **The menu renders NOTHING when `/me` fails.** The pre-paint gate already owns
  "are you logged in"; a half-drawn header with an error in it would be worse
  than no header, and this is reachable whenever the composed API is down.
- **`fetchMe()` memoises for the page load.** The gate has usually just called
  `/me`, and the menu, the profile page and (later) a company switcher would
  each repeat it. A **failed** probe is not cached — a sticky `null` would keep
  the menu empty for the rest of the page's life. `invalidateMe()` after any
  write that changes the principal.
- **Company NAMES come from the composed API** (`GET /me/companies`,
  tds-ext-customers), because auth-api only ever holds ids and
  `GET /admin/customers` is admin-only. An admin has no memberships, so the
  menu shows the product ("Management" / "Kundenportal") instead — and skips
  the request entirely.
- **`/profil` is injected but deliberately absent from the nav.** It is personal
  settings, not a section of the product; the menu is the way in.

> **Two latent bugs surfaced when this got its first caller**, both invisible
> while `lib/auth.ts` had none: `Me` declared `id: number` when `/me` returns
> **`userId`**, and `logout()` sent **POST** to a route auth-api registers as
> `DELETE`. The second is the nastier one — a 405 is a *resolved* fetch, so the
> `catch` never saw it; the hint was cleared and the redirect happened, so it
> looked like it worked, while the session stayed alive and the
> `Domain=.tracht-digital.de` cookie signed the user straight back in.

### Theme is per USER now, not per browser

`lib/preferences.ts` reconciles `localStorage` with `/me/preferences`.
localStorage stays — it is the pre-paint cache the no-flash bootstrap reads
synchronously in `<head>` — and the server is the copy that follows the choice
to another device. Three things to keep intact:

- **Apply a loaded value with `{ announce: false }`.** `applyThemePreference`
  raises `tds:theme-change`, and the listener that persists it would otherwise
  echo the value straight back as a save.
- **`initPreferences()` is idempotent.** A layout `<script>` runs on every page;
  a second listener doubles every save. (Its test had to unregister listeners
  per case: jsdom's `window` is shared for a whole file, so a leaked listener
  from an earlier test made the guard look broken.)
- **A failed load is silent, a failed save is a toast.** The frontend service's
  database is still an open go-live step; a load-failure toast would fire on
  every page and teach everyone to ignore the box that matters — the same
  reasoning as the dashboard layout's silent `GET` below.

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

**Saving reports its outcome, and the two failure paths differ from the load
path on purpose.** The save handler had no `else` to its `if (r.ok)` and an
empty `.catch()`, so a 401/422/500 was indistinguishable from a mis-click —
this is the "Speichern tut nichts" report. It now raises a `toast.success` on
2xx and a `toast.danger` **carrying the HTTP status** otherwise, and edit mode
still stays open on failure because the arrangement exists only in the DOM.
The initial `GET` deliberately stays silent: it runs on every dashboard view,
costs the user nothing when it fails (they get the authored order), and while
the frontend service is undeployed a toast there would fire on every page load
and teach everyone to ignore the red box that matters. `dashboardLayout.test.ts`
pins all four branches by listening for `tds:toast` on `window` — no ToastHost
in the fixture, so the DOM fixture stayed untouched.

## Live notifications (`lib/notificationFeed.ts`)

The shell polls **one** endpoint — `GET /me/notifications` — on every non-`bare`
page and raises a toast per event, plus a `tds:notification` window event so an
open list can refresh itself. Started from the same `<script>` block as
`initSidebarCollapse`.

**Why it looks like this**

- **Polling, because the host cannot do anything else.** PHP-FPM behind Plesk:
  no long-lived workers, no `proc_open`, so no SSE and no WebSockets.
- **One poller for every module.** Modules contribute events on the BACKEND (the
  contract's `NotificationSource`), so a new module does not add a timer here.
  A poller per extension island would be thirteen intervals on every page.
- **The cursor is opaque and lives in `sessionStorage`, per target.** Not in
  memory: the panel is a multi-page static site, so every navigation would be a
  "first call" — which suppresses the backlog and would therefore silently drop
  whatever arrived while the page was changing. Not `localStorage`: two tabs
  sharing one cursor would race to consume events and each would see only some.
- **First call announces nothing.** The backend returns items only once it has
  seen a cursor, so opening a tab is never a burst of toasts about yesterday.
- **401/403 STOPS the poller.** `frontendFetch` has already probed `/me` and
  tried a refresh by then; carrying on is a `/me` storm every 30 s for as long
  as the tab is open, and a principal does not gain rights mid-session.
- **A transport failure is NEVER toasted** (exponential backoff to 5 min
  instead) — same reasoning as the dashboard-layout load path above: it runs on
  every page, and a red box about the notifier teaches people to ignore the red
  box that matters.
- **Hidden tabs do not poll**, and poll immediately on becoming visible.

**The 401 backstop now covers extensions too.** The same script registers
`onUnauthorized` with tds-shared's `setUnauthorizedHandler`. Extension islands
call the API through `apiFetch`, which cannot reach into the host, so until this
existed every extension 401 skipped the confirm-against-`/me`-then-refresh rule
entirely.

**`<meta name="tds-api-base">`** in `Layout.astro`'s `<head>` is what tells
`apiFetch` where the API is. It cannot be `import.meta.env`: the extensions ship
as built packages inside a consumer's `node_modules`, and a `PUBLIC_*`
substitution is not something a published package may rely on. Without the tag a
relative call resolves against the product's own static host, whose SPA fallback
answers **200 + HTML** — `res.ok` true, `json()` throwing, the catch rendering a
calm empty state. That is precisely how the contact inbox reported "Keine
Anfragen." while the rows sat in the database.

## `/wiki` — TWO wikis behind one route

There are two wikis, and which one a build gets is decided by `FRONTEND_TARGET`
in `pages/wiki.astro`. The branches are **mutually exclusive** — this is not one
page with an optional section, which is what it used to be.

| Target | Nav label | Content |
|---|---|---|
| `admin` | **API-Referenz** (`book-open`) | The full API of the base + every composed module. No FAQs. |
| `customer` | **Hilfe** (`life-buoy`) | FAQs and handbooks for the software the customer has. No API. |

One route rather than two: `coreFrontendBase()` takes no target and injects the
same base-route set into both products, and "Wiki" is the same idea in both
places — only its content differs. Adding a second route would also mean
touching the `BASE` shadow-guard array in all thirteen `tds-ext-*` suites.

### Admin: `components/ApiReference.tsx`

Renders `/wiki.json` **v2** — introspected Slim routes joined with the prose each
module contributes through the contract's `ApiDocSource`. Things worth keeping:

- **Grouping is by the module that MOUNTED the route** (`ModuleRegistry::routeOwners()`
  on the backend), not by path segment. The old version grouped by first segment,
  which collapsed all thirteen modules' `/admin/*` routes into one block called
  `admin` — the single thing that made the page useless as a reference.
- **The German module name comes from the BUILD, not the API.** The endpoint emits
  ids; the name lives in each extension's manifest, which the product already
  composed into `virtual:frontend-modules`. The page reads it there and hands it
  in as a prop (same arrangement as `module.astro` → `ModulesAdmin`). Duplicating
  names into the backend would be a second source of truth that nothing syncs.
- **An undocumented route is still listed** and says so. Introspection is
  authoritative: nobody may shrink the reference by forgetting to write something
  down. A doc entry whose route no longer exists shows up as a warning
  (`stats.orphan_docs`) rather than being swallowed.
- **Collapsing is native `<details>`**, not React state — keyboard and
  screen-reader semantics for free, and the browser keeps each section's state
  while the filter re-renders around it. "Alles aufklappen" works by bumping a key
  that remounts them. Filtering auto-opens its matches; leaving them collapsed
  would defeat the point of filtering.
- **The component refuses a payload whose `version` is not 2.** The backend ships
  on its own release train; rendering v1 data here would produce a page of blanks
  with no explanation.
- Parameter and response tables carry `tds-table` + `tabindex="0"` + `role="region"`
  + a label — the primitive becomes a horizontal scroller below 40rem, and a table
  with no focusable cell is otherwise unreachable by keyboard.

### Customer: `components/HelpCenter.tsx`

FAQs and handbooks from the **database**, via the public `/help/faqs`,
`/help/articles` and `/help/articles/{slug}`. Maintained in the admin frontend
under *Wiki-Inhalte* (`tds-ext-live-chat-cta-pkg`), and the same rows feed the
floating support widget — **one source, two surfaces**.

- **`src/content/faq.ts` is GONE.** It held three hard-coded entries that had to be
  hand-synced with the rows migration `20260801000006` seeds into `live_chat_faq`
  — the seed's own docblock asked for that sync. Nothing was lost in the deletion:
  the three entries exist in DE and EN in the database. Do not reintroduce a
  code-side FAQ list. (`FaqList.astro` and `ApiWiki.tsx` went with it.)
- **Those routes belong to an extension the customer product does not compose** on
  the frontend. That is fine and not new: the shell already mounts the shared
  `LiveChatCta` island unconditionally against the same module's public API. If a
  backend build lacks the module, the calls 404.
- **A 404 or an empty answer is an EMPTY WIKI, not an error.** The frontend
  service's database is still a go-live step, so the empty state is what a real
  customer may meet first; it must read as "nothing here yet" and offer the
  support route. Only a genuine transport failure shows the warning banner.
- **A handbook body is fetched when its article is opened**, not with the list.
  `/help/articles` deliberately returns no bodies: an article is markdown of
  arbitrary length, and loading two hundred of them to draw a list of headings is
  the difference between a page that opens and one that stalls.
- **FAQ answers are plain text and are interpolated per paragraph, never
  `set:html`** — that is the contract with the widget's renderer. Handbook bodies
  ARE markdown and go through `renderMarkdown` from
  `@tracht-digital-solutions/tds-shared/markdown`, which is escape-first: raw HTML
  in an article can only ever render as text.


## Access control (`/users` → `AccessAdmin.tsx`)

**The nav row is platform-admin only** (`revealFor: "platform-admin"`, same
mechanism as `/firma`). It used to hang in the nav of *both* products with no
condition at all, so every portal user was invited to a screen whose very first
call — `GET /admin/users` — answers 403 for them.

One route, three tabs — **Benutzer | Gruppen | Firmen-Kontingente**. Tabs rather
than three `BASE_ROUTES` entries because groups and quotas are edited a couple of
times a year and only make sense next to the users they apply to; splitting them
out would cost two permanent nav rows in *both* products. Each panel mounts on
first view and then stays mounted (a tab switch must not throw away a half-typed
form, and re-mounting would re-fetch the catalog).

**Benutzer — `UsersAdmin.tsx`.** List/create/reset-password/delete plus the
per-user form: admin / support-agent / blog-author flags, account status, and
**company memberships**. A membership now carries four things: direct
`permissions`, `groupIds`, `isCompanyAdmin`, and an optional `permissionCeiling`
(empty = inherit the company's).

- **Rights are edited through `PermissionMatrix`**, shared with `/firma` so the
  two screens cannot drift. It is a **tri-state per right** — inherited from a
  group, granted individually, or withheld individually — rendered adaptively:
  a right no assigned group carries gets a plain checkbox, because "inherited"
  and "withheld" both mean *not granted* there and offering both would be
  asking for a choice between two spellings of "no". A right a group DOES carry
  gets three options and names the group, since the interesting question there
  is "why does this person have it".
- **The origin is computed in the client** from `groups[].permissions`, not
  delivered by the server: ticking a group above changes which shape a right
  renders in, and a server-side answer would be stale the moment it did.
- **Only the decisions are stored** — `permissions` (granted) and
  `permissionDenies` (withheld), never the effective set. The effective set is
  derived on every token issue; writing it back would freeze a group's
  contribution at the moment somebody last opened the form.
- **Permission options come from the COMPOSED catalog** (`GET
  ${API_BASE}/admin/permissions`, every module's contribution), grouped by
  section, falling back to `tds-shared`'s `PORTAL_PERMISSIONS` when that service
  is unreachable. That fallback is a *seed set and UI fallback* now — not the
  definition of a valid right. Offering only those nine keys is exactly what
  Phase 2 fixed: the panel composes thirteen extensions and their rights were
  ungrantable here.
- **A stored key the catalog does not know still renders**, under an
  "Unbekannt" heading. Loosening the backend's validation was one-way, so a key
  can be legitimately held and unrecognised — dropping it would make it
  invisible AND unremovable.
- **The Firmenadmin checkbox is disabled for a company without delegation**,
  with the fix named (*Firmen-Kontingente → Firmenadmins zulassen*). The policy
  is fetched per company as the form touches it, not up front: the list screen
  shows every user and would otherwise fetch a policy for every company on a
  page where nobody is editing. A pending fetch counts as ALLOWED — the backend
  refuses with a named 422 either way, and a control disabled on a pending
  request reads as "not permitted".
- **The four role-preset buttons are gone.** They are real groups now (seeded
  `is_system` rows). What is left is one button that clears the DIRECT grants —
  it deliberately does not touch the group boxes, because group rights are added
  server-side.

**Gruppen — `GroupsAdmin.tsx`.** A group is a named permission bundle, owned
either by the platform (`companyId = 0`, assignable everywhere) or by one
company. Same row, the scope is the only difference — which is why a company
admin's own groups need no second concept. System groups keep editable rights but
cannot be renamed or deleted; something is assigned to them. Every write revokes
sessions (the resolved union rides in the JWT), and the screen SAYS how many —
"saved" while nothing changes for an hour gets debugged twice.

**Firmen-Kontingente — `CompanyQuotasAdmin.tsx`.** `maxUsers`,
`allowedPermissions`, `allowCustomGroups` and **`allowCompanyAdmins`** per
company. That last one is the switch the whole delegated surface hangs on: off
(the default, including for a company with no policy row) means nobody inside
the company manages users, rights or groups, and `/firma` stays invisible to
them. The platform admin is never subject to it. Two "unlimited"
states that must not be collapsed: `maxUsers: null` = no cap;
`allowedPermissions: null` = no ceiling, while `[]` = may grant nothing.
Unticking "Alle Rechte freigeben" seeds the box list from the full catalog so an
admin subtracts rather than rebuilds. Quotas bind delegation only — a platform
admin is never subject to them.

## `/firma` — the delegated company-admin surface

`CompanyUsersAdmin.tsx`, reached from a nav row that ships `hidden` and is
unhidden by `lib/revealNav.ts` against the memoised `/me`. **Hiding is not a
permission check** — every `/company/*` call is gated by auth-api's
`CompanyAdminMiddleware`; this only avoids offering a page that would 403.

The row's condition is `company-or-platform-admin`. A platform admin belongs to
no company, so the company-admin condition never holds for them — but they may
manage every company from this screen, which offers them a **company picker**
built from `fetchCompanies()` instead of their (empty) memberships. That is
"als Universaladmin alle Rechte auch intern dieser Firma bearbeiten": the
internal view exists nowhere else.

`isCompanyAdmin` on `/me` arrives already folded against the company's
delegation grant (auth-api resolves it), so a promotion into a company that was
never switched on does not light this row up — which is why the resolution
happens server-side rather than by reading the stored flag here.

It lives in the **host**, not in the Firmen extension: `tds-customer-frontend`
composes only support-tickets/billing/messages/projects/documents, and a company
admin signs in to the *portal*. The shell is what both products build.

Seat counts, the permission ceiling and the assignable groups all arrive in the
list payload — this screen never computes them. `describeFailure()` in
`lib/companyAdmin.ts` maps the backend's named refusals (`seat_limit`,
`permission_not_allowed`, `last_company_admin`, …) to German sentences, which is
why a rejection names the offending right instead of saying "Forbidden".

It resolves its company with `getActiveCompany()` and an explicit fallback,
**not** `resolveActiveCompany()`: that clears a stored pick when it is not in the
list, and the list here is a SUBSET (companies *administered*). A plain member of
A who administers B would otherwise lose their panel-wide selection just by
opening the page.

## The active company (`lib/activeCompany.ts`)

A login can hold a different role in each company it belongs to, so "the active
one" is a per-session UI choice that scopes nearly every composed-API call. It
lives in `localStorage` under `${HINT_PREFIX}_active_company` — not a cookie (the
shared one is httpOnly and belongs to auth; a second `.tracht-digital.de` cookie
would leak the selection between the admin panel and the portal, where it
legitimately differs) and not the URL (every extension route would have to carry
it). Tampering buys nothing: `JwtUserContext::resolveCompany()` checks the id
against the *signed* claim.

The switcher is in the profile menu, rendered only for more than one membership,
and it **reloads** on pick. Every island has fetched its data by then; a reload is
ten honest lines against a global invalidation bus that every extension would
have to remember to subscribe to.

### `actAsHeaders()` — read this before touching the condition

The shell registers it as tds-shared's `setRequestHeadersProvider`. `AUTH_API_URL`
defaults to `https://api.tracht-digital.de/auth`, which **starts with** `API_BASE`
`https://api.tracht-digital.de`, so a plain `startsWith(API_BASE)` sends
`X-Act-As-Company` to auth-api too — whose CORS allow-list carries only
`Content-Type` and `Authorization`. The preflight then fails and `/me`,
`/refresh`, logout and all of user management stop working *together*, which
reads as "the panel is broken". The auth prefix is excluded FIRST, and the
function lives in a `.ts` file precisely so it can have a test — an `.astro`
script is compiled by neither vitest nor tsc.

### `companyId` vs `customerId` on `/me`

Both are optional on `MeCompany` and read through `companyIdOf()` /
`membershipIds()`. auth-api emits both for one release so a token minted before
the deploy keeps working; typing `companyId` as required would let `c.companyId`
compile everywhere while being `undefined` at runtime for every older session.

## Status / next

Composition proven end-to-end (routes + nav + hydrated widgets + settings), auth
gate + chrome + tds-shared-pkg wired, Wiki / users (incl. fine-grained permission +
membership editing) / settings pages built, per-user dashboard layout done, both
product targets (admin/customer) build + deploy. Groups, per-company quotas, the
company admin surface (`/firma`), the company switcher, the tri-state permission
matrix and the delegation grant are in and live against tds-auth-api **0.7.0**.

Two operational steps per company, in this order, or the delegated surface does
nothing and says nothing: switch **Firmenadmins zulassen** on in
*Firmen-Kontingente*, then promote the first company admin. See
`tds-auth-api/RUNBOOK.md`.

Next: move the dashboard-layout DDL into a base migration once core-frontend-api
gains a migrator; drop the `customers`/`customerId`/`X-Act-As-Customer` aliases
in the follow-up release; optionally port the author-profile (avatar/bio) editor
if the blog byline is managed from here.
