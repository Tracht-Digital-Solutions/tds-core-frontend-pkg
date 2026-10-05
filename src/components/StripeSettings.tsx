import { useEffect, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

interface Webhook {
  module: string;
  label: string;
  url: string;
  events: string[];
  secretNamespace: string;
  secretKey: string;
  secretConfigured: boolean;
}

interface StripeStatus {
  configured: boolean;
  source: "db" | "env" | "none";
  mode: "test" | "live" | null;
  last4: string | null;
  webhooks: Webhook[];
}

const NS = `${API_BASE}/admin/settings/stripe`;
const STATUS = `${API_BASE}/admin/stripe`;
const TEST = `${API_BASE}/admin/stripe/test`;

/**
 * *Zahlungen (Stripe)* — the platform's one Stripe account.
 *
 * Rechnungen, Premium-Tools and the Shop each kept their own key field, so the
 * same account had to be entered three times and nothing showed which module
 * actually charged through which key. The key is entered once here; a module
 * key, where one is set, still overrides it for that module only.
 *
 * The list below is the part an admin needs when setting up Stripe: every
 * webhook endpoint the composed modules expect, with the events to subscribe
 * and whether that endpoint's signing secret is stored. Without a secret a
 * module refuses every webhook — no payment is ever confirmed — and nothing
 * else in the panel would say so.
 *
 * "Verbindung testen" makes a read-only call (the balance), because saving a
 * key is not proof that it works, and the first real proof would otherwise be
 * a customer's failed payment.
 */
export default function StripeSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await frontendFetch(STATUS);
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Nur für Administratoren."
            : `Stripe-Status konnte nicht geladen werden (HTTP ${res.status}).`,
        );
        return;
      }
      setStatus((await res.json()) as StripeStatus);
      setError(null);
    } catch {
      setError("Stripe-Status konnte nicht geladen werden — die API ist nicht erreichbar.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (key.trim() === "") {
      toast.info("Kein neuer Schlüssel eingegeben — der bestehende bleibt.");
      return;
    }
    setBusy(true);
    try {
      const res = await frontendFetch(NS, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: [{ key: "secret_key", secret: true, value: key.trim() }] }),
      });
      if (res.ok) {
        setKey("");
        toast.success("Gespeichert.");
        void load();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.danger(data?.error ?? `Speichern fehlgeschlagen (HTTP ${res.status}).`);
      }
    } catch {
      toast.danger("Speichern fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const res = await frontendFetch(TEST, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; mode?: string; error?: string } | null;
      if (res.ok && data?.ok) {
        toast.success(`Verbindung steht (${data.mode === "live" ? "Live-Modus" : "Testmodus"}).`);
      } else {
        setTestError(
          data?.error ? `Test fehlgeschlagen (HTTP ${res.status}): ${data.error}` : `Test fehlgeschlagen (HTTP ${res.status}).`,
        );
      }
    } catch {
      setTestError("Test fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setTesting(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Adresse kopiert.");
    } catch {
      toast.info(text);
    }
  };

  if (!loaded) return <Spinner />;

  const state: { text: string; variant: "success" | "warning" | "danger" } = !status
    ? { text: "Status unbekannt", variant: "warning" }
    : !status.configured
      ? { text: "Kein Stripe-Konto verbunden", variant: "danger" }
      : status.source === "env"
        ? { text: "Aktiv über STRIPE_SECRET_KEY aus der .env des Hosts", variant: "warning" }
        : { text: "Aktiv über diese Einstellungen", variant: "success" };

  return (
    <div className="tds-settings-section__body tds-stack">
      <FormAlert message={error} />

      <p className="tds-row">
        <span className={`status-pill status-pill--${state.variant}`}>{state.text}</span>
        {status?.mode ? (
          <span className={`status-pill status-pill--${status.mode === "live" ? "success" : "warning"}`}>
            {status.mode === "live" ? "Live-Modus" : "Testmodus"}
          </span>
        ) : null}
        {status?.last4 ? <span className="marginalia">Schlüssel …{status.last4}</span> : null}
      </p>

      <label className="block">
        <span className="text-sm">Secret Key</span>
        <input
          className="field-boxed"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk_live_… oder rk_live_… (leer = bestehenden behalten)"
          autoComplete="off"
        />
      </label>
      <p className="marginalia">
        Gilt für Rechnungen, Premium-Tools und den Shop. Ein Modul mit eigenem Schlüssel in seinen
        Einstellungen nutzt weiterhin diesen. Ein eingeschränkter Schlüssel (<code>rk_</code>) mit
        Schreibrechten für Kunden, Rechnungen und Checkout genügt.
      </p>

      <div className="tds-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner size="sm" /> : "Speichern"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void test()}
          disabled={testing || !status?.configured}
        >
          {testing ? <Spinner size="sm" /> : "Verbindung testen"}
        </button>
      </div>
      <FormAlert message={testError} />

      <hr />

      <h3 className="text-sm">Webhooks</h3>
      {status && status.webhooks.length > 0 ? (
        <>
          <p className="marginalia">
            In Stripe unter <em>Entwickler → Webhooks</em> je Adresse einen Endpunkt mit den
            genannten Ereignissen anlegen und dessen Signing Secret (<code>whsec_…</code>) in den
            Einstellungen des Moduls eintragen.
          </p>
          <ul className="tds-stack" data-testid="stripe-webhooks">
            {status.webhooks.map((hook) => (
              <li key={hook.url} className="tds-card p-3">
                <p className="tds-row">
                  <strong>{hook.label}</strong>
                  <span className={`status-pill status-pill--${hook.secretConfigured ? "success" : "danger"}`}>
                    {hook.secretConfigured ? "Signing Secret hinterlegt" : "Signing Secret fehlt"}
                  </span>
                </p>
                <p className="tds-row">
                  <code className="break-all">{hook.url}</code>
                  <button type="button" className="btn btn-ghost" onClick={() => void copy(hook.url)}>
                    Kopieren
                  </button>
                </p>
                <p className="marginalia">Ereignisse: {hook.events.join(", ")}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="marginalia">Kein Modul mit Stripe-Zahlungen aktiv.</p>
      )}
    </div>
  );
}
