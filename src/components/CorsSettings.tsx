import { useEffect, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

type Source = "baseline" | "env" | "db";

interface OriginRow {
  origin: string;
  source: Source;
}

interface CorsStatus {
  origins: OriginRow[];
  custom: string[];
  store_available: boolean;
}

interface Rejected {
  value: string;
  reason: string;
}

const ENDPOINT = `${API_BASE}/admin/cors`;

const SOURCE_LABEL: Record<Source, string> = {
  baseline: "fest eingebaut",
  env: ".env des Hosts",
  db: "hier gepflegt",
};

const SOURCE_VARIANT: Record<Source, string> = {
  baseline: "chip--neutral",
  env: "chip--warning",
  db: "chip--info",
};

/**
 * *CORS / Freigegebene Origins* — which browser origins may call this API.
 *
 * It used to live only in `CORS_ALLOWED_ORIGINS` on the host, editable by
 * opening a file over SSH on a host whose whole install model is "ohne SSH".
 * So in practice the list was whatever the installer wrote once, and adding a
 * customer domain or a staging host was not something anybody could do.
 *
 * Two things this form has to make visible, because getting either wrong is
 * silent:
 *
 * The LAYER each origin comes from. The list is a union of a coded baseline,
 * the host's `.env` and the rows edited here — a union, not an override, so
 * that nothing saved in a browser can remove the origin that browser is
 * running on. Without the layer shown, the entries that cannot be deleted look
 * like a bug.
 *
 * And the REJECTS. The server compares an exact string, so `https://kunde.de/`
 * — the standard paste error — unblocks nothing, forever, with no error
 * anywhere. The API normalises what it can and hands back what it could not;
 * that list is rendered IN FLOW rather than as a toast, because it is text to
 * read and act on, not a passing notice.
 */
export default function CorsSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CorsStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await frontendFetch(ENDPOINT);
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Nur für Administratoren."
            : `Origins konnten nicht geladen werden (HTTP ${res.status}).`,
        );
        setLoaded(true);
        return;
      }
      const data = (await res.json()) as CorsStatus;
      setStatus(data);
      setDraft((data.custom ?? []).join("\n"));
      setError(null);
    } catch {
      setError("Origins konnten nicht geladen werden — die API ist nicht erreichbar.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setRejected([]);
    try {
      const res = await frontendFetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: draft }),
      });
      const data = (await res.json().catch(() => null)) as
        | (CorsStatus & { ok?: boolean; saved?: string[]; rejected?: Rejected[]; error?: string })
        | null;

      if (!res.ok || !data?.ok) {
        toast.danger(
          data?.error
            ? `Speichern fehlgeschlagen (HTTP ${res.status}): ${data.error}`
            : `Speichern fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }

      setStatus(data);
      setDraft((data.saved ?? []).join("\n"));
      setRejected(data.rejected ?? []);
      if ((data.rejected ?? []).length > 0) {
        toast.warning("Gespeichert — einzelne Einträge wurden abgelehnt.");
      } else {
        toast.success("Gespeichert.");
      }
    } catch {
      toast.danger("Speichern fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Spinner />;

  return (
    <div className="tds-settings-section__body tds-stack">
      <FormAlert message={error} />

      {status && !status.store_available ? (
        <p className="tds-alert tds-alert--warning">
          Noch keine Datenbank konfiguriert — es gelten nur die fest eingebauten Origins und die{" "}
          <code>.env</code> des Hosts. Eigene Einträge lassen sich erst danach speichern.
        </p>
      ) : null}

      <p className="marginalia">
        Nur Browser-Anfragen von diesen Herkünften dürfen die API lesen. Die fest eingebauten
        Adressen der eigenen Seiten lassen sich nicht entfernen — sonst könnte eine Änderung hier
        genau die Oberfläche aussperren, die sie zurücknehmen müsste.
      </p>

      {status ? (
        <ul className="tds-list">
          {status.origins.map((row) => (
            <li className="tds-list__row" key={`${row.source}-${row.origin}`}>
              <code>{row.origin}</code>
              <span className={`chip ${SOURCE_VARIANT[row.source]}`}>{SOURCE_LABEL[row.source]}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="block">
        <span className="text-sm">Zusätzliche Origins (eine pro Zeile)</span>
        <textarea
          className="field-boxed"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"https://kunde.example\nhttp://localhost:4321"}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <p className="marginalia">
        Schema, Host und gegebenenfalls Port — kein Pfad und kein Schrägstrich am Ende
        (<code>https://kunde.example</code>, nicht <code>https://kunde.example/</code>). Verglichen
        wird exakt, ein knapp danebenliegender Eintrag gibt also dauerhaft nichts frei. Ein
        <code> *</code> ist nicht möglich: zusammen mit Sitzungs-Cookies verbietet der Standard den
        Platzhalter.
      </p>

      {rejected.length > 0 ? (
        <div className="tds-alert tds-alert--warning">
          <p>Diese Einträge wurden nicht übernommen:</p>
          <ul>
            {rejected.map((entry) => (
              <li key={entry.value}>
                <code>{entry.value}</code> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="tds-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner size="sm" /> : "Speichern"}
        </button>
      </div>

      <p className="marginalia">
        Die Änderung gilt sofort für die nächste Anfrage — ein neues Deployment ist nicht nötig.
      </p>
    </div>
  );
}
