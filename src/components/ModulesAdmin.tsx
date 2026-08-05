import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";
import {
  classify,
  STATE_META,
  suggestedRange,
  type ModuleEntry,
  type UpdateState,
} from "../lib/moduleUpdates";

/** One deploy pipeline the API is willing to start. */
interface DeployTarget {
  key: string;
  label: string;
  repo: string;
  workflow: string;
  configured: boolean;
}

/** State of the unattended updater, as the API reports it. */
interface AutoState {
  enabled: boolean;
  interval_hours: number;
  last_run: string | null;
  last_result: string | null;
  last_dispatch: string | null;
  next_run: string | null;
  inventory_known: boolean;
}

interface AutoReport {
  enabled: boolean;
  checked: number;
  updates: { pkg: string; from: string; to: string }[];
  repins: { pkg: string; from: string; to: string }[];
  dispatched: boolean;
  message: string;
}

interface CheckResponse {
  versions: Record<string, string | null>;
  registry: { configured: boolean; error: string };
  targets: DeployTarget[];
  backend: { modules: string[]; packages: Record<string, string> };
  auto: AutoState;
  checked_at: string;
}

interface Props {
  /** The composed inventory, baked in at build time (virtual:frontend-modules). */
  modules: ModuleEntry[];
}

const checkUrl = `${API_BASE}/admin/modules/check`;
const deployUrl = `${API_BASE}/admin/modules/deploy`;
const autoUrl = `${API_BASE}/admin/modules/auto-update`;

/** Local date rendering that tolerates the API not having a timestamp yet. */
function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("de-DE");
}

/**
 * What the confirmation actually promises. The frontend wording is deliberately
 * broader than the row the button sits in: one rebuild re-resolves every caret
 * range, so claiming a single-module update here would be false.
 */
function confirmMessage(target: DeployTarget, module?: ModuleEntry): string {
  const where = `Startet ${target.workflow} in ${target.repo}.`;
  if (target.key !== "frontend") {
    return `${where} Das API-Bundle wird aus dem main-Stand aller Dienste und Erweiterungen neu zusammengesetzt und ausgeliefert.`;
  }
  const scope =
    "Der Rebuild löst alle Versionsbereiche neu auf und zieht damit jedes Modul auf die neueste Version innerhalb seiner gepinnten Linie";
  return module ? `${where} ${scope} — nicht nur „${module.name}“.` : `${where} ${scope}.`;
}

/**
 * The Module page: what this build is composed of, what the registry publishes,
 * and the two buttons that put a newer version into service.
 *
 * WHY AN "UPDATE" IS A DEPLOY. There is no runtime module swap — the products
 * are composed during `astro build` and the API is assembled into one bundle.
 * So updating means re-running a pipeline, and a module has TWO halves on two
 * pipelines: the npm package a product build composes, and the Composer package
 * the gateway bundle assembles. Both columns are shown for that reason; a green
 * frontend version says nothing about the PHP side.
 *
 * WHY THE PER-ROW BUTTON IS HONEST ABOUT ITS SCOPE. CI installs with
 * `npm install --no-package-lock`, so one rebuild re-resolves EVERY caret range
 * — pressing "Aktualisieren" on one row updates every module that has a newer
 * version inside its pinned line. The confirmation says so instead of implying
 * a per-module deploy that this architecture cannot do.
 *
 * And when the newest version falls outside the pin (a crossed 0.x minor), no
 * rebuild will deliver it. That row offers no button at all — it names the
 * replacement range a maintainer has to commit in the product repo.
 */
