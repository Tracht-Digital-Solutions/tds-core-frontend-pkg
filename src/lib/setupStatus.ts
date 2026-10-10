import type { SetupItem, SetupStatus } from "@tracht-digital-solutions/tds-frontend-contract";

import { API_BASE, frontendFetch } from "./auth";

/**
 * The setup wizard's data: `GET /me/setup-status` and one choice per item.
 *
 * The banner, the `/einrichtung` page and the settings markers all read the
 * same answer. It is fetched once per page load and shared through this
 * module-level promise, so a page with all three asks the API once.
 */

export type { SetupItem, SetupStatus };
export type SetupAction = "snooze" | "ignore" | "restore";

let pending: Promise<SetupStatus | null> | null = null;
let fetchedAt = 0;

/**
 * Shared for a few seconds only: long enough for the banner, the page and the
 * settings markers of ONE page load to share a request, short enough that a
 * client-side navigation after changing a setting asks again. Module state
 * survives the ClientRouter's page swaps, so an unbounded cache would show the
 * state from before the change.
 */
const SHARE_MS = 5000;

/** The current status, or null when the API is unreachable or answered badly. */
export function loadSetupStatus(fresh = false): Promise<SetupStatus | null> {
  if (fresh || pending === null || Date.now() - fetchedAt > SHARE_MS) {
    fetchedAt = Date.now();
    pending = (async () => {
      try {
        const res = await frontendFetch(`${API_BASE}/me/setup-status`);
        if (!res.ok) return null;
        const json = (await res.json()) as Partial<SetupStatus>;
        return Array.isArray(json.items) ? { items: json.items, open: Number(json.open ?? 0) } : null;
      } catch {
        return null;
      }
    })();
  }
  return pending;
}

/** Store one choice. Throws with the HTTP status on failure, for the toast. */
export async function chooseSetup(id: string, action: SetupAction): Promise<void> {
  // Sent as is, not percent-encoded: the route matches `<module>:<key>` on the
  // raw path, and `%3A` would not match it. Anything outside the id alphabet
  // is refused here instead.
  if (!/^[a-z0-9-]+:[a-z0-9_.-]+$/.test(id)) throw new Error("invalid id");
  const res = await frontendFetch(`${API_BASE}/me/setup-status/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  pending = null;
}

/** Still to do: not set up, and neither put off nor ignored. */
export const isOpen = (item: SetupItem): boolean => item.state !== "ok" && !item.snoozed && !item.ignored;

/**
 * Items that are not set up, keyed by the settings section they point at
 * (`/einstellungen#settings-<id>` → `<id>`). Snoozed items count too — a
 * snooze hides the reminder, not the fact.
 */
export function unconfiguredSections(status: SetupStatus): Map<string, SetupItem[]> {
  const out = new Map<string, SetupItem[]>();
  for (const item of status.items) {
    if (item.state === "ok" || item.ignored) continue;
    const match = /^\/einstellungen#settings-([a-z0-9-]+)$/.exec(item.href);
    if (!match) continue;
    const list = out.get(match[1]!) ?? [];
    list.push(item);
    out.set(match[1]!, list);
  }
  return out;
}

/** Drop the shared answer (tests). */
export function resetSetupStatusCache(): void {
  pending = null;
  fetchedAt = 0;
}
