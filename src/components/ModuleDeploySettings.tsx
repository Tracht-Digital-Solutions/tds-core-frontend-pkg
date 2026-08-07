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

const NS = `${API_BASE}/admin/settings/modules`;

/** Coded defaults, mirrored from the API's `ModuleUpdateConfig::KEYS`. */
const DEFAULTS = {
  frontend_workflow: "release.yml",
  backend_repo: "Tracht-Digital-Solutions/tds-gateway-api",
  backend_workflow: "release.yml",
  ref: "main",
  auto_update_interval: "24",
} as const;

/**
 * *Module & Deployment* — the base's own settings section, wiring the Module
 * page to GitHub.
 *
 * Two tokens because two different scopes are involved: reading published
 * versions needs `read:packages`, starting a pipeline needs `workflow`. One PAT
 * usually carries both, which is why the deploy token may be left blank — the
 * API then reuses the registry token rather than asking for the same secret
 * twice.
 *
 * Secrets come back masked (`configured` + `last4`) and a blank field on save
 * keeps the stored value, so the raw token never round-trips through the
 * browser.
 */
export default function ModuleDeploySettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registryToken, setRegistryToken] = useState<Masked | null>(null);
  const [dispatchToken, setDispatchToken] = useState<Masked | null>(null);
  const [registryInput, setRegistryInput] = useState("");
  const [dispatchInput, setDispatchInput] = useState("");
  const [frontendRepo, setFrontendRepo] = useState("");
  const [frontendWorkflow, setFrontendWorkflow] = useState<string>(DEFAULTS.frontend_workflow);
  const [backendRepo, setBackendRepo] = useState<string>(DEFAULTS.backend_repo);
  const [backendWorkflow, setBackendWorkflow] = useState<string>(DEFAULTS.backend_workflow);
  const [ref, setRef] = useState<string>(DEFAULTS.ref);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [autoInterval, setAutoInterval] = useState<string>(DEFAULTS.auto_update_interval);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await frontendFetch(NS);
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Nur für Administratoren."
            : `Einstellungen konnten nicht geladen werden (HTTP ${res.status}).`,
        );
        setLoaded(true);
        return;
      }
      const data = (await res.json()) as { settings?: Masked[] };
      const map = new Map<string, Masked>((data.settings ?? []).map((s) => [s.key, s]));
      setRegistryToken(map.get("registry_token") ?? null);
      setDispatchToken(map.get("dispatch_token") ?? null);
      setFrontendRepo(map.get("frontend_repo")?.value ?? "");
      setFrontendWorkflow(map.get("frontend_workflow")?.value || DEFAULTS.frontend_workflow);
      setBackendRepo(map.get("backend_repo")?.value || DEFAULTS.backend_repo);
      setBackendWorkflow(map.get("backend_workflow")?.value || DEFAULTS.backend_workflow);
      setRef(map.get("ref")?.value || DEFAULTS.ref);
      setAutoUpdate(map.get("auto_update")?.value === "1");
      setAutoInterval(map.get("auto_update_interval")?.value || DEFAULTS.auto_update_interval);
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
            { key: "registry_token", secret: true, value: registryInput.trim() },
            { key: "dispatch_token", secret: true, value: dispatchInput.trim() },
            { key: "frontend_repo", secret: false, value: frontendRepo.trim() },
            { key: "frontend_workflow", secret: false, value: frontendWorkflow.trim() },
            { key: "backend_repo", secret: false, value: backendRepo.trim() },
            { key: "backend_workflow", secret: false, value: backendWorkflow.trim() },
            { key: "ref", secret: false, value: ref.trim() },
            { key: "auto_update", secret: false, value: autoUpdate ? "1" : "0" },
            { key: "auto_update_interval", secret: false, value: autoInterval.trim() },
          ],
        }),
      });
      if (res.ok) {
        setRegistryInput("");
        setDispatchInput("");
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

  const hint = (state: Masked | null) =>
    state?.configured ? `konfiguriert (…${state.last4 ?? "????"})` : "nicht konfiguriert";

  if (!loaded) return <Spinner />;

  return (
    <div className="tds-settings-section__body tds-stack">
      <FormAlert message={error} />

      <label className="block">
        <span className="text-sm">
          Registry-Token <em className="opacity-60">({hint(registryToken)})</em>
        </span>
        <input
          className="field-boxed"
          type="password"
          value={registryInput}
          onChange={(e) => setRegistryInput(e.target.value)}
          placeholder="PAT mit read:packages (leer = behalten)"
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="text-sm">
          Deploy-Token <em className="opacity-60">({hint(dispatchToken)})</em>
        </span>
        <input
          className="field-boxed"
          type="password"
          value={dispatchInput}
          onChange={(e) => setDispatchInput(e.target.value)}
          placeholder="PAT mit workflow-Scope (leer = Registry-Token verwenden)"
          autoComplete="off"
        />
      </label>

      {/* Two up from `sm` only. Unprefixed, these four fields sat at ~150px
          each on a phone, holding placeholders like the 42-character repo
          slug below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Frontend-Repository</span>
          <input
            className="field-boxed"
            type="text"
            value={frontendRepo}
            onChange={(e) => setFrontendRepo(e.target.value)}
            placeholder="Tracht-Digital-Solutions/tds-admin-frontend"
          />
        </label>
        <label className="block">
          <span className="text-sm">Frontend-Workflow</span>
          <input
            className="field-boxed"
            type="text"
            value={frontendWorkflow}
            onChange={(e) => setFrontendWorkflow(e.target.value)}
            placeholder={DEFAULTS.frontend_workflow}
          />
        </label>
        <label className="block">
          <span className="text-sm">Backend-Repository</span>
          <input
            className="field-boxed"
            type="text"
            value={backendRepo}
            onChange={(e) => setBackendRepo(e.target.value)}
            placeholder={DEFAULTS.backend_repo}
          />
        </label>
        <label className="block">
          <span className="text-sm">Backend-Workflow</span>
          <input
            className="field-boxed"
            type="text"
            value={backendWorkflow}
            onChange={(e) => setBackendWorkflow(e.target.value)}
            placeholder={DEFAULTS.backend_workflow}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm">Branch (ref)</span>
        <input
          className="field-boxed"
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder={DEFAULTS.ref}
        />
      </label>

      <p className="marginalia">
        Der Deploy-Workflow wird per <code>workflow_dispatch</code> auf diesem Branch gestartet. Die
        Release-Workflows der Plattform nehmen keine Inputs entgegen.
      </p>

      <div className="tds-toggle-row">
        <label className="block">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
          />{" "}
          <span className="text-sm">Module automatisch aktualisieren</span>
        </label>
        <label className="block">
          <span className="text-sm">Prüfintervall (Stunden)</span>
          <input
            className="field-boxed"
            type="number"
            min="1"
            max="720"
            value={autoInterval}
            onChange={(e) => setAutoInterval(e.target.value)}
            placeholder={DEFAULTS.auto_update_interval}
          />
        </label>
      </div>

      <p className="marginalia">
        Aktiv startet die API bei einer neuen Version <strong>innerhalb der gepinnten Linie</strong>
        selbstständig den Frontend-Rebuild. Das Backend-Bundle bleibt manuell — es würde den
        <code>main</code>-Stand aller Repositories ausliefern, auch unveröffentlichte Commits. Der
        Zeitplan hängt am Request-Verkehr der API: ohne Zugriffe läuft keine Prüfung (der
        Produktions-Host hat weder Cron noch <code>proc_open</code>).
      </p>

      <div className="tds-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner size="sm" /> : "Speichern"}
        </button>
      </div>
    </div>
  );
}
