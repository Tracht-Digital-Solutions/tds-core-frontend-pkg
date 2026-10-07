import { useEffect, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { API_BASE, frontendFetch } from "../lib/auth";

interface Site {
  id: string;
  label: string;
}

interface SitesPayload {
  sites: Site[];
  sitemap_exclusions: Record<string, string[]>;
  sitemap_exclusion_limits?: { max_per_site: number; max_length: number };
  store_available?: boolean;
}

interface Rejected {
  value: string;
  reason: string;
}

const ENDPOINT = `${API_BASE}/admin/sites`;

const CACHE_LABEL: Record<string, string> = {
  refreshed: "Sitemap neu erzeugt",
  not_configured: "nicht gekoppelt — wirkt beim nächsten Rendern",
  failed: "Site nicht erreichbar — wirkt beim nächsten Rendern",
  skipped: "übersprungen",
};

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/**
 * *Suchmaschinen (Sitemap)* — the paths each public site leaves out of its
 * sitemap and serves `noindex`.
 *
 * The sites have read this list since 2026-09 (`/content/sitemap-exclusions`)
 * and the API has stored it on `PUT /admin/sites`, but no screen ever wrote it:
 * an operator who wanted `/tag/*` out of the index had to send JSON by hand.
 *
 * One textarea per site, one pattern per line. The PUT REPLACES the whole map —
 * a partial merge could never remove a site's last path — so every site's list
 * is sent on every save, exactly as the form shows it. Rejects come back as
 * text and stay in flow (see CorsSettings for why that is not a toast).
 */
export default function SitemapSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<{ max_per_site: number; max_length: number } | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [cache, setCache] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const apply = (data: Pick<SitesPayload, "sitemap_exclusions">, list: Site[]) => {
    const next: Record<string, string> = {};
    for (const site of list) next[site.id] = (data.sitemap_exclusions?.[site.id] ?? []).join("\n");
    setDrafts(next);
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await frontendFetch(ENDPOINT);
        if (!res.ok) {
          setError(
            res.status === 401 || res.status === 403
              ? "Nur für Administratoren."
              : `Sites konnten nicht geladen werden (HTTP ${res.status}).`,
          );
          return;
        }
        const data = (await res.json()) as SitesPayload;
        const list = (data.sites ?? []).map((s) => ({ id: s.id, label: s.label }));
        setSites(list);
        setLimits(data.sitemap_exclusion_limits ?? null);
        apply(data, list);
      } catch {
        setError("Sites konnten nicht geladen werden — die API ist nicht erreichbar.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    setRejected([]);
    setCache({});
    try {
      const body: Record<string, string[]> = {};
      for (const site of sites) body[site.id] = lines(drafts[site.id] ?? "");
      const res = await frontendFetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitemap_exclusions: body }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; rejected?: Rejected[]; sitemap_exclusions?: Record<string, string[]>; cache_status?: Record<string, string> }
        | null;
      if (!res.ok || !data?.ok) {
        toast.danger(
          data?.error ? `Speichern fehlgeschlagen (HTTP ${res.status}): ${data.error}` : `Speichern fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      if (data.sitemap_exclusions) apply({ sitemap_exclusions: data.sitemap_exclusions }, sites);
      setRejected(data.rejected ?? []);
      setCache(data.cache_status ?? {});
      if ((data.rejected ?? []).length > 0) toast.warning("Gespeichert — einzelne Pfade wurden abgelehnt.");
      else toast.success("Gespeichert.");
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
      {error ? null : (
        <>
          <p className="marginalia">
            Pfade, die eine Site aus ihrer Sitemap nimmt und mit <code>noindex</code> ausliefert — die
            Seite bleibt erreichbar, sie wird nur nicht mehr zum Indexieren angeboten. Ein Pfad pro
            Zeile, beginnend mit <code>/</code>; ein <code>*</code> am Ende schließt alles darunter aus
            (<code>/tag/*</code>). Ein Artikel fällt immer mit seiner Sprachfassung zusammen heraus.
            {limits ? ` Höchstens ${limits.max_per_site} Pfade je Site.` : null}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {sites.map((site) => (
              <label className="block" key={site.id}>
                <span className="text-sm font-semibold">{site.label}</span>
                <textarea
                  className="field-boxed"
                  rows={4}
                  value={drafts[site.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [site.id]: e.target.value }))}
                  placeholder={"/tag/*\n/aktuelles"}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={cache[site.id] ? `sitemap-cache-${site.id}` : undefined}
                />
                {cache[site.id] ? (
                  <span id={`sitemap-cache-${site.id}`} className="marginalia">
                    {CACHE_LABEL[cache[site.id]!] ?? cache[site.id]}
                  </span>
                ) : null}
              </label>
            ))}
          </div>

          {rejected.length > 0 ? (
            <div className="tds-alert tds-alert--warning">
              <p>Diese Pfade wurden nicht übernommen:</p>
              <ul>
                {rejected.map((entry, i) => (
                  <li key={`${entry.value}-${i}`}>
                    <code>{entry.value || "(leer)"}</code> — {entry.reason}
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
        </>
      )}
    </div>
  );
}
