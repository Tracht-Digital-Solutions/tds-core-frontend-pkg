/**
 * The RBAC surfaces added in Phase 2: groups, per-company policies, and the
 * delegated company-admin user management.
 *
 * All of it lives in **tds-auth-api**, not the composed API — it writes
 * `app_user`, and auth-api is the only service that does. So these go through
 * `frontendFetch` against `AUTH_API_URL`, while the permission CATALOG comes
 * from the composed API (`/admin/permissions`), which is the service that
 * enforces it.
 *
 * Every call returns the parsed body plus the `Response`, never throws, and
 * never swallows a status: the callers report failures with the HTTP code,
 * which is what separates "session expired" from "service down" in a report.
 */
import { API_BASE, AUTH_API_URL, frontendFetch } from "./auth";

export interface PermissionDef {
  id: string;
  label: string;
  group?: string;
}

export interface Group {
  id: number;
  companyId: number;
  slug: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  scope: "platform" | "company";
  memberCount?: number;
}

export interface CompanyPolicy {
  companyId: number;
  maxUsers: number | null;
  allowedPermissions: string[] | null;
  allowCustomGroups: boolean;
  /**
   * May this company have company admins at all? Off means nobody inside it
   * creates or manages users or assigns groups — the whole `/company/*`
   * surface answers 403. Defaults to false, including for a company that has
   * no policy row: unlike the limits in this object, this field hands a
   * capability out rather than capping one.
   */
  allowCompanyAdmins: boolean;
}

export interface CompanyMember {
  id: number;
  email: string;
  name: string | null;
  displayName: string | null;
  label: string;
  status: "active" | "disabled";
  permissions: string[];
  groupIds: number[];
  isCompanyAdmin: boolean;
  /**
   * Rights withheld from this person even where an assigned group grants them.
   * The RAW stored decision, not the effective set — an effective list cannot
   * express "the group grants it and we took it away", which is exactly what
   * the editor has to show.
   */
  permissionDenies: string[];
}

export interface CompanyUsersPayload {
  users: CompanyMember[];
  seats: { used: number; max: number | null; remaining: number | null };
  allowedPermissions: string[] | null;
  allowCustomGroups: boolean;
  allowCompanyAdmins: boolean;
  groups: Group[];
}

/** `{ res }` on failure so the caller can name the status. */
export interface Result<T> {
  res: Response | null;
  data: T | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await frontendFetch(url, init);
    if (!res.ok) return { res, data: null };
    return { res, data: (await res.json()) as T };
  } catch {
    // Network failure — `res: null` is how a caller tells "no connection"
    // from "the server said no".
    return { res: null, data: null };
  }
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// --- the permission catalog ------------------------------------------------

/**
 * The composed catalog every module contributes.
 *
 * Falls back to `[]` rather than throwing: the editor degrades to the shared
 * seed labels, which is the same never-throws contract `fetchCompanies` has —
 * user management must not go down because the composed API is unreachable.
 */
export async function fetchPermissionCatalog(): Promise<PermissionDef[]> {
  const { data } = await call<{ permissions?: PermissionDef[] }>(`${API_BASE}/admin/permissions`);
  return data?.permissions ?? [];
}

// --- groups (platform admin) -----------------------------------------------

/** The raw call, for the screen that has to tell "none" from "unreachable". */
export function listGroups(companyId?: number): Promise<Result<{ groups: Group[] }>> {
  const query = companyId !== undefined ? `?company_id=${companyId}` : "";
  return call(`${AUTH_API_URL}/admin/groups${query}`);
}

/**
 * Groups as a plain list, empty when they cannot be fetched.
 *
 * For the callers where the group picker is one control among many (the user
 * editor): an outage there costs a checkbox list, and taking the whole editor
 * down for it would be the worse trade. `listGroups` is the variant for the
 * screen that IS the group list.
 */
export async function fetchGroups(companyId?: number): Promise<Group[]> {
  const { data } = await listGroups(companyId);
  return data?.groups ?? [];
}

