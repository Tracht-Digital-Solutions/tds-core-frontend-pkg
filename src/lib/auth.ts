/**
 * Panel auth helpers (ported from tds-admin). The real gate is always the
 * httpOnly `tds_session` cookie tds-auth-api sets (Domain=.tracht-digital.de, so
 * one session works across the admin + customer panels). This module manages the
 * NON-sensitive presence hint the inline gate in Layout.astro reads to decide —
 * before paint — whether to bounce to /login, and a per-request 401 backstop.
 *
 * A 401 does NOT automatically mean "logged out": it's confirmed against `/me`
 * first, so a single RBAC/resource-scoped 401 can't loop a freshly-logged-in
 * user back to login.
 */

import { HINT_PREFIX, LOGIN_URL } from "../config/target";

const AUTHED_HINT_KEY = `${HINT_PREFIX}_authed`;
const AUTHED_EXP_KEY = `${HINT_PREFIX}_authed_exp`;
const CONFIRMED_KEY = `${HINT_PREFIX}_confirmed`;

/** How long a `/me` confirmation is trusted before the gate re-checks (ms). Keep in sync with the inline gate. */
export const CONFIRM_TTL_MS = 60_000;

export const AUTH_API_URL: string =
  (import.meta.env.PUBLIC_AUTH_API_URL as string | undefined) ??
  "https://api.tracht-digital.de/auth";

export const API_BASE: string =
  (import.meta.env.PUBLIC_API_BASE as string | undefined) ??
  "https://api.tracht-digital.de";

/** tds-customer-api, reached through the gateway's `/customer` prefix (company list). */
export const CUSTOMER_API_URL: string = `${API_BASE}/customer`;

/** Mark the session present (called right after a successful login / SSO check). */
export function setAuthed(expiresAt?: number): void {
  try {
    localStorage.setItem(AUTHED_HINT_KEY, "1");
    if (expiresAt) {
      localStorage.setItem(AUTHED_EXP_KEY, String(expiresAt));
    }
    // Seed the confirmation so the very next navigation paints without a
    // redundant /me round-trip.
    localStorage.setItem(CONFIRMED_KEY, String(Date.now() + CONFIRM_TTL_MS));
  } catch {
    /* storage disabled — the cookie + 401 backstop still gate */
  }
}

export function clearAuthed(): void {
  try {
    localStorage.removeItem(AUTHED_HINT_KEY);
    localStorage.removeItem(AUTHED_EXP_KEY);
    localStorage.removeItem(CONFIRMED_KEY);
  } catch {
    /* ignore */
  }
}

