import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  FormAlert,
  Spinner,
  toast,
} from "@tracht-digital-solutions/tds-shared/components";
import {
  applyThemePreference,
  readThemePreference,
} from "@tracht-digital-solutions/tds-shared/theme";
import type { ThemePreference } from "@tracht-digital-solutions/tds-shared/design";

import {
  AUTH_API_URL,
  fetchMe,
  frontendFetch,
  invalidateMe,
  type Me,
} from "../lib/auth";
import { LOGIN_URL } from "../config/target";
import { loadPreferences, savePreferences, type Preferences } from "../lib/preferences";

/**
 * The user's own account screen: profile, appearance, notifications, security.
 *
 * ### Where each setting actually lives
 *
 * - **Profile** (display name, picture) → `tds-auth-api`. It is identity, and
 *   auth-api owns the `app_user` row. Only `displayName` and the avatar are
 *   editable: `name` drives the admin user list and the public blog byline, and
 *   `email` is the login identity.
 * - **Appearance / notifications** → `tds-core-frontend-api` (`/me/preferences`).
 *   Interface state, not identity.
 * - **Password / passkeys** → the central login site. The panel deliberately
 *   hosts no login UI, so those are links with a `?next=` back here rather than
 *   a second implementation of a security flow.
 * - **Sessions** → `tds-auth-api`, rendered here because this is where a user
 *   looks for them.
 *
 * ### Feedback follows the house rule
 *
 * Transient outcome ("Gespeichert.") → toast. Persistent state (a load that
 * failed, a service that is not reachable) → an in-flow `FormAlert`. Never both
 * for one event. Every message carries the HTTP status, which is what separates
 * "session expired" from "service down" in a bug report.
 */

type Tab = "profil" | "darstellung" | "benachrichtigungen" | "sicherheit";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "profil", label: "Profil" },
  { id: "darstellung", label: "Darstellung" },
  { id: "benachrichtigungen", label: "Benachrichtigungen" },
  { id: "sicherheit", label: "Sicherheit" },
];

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; hint: string }> = [
  { value: "light", label: "Hell", hint: "Immer die helle Oberfläche." },
  { value: "dark", label: "Dunkel", hint: "Immer die dunkle Oberfläche." },
  { value: "system", label: "System", hint: "Folgt der Einstellung Ihres Geräts." },
];

/** Longest edge of a stored avatar. */
const AVATAR_PX = 256;
/** Mirrors AvatarService::MAX_BYTES in tds-auth-api. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

interface SessionRow {
  jti: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * Downscale in the browser before uploading.
 *
 * The production host has no guaranteed `ext-gd`, so the server validates and
 * stores rather than transforms. Doing it here means a 4 MB phone photo becomes
 * a ~30 KB square instead of a 413 the user has to solve with an image editor.
 * Falls back to the original file if anything about canvas/WebP is unavailable —
 * the server still enforces the real limit.
 */
async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Centre-crop to a square first, so a portrait is not squashed into the
    // circle the avatar renders as.
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX,
    );
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

