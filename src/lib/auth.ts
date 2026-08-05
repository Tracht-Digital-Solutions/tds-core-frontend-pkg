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

/** The authenticated principal, as returned by tds-auth-api GET /me. */
export interface Me {
  id: number;
  email: string;
  name?: string;
  isAdmin?: boolean;
  permissions?: string[];
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch(`${AUTH_API_URL}/me`, { credentials: "include" });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
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
 */
async function onUnauthorized(requestUrl: string): Promise<void> {
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

export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API_URL}/logout`, { method: "POST", credentials: "include" });
  } catch {
    /* best effort */
  }
  clearAuthed();
  location.replace(LOGIN_URL);
}
