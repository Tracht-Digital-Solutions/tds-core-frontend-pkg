/**
 * Per-user interface preferences — the client half of `/me/preferences`.
 *
 * ### Two stores, one truth, and why both exist
 *
 * The theme lives in `localStorage` because the no-flash bootstrap has to read
 * it **synchronously in `<head>`**, before anything paints. That is a
 * per-browser cache and it stays. The server copy (`/me/preferences`) is what
 * makes the choice follow the USER to another device.
 *
 * So this module reconciles: on load, take the server's value and apply it
 * locally; on change, push the local value up. The visible cost is one frame in
 * the old theme the first time a user opens the panel on a new device — the
 * alternative is blocking first paint on a cross-origin request, which is worse
 * for every other page load.
 *
 * ### Everything here is best-effort
 *
 * `services/frontend/.env` and the `tds_frontend` database are still an open
 * go-live step, so `/me/preferences` may legitimately fail. A failed LOAD is
 * silent — the panel keeps working off `localStorage`, which is exactly what it
 * did before this existed. A failed SAVE is a toast, because the user just
 * asked for something and deserves to know it did not stick (with the HTTP
 * status, which is what separates "session expired" from "service down").
 */
import { applyThemePreference, readThemePreference, startSystemThemeSync } from
  "@tracht-digital-solutions/tds-shared/theme";
import type { ThemePreference } from "@tracht-digital-solutions/tds-shared/design";
import { THEME_CHANGE_EVENT } from "@tracht-digital-solutions/tds-shared/design";
import type { ThemeChangeDetail } from "@tracht-digital-solutions/tds-shared/design";
import { toast } from "@tracht-digital-solutions/tds-shared/toast";

import { API_BASE, frontendFetch } from "./auth";

const PREFERENCES_URL = `${API_BASE}/me/preferences`;

/** The keys the backend whitelists (`Support\PreferenceWhitelist`). */
export interface Preferences {
  theme?: ThemePreference;
  locale?: "de" | "en";
  notify_toast?: "0" | "1";
  notify_email?: "0" | "1";
}

const THEMES: readonly string[] = ["light", "dark", "system"];
const LOCALES: readonly string[] = ["de", "en"];

/** Narrow an untrusted payload to the shape we understand. */
function parse(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: Preferences = {};
  if (typeof obj.theme === "string" && THEMES.includes(obj.theme)) {
    out.theme = obj.theme as ThemePreference;
  }
  if (typeof obj.locale === "string" && LOCALES.includes(obj.locale)) {
    out.locale = obj.locale as "de" | "en";
  }
  for (const key of ["notify_toast", "notify_email"] as const) {
    const value = obj[key];
    if (value === "0" || value === "1") out[key] = value;
  }
  return out;
}

/** Read the stored preferences. Resolves to `{}` on any failure — never throws. */
export async function loadPreferences(): Promise<Preferences> {
  try {
    const res = await frontendFetch(PREFERENCES_URL);
    if (!res.ok) return {};
    const body = (await res.json()) as { preferences?: unknown };
    return parse(body.preferences);
  } catch {
    return {};
  }
}

/**
 * Persist a partial set of preferences.
 *
 * Returns the response so the caller can report the status — never `await` this
 * and drop the result, which is the single most common defect across these
 * repos: a 403 that closes the dialog and reloads the list while nothing
 * changed. Resolves to `null` only when the request could not be made at all.
 */
export async function savePreferences(values: Preferences): Promise<Response | null> {
  try {
    return await frontendFetch(PREFERENCES_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: values }),
    });
  } catch {
    return null;
  }
}

let started = false;

/**
 * Wire the theme to the server for this page.
 *
 * 1. Keep a `"system"` preference honest while the page is open (the bootstrap
 *    only runs once, so without this "System" means "whatever the OS said at
 *    load" and reads as broken).
 * 2. Pull the stored theme and apply it — with `announce: false`, or the
 *    listener below would echo the value we just read straight back as a save.
 * 3. Push every later change up.
 *
 * Called once from the shell. Idempotent, because Astro's `<script>` in a
 * layout runs per page and a second listener would double every save.
 */
export function initPreferences(): void {
  if (started) return;
  started = true;

  startSystemThemeSync();

  void loadPreferences().then((prefs) => {
    // Only touch the DOM when the server actually disagrees. Re-applying the
    // same value is harmless but would fight the toggle if the user flipped
    // the theme while this request was in flight.
    if (prefs.theme && prefs.theme !== readThemePreference()) {
      applyThemePreference(prefs.theme, { announce: false });
    }
  });

  window.addEventListener(THEME_CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<ThemeChangeDetail>).detail;
    if (!detail) return;
    void savePreferences({ theme: detail.preference }).then((res) => {
      // Silent on success and on "no backend yet" (the panel still works off
      // localStorage). A 4xx that is not a 401 means the request was
      // understood and refused, which the user should hear about — a 401 is
      // already handled by frontendFetch's backstop.
      if (res && !res.ok && res.status !== 401) {
        toast.warning(`Theme konnte nicht gespeichert werden (HTTP ${res.status}).`);
      }
    });
  });
}
