import { useEffect, useMemo, useState } from "react";
import { FormAlert, Spinner } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";
import type { ModuleEntry } from "../lib/moduleInventory";

/**
 * The ADMIN wiki: the full API of the base plus every composed module, with a
 * description, parameters, responses and required permission per route.
 *
 * The data is `GET /wiki.json` v2 — introspected Slim routes joined with the
 * prose each module contributes through the contract's `ApiDocSource`, grouped
 * by the module that actually mounted each route. The previous version grouped
 * by first path segment, which collapsed all thirteen modules' `/admin/*` routes
 * into one undifferentiated block; that is the reason this page is structured
 * around modules now.
 *
 * Collapsing is native `<details>`, not React state: keyboard and screen-reader
 * semantics come for free, and the browser keeps the open/closed state while the
 * filter re-renders around it.
 */

interface RouteParam {
  in: "path" | "query" | "body" | "header";
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

interface RouteResponse {
  status: number;
  description: string;
  example?: string;
}

interface WikiRoute {
  method: string;
  pattern: string;
  documented: boolean;
  summary: string;
  description?: string;
  tag?: string;
  auth?: string;
  permission?: string;
  params?: RouteParam[];
  responses?: RouteResponse[];
}

interface WikiModule {
  id: string;
  routes: WikiRoute[];
}

interface WikiData {
  generated_at: string;
  version: number;
  modules: WikiModule[];
  stats: { routes: number; documented: number; modules: number; orphan_docs: string[] };
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function methodChip(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "chip--success";
    case "POST":
      return "chip--info";
    case "PUT":
    case "PATCH":
      return "chip--warning";
    case "DELETE":
      return "chip--danger";
    default:
      return "chip--neutral";
  }
}

const AUTH_LABEL: Record<string, string> = {
  public: "Öffentlich",
  session: "Anmeldung",
  permission: "Recht",
  admin: "Nur Admin",
  token: "Token",
  "pairing-token": "Pairing-Token",
  "finalize-token": "Finalisierungs-Token",
};

/**
 * The module's German display name. The API emits ids only — on purpose: the
 * name lives in each extension's TS manifest, which the BUILD already has
 * composed (`virtual:frontend-modules`, handed in as a prop by the page).
 * Duplicating it into the backend would be a second source of truth that
 * nothing keeps in sync. An id with no matching package renders as itself.
 */
function moduleName(id: string, modules: ModuleEntry[]): string {
  if (id === "base") return "Basis (Kernel)";
  return modules.find((m) => m.id === id)?.name ?? id;
}

/** German plural. A composed build has one module often enough to notice. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Stable, linkable anchor for one route. */
function anchorFor(route: WikiRoute): string {
  return `route-${route.method}-${route.pattern}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  /** The composed inventory, baked in at build time (virtual:frontend-modules). */
  modules: ModuleEntry[];
}

export default function ApiReference({ modules: inventory }: Props) {
  const [data, setData] = useState<WikiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  // Bumping this key remounts every <details>, which is how "expand all" /
  // "collapse all" works without tracking each one in state.
  const [expandKey, setExpandKey] = useState(0);
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    frontendFetch(`${API_BASE}/wiki.json`)
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(new Error(r.status === 403 ? "Nur für Admins." : `HTTP ${r.status}`)),
      )
      .then((d: WikiData) => setData(d))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const modules = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    return data.modules
      .map((m) => ({
        ...m,
        routes: m.routes.filter((r) => {
          if (method && r.method !== method) return false;
          if (!query) return true;
          return `${r.method} ${r.pattern} ${r.summary} ${r.description ?? ""}`
            .toLowerCase()
            .includes(query);
        }),
      }))
      .filter((m) => m.routes.length > 0);
  }, [data, q, method]);

  // A filter that narrows to a handful of routes should show them, not leave
  // the reader clicking open every module to find out where they went.
  const filtering = q.trim() !== "" || method !== null;
  const open = expandAll || filtering;

  if (error) return <FormAlert message={error} />;
  if (!data) {
    return (
      <p role="status">
        <Spinner />
      </p>
    );
  }
  if (data.version !== 2) {
    return (
      <FormAlert
        message={`Diese Seite erwartet /wiki.json in Version 2, bekommen hat sie Version ${data.version}. Vermutlich ist das Backend älter als das Frontend.`}
      />
    );
  }

  const shown = modules.reduce((n, m) => n + m.routes.length, 0);

  return (
    <div className="api-reference">
      <div className="tds-toolbar">
        <input
          className="field-boxed"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Route, Zweck oder Beschreibung suchen …"
          aria-label="API-Referenz durchsuchen"
        />
        <div className="tds-row" role="group" aria-label="Nach Methode filtern">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              className={method === m ? `chip ${methodChip(m)}` : "chip"}
              onClick={() => setMethod(method === m ? null : m)}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setExpandAll(!expandAll);
            setExpandKey((k) => k + 1);
          }}
        >
          {expandAll ? "Alles zuklappen" : "Alles aufklappen"}
        </button>
      </div>

      <p className="text-sm opacity-70 my-3">
        {shown === data.stats.routes
          ? `${plural(data.stats.routes, "Route", "Routen")} in ${plural(data.stats.modules, "Modul", "Modulen")}`
          : `${shown} von ${plural(data.stats.routes, "Route", "Routen")}`}
        {data.stats.documented < data.stats.routes && (
          <> · {data.stats.routes - data.stats.documented} ohne Beschreibung</>
        )}
      </p>

      {data.stats.orphan_docs.length > 0 && (
        // A doc entry whose route no longer exists means a path was renamed and
        // the prose stayed behind — surfaced rather than swallowed, because a
        // reference that confidently describes a route nobody can call is worse
        // than one that admits the gap. `.tds-alert--warning` rather than
        // FormAlert: this is a persistent state worth reading, not a failed
        // submit, and FormAlert is danger-only by design.
        <p className="tds-alert tds-alert--warning">
          Beschreibungen ohne passende Route (vermutlich umbenannt):{" "}
          {data.stats.orphan_docs.join(", ")}
        </p>
      )}

      {modules.length === 0 ? (
        <p className="tds-empty">Keine Route passt zum Filter.</p>
      ) : (
        modules.map((m) => (
          <details key={`${m.id}-${expandKey}`} className="tds-card p-4 mb-4" open={open}>
            <summary className="cursor-pointer font-semibold">
              {moduleName(m.id, inventory)}{" "}
              <span className="opacity-60 font-normal">({m.routes.length})</span>
            </summary>
            <div className="tds-stack mt-3">
              {m.routes.map((r) => (
                <RouteEntry key={`${r.method} ${r.pattern}`} route={r} open={open} />
              ))}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

function RouteEntry({ route, open }: { route: WikiRoute; open: boolean }) {
  return (
    <details id={anchorFor(route)} open={open}>
      {/* `min-w-0` + `break-all`: a route pattern is one unbroken token
          (`/cms/sites/{site}/connection/pairing`), and a flex item defaults to
          min-content width, so without both the row ran past the viewport —
          where `body { overflow-x: hidden }` cut it off rather than letting it
          scroll. */}
      <summary className="cursor-pointer flex items-baseline gap-2 min-w-0 flex-wrap">
        <span className={`chip ${methodChip(route.method)}`}>{route.method}</span>
        <code className="break-all">{route.pattern}</code>
        {route.summary && <span className="text-sm opacity-70">{route.summary}</span>}
      </summary>

      <div className="tds-stack mt-2 mb-4 pl-1 text-sm">
        {!route.documented && (
          <p className="opacity-60">
            Für diese Route liegt noch keine Beschreibung vor. Sie wird aus den
            registrierten Slim-Routen gelistet, damit die Referenz vollständig bleibt.
          </p>
        )}

        {route.description && <p className="opacity-80">{route.description}</p>}

        {(route.auth || route.permission) && (
          <p className="tds-row">
            {route.auth && (
              <span className="chip chip--neutral">{AUTH_LABEL[route.auth] ?? route.auth}</span>
            )}
            {route.permission && <code>{route.permission}</code>}
          </p>
        )}

        {route.params && route.params.length > 0 && (
          <ParamTable params={route.params} label={`Parameter von ${route.method} ${route.pattern}`} />
        )}

        {route.responses && route.responses.length > 0 && (
          <ResponseTable
            responses={route.responses}
            label={`Antworten von ${route.method} ${route.pattern}`}
          />
        )}
      </div>
    </details>
  );
}

/**
 * `tds-table` turns itself into a horizontal scroller below 40rem — no extra
 * `overflow-x` wrapper. It has no focusable cell, so it also needs
 * `tabindex`/`role`/label or its scrollport is unreachable by keyboard.
 */
function ParamTable({ params, label }: { params: RouteParam[]; label: string }) {
  return (
    <table className="tds-table" tabIndex={0} role="region" aria-label={label}>
      <caption className="text-left opacity-70">Parameter</caption>
      <thead>
        <tr>
          <th>Name</th>
          <th>Ort</th>
          <th>Typ</th>
          <th>Pflicht</th>
          <th>Beschreibung</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={`${p.in}-${p.name}`}>
            <td>
              <code>{p.name}</code>
            </td>
            <td>{p.in}</td>
            <td>{p.type}</td>
            <td>{p.required ? "ja" : "—"}</td>
            <td>{p.description ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResponseTable({ responses, label }: { responses: RouteResponse[]; label: string }) {
  return (
    <table className="tds-table" tabIndex={0} role="region" aria-label={label}>
      <caption className="text-left opacity-70">Antworten</caption>
      <thead>
        <tr>
          <th>Status</th>
          <th>Bedeutung</th>
        </tr>
      </thead>
      <tbody>
        {responses.map((r) => (
          <tr key={r.status}>
            <td>
              <code>{r.status}</code>
            </td>
            <td>
              {r.description}
              {r.example && (
                <>
                  {" "}
                  <code className="break-all">{r.example}</code>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