function formatDate(value: string): string {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export default function ProfileSettings() {
  const [tab, setTab] = useState<Tab>("profil");
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [prefs, setPrefs] = useState<Preferences>({});
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [prefsUnavailable, setPrefsUnavailable] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsError, setSessionsError] = useState("");

  useEffect(() => {
    void (async () => {
      const principal = await fetchMe();
      if (!principal) {
        // The pre-paint gate handles a dead session; this is the "service
        // answered, but not with a principal" case, which is persistent state
        // rather than a transient outcome — so it is an in-flow alert.
        setLoadError("Ihr Profil konnte nicht geladen werden.");
        setLoading(false);
        return;
      }
      setMe(principal);
      setDisplayName(principal.displayName ?? "");
      setAvatarUrl(principal.avatarUrl ?? null);
      setHasAvatar(Boolean(principal.hasAvatar));
      setLoading(false);
    })();

    setTheme(readThemePreference());

    void loadPreferences().then((stored) => {
      setPrefs(stored);
      if (stored.theme) setTheme(stored.theme);
      // An empty result is indistinguishable from "nothing saved yet", so this
      // is not treated as an error — the panel keeps working off localStorage.
      setPrefsUnavailable(Object.keys(stored).length === 0);
    });
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await frontendFetch(`${AUTH_API_URL}/me/sessions`);
      if (!res.ok) {
        setSessionsError(`Sitzungen konnten nicht geladen werden (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { sessions?: SessionRow[] };
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
      setSessionsError("");
    } catch {
      setSessionsError("Sitzungen konnten nicht geladen werden (keine Verbindung).");
    }
  }, []);

  useEffect(() => {
    if (tab === "sicherheit") void loadSessions();
  }, [tab, loadSessions]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const res = await frontendFetch(`${AUTH_API_URL}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      // Never await a mutation and drop the response.
      if (!res.ok) {
        toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      invalidateMe();
      toast.success("Profil gespeichert.");
    } catch {
      toast.danger("Speichern fehlgeschlagen (keine Verbindung).");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    try {
      const blob = await downscale(file);
      if (blob.size > MAX_UPLOAD_BYTES) {
        toast.warning("Das Bild ist zu groß (maximal 2 MB).");
        return;
      }
      const form = new FormData();
      form.append("file", blob, "avatar.webp");
      const res = await frontendFetch(`${AUTH_API_URL}/me/avatar`, { method: "POST", body: form });
      if (!res.ok) {
        toast.danger(`Bild konnte nicht gespeichert werden (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { avatarUrl?: string };
      setAvatarUrl(body.avatarUrl ?? null);
      setHasAvatar(true);
      invalidateMe();
      toast.success("Profilbild aktualisiert.");
    } catch {
      toast.danger("Bild konnte nicht gespeichert werden (keine Verbindung).");
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      const res = await frontendFetch(`${AUTH_API_URL}/me/avatar`, { method: "DELETE" });
      if (!res.ok) {
        toast.danger(`Bild konnte nicht entfernt werden (HTTP ${res.status}).`);
        return;
      }
      setAvatarUrl(null);
      setHasAvatar(false);
      invalidateMe();
      toast.success("Profilbild entfernt.");
    } catch {
      toast.danger("Bild konnte nicht entfernt werden (keine Verbindung).");
    } finally {
      setAvatarBusy(false);
    }
  }

  function pickTheme(next: ThemePreference) {
    setTheme(next);
    // The single write path: this stores it, paints it and raises
    // `tds:theme-change`, which the shell's preferences sync turns into a save.
    // Doing the PUT here as well would double every write.
    applyThemePreference(next);
  }

  async function persist(patch: Preferences, message: string) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const res = await savePreferences(patch);
    if (res && !res.ok) {
      toast.danger(`${message} fehlgeschlagen (HTTP ${res.status}).`);
      return;
    }
    if (!res) {
      toast.danger(`${message} fehlgeschlagen (keine Verbindung).`);
      return;
    }
    toast.success("Gespeichert.");
  }

  async function revokeSession(jti: string, current: boolean) {
    try {
      const res = await frontendFetch(`${AUTH_API_URL}/me/sessions/${encodeURIComponent(jti)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.danger(`Sitzung konnte nicht beendet werden (HTTP ${res.status}).`);
        return;
      }
      if (current) {
        // Ending your own session from the list IS logging out; the panel's
        // 401 backstop would get there eventually, but bouncing immediately is
        // what the user just asked for.
        location.replace(LOGIN_URL);
        return;
      }
      toast.success("Sitzung beendet.");
      void loadSessions();
    } catch {
      toast.danger("Sitzung konnte nicht beendet werden (keine Verbindung).");
    }
  }

  if (loading) {
    return (
      <div className="tds-card" style={{ padding: "1.5rem" }}>
        <Spinner size="lg" tone="primary" />
      </div>
    );
  }

  if (loadError || !me) {
    return <p className="tds-alert tds-alert--danger" role="alert">{loadError || "Profil nicht verfügbar."}</p>;
  }

  const label = me.label ?? me.name ?? me.email;
  const nextParam = encodeURIComponent(typeof location !== "undefined" ? location.href : "");

  return (
    <div className="flex flex-col gap-4">
      <div className="tds-toolbar" role="tablist" aria-label="Bereiche">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`chip ${tab === t.id ? "chip--info" : "chip--neutral"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profil" && (
        <div className="tds-card" style={{ padding: "1.25rem" }}>
          <div className="tds-row" style={{ alignItems: "center", gap: "1rem" }}>
            <Avatar name={label} src={hasAvatar ? avatarUrl : null} seed={me.userId} size="lg" decorative />
            <div className="flex flex-col gap-2">
              <div className="tds-row" style={{ gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={avatarBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {avatarBusy ? <Spinner size="sm" /> : "Bild auswählen"}
                </button>
                {hasAvatar && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={avatarBusy}
                    onClick={() => void removeAvatar()}
                  >
                    Entfernen
                  </button>
                )}
              </div>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                PNG, JPEG oder WebP, maximal 2 MB. Das Bild wird vor dem Hochladen
                automatisch auf {AVATAR_PX}×{AVATAR_PX} Pixel verkleinert.
              </p>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />

          <hr className="tds-dropdown__sep" style={{ margin: "1.25rem 0" }} />

          <form className="flex flex-col gap-4" onSubmit={saveProfile}>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Anzeigename</span>
              <input
                className="field-boxed"
                value={displayName}
                maxLength={100}
                placeholder={me.name ?? me.email}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                So werden Sie in der Oberfläche angesprochen. Leer lassen, um
                „{me.name ?? me.email}" zu verwenden.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Name</span>
              <input className="field-boxed" value={me.name ?? ""} readOnly disabled />
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Der Name Ihres Kontos. Änderungen nimmt die Benutzerverwaltung vor.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">E-Mail</span>
              <input className="field-boxed" value={me.email} readOnly disabled />
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Ihre Anmeldeadresse. Änderungen nimmt die Benutzerverwaltung vor.
              </span>
            </label>

            <div className="tds-toolbar">
              <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                {savingProfile ? <Spinner size="sm" /> : "Speichern"}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "darstellung" && (
        <div className="tds-card" style={{ padding: "1.25rem" }}>
          {prefsUnavailable && (
            <p className="tds-alert" role="status">
              Einstellungen werden derzeit nur auf diesem Gerät gespeichert.
            </p>
          )}

          <fieldset className="flex flex-col gap-2" style={{ marginTop: "0.75rem" }}>
            <legend className="text-sm font-medium">Erscheinungsbild</legend>
            {THEME_OPTIONS.map((option) => (
              <label key={option.value} className="tds-list__row" style={{ gap: "0.625rem" }}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === option.value}
                  onChange={() => pickTheme(option.value)}
                />
                <span className="flex flex-col">
                  <span className="text-sm">{option.label}</span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <hr className="tds-dropdown__sep" style={{ margin: "1.25rem 0" }} />

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Sprache</span>
            <select
              className="field-boxed"
              value={prefs.locale ?? "de"}
              onChange={(e) => void persist({ locale: e.target.value as "de" | "en" }, "Sprache speichern")}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              Gilt für Hinweise und den Support-Chat. Die Menüs und Seiten der
              Verwaltung sind derzeit ausschließlich auf Deutsch.
            </span>
          </label>
        </div>
      )}

      {tab === "benachrichtigungen" && (
        <div className="tds-card" style={{ padding: "1.25rem" }}>
          <div className="flex flex-col gap-3">
            <label className="tds-list__row" style={{ gap: "0.625rem" }}>
              <input
                type="checkbox"
                checked={(prefs.notify_toast ?? "1") === "1"}
                onChange={(e) =>
                  void persist(
                    { notify_toast: e.target.checked ? "1" : "0" },
                    "Einstellung speichern",
                  )
                }
              />
              <span className="flex flex-col">
                <span className="text-sm">Hinweise in der Oberfläche</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Kurze Einblendungen, wenn etwas Neues eintrifft.
                </span>
              </span>
            </label>

            <label className="tds-list__row" style={{ gap: "0.625rem" }}>
              <input
                type="checkbox"
                checked={(prefs.notify_email ?? "1") === "1"}
                onChange={(e) =>
                  void persist(
                    { notify_email: e.target.checked ? "1" : "0" },
                    "Einstellung speichern",
                  )
                }
              />
              <span className="flex flex-col">
                <span className="text-sm">E-Mail-Benachrichtigungen</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Nachrichten zu Vorgängen, die Sie betreffen.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {tab === "sicherheit" && (
        <div className="flex flex-col gap-4">
          <div className="tds-card" style={{ padding: "1.25rem" }}>
            <h2 className="text-sm font-medium">Anmeldung</h2>
            <p className="text-xs" style={{ color: "var(--color-muted)", marginTop: "0.25rem" }}>
              Passwort und Passkeys werden zentral bei der Anmeldung verwaltet.
            </p>
            <div className="tds-toolbar" style={{ marginTop: "0.75rem" }}>
              <a className="btn btn-secondary" href={`${LOGIN_URL}/passwort?next=${nextParam}`}>
                Passwort ändern
              </a>
              <a className="btn btn-ghost" href={`${LOGIN_URL}/passkeys?next=${nextParam}`}>
                Passkeys verwalten
              </a>
            </div>
          </div>

          <div className="tds-card" style={{ padding: "1.25rem" }}>
            <h2 className="text-sm font-medium">Aktive Sitzungen</h2>
            {sessionsError && <FormAlert message={sessionsError} />}
            {!sessionsError && sessions.length === 0 && (
              <p className="tds-empty">Keine weiteren Sitzungen.</p>
            )}
            {sessions.length > 0 && (
              <ul className="tds-list" style={{ marginTop: "0.5rem" }}>
                {sessions.map((session) => (
                  <li key={session.jti} className="tds-list__row">
                    <span className="flex flex-col">
                      <span className="text-sm">
                        Angemeldet seit {formatDate(session.createdAt)}
                        {session.current && (
                          <span className="chip chip--info" style={{ marginLeft: "0.5rem" }}>
                            Dieses Gerät
                          </span>
                        )}
                      </span>
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                        Gültig bis {formatDate(session.expiresAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void revokeSession(session.jti, session.current)}
                    >
                      {session.current ? "Abmelden" : "Beenden"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
