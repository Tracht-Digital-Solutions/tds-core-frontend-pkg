/**
 * The company list the user editor needs for membership editing.
 *
 * This is the **last live dependency on the legacy `tds-customer-api`** in the
 * whole frontend platform, and the one thing standing between that service and
 * retirement (`tds-core-frontend-api#8`). The composed `tds-ext-customers`
 * extension already serves the identical payload — `{customers:[{id,name}]}` —
 * at `GET /admin/customers`, so this asks the composed API first and only falls
 * back to `GET /customer/admin/customers`.
 *
 * **Why a fallback rather than a straight switch.** The composed frontend
 * service cannot boot until `services/frontend/.env` and the `tds_frontend`
 * database exist (issue #2), and until then every catch-all route answers 500.
 * Cutting straight over would therefore have broken membership editing *today*
 * to fix it *later*. With the fallback the call works on both sides of go-live,
 * and the legacy leg simply stops being reached the moment the composed one
 * answers — no second deploy needed to complete the migration.
 *
 * Delete the legacy leg (and `CUSTOMER_API_URL`) once `tds-customer-api` is
 * retired.
 */

import { API_BASE, CUSTOMER_API_URL, frontendFetch } from "./auth";

export interface Company {
  id: number;
  name: string;
}

/** Composed `tds-ext-customers` — mounted at the API root by the frontend kernel. */
export const COMPOSED_COMPANIES_URL = `${API_BASE}/admin/customers`;

/** Legacy `tds-customer-api`, reached through the gateway's `/customer` prefix. */
export const LEGACY_COMPANIES_URL = `${CUSTOMER_API_URL}/admin/customers`;

export interface CompaniesResult {
  companies: Company[];
  /** Which endpoint answered — surfaced so a caller can report the degraded path. */
  source: "composed" | "legacy" | "none";
}

/**
 * Read the company list, preferring the composed API.
 *
 * Deliberately **never throws**: the editor works without names (it falls back
 * to showing ids), so a company-list outage must not take the whole user
 * management down with it. That was already the contract at the call site; it
 * is just explicit now.
 */
export async function fetchCompanies(): Promise<CompaniesResult> {
  const composed = await tryFetch(COMPOSED_COMPANIES_URL);
  if (composed) return { companies: composed, source: "composed" };

  const legacy = await tryFetch(LEGACY_COMPANIES_URL);
  if (legacy) return { companies: legacy, source: "legacy" };

  return { companies: [], source: "none" };
}

/**
 * One attempt. Returns null for anything that is not a usable list, so the
 * caller cannot mistake "answered with junk" for "answered".
 */
async function tryFetch(url: string): Promise<Company[] | null> {
  try {
    const res = await frontendFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { companies?: unknown; customers?: unknown };
    // Both keys, for the length of the rename: the composed extension emits
    // `companies` AND `customers` for one release, the legacy customer-api only
    // ever emits `customers`. Reading just one of them breaks at a different
    // moment depending on which — `customers` alone dies when the alias is
    // dropped, `companies` alone dies against the legacy fallback today.
    const list = Array.isArray(data.companies) ? data.companies : data.customers;
    if (!Array.isArray(list)) return null;
    return list.filter(isCompany);
  } catch {
    // Network failure, or a 500 body that is not JSON — both mean "try the next
    // endpoint", never "the list is empty".
    return null;
  }
}

function isCompany(value: unknown): value is Company {
  if (typeof value !== "object" || value === null) return false;
  const c = value as { id?: unknown; name?: unknown };
  return typeof c.id === "number" && typeof c.name === "string";
}
