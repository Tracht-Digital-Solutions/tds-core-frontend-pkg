import { useEffect, useMemo, useState } from "react";
import { FormAlert, Spinner } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

interface WikiRoute {
  method: string;
  pattern: string;
  group: string;
}

interface WikiData {
  generated_at: string;
  modules: string[];
  routes: WikiRoute[];
}

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

/**
 * In-panel API wiki — the full route map of the base + every composed module,
 * auto-generated from the live Slim routes (`/wiki.json`) and rendered in the
 * panel design system. New module routes appear on the next deploy without
 * touching this component. Admin-only (the endpoint gates it).
 */
export default function ApiWiki() {
  const [data, setData] = useState<WikiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    frontendFetch(`${API_BASE}/wiki.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? "Nur für Admins." : `HTTP ${r.status}`))))
      .then((d: WikiData) => setData(d))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    const byGroup = new Map<string, WikiRoute[]>();
    for (const r of data.routes) {
      if (query && !`${r.method} ${r.pattern}`.toLowerCase().includes(query)) continue;
      const bucket = byGroup.get(r.group) ?? [];
      bucket.push(r);
      byGroup.set(r.group, bucket);
    }
    return [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, q]);

  if (error) return <FormAlert message={error} />;
  if (!data) return <p role="status"><Spinner /></p>;

  return (
    <div className="api-wiki">
      <input
        className="api-wiki__search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Route oder Methode suchen …"
      />
      <p className="text-sm opacity-60 my-2">
        {data.routes.length} Routen · Module: {data.modules.join(", ") || "—"}
      </p>
      {groups.map(([group, routes]) => (
        <section key={group} className="api-wiki__group card p-4 mb-4">
          <h2 className="text-lg font-semibold mb-2">/{group}</h2>
          <ul className="api-wiki__routes flex flex-col gap-1">
            {routes.map((r, i) => (
              <li key={`${r.method}-${r.pattern}-${i}`} className="flex items-center gap-2">
                <span className={`chip ${methodChip(r.method)}`}>{r.method}</span>
                <code>{r.pattern}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
