# Base features

## Toasts

The shell owns the **one** `ToastHost` (`Layout.astro`, next to `CookieNotice`, `client:idle`, mounted even in
`bare` mode). Everything else raises toasts (`tds-shared/toast` in TS, `tds-shared/components` in islands).
Anything the user must **read or copy** (a temporary password) never goes in a toast; `UsersAdmin` keeps an in-flow
notice for those cases.

## Per-user dashboard layout

`src/pages/index.astro` renders every enabled widget into `.widget-slot[data-widget]` at build time;
`src/lib/dashboardLayout.ts` fetches `GET /me/dashboard-layout` and reorders and shows/hides the existing slots.

- No saved layout or an unreachable API ⇒ every widget visible in authored order.
- "Anpassen" edit mode: drag from the handle (mouse) plus **`[data-widget-move]` up/down buttons** (touch and
  keyboard), which call the same `insertBefore`, restore focus to the pressed button and announce the new position
  through one polite live region. Hidden slots count as positions in edit mode. Reorders animate with `flipReorder`
  (FLIP via Web Animations), not a view transition.
- Only the decorative ⠿ handle is `aria-hidden` (the controls block once hid a focusable checkbox).
- Saves report via toast (`toast.danger` with the HTTP status); edit mode stays open on failure. The initial `GET`
  stays silent.
- Edit-mode CSS is an inline raw `<style>`; the script is a module import.
- Next: move the layout DDL into a base migration in `tds-core-frontend-api`.

## Live notifications (`lib/notificationFeed.ts`)

One poll of `GET /me/notifications` on every non-`bare` page, a toast per event, and a `tds:notification` window
event so an open list can refresh.

- **Polling**, because PHP-FPM on Plesk allows no SSE or WebSockets. **One poller for all modules.**
- **The cursor is opaque, in `sessionStorage`, per target** (survives a hard reload; not shared across tabs).
- **The first call announces nothing.**
- **401/403 stops the poller**; **transport failures are never toasted** (exponential backoff to 5 min);
  **hidden tabs don't poll** and poll immediately on becoming visible.

## `/wiki`: two wikis behind one route

`pages/wiki.astro` branches on `FRONTEND_TARGET`; the branches are mutually exclusive.

| Target | Nav label | Content |
|---|---|---|
| admin | API-Referenz (`book-open`) | The API of the base and every composed module |
| customer | Hilfe (`life-buoy`) | FAQs and handbooks |

### Admin: `components/ApiReference.tsx`

Renders `/wiki.json` **v2**.

- Grouped by the module that **mounted** the route (`ModuleRegistry::routeOwners()`), not by path segment.
- German module names come from the build (`virtual:frontend-modules`), passed as a prop.
- Undocumented routes are listed and say so; orphan docs show as a warning (`stats.orphan_docs`).
- Collapsing uses native `<details>`; "Alles aufklappen" bumps a remount key; filtering auto-opens matches.
- A payload whose `version` isn't 2 is refused.
- Parameter and response tables carry `tds-table` + `tabindex="0"` + `role="region"` + a label.

### Customer: `components/HelpCenter.tsx`

FAQs and handbooks from the database via public `/help/faqs`, `/help/articles`, `/help/articles/{slug}`, edited in
the admin product under *Wiki-Inhalte* (`tds-ext-live-chat-cta-pkg`); the same rows feed the support widget.

- There is no code-side FAQ list (`src/content/faq.ts` was removed); don't reintroduce one.
- The customer product doesn't compose that extension's frontend; the page is base code calling a public API.
- **A 404 or empty answer is an empty wiki**, not an error; only a transport failure shows a warning.
- A handbook body is fetched when opened (the list has no bodies).
- FAQ answers are plain text, interpolated per paragraph, never `set:html`. Handbook bodies go through tds-shared's
  escape-first `renderMarkdown`.

## Access control (`/users` → `AccessAdmin.tsx`)

