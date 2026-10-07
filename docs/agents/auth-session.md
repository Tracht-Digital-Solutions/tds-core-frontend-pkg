# Auth, session and request headers

## Login lives off this host

The login and password-change UI is `tds-auth-frontend` (`auth.tracht-digital.de`). There is no in-app `/login`.
The gate, `redirectToLogin` and `logout` bounce to `LOGIN_URL` (`PUBLIC_LOGIN_URL`, default
`https://auth.tracht-digital.de`) with an **absolute** `?next=`. The session cookie is `Domain=.tracht-digital.de`,
so a login there is valid here immediately.

## The pre-paint gate (`Layout.astro`)

- **Probe `/me` when there is no local hint, and seed it on success.** A missing hint after arriving from the login
  site is normal (localStorage is per origin); redirecting on it would loop against the login.
- **A `/me` 401 tries `POST /refresh` once** before redirecting (remember-me sessions keep the JWT short on
  purpose; panels are the only place that exchange happens). A 200 from `/refresh` is re-confirmed against `/me`.
- Only a 401 that a refresh can't revive is a logout.
- The no-flash theme bootstrap is `themeBootstrapScript` from `tds-shared/astro`
  (`<script is:inline set:html={themeBootstrapScript} />`). It must stay `is:inline` and **before** the gate,
  whose spinner paints in theme colours. Never wrap it in a template body.
- The gate spinner is a deliberate copy of `.tds-spinner--lg.tds-spinner--primary` (it paints before CSS loads);
  geometry, timing and hex fallbacks are marked KEEP-IN-SYNC in `Layout.astro`. The gate backdrop paints
  **`--tds-panel-canvas`**, not `--color-paper`. `src/layouts/Layout.test.ts` checks the hex fallbacks against the
  installed tds-shared canvas formula (tolerance 3 per channel).
- `target.test.ts` pins different `HINT_PREFIX` values per product (a shared prefix would let a stale admin hint
  reveal the portal shell).

## The 401 backstop for everyone

`frontendFetch` and the shell's registration of tds-shared's `setUnauthorizedHandler` (`onUnauthorized`) cover
extension calls via `apiFetch` too: confirm against `/me`, try a refresh, only then log out. A scoped 401 while
`/me` still succeeds returns to the caller (`auth.test.ts`); never inject a blanket `redirectToLogin()`.

**`<meta name="tds-api-base">`** in `Layout.astro`'s `<head>` tells `apiFetch` where the API is. It can't be
`import.meta.env` (extensions ship as built packages). Without it, relative calls hit the product host's fallback.

## Profile menu (`components/UserMenu.tsx`) and `/profil`

- **Renders nothing when `/me` fails**; the gate owns "are you logged in".
- **`fetchMe()` memoises per page load**; a failed probe isn't cached. Call `invalidateMe()` after writes that
  change the principal.
- **Company names come from the composed API** (`GET /me/companies`, tds-ext-customers); auth-api holds only ids.
  Admins have no memberships, so the menu shows the product name and skips the request.
- `/profil` is injected but absent from the nav; the menu is the way in.
- `Me` uses **`userId`** (not `id`), and `logout()` sends **DELETE** (a POST got a resolved 405 that looked like
  success while the session stayed alive).

### Theme is per user (`lib/preferences.ts`)

localStorage stays the pre-paint cache; `/me/preferences` follows the choice across devices.

- Apply a loaded value with `{ announce: false }`, or the persisting listener echoes it back as a save.
- `initPreferences()` is idempotent (a second listener doubles every save).
- A failed load is silent; a failed save is a toast.

## The active company (`lib/activeCompany.ts`)

A per-session UI choice in `localStorage` under `${HINT_PREFIX}_active_company`: not a cookie (it would leak
between admin and portal), not the URL. Tampering buys nothing; the backend checks against the signed claim.
The switcher is in the profile menu (only with more than one membership) and **reloads** on pick.

`/firma` resolves its company with `getActiveCompany()` and an explicit fallback, **not** `resolveActiveCompany()`
(which would clear a stored pick missing from the administered subset).

### `actAsHeaders()`

Registered as tds-shared's `setRequestHeadersProvider`. `AUTH_API_URL` (`https://api.tracht-digital.de/auth`)
**starts with** `API_BASE`, so a plain `startsWith(API_BASE)` would send `X-Act-As-Company` to auth-api, whose CORS
allows only `Content-Type` and `Authorization`. The preflight would fail and `/me`, `/refresh`, logout and user
management would break together. **The auth prefix is excluded first.** The function lives in a `.ts` file so it
can be tested.

### `companyId` vs `customerId` on `/me`

Both are optional on `MeCompany` and read via `companyIdOf()` / `membershipIds()`; auth-api emits both for one
transition release. Drop the `customers` / `customerId` / `X-Act-As-Customer` aliases in the follow-up release.
