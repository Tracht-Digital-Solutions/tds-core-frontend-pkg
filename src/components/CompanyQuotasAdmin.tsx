import { useEffect, useMemo, useState } from "react";
import { FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";

import {
  describeFailure,
  fetchCompanyPolicy,
  fetchPermissionCatalog,
  saveCompanyPolicy,
  type CompanyPolicy,
  type PermissionDef,
} from "../lib/companyAdmin";
import { fetchCompanies, type Company } from "../lib/companies";

/**
 * What a company may do for itself: how many users it may create, and which
 * rights it may hand out.
 *
 * ### The two "unlimited" states are different, and both are meaningful
 *
 * `maxUsers = null` is "no cap"; `allowedPermissions = null` is "no ceiling",
 * while `[]` is "may grant nothing". An empty array and a null therefore must
 * not be collapsed into one control — a company set to `[]` whose policy round-
 * trips as `null` silently gains the right to grant everything.
 *
 * ### The ceiling is a cut, not a one-time check
 *
 * Lowering it takes effect immediately, including on rights a group already
 * grants: `EffectivePermissions::resolve()` intersects with the ceiling on
 * every token issue. That is deliberate — a limit that only applied at
 * assignment time would be a suggestion.
 *
 * A platform admin is never subject to this. The quota is a DELEGATION limit,
 * not a licence.
 */
export default function CompanyQuotasAdmin() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);

  const [policy, setPolicy] = useState<CompanyPolicy | null>(null);
  const [seatsUsed, setSeatsUsed] = useState(0);
  const [companyAdmins, setCompanyAdmins] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [companyResult, defs] = await Promise.all([fetchCompanies(), fetchPermissionCatalog()]);
      setCatalog(defs);
      setCompanies(companyResult.companies);
      setCompanyId(companyResult.companies[0]?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (companyId === null) return;
    let cancelled = false;
    void (async () => {
      setPolicy(null);
      const { res, data } = await fetchCompanyPolicy(companyId);
      if (cancelled) return;
      if (!data) {
        setError(await describeFailure(res, "Kontingent konnte nicht geladen werden"));
        return;
      }
      setError("");
      setPolicy(data.policy);
      setSeatsUsed(data.seatsUsed);
      setCompanyAdmins(data.companyAdmins);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, PermissionDef[]>();
    for (const def of catalog) {
      const key = def.group ?? "Weitere";
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(def);
      else byGroup.set(key, [def]);
    }
    return [...byGroup.entries()];
  }, [catalog]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (companyId === null || policy === null) return;
    setSaving(true);
    try {
      const { res, data } = await saveCompanyPolicy(companyId, {
        maxUsers: policy.maxUsers,
        allowedPermissions: policy.allowedPermissions,
        allowCustomGroups: policy.allowCustomGroups,
      });
      if (!data) {
        toast.danger(await describeFailure(res, "Speichern fehlgeschlagen"));
        return;
      }
      setPolicy(data.policy);
      setSeatsUsed(data.seatsUsed);
      const revoked = data.sessionsRevoked ?? 0;
      toast.success(
        revoked > 0
          ? `Kontingent gespeichert. ${revoked} Sitzung${revoked === 1 ? "" : "en"} beendet — die Rechte gelten ab der nächsten Anmeldung.`
          : "Kontingent gespeichert.",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleCeiling(key: string) {
    setPolicy((current) => {
      if (current === null) return current;
      // A null ceiling means "everything"; the first tick has to start from the
      // full catalog and REMOVE, not start from empty and add — otherwise
      // untangling one right silently revokes all the others.
      const base = current.allowedPermissions ?? catalog.map((d) => d.id);
      return {
        ...current,
        allowedPermissions: base.includes(key) ? base.filter((k) => k !== key) : [...base, key],
      };
    });
  }

  if (companies === null) {
    return (
      <p role="status">
        <Spinner />
      </p>
    );
  }

  if (companies.length === 0) {
    return <p className="tds-empty">Es sind keine Firmen angelegt.</p>;
  }

  return (
    <div className="space-y-6">
      <FormAlert message={error} />

      <label className="block">
        <span className="text-sm">Firma</span>
        <select
          className="field-boxed"
          value={companyId ?? ""}
          onChange={(e) => setCompanyId(Number(e.target.value))}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>

      {policy === null ? (
        <p role="status">
          <Spinner />
        </p>
      ) : (
        <form className="tds-card p-4 space-y-4" onSubmit={save}>
          <p className="text-sm opacity-70">
            {seatsUsed} Benutzer belegt
            {policy.maxUsers !== null ? ` von ${policy.maxUsers}` : " (kein Limit)"} ·{" "}
            {companyAdmins} Firmenadmin{companyAdmins === 1 ? "" : "s"}
          </p>

          <div className="tds-row">
            <label className="block">
              <span className="text-sm">Maximale Benutzerzahl</span>
              <input
                className="field-boxed"
                type="number"
                min={0}
                value={policy.maxUsers ?? ""}
                placeholder="unbegrenzt"
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    // An empty field is "no cap", not zero — zero would lock
                    // the company out of creating anyone.
                    maxUsers: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={policy.allowCustomGroups}
                onChange={(e) => setPolicy({ ...policy, allowCustomGroups: e.target.checked })}
              />
              Darf eigene Gruppen anlegen
            </label>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Vergebbare Rechte</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={policy.allowedPermissions === null}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    // Unticking starts from the full catalog so the admin
                    // subtracts rather than rebuilds; `[]` stays reachable by
                    // clearing every box.
                    allowedPermissions: e.target.checked ? null : catalog.map((d) => d.id),
                  })
                }
              />
              Alle Rechte freigeben
            </label>

            {policy.allowedPermissions !== null &&
              (grouped.length === 0 ? (
                <p className="tds-empty">
                  Der Rechte-Katalog ist nicht erreichbar — die Auswahl lässt sich gerade nicht
                  bearbeiten.
                </p>
              ) : (
                grouped.map(([section, defs]) => (
                  <div key={section}>
                    <p className="text-xs uppercase opacity-60">{section}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1">
                      {defs.map((def) => (
                        <label key={def.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={policy.allowedPermissions?.includes(def.id) ?? false}
                            onChange={() => toggleCeiling(def.id)}
                          />
                          {def.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ))}

            {policy.allowedPermissions?.length === 0 && (
              <p className="tds-alert" role="status">
                Diese Firma darf derzeit keine Rechte vergeben. Bestehende Rechte ihrer Benutzer
                werden dadurch ebenfalls wirkungslos.
              </p>
            )}
          </fieldset>

          <div className="tds-toolbar">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : "Speichern"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