The nav row is platform-admin only (`revealFor: "platform-admin"`). One route, three tabs (Benutzer | Gruppen |
Firmen-Kontingente); each panel mounts on first view and stays mounted.

**Benutzer (`UsersAdmin.tsx`):** list, create, reset password, delete, and the per-user form (admin, support-agent
and blog-author flags, status, company memberships). A membership has direct `permissions`, `groupIds`,
`isCompanyAdmin` and an optional `permissionCeiling` (empty = inherit).

- **`PermissionMatrix`** (shared with `/firma`) is tri-state per right: inherited from a group, granted, or
  withheld. A right no assigned group carries gets a plain checkbox; one a group carries gets three options naming
  the group. The origin is computed client-side from `groups[].permissions`.
- **Only decisions are stored** (`permissions` granted, `permissionDenies` withheld), never the effective set.
- **Options come from the composed catalog** (`GET ${API_BASE}/admin/permissions`), falling back to tds-shared's
  `PORTAL_PERMISSIONS` when unreachable.
- **An unknown stored key still renders** under "Unbekannt" (otherwise it would be invisible and unremovable).
- **The Firmenadmin checkbox is disabled for a company without delegation**, naming the fix. Policies are fetched
  per company as the form touches it; a pending fetch counts as allowed.
- One button clears the direct grants only (role presets are real groups now).

**Gruppen (`GroupsAdmin.tsx`):** a group is owned by the platform (`companyId = 0`) or one company. System groups
keep editable rights but can't be renamed or deleted. Every write revokes sessions, and the screen says how many.

**Firmen-Kontingente (`CompanyQuotasAdmin.tsx`):** `maxUsers`, `allowedPermissions`, `allowCustomGroups` and
**`allowCompanyAdmins`** (off by default; without it `/firma` stays invisible inside the company). Keep
`maxUsers: null` (no cap) and `allowedPermissions: null` (no ceiling) distinct from `[]` (may grant nothing).
Unticking "Alle Rechte freigeben" seeds the list from the full catalog. Quotas never bind a platform admin.

## `/firma`: the delegated company-admin surface (`CompanyUsersAdmin.tsx`)

The nav row ships `hidden` and is revealed for `company-or-platform-admin` **and** at least one membership, so a
platform admin (no memberships) doesn't see it; by URL they get a company picker from `fetchCompanies()`.

- Hiding is not a permission check; auth-api's `CompanyAdminMiddleware` gates every `/company/*` call.
- `isCompanyAdmin` on `/me` arrives already folded against the delegation grant.
- It lives in the host because a company admin signs in to the portal, which doesn't compose the Firmen extension.
- Seat counts, ceilings and assignable groups arrive in the list payload. `describeFailure()` in
  `lib/companyAdmin.ts` maps named refusals (`seat_limit`, `permission_not_allowed`, `last_company_admin`, …) to
  German.
- Operational order per company: enable **Firmenadmins zulassen**, then promote the first company admin (see
  `tds-auth-api/RUNBOOK.md`).

## E-Mail (SMTP) settings (`components/MailSettings.tsx`, admin product only)

- **Reads two endpoints:** `GET /admin/settings/mail` (stored, edited here) and `GET /admin/mail` (what actually
  sends, `source: db|env|none`). The `env` case gets its own explanatory note.
- **A blank password is sent as `""`** (the API keeps the stored secret).
- **The test mail's failure renders in flow** (the SMTP reply is diagnostic text); success is a toast. The button is
  disabled while nothing is configured.

## CORS settings (`components/CorsSettings.tsx`, admin product only)

- Shows **the layer** each origin comes from (`baseline` / `env` / `db`); the list is a union, so baseline entries
  can't be deleted.
- Shows **rejects in flow** as a `.tds-alert` (e.g. a trailing-slash paste error). Success is a toast; a partial save
  is a warning toast.

## Sitemap exclusions (`SitemapSettings.tsx`)

"Suchmaschinen (Sitemap)" edits per-site `sitemap_exclusions` via `PUT /admin/sites`, which replaces the whole map,
so every site's list is sent on each save.