export default function ModulesAdmin({ modules }: Props) {
  const [latest, setLatest] = useState<Record<string, string | null>>({});
  const [registry, setRegistry] = useState<CheckResponse["registry"] | null>(null);
  const [targets, setTargets] = useState<DeployTarget[]>([]);
  const [backend, setBackend] = useState<CheckResponse["backend"] | null>(null);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ target: DeployTarget; module?: ModuleEntry } | null>(null);
  const [deploying, setDeploying] = useState(false);

  // The pinned ranges exist only in the product's package.json, which the API
  // never sees — so the panel hands its build-time inventory over, and the
  // unattended updater checks against that snapshot.
  const inventory = useMemo(
    () => modules.map((m) => ({ pkg: m.pkg, installed: m.installed, range: m.range })),
    [modules],
  );

  const check = async (announce = false) => {
    setChecking(true);
    setError(null);
    try {
      const res = await frontendFetch(checkUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory }),
      });
      if (!res.ok) throw new Error(`Modulstatus konnte nicht geladen werden (HTTP ${res.status}).`);
      const data = (await res.json()) as CheckResponse;
      setLatest(data.versions ?? {});
      setRegistry(data.registry ?? null);
      setTargets(data.targets ?? []);
      setBackend(data.backend ?? null);
      setAuto(data.auto ?? null);
      setCheckedAt(data.checked_at ?? null);
      if (announce) toast.success("Modulstatus aktualisiert.");
    } catch (e) {
      // A load failure is a persistent state, so it stays in the flow rather
      // than in a toast — there is nothing on screen without it.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frontendTarget = targets.find((t) => t.key === "frontend");

  const rows = useMemo(
    () =>
      modules.map((entry) => {
        const published = latest[entry.pkg] ?? null;
        const state: UpdateState = classify(entry, published);
        return { entry, published, state };
      }),
    [modules, latest],
  );

  const updatable = rows.filter((r) => r.state === "update").length;
  const repins = rows.filter((r) => r.state === "repin").length;

  const runDeploy = async () => {
    if (!pending) return;
    setDeploying(true);
    try {
      const res = await frontendFetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: pending.target.key }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.ok) {
        toast.success(data.message ?? "Deploy gestartet.");
        setPending(null);
      } else {
        // The status is what separates "Token abgelehnt" from "Dienst nicht
        // erreichbar" in a bug report — never drop it.
        toast.danger(`${data.error ?? data.message ?? "Deploy fehlgeschlagen"} (HTTP ${res.status}).`);
      }
    } catch {
      toast.danger("Deploy fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setDeploying(false);
    }
  };

  /**
   * Run the unattended check now. `force` on the API side means it also runs
   * while the automation is switched off — an admin has to be able to try the
   * wiring before handing deploys over to it.
   */
  const runAuto = async () => {
    setAutoRunning(true);
    try {
      const res = await frontendFetch(autoUrl, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { report?: AutoReport; auto?: AutoState };
      if (!res.ok) {
        toast.danger(`Prüfung fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      if (data.auto) setAuto(data.auto);
      const report = data.report;
      if (report?.dispatched) toast.success(report.message);
      else if (report?.updates.length) toast.warning(report.message);
      else toast.info(report?.message ?? "Prüfung abgeschlossen.");
      // Refresh the table so the versions match what the run just saw.
      void check();
    } catch {
      toast.danger("Prüfung fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setAutoRunning(false);
    }
  };

  /** Composer package = the npm name without the leading `@` (they are kept identical). */
  const backendVersion = (pkg: string): string | null => backend?.packages?.[pkg.slice(1)] ?? null;

  return (
    <div className="tds-stack">
      <div className="tds-toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => void check(true)} disabled={checking}>
          {checking ? <Spinner size="sm" /> : "Erneut prüfen"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void runAuto()}
          disabled={autoRunning || checking}
          title="Prüft alle Module und startet bei einem Update innerhalb der gepinnten Linie den Rebuild"
        >
          {autoRunning ? <Spinner size="sm" /> : "Jetzt prüfen und aktualisieren"}
        </button>
        {targets.map((target) => (
          <button
            key={target.key}
            type="button"
            className="btn btn-primary"
            disabled={!target.configured || deploying}
            title={target.configured ? `${target.repo} → ${target.workflow}` : "Nicht konfiguriert"}
            onClick={() => setPending({ target })}
          >
            {target.label}
          </button>
        ))}
        {checkedAt ? (
          <span className="marginalia">Geprüft: {new Date(checkedAt).toLocaleString("de-DE")}</span>
        ) : null}
      </div>

      <FormAlert message={error} />

      {registry && !registry.configured ? (
        <p className="tds-alert tds-alert--warning">
          Kein Registry-Token hinterlegt — verfügbare Versionen können nicht abgefragt werden. Unter{" "}
          <a href="/einstellungen">Einstellungen → Module &amp; Deployment</a> eintragen.
        </p>
      ) : null}

      {registry?.configured && registry.error ? (
        <p className="tds-alert tds-alert--warning">Registry-Abfrage unvollständig: {registry.error}</p>
      ) : null}

      {auto ? (
        <div className="tds-card tds-stack tds-stack--tight">
          <div className="tds-row tds-row--between">
            <h2 className="tds-widget__title">Automatische Updates</h2>
            <span className={`chip ${auto.enabled ? "chip--success" : "chip--neutral"}`}>
              {auto.enabled ? `aktiv, alle ${auto.interval_hours} h` : "inaktiv"}
            </span>
          </div>
          <p className="marginalia">
            Letzte Prüfung: {when(auto.last_run)}
            {auto.last_result ? ` — ${auto.last_result}` : ""}
            {auto.enabled ? ` · Nächste frühestens: ${when(auto.next_run)}` : ""}
            {auto.last_dispatch ? ` · Letzter Rebuild: ${when(auto.last_dispatch)}` : ""}
          </p>
          <p className="marginalia">
            Nur das Frontend wird automatisch neu gebaut, und nur bei Versionen innerhalb der gepinnten
            Linie. Der Zeitplan hängt am Request-Verkehr der API — ohne Zugriffe läuft keine Prüfung.
            Ein-/ausschalten unter <a href="/einstellungen">Einstellungen → Module &amp; Deployment</a>.
          </p>
          {auto.enabled && !auto.inventory_known ? (
            <p className="tds-alert tds-alert--warning">
              Noch keine Modulübersicht gespeichert — sie wird beim Öffnen dieser Seite hinterlegt.
            </p>
          ) : null}
        </div>
      ) : null}

      {repins > 0 ? (
        <p className="tds-alert">
          {repins === 1 ? "Ein Modul hat" : `${repins} Module haben`} eine neuere Version außerhalb der
          gepinnten Linie. Ein Rebuild zieht sie nicht — dafür muss die Version im Produkt-Repository
          angehoben werden.
        </p>
      ) : null}

      <div className="tds-card">
        <table className="tds-table">
          <caption className="marginalia">
            Installiert = in diesen Build komponiert · Backend = im API-Bundle ausgelieferte PHP-Hälfte ·
            Pin = Bereich in der package.json des Produkts.
          </caption>
          <thead>
            <tr>
              <th scope="col">Modul</th>
              <th scope="col">Installiert</th>
              <th scope="col">Backend</th>
              <th scope="col">Verfügbar</th>
              <th scope="col">Pin</th>
              <th scope="col">Status</th>
              <th scope="col">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, published, state }) => {
              const meta = STATE_META[state];
              const be = backendVersion(entry.pkg);
              return (
                <tr key={entry.pkg}>
                  <th scope="row">
                    {entry.name}
                    <span className="marginalia block">{entry.pkg}</span>
                  </th>
                  <td>{entry.installed || "—"}</td>
                  <td>{be ?? "—"}</td>
                  <td>{published ?? "—"}</td>
                  <td>{entry.range || "—"}</td>
                  <td>
                    <span className={`chip ${meta.chip}`}>{meta.label}</span>
                  </td>
                  <td>
                    {state === "update" && frontendTarget?.configured ? (
                      <button
                        type="button"
                        className="btn btn-accent"
                        disabled={deploying}
                        onClick={() => setPending({ target: frontendTarget, module: entry })}
                      >
                        Aktualisieren
                      </button>
                    ) : state === "repin" && published ? (
                      <span className="marginalia">Pin auf {suggestedRange(published)} anheben</span>
                    ) : (
                      <span className="marginalia">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {modules.length === 0 ? (
          <p className="tds-empty">
            Keine Module gefunden — dieser Build wurde ohne aufgelöste Produkt-Abhängigkeiten erzeugt.
          </p>
        ) : null}
      </div>

      {updatable > 0 ? (
        <p className="marginalia">
          {updatable === 1 ? "Ein Modul lässt sich" : `${updatable} Module lassen sich`} per Rebuild
          aktualisieren.
        </p>
      ) : null}

      {backend && backend.modules.length > 0 ? (
        <p className="marginalia">
          Im API-Bundle komponiert: {backend.modules.join(", ")}.
        </p>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.target.label ?? "Deploy starten"}
        message={pending ? confirmMessage(pending.target, pending.module) : null}
        confirmLabel="Starten"
        // A deploy is not destructive — keep the affirmative button in the
        // accent colour and let Enter confirm.
        destructive={false}
        busy={deploying}
        onCancel={() => setPending(null)}
        onConfirm={() => void runDeploy()}
      />
    </div>
  );
}