export function createGroup(body: Record<string, unknown>): Promise<Result<{ group: Group }>> {
  return call(`${AUTH_API_URL}/admin/groups`, { method: "POST", ...json(body) });
}

export function updateGroup(
  id: number,
  body: Record<string, unknown>,
): Promise<Result<{ group: Group; sessionsRevoked: number }>> {
  return call(`${AUTH_API_URL}/admin/groups/${id}`, { method: "PATCH", ...json(body) });
}

export function deleteGroup(id: number): Promise<Result<{ sessionsRevoked: number }>> {
  return call(`${AUTH_API_URL}/admin/groups/${id}`, { method: "DELETE" });
}

// --- company policy (platform admin) ---------------------------------------

export function fetchCompanyPolicy(
  companyId: number,
): Promise<Result<{ policy: CompanyPolicy; seatsUsed: number; companyAdmins: number }>> {
  return call(`${AUTH_API_URL}/admin/companies/${companyId}/policy`);
}

export function saveCompanyPolicy(
  companyId: number,
  body: Record<string, unknown>,
): Promise<Result<{ policy: CompanyPolicy; seatsUsed: number; sessionsRevoked: number }>> {
  return call(`${AUTH_API_URL}/admin/companies/${companyId}/policy`, { method: "PUT", ...json(body) });
}

// --- the delegated company-admin surface -----------------------------------

export function fetchCompanyUsers(companyId: number): Promise<Result<CompanyUsersPayload>> {
  return call(`${AUTH_API_URL}/company/${companyId}/users`);
}

export function createCompanyUser(
  companyId: number,
  body: Record<string, unknown>,
): Promise<Result<{ user: unknown; temporaryPassword: string | null }>> {
  return call(`${AUTH_API_URL}/company/${companyId}/users`, { method: "POST", ...json(body) });
}

export function updateCompanyUser(
  companyId: number,
  userId: number,
  body: Record<string, unknown>,
): Promise<Result<{ user: unknown }>> {
  return call(`${AUTH_API_URL}/company/${companyId}/users/${userId}`, { method: "PATCH", ...json(body) });
}

export function removeCompanyUser(companyId: number, userId: number): Promise<Result<{ ok: true }>> {
  return call(`${AUTH_API_URL}/company/${companyId}/users/${userId}`, { method: "DELETE" });
}

/**
 * Turn a failed {@link Result} into something worth showing a person.
 *
 * The backend names WHY it refused (`seat_limit`, `permission_not_allowed`,
 * `last_company_admin`, …) precisely so the UI does not have to say
 * "Forbidden" and leave an admin guessing which checkbox to untick.
 */
export async function describeFailure(res: Response | null, fallback: string): Promise<string> {
  if (res === null) return `${fallback} (keine Verbindung).`;

  let body: Record<string, unknown> = {};
  try {
    body = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    /* not JSON — fall through to the status */
  }

  const code = typeof body.code === "string" ? body.code : "";
  const rejected = Array.isArray(body.rejected) ? body.rejected.join(", ") : "";

  switch (code) {
    case "seat_limit":
      return `Keine freien Benutzerplätze mehr (${body.used} von ${body.max}).`;
    case "permission_not_allowed":
      return `Diese Rechte sind für diese Firma nicht freigegeben: ${rejected}.`;
    case "last_company_admin":
      return "Die Firma braucht mindestens einen Firmenadmin.";
    case "field_not_allowed":
      return "Dieses Feld darf hier nicht geändert werden.";
    case "custom_groups_disabled":
      return "Diese Firma darf keine eigenen Gruppen anlegen.";
    case "delegation_disabled":
      // Names the fix, because only a platform admin can apply it and the
      // person reading this may not be one.
      return "Für diese Firma sind Firmenadmins nicht freigeschaltet (Benutzer → Firmen-Kontingente).";
    case "unknown_group":
      return "Unbekannte Gruppe.";
    case "seats_in_use":
      return `Die Firma hat bereits ${body.used} Benutzer.`;
    case "system_group":
      return "System-Gruppen können nicht gelöscht werden.";
    default:
      return `${fallback} (HTTP ${res.status}).`;
  }
}
