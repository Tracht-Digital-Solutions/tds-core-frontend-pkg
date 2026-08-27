import { useEffect, useState } from "react";
import { FormAlert, Spinner } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";
import type { ModuleEntry } from "../lib/moduleInventory";

interface BackendInventory {
  modules: string[];
  packages: Record<string, string>;
}

interface Props {
  /** The frontend inventory baked into this product at build time. */
  modules: ModuleEntry[];
}

/**
 * Read-only inventory of the code that is actually running.
 *
 * Updating a composed module is a source/release operation. The running panel
 * therefore neither contacts a package registry nor starts a GitHub workflow;
 * it only combines the frontend build inventory with Composer's local runtime
 * inventory from `GET /admin/modules`.
 */
export default function ModulesAdmin({ modules }: Props) {
  const [backend, setBackend] = useState<BackendInventory | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await frontendFetch(`${API_BASE}/admin/modules`);
        if (!res.ok) {
          throw new Error(`Backend-Inventar konnte nicht geladen werden (HTTP ${res.status}).`);
        }
        const payload = (await res.json()) as Partial<BackendInventory>;
        if (!cancelled) {
          setBackend({ modules: payload.modules ?? [], packages: payload.packages ?? {} });
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const backendVersion = (pkg: string): string | null =>
    backend?.packages?.[pkg.replace(/^@/, "")] ?? null;

  return (
    <div className="tds-stack">
      <p className="marginalia">
        Diese Übersicht zeigt ausschließlich den ausgelieferten Stand. Änderungen an Modulen werden
        im Quellcode vorgenommen und über den regulären Release-Prozess veröffentlicht.
      </p>

      <FormAlert message={error} />

      <div className="tds-card">
        <table className="tds-table">
          <caption className="marginalia">
            Frontend = in diesen Panel-Build komponiert · Backend = im laufenden API-Bundle installiert.
          </caption>
          <thead>
            <tr>
              <th scope="col">Modul</th>
              <th scope="col">Frontend</th>
              <th scope="col">Backend</th>
              <th scope="col" className="hidden md:table-cell">Pin</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((entry) => (
              <tr key={entry.pkg}>
                <th scope="row">
                  {entry.name}
                  <span className="marginalia block">{entry.pkg}</span>
                </th>
                <td>{entry.installed || "—"}</td>
                <td>{loaded ? (backendVersion(entry.pkg) ?? "—") : <Spinner size="sm" />}</td>
                <td className="hidden md:table-cell">{entry.range || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {modules.length === 0 ? (
          <p className="tds-empty">
            Keine Module gefunden — dieser Build enthält kein auflösbares Produkt-Inventar.
          </p>
        ) : null}
      </div>

      {backend && backend.modules.length > 0 ? (
        <p className="marginalia">Im API-Bundle komponiert: {backend.modules.join(", ")}.</p>
      ) : null}
    </div>
  );
}
