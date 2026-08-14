import { useEffect, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

interface Masked {
  key: string;
  secret: boolean;
  configured?: boolean;
  last4?: string | null;
  value?: string;
}

interface MailStatus {
  configured: boolean;
  source: "db" | "env" | "none";
  host: string;
  port: number;
  security: string;
  user: string;
  password_configured: boolean;
  from_email: string;
  from_name: string;
}

const NS = `${API_BASE}/admin/settings/mail`;
const STATUS = `${API_BASE}/admin/mail`;
const TEST = `${API_BASE}/admin/mail/test`;

/** Coded defaults, mirrored from the API's `MailConfig`. */
const DEFAULTS = {
  port: "587",
  security: "tls",
  from_email: "no-reply@tracht-digital.de",
  from_name: "Tracht Digital Solutions",
} as const;

/**
 * *E-Mail (SMTP)* — the base's own settings section for the one transport every
 * composed module sends through (Ticket-Benachrichtigungen, Kontakt-Antworten,
 * Live-Chat-Mails …).
 *
 * Two reads, because they answer different questions: the settings namespace
 * holds what is *stored* (and is what this form edits), while `GET /admin/mail`
 * reports what actually *sends* — including a transport that comes from the
 * host's `MAIL_DSN`. Showing only the former would present an empty form on a
 * host that mails perfectly well, and the first "fix" would overwrite a working
 * transport.
 *
 * The password is a secret: it comes back masked and a blank field on save keeps
 * the stored value, so it never round-trips through the browser.
 *
 * The test button exists because saving is not sending. SMTP fails on things no
 * form can validate (wrong port, refused relay, bad credentials), and the
 * modules that use the mailer send on events an admin cannot trigger at will —
 * without this, the first proof that mail works would be a customer not getting
 * one. Its failure is rendered IN FLOW, not as a toast: the SMTP server's reply
 * is diagnostic text to read, not a passing notice.
 */
export default function MailSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState<string>(DEFAULTS.port);
  const [security, setSecurity] = useState<string>(DEFAULTS.security);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [passwordState, setPasswordState] = useState<Masked | null>(null);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [dsn, setDsn] = useState("");
  const [dsnState, setDsnState] = useState<Masked | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        frontendFetch(NS),
        frontendFetch(STATUS),
      ]);
      if (!settingsRes.ok) {
        setError(
          settingsRes.status === 401 || settingsRes.status === 403
            ? "Nur für Administratoren."
            : `Einstellungen konnten nicht geladen werden (HTTP ${settingsRes.status}).`,
        );
        setLoaded(true);
        return;
      }
      const data = (await settingsRes.json()) as { settings?: Masked[] };
      const map = new Map<string, Masked>((data.settings ?? []).map((s) => [s.key, s]));
      setHost(map.get("host")?.value ?? "");
      setPort(map.get("port")?.value || DEFAULTS.port);
      setSecurity(map.get("security")?.value || DEFAULTS.security);
      setUser(map.get("user")?.value ?? "");
      setPasswordState(map.get("password") ?? null);
      setFromEmail(map.get("from_email")?.value ?? "");
      setFromName(map.get("from_name")?.value ?? "");
      setDsnState(map.get("dsn") ?? null);
      setStatus(statusRes.ok ? ((await statusRes.json()) as MailStatus) : null);
      setError(null);
    } catch {
      setError("Einstellungen konnten nicht geladen werden — die API ist nicht erreichbar.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const res = await frontendFetch(NS, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [
            { key: "host", secret: false, value: host.trim() },
            { key: "port", secret: false, value: port.trim() },
            { key: "security", secret: false, value: security },
            { key: "user", secret: false, value: user.trim() },
            { key: "password", secret: true, value: password },
            { key: "from_email", secret: false, value: fromEmail.trim() },
            { key: "from_name", secret: false, value: fromName.trim() },
            { key: "dsn", secret: true, value: dsn.trim() },
          ],
        }),
      });
      if (res.ok) {
        setPassword("");
        setDsn("");
        toast.success("Gespeichert.");
        void load();
      } else {
        toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
      }
    } catch {
      toast.danger("Speichern fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const res = await frontendFetch(TEST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; to?: string; error?: string } | null;
      if (res.ok && data?.ok) {
        toast.success(`Testmail an ${data.to ?? "die eigene Adresse"} übergeben.`);
      } else {
        setTestError(
          data?.error
            ? `Versand fehlgeschlagen (HTTP ${res.status}): ${data.error}`
            : `Versand fehlgeschlagen (HTTP ${res.status}).`,
        );
      }
    } catch {
      setTestError("Versand fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setTesting(false);
    }
  };

  const passwordHint = passwordState?.configured
    ? `hinterlegt (…${passwordState.last4 ?? "????"})`
    : "nicht hinterlegt";
  const dsnHint = dsnState?.configured ? `hinterlegt (…${dsnState.last4 ?? "????"})` : "nicht gesetzt";

  const sourceLabel = (): { text: string; variant: "success" | "warning" | "danger" } => {
    if (!status) return { text: "Status unbekannt", variant: "warning" };
    if (!status.configured) return { text: "Kein Versand konfiguriert", variant: "danger" };
    return status.source === "env"
      ? { text: "Aktiv über MAIL_DSN aus der .env des Hosts", variant: "warning" }
      : { text: "Aktiv über diese Einstellungen", variant: "success" };
  };

  if (!loaded) return <Spinner />;

  const state = sourceLabel();

  return (
    <div className="tds-settings-section__body tds-stack">
      <FormAlert message={error} />

      <p className="tds-row">
        <span className={`status-pill status-pill--${state.variant}`}>{state.text}</span>
        {status?.configured ? (
          <span className="marginalia">
            Absender: {status.from_name} &lt;{status.from_email}&gt;
          </span>
        ) : null}
      </p>

      {status?.source === "env" ? (
        <p className="marginalia">
          Der Versand läuft derzeit über die <code>MAIL_DSN</code> auf dem Host. Sobald hier ein
          Server eingetragen und gespeichert ist, gilt diese Einstellung — die <code>.env</code>
          bleibt nur noch Rückfallebene.
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">SMTP-Server</span>
          <input
            className="field-boxed"
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.example.net"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-sm">Port</span>
          <input
            className="field-boxed"
            type="number"
            min="1"
            max="65535"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={DEFAULTS.port}
          />
        </label>
        <label className="block">
          <span className="text-sm">Verschlüsselung</span>
          <select
            className="field-boxed"
            value={security}
            onChange={(e) => setSecurity(e.target.value)}
          >
            <option value="tls">STARTTLS (Port 587)</option>
            <option value="ssl">SSL/TLS (Port 465)</option>
            <option value="none">Keine</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Benutzername</span>
          <input
            className="field-boxed"
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="no-reply@example.net"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm">
          Passwort <em className="opacity-60">({passwordHint})</em>
        </span>
        <input
          className="field-boxed"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="leer = bestehendes Passwort behalten"
          autoComplete="new-password"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Absenderadresse</span>
          <input
            className="field-boxed"
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder={DEFAULTS.from_email}
          />
        </label>
        <label className="block">
          <span className="text-sm">Absendername</span>
          <input
            className="field-boxed"
            type="text"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder={DEFAULTS.from_name}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm">
          Eigener DSN <em className="opacity-60">({dsnHint})</em>
        </span>
        <input
          className="field-boxed"
          type="password"
          value={dsn}
          onChange={(e) => setDsn(e.target.value)}
          placeholder="optional, z. B. sendmail://default"
          autoComplete="off"
        />
      </label>

      <p className="marginalia">
        Ein eigener DSN übersteuert die Felder oben und ist nur für Transporte gedacht, die das
        Formular nicht abbildet. Er kann das Passwort enthalten und wird deshalb wie ein Geheimnis
        behandelt.
      </p>

      <div className="tds-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner size="sm" /> : "Speichern"}
        </button>
      </div>

      <hr />

      <h3 className="text-sm">Testmail</h3>
      <FormAlert message={testError} />
      <div className="tds-toolbar">
        <label className="block">
          <span className="text-sm">Empfänger</span>
          <input
            className="field-boxed"
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="leer = eigene Adresse"
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void sendTest()}
          disabled={testing || !status?.configured}
        >
          {testing ? <Spinner size="sm" /> : "Testmail senden"}
        </button>
      </div>
      <p className="marginalia">
        Der Test verwendet die <strong>gespeicherte</strong> Konfiguration — vorher speichern.
        Erfolg heißt: der SMTP-Server hat die Mail angenommen.
      </p>
    </div>
  );
}