export function hasAuthedHint(): boolean {
  try {
    return localStorage.getItem(AUTHED_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** One company the principal belongs to, as `/me` reports it. */
export interface MeCompany {
  /**
   * Optional on purpose for the length of the rename: a token minted before the
   * deploy carries only `customerId`, and typing this as required would let
   * `c.companyId` compile everywhere while being `undefined` at runtime for
   * every session older than the release. Read it via `companyIdOf`.
   */
  companyId?: number;
  /** @deprecated alias of `companyId`, emitted by auth-api for one release. */
  customerId?: number;
  permissions?: string[];
  /** Whether this membership may manage the company's own users. */
  isCompanyAdmin?: boolean;
  groupIds?: number[];
  permissionCeiling?: string[] | null;
}

/**
 * The id of one membership, whichever spelling this token carries.
 *
 * `company_id` replaced `customer_id` in the rename, and auth-api emits both
 * for one release so a token minted before the deploy keeps working. Every
 * reader goes through this rather than picking one field — a `?? 0` here would
 * quietly scope a request to a company that does not exist.
 */
export function companyIdOf(company: MeCompany): number | null {
  return company.companyId ?? company.customerId ?? null;
}

/** The company ids of a principal's memberships, in the order /me reports them. */
export function membershipIds(me: Me | null, only?: (c: MeCompany) => boolean): number[] {
  return (me?.companies ?? [])
    .filter((c) => only === undefined || only(c))
    .map(companyIdOf)
    .filter((id): id is number => id !== null);
}

/**
 * The authenticated principal, as returned by tds-auth-api `GET /me`.
 *
 * The id field is **`userId`**, not `id`. This interface declared `id: number`
 * for as long as it existed and nothing ever noticed, because `fetchMe` had no
 * call sites at all — the first consumer (the profile menu) would have rendered
 * `undefined`.
 */
export interface Me {
  userId: number;
  email: string;
  name?: string | null;
  /** The short name the user picked for themselves; may be null. */
  displayName?: string | null;
  /** Server-resolved `displayName ?? name ?? email` — prefer this for display. */
  label?: string;
  avatarUrl?: string | null;
  /** Whether an uploaded picture exists (an `avatarUrl` can be a stale legacy URL). */
  hasAvatar?: boolean;
  isAdmin?: boolean;
  isSupportAgent?: boolean;
  isBlogAuthor?: boolean;
  permissions?: string[];
  companies?: MeCompany[];
  customerId?: number | null;
  mustChangePassword?: boolean;
  /** Unix seconds, from the verified token's `exp`. */
  expiresAt?: number | null;
}

/**
 * In-flight/settled `/me` for this page load.
 *
 * The shell can ask for the principal from several places on one page (the
 * profile menu, the profile page, a future company switcher) and the pre-paint
 * gate has usually just called `/me` itself. Without this each of them is a
 * separate cross-origin round-trip on every navigation. Deliberately a plain
 * module-level promise rather than `sessionStorage`: identity is exactly the
 * thing that must not be served stale after a logout in another tab, and a
 * page load is the right lifetime.
 */
let mePromise: Promise<Me | null> | null = null;

export async function fetchMe(): Promise<Me | null> {
  if (mePromise === null) {
    mePromise = (async () => {
      try {
        const res = await fetch(`${AUTH_API_URL}/me`, { credentials: "include" });
        return res.ok ? ((await res.json()) as Me) : null;
      } catch {
        return null;
      }
    })();

    // A failed probe must not be cached: the panel calls this again after a
    // refresh/SSO recovery, and a sticky null would keep the menu empty for
    // the rest of the page's life.
    mePromise = mePromise.then((me) => {
      if (me === null) mePromise = null;
      return me;
    });
  }
  return mePromise;
}

/** Drop the cached principal — call after any write that changes it. */
export function invalidateMe(): void {
  mePromise = null;
}

let redirecting = false;

/**
 * Redirect to the central login once, preserving the current location as an
 * absolute ?next= (the login site validates it against a *.tracht-digital.de
 * allow-list and returns the user here).
 */
function redirectToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  clearAuthed();
  try {
    document.documentElement.classList.add("auth-checking");
  } catch {
    /* ignore */
  }
  const next = encodeURIComponent(location.href);
  location.replace(`${LOGIN_URL}?next=${next}`);
}

/**
 * Try to mint a fresh session from the "angemeldet bleiben" cookie.
 *
 * The session JWT is short-lived on purpose (other services verify it against
 * the JWKS and never consult the auth database, so its lifetime is also its
 * non-revocability window). Staying signed in for 30 days is therefore this
 * exchange, not a longer token — and this is the one place the panels perform
 * it. Without it the remember-me cookie would exist and never be used: the
 * hourly expiry would still bounce the user to the login.
 *
 * Returns true only when a new session really was issued.
 */
async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${AUTH_API_URL}/refresh`, { method: "POST", credentials: "include" });
    if (!res.ok) return false;
    // Re-confirm rather than trusting the 200: a refreshed token that somehow
    // did not stick as a cookie must not read as a live session.
    const me = await fetch(`${AUTH_API_URL}/me`, { credentials: "include" });
    if (!me.ok) return false;
    setAuthed();
    return true;
  } catch {
    return false;
  }
}

/**
 * A 401 is verified against /me before it's treated as a dead session, so a
 * single scoped-permission 401 never loops the user to login. Only a /me that
 * ALSO 401s — and a refresh that cannot revive it either — is definitive.
 *
 * Exported so the shell can hand it to tds-shared's `setUnauthorizedHandler`:
 * extension islands call the API through `apiFetch`, which has no way to reach
 * into the host, so without that registration every extension 401 skipped this
 * backstop entirely.
 */
export async function onUnauthorized(requestUrl: string): Promise<void> {
  // A 401 straight from /me is definitive for the SESSION, but not yet for the
  // login: a remembered device can still refresh its way back in.
  if (requestUrl.startsWith(`${AUTH_API_URL}/me`)) {
    if (!(await tryRefresh())) redirectToLogin();
    return;
  }
  const res = await fetch(`${AUTH_API_URL}/me`, { credentials: "include" });
  if (!res.ok && !(await tryRefresh())) {
    redirectToLogin();
  }
}

/**
 * fetch wrapper for the panel API. Sends the session cookie, and on a 401
 * confirms against /me before deciding the session is dead. Returns the original
 * response so callers can handle a legitimate 401 (e.g. RBAC) themselves.
 */
export async function frontendFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const res = await fetch(url, { credentials: "include", ...init });
  if (res.status === 401) {
    await onUnauthorized(url);
  }
  return res;
}

/**
 * End the session everywhere and return to the central login.
 *
 * **The verb is DELETE.** tds-auth-api registers `DELETE /logout`
 * (`$app->delete('/logout', …)`), and this used to send `POST` — a 405 that
 * the `catch` could not even see, because a 405 is a resolved fetch, not a
 * thrown one. The local hint was cleared and the user was redirected, so it
 * *looked* like it worked; the session row was never revoked and the
 * `Domain=.tracht-digital.de` cookie was never expired, so returning to the
 * panel signed them straight back in. Nobody caught it because `logout()` had
 * no call sites until the profile menu.
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API_URL}/logout`, { method: "DELETE", credentials: "include" });
  } catch {
    /* Network failure — still clear locally and bounce; the server-side
       session outlives it, but leaving the user on an authed-looking panel
       would be worse. */
  }
  invalidateMe();
  clearAuthed();
  location.replace(LOGIN_URL);
}
