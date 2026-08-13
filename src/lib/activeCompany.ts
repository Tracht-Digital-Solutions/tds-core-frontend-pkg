/**
 * Which company the panel is currently acting as.
 *
 * A login can belong to several companies with a different role in each, so
 * "the active one" is a per-session UI choice — and every extension call has to
 * carry it, because the composed API scopes its data by it.
 *
 * ### Why localStorage and not a cookie or the URL
 *
 * The session cookie is httpOnly and belongs to auth; a second
 * `.tracht-digital.de` cookie would leak the selection between the admin panel
 * and the portal, where it legitimately differs. The URL would mean every
 * extension route has to carry and forward it. localStorage is per-origin,
 * which is exactly the scope this needs — and the per-target prefix keeps the
 * two products apart on the same machine.
 *
 * ### Tampering is a non-issue
 *
 * `JwtUserContext::resolveCompany()` checks the requested id against the
 * SIGNED `companies` claim and ignores anything else, so editing this value by
 * hand buys nothing. The validation here is for correctness, not security: it
 * keeps a stale id (a membership that was revoked) from pinning the panel to a
 * company the server will refuse.
 */
import { API_BASE, AUTH_API_URL } from "./auth";
import { HINT_PREFIX } from "../config/target";

const KEY = `${HINT_PREFIX}_active_company`;

/** The stored selection, or null when there is none. */
export function getActiveCompany(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Store a selection, or clear it with `null`. */
export function setActiveCompany(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    /* storage disabled — the server falls back to the primary company */
  }
}

/**
 * The selection to actually use, given what the principal may act as.
 *
 * A stored id that is no longer a membership is discarded (and cleared), so
 * losing access to a company does not leave the panel pinned to it — the
 * server would refuse and every list would come back empty with nothing on
 * screen to explain why.
 */
export function resolveActiveCompany(allowed: readonly number[]): number | null {
  const stored = getActiveCompany();
  if (stored !== null && allowed.includes(stored)) return stored;
  if (stored !== null) setActiveCompany(null);
  return allowed[0] ?? null;
}

/**
 * The act-as header for one outgoing request — the body of the shell's
 * `setRequestHeadersProvider`.
 *
 * ### Read this before touching the condition
 *
 * `AUTH_API_URL` defaults to `https://api.tracht-digital.de/auth`, which
 * **starts with** `API_BASE` `https://api.tracht-digital.de`. A plain
 * `url.startsWith(API_BASE)` therefore sends `X-Act-As-Company` to auth-api as
 * well — and auth-api's CORS allow-list carries only `Content-Type` and
 * `Authorization`, so the browser's PREFLIGHT fails and the request is never
 * sent. That does not degrade a feature: `/me`, `/refresh`, logout and the
 * whole of user management stop working at once, which reads as "the panel is
 * broken", not "the company switcher is broken". The auth prefix is excluded
 * FIRST for that reason.
 *
 * Lives here rather than inline in `Layout.astro` because an `.astro` script is
 * compiled by neither vitest nor tsc — the one condition in the shell that can
 * take the login down would have had no test at all.
 */
export function actAsHeaders(url: string): Record<string, string> {
  if (url.startsWith(AUTH_API_URL) || !url.startsWith(API_BASE)) return {};
  const companyId = getActiveCompany();
  return companyId === null ? {} : { "X-Act-As-Company": String(companyId) };
}
