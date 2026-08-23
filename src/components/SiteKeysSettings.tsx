import { useEffect, useMemo, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

type CorsSource = "baseline" | "env" | "db";
type Mode = "off" | "warn" | "enforce";

interface OriginRow {
  origin: string;
  cors: CorsSource | null;
}

interface KeyRow {
  id: number;
  site: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  last_used_origin: string | null;
  last_used_api_base: string | null;
  revoked_at: string | null;
}

interface SiteRow {
  id: string;
  label: string;
  known: boolean;
  origins: OriginRow[];
  keys: KeyRow[];
}

interface SitesStatus {
  sites: SiteRow[];
  enforcement: Mode;
  modes: Mode[];
  protected_routes: string[];
  unkeyed: {
    count: number;
    first_at: string | null;
    last_at: string | null;
    last_path: string | null;
    last_origin: string | null;
  };
  store_available: boolean;
}

interface Rejected {
  value: string;
  reason: string;
}

const ENDPOINT = `${API_BASE}/admin/sites`;
const CORS_ENDPOINT = `${API_BASE}/admin/cors`;

const CORS_LABEL: Record<CorsSource, string> = {
  baseline: "freigegeben",
  env: "freigegeben (.env)",
  db: "freigegeben (hier)",
};

const MODE_LABEL: Record<Mode, string> = {
  off: "Aus",
  warn: "Nur beobachten",
  enforce: "Erzwingen",
};

const MODE_HINT: Record<Mode, string> = {
  off: "Die öffentlichen Lese-Routen sind frei zugänglich. Keys werden trotzdem vermerkt, sobald eine Site einen mitschickt.",
  warn: "Wird weiterhin ausgeliefert, Zugriffe ohne Key werden aber gezählt. Der Weg dazwischen: erst sehen, wer noch keinen Key hat.",
  enforce: "Ohne gültigen Key antwortet die API mit 401. Erst umschalten, wenn jede Site ihren Key im Build hinterlegt hat.",
};

/** "vor 4 Minuten" — a timestamp alone does not answer "is this site alive". */
function relative(value: string | null): string {
  if (value === null || value === "") return "noch nie";
  // The API sends MySQL DATETIME in UTC; Safari refuses "YYYY-MM-DD HH:MM:SS".
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;

  const seconds = Math.round((Date.now() - parsed) / 1000);
  if (seconds < 90) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `vor ${minutes} Minuten`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `vor ${hours} Stunden`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

/**
 * *Site-Verbindungen* — which public site is connected to this API, and the key
 * that proves it.
 *
 * Until this existed there was no such notion anywhere: the CORS list knew
 * origins but no sites, `cms_site` and `blog` knew sites but no origins, the
 * tools extension had one global token, and the four public origins were
 * enumerated only inside a frontend bundle the API could never see. Nothing
 * reported that a site had ever talked to the API — and because every
 * build-time content fetch is fail-soft, a site pointed at the wrong host
 * rendered its baked fallbacks and looked perfectly healthy.
 *
 * Three things this form has to make visible, because each is silent otherwise:
 *
 * **The plaintext key, exactly once.** Only a hash is stored, so it cannot be
 * shown again. It is rendered in flow, never as a toast — a value the reader
 * has to copy must not sit in something that disappears on a timer.
 *
 * **Whether the origin is allowed at all.** A key is useless to a site whose
 * origin CORS rejects, and the two settings live in different sections. The
 * chip says which, and the button fixes it without leaving the page.
 *
 * **What enforcing would break.** `off` → `enforce` in one step breaks whatever
 * site was forgotten, in production, invisibly. The `warn` counter is what
 * turns that into a number before it turns into an outage.
 */
export default function SiteKeysSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SitesStatus | null>(null);
  const [issued, setIssued] = useState<{ site: string; key: string } | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await frontendFetch(ENDPOINT);
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Nur für Administratoren."
            : `Site-Verbindungen konnten nicht geladen werden (HTTP ${res.status}).`,
        );
        setLoaded(true);
        return;
      }
      const data = (await res.json()) as SitesStatus;
      setStatus(data);
      setCustomDraft(
        data.sites
          .filter((site) => !site.known)
          .map((site) => `${site.id} | ${site.label} | ${site.origins.map((o) => o.origin).join(" ")}`)
          .join("\n"),
      );
      setError(null);
    } catch {
      setError("Site-Verbindungen konnten nicht geladen werden — die API ist nicht erreichbar.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createKey = async (site: SiteRow) => {
    setBusy(`create-${site.id}`);
    try {
      const res = await frontendFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: site.id, label: site.label }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; key?: string; error?: string }
        | null;
      // Never await a mutation and drop the response: a 403 would otherwise
      // close nothing, report nothing, and leave the operator waiting for a key.
      if (!res.ok || !data?.ok || typeof data.key !== "string") {
        toast.danger(
          data?.error
            ? `Key konnte nicht erzeugt werden (HTTP ${res.status}): ${data.error}`
            : `Key konnte nicht erzeugt werden (HTTP ${res.status}).`,
        );
        return;
      }
      setIssued({ site: site.id, key: data.key });
      await load();
    } catch {
      toast.danger("Key konnte nicht erzeugt werden — die API ist nicht erreichbar.");
    } finally {
      setBusy(null);
    }
  };

  const revokeKey = async (row: KeyRow) => {
    setBusy(`revoke-${row.id}`);
    try {
      const res = await frontendFetch(`${ENDPOINT}/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.danger(`Widerruf fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      if (issued !== null && issued.key.startsWith(row.key_prefix)) setIssued(null);
      toast.success("Key widerrufen.");
      await load();
    } catch {
      toast.danger("Widerruf fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setBusy(null);
    }
  };

  const savePolicy = async (body: Record<string, unknown>, okMessage: string) => {
    setBusy("policy");
    setRejected([]);
    try {
      const res = await frontendFetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; rejected?: Rejected[]; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.danger(
          data?.error
            ? `Speichern fehlgeschlagen (HTTP ${res.status}): ${data.error}`
            : `Speichern fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      setRejected(data.rejected ?? []);
      if ((data.rejected ?? []).length > 0) {
        toast.warning("Gespeichert — einzelne Einträge wurden abgelehnt.");
      } else {
        toast.success(okMessage);
      }
      await load();
    } catch {
      toast.danger("Speichern fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Add one origin to the CORS allow-list without leaving the page.
   *
   * Deliberately a button and not an automatism: the CORS list is the one thing
   * an admin can edit that could cut the panel off from the API, so every entry
   * stays a decision somebody made. It reuses PUT /admin/cors and resends the
   * existing custom entries — that route stores the whole custom layer, so
   * sending only the new origin would delete the others.
   */
  const allowOrigin = async (origin: string) => {
    setBusy(`cors-${origin}`);
    try {
      const current = await frontendFetch(CORS_ENDPOINT);
      const currentData = (await current.json().catch(() => null)) as { custom?: string[] } | null;
      if (!current.ok || currentData === null) {
        toast.danger(`Origin konnte nicht freigegeben werden (HTTP ${current.status}).`);
        return;
      }
      const next = [...(currentData.custom ?? []), origin];
      const res = await frontendFetch(CORS_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: next }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        toast.danger(
          data?.error
            ? `Origin konnte nicht freigegeben werden (HTTP ${res.status}): ${data.error}`
            : `Origin konnte nicht freigegeben werden (HTTP ${res.status}).`,
        );
        return;
      }
      toast.success("Origin freigegeben.");
      await load();
    } catch {
      toast.danger("Origin konnte nicht freigegeben werden — die API ist nicht erreichbar.");
    } finally {
      setBusy(null);
    }
  };

  const saveCustomSites = () => {
    // One site per line: `kennung | Name | origin origin`. A table would be
    // nicer and would also be a second editor to keep in sync; this is the
    // same textarea shape the CORS section already teaches.
    const sites = customDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => {
        const [id = "", label = "", origins = ""] = line.split("|").map((part) => part.trim());
        return { id, label, origins };
      });
    void savePolicy({ sites }, "Gespeichert.");
  };

  const activeKeys = useMemo(
    () => (status?.sites ?? []).reduce((n, site) => n + site.keys.filter((k) => k.revoked_at === null).length, 0),
    [status],
  );

  if (!loaded) return <Spinner />;

  return (
    <div className="tds-settings-section__body tds-stack">
      <FormAlert message={error} />

      {status && !status.store_available ? (
        <p className="tds-alert tds-alert--warning">
          Noch keine Datenbank konfiguriert — Site-Keys lassen sich erst danach erzeugen. Die
          öffentlichen Lese-Routen bleiben so lange frei zugänglich.
        </p>
      ) : null}

      <p className="marginalia">
        Ein Site-Key verbindet eine öffentliche Seite mit dieser API. Er wird hier erzeugt, im{" "}
        <code>/install</code>-Assistenten der Seite einmalig eingegeben und als{" "}
        <code>TDS_SITE_KEY</code> im Build hinterlegt. Danach zeigt diese Seite, wann sich die
        Seite zuletzt gemeldet hat — bisher gab es dafür keinerlei Nachweis.
      </p>

      {issued !== null ? (
        <div className="tds-alert tds-alert--success">
          <p>
            Neuer Key für <strong>{issued.site}</strong>. Er wird <strong>nur jetzt</strong>{" "}
            angezeigt — gespeichert ist ausschließlich seine Prüfsumme.
          </p>
          <p>
            <code>{issued.key}</code>
          </p>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.key);
              toast.success("In die Zwischenablage kopiert.");
            }}
          >
            Kopieren
          </button>
        </div>
      ) : null}

      {(status?.sites ?? []).map((site) => (
        <div className="tds-card tds-stack" key={site.id}>
          <div className="tds-row">
            <strong>{site.label}</strong>
            <code>{site.id}</code>
            {!site.known ? <span className="chip chip--neutral">eigene Site</span> : null}
          </div>

          <ul className="tds-list">
            {site.origins.length === 0 ? (
              <li className="tds-list__row">
                <span className="marginalia">Keine Origin hinterlegt.</span>
              </li>
            ) : null}
            {site.origins.map((row) => (
              <li className="tds-list__row" key={row.origin}>
                <code>{row.origin}</code>
                {row.cors === null ? (
                  <>
                    <span className="chip chip--warning">nicht freigegeben</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void allowOrigin(row.origin)}
                      disabled={busy !== null}
                    >
                      {busy === `cors-${row.origin}` ? <Spinner size="sm" /> : "Origin freigeben"}
                    </button>
                  </>
                ) : (
                  <span className="chip chip--success">{CORS_LABEL[row.cors]}</span>
                )}
              </li>
            ))}
          </ul>

          <ul className="tds-list">
            {site.keys.length === 0 ? (
              <li className="tds-list__row">
                <span className="marginalia">Noch kein Key erzeugt.</span>
              </li>
            ) : null}
            {site.keys.map((row) => (
              <li className="tds-list__row" key={row.id}>
                <code>{row.key_prefix}…</code>
                {row.revoked_at !== null ? (
                  <span className="chip chip--neutral">widerrufen</span>
                ) : (
                  <span className="chip chip--info">zuletzt gesehen {relative(row.last_used_at)}</span>
                )}
                {row.last_used_api_base !== null ? <code>{row.last_used_api_base}</code> : null}
                {row.revoked_at === null ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void revokeKey(row)}
                    disabled={busy !== null}
                  >
                    {busy === `revoke-${row.id}` ? <Spinner size="sm" /> : "Widerrufen"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="tds-toolbar">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void createKey(site)}
              disabled={busy !== null || (status?.store_available ?? false) === false}
            >
              {busy === `create-${site.id}` ? <Spinner size="sm" /> : "Key erzeugen"}
            </button>
          </div>
        </div>
      ))}

      <label className="block">
        <span className="text-sm">Eigene Sites (eine pro Zeile)</span>
        <textarea
          className="field field-boxed"
          rows={3}
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          placeholder={"kunde-a | Kunde A | https://kunde-a.example"}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <p className="marginalia">
        Aufbau: <code>kennung | Name | origin origin</code>. Die vier festen Seiten stehen bereits
        oben und lassen sich hier nicht überschreiben — sonst würde die eingebaute Origin durch
        eine getippte ersetzt und die Freigabe-Auskunft dieser Seite wäre überzeugend falsch.
      </p>

      {rejected.length > 0 ? (
        <div className="tds-alert tds-alert--warning">
          <p>Diese Einträge wurden nicht übernommen:</p>
          <ul>
            {rejected.map((entry) => (
              <li key={`${entry.value}-${entry.reason}`}>
                <code>{entry.value}</code> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="tds-toolbar">
        <button type="button" className="btn btn-ghost" onClick={saveCustomSites} disabled={busy !== null}>
          {busy === "policy" ? <Spinner size="sm" /> : "Eigene Sites speichern"}
        </button>
      </div>

      <hr className="rule" />

      <label className="block">
        <span className="text-sm">Zugriff ohne Key</span>
        <select
          className="field field-boxed"
          value={status?.enforcement ?? "off"}
          onChange={(e) => void savePolicy({ enforcement: e.target.value }, "Modus gespeichert.")}
          disabled={busy !== null}
        >
          {(status?.modes ?? ["off", "warn", "enforce"]).map((mode) => (
            <option value={mode} key={mode}>
              {MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </label>

      <p className="marginalia">{MODE_HINT[status?.enforcement ?? "off"]}</p>

      {(status?.protected_routes ?? []).length > 0 ? (
        <p className="marginalia">
          Betroffen sind die von den Modulen gemeldeten Pfade:{" "}
          {(status?.protected_routes ?? []).map((route) => (
            <code key={route}>{route} </code>
          ))}
        </p>
      ) : (
        <p className="marginalia">
          Zurzeit meldet kein Modul geschützte Pfade — der Modus hat dann keine Wirkung.
        </p>
      )}

      {status && status.unkeyed.count > 0 ? (
        <div className="tds-alert tds-alert--warning">
          <p>
            {status.unkeyed.count} Zugriffe ohne Key seit {status.unkeyed.first_at ?? "unbekannt"}.
            {status.unkeyed.last_path !== null ? (
              <>
                {" "}
                Zuletzt <code>{status.unkeyed.last_path}</code>
                {status.unkeyed.last_origin ? ` von ${status.unkeyed.last_origin}` : ""}.
              </>
            ) : null}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void savePolicy({ reset_unkeyed: true }, "Zähler zurückgesetzt.")}
            disabled={busy !== null}
          >
            Zähler zurücksetzen
          </button>
        </div>
      ) : null}

      <p className="marginalia">
        {activeKeys === 0
          ? "Noch kein gültiger Key vergeben — „Erzwingen“ würde jeden Build der öffentlichen Seiten abweisen."
          : `${activeKeys} gültige Keys vergeben.`}
      </p>
    </div>
  );
}
