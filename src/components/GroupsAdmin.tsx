import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";

import {
  createGroup,
  deleteGroup,
  describeFailure,
  fetchPermissionCatalog,
  listGroups,
  updateGroup,
  type Group,
  type PermissionDef,
} from "../lib/companyAdmin";
import { fetchCompanies, type Company } from "../lib/companies";

/**
 * Platform-side group management.
 *
 * A group is a named bundle of permissions that can be assigned per company, so
 * "Buchhaltung" is one edit instead of nine checkboxes on every user. Four are
 * seeded as SYSTEM groups (the former role presets): their rights stay
 * editable, their slug and their existence do not — something is assigned to
 * them, and deleting a group silently drops whatever it granted.
 *
 * Groups belong either to the platform (`companyId = 0`, assignable
 * everywhere) or to one company. Both are the same row; the scope is the only
 * difference, which is why a company admin's own groups need no second concept.
 *
 * ### Every write revokes sessions
 *
 * A group's rights ride in the JWT as a resolved union, so a changed group does
 * nothing until the affected tokens are gone. The backend revokes them and
 * reports how many — this screen says so, because "saved" while nothing
 * changes for an hour is the kind of silence that gets debugged twice.
 */

const PLATFORM = 0;

interface Draft {
  id: number | null;
  companyId: number;
  name: string;
  slug: string;
  description: string;
  permissions: string[];
}

const emptyDraft = (): Draft => ({
  id: null,
  companyId: PLATFORM,
  name: "",
  slug: "",
  description: "",
  permissions: [],
});

const draftOf = (group: Group): Draft => ({
  id: group.id,
  companyId: group.companyId,
  name: group.name,
  slug: group.slug,
  description: group.description ?? "",
  permissions: [...group.permissions],
});

export default function GroupsAdmin() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  const load = async () => {
    // The catalog and the company list are best-effort — the same never-throws
    // contract `fetchCompanies` established. Without the catalog the editor
    // still works; it just shows raw keys.
    //
    // The GROUP list is not best-effort here, because this screen IS the group
    // list: "Keine Gruppen." when the service is unreachable reads as "there
    // are none", and an admin would go and create four duplicates.
    const [result, defs, companyResult] = await Promise.all([
      listGroups(),
      fetchPermissionCatalog(),
      fetchCompanies(),
    ]);
    setCatalog(defs);
    setCompanies(companyResult.companies);

    if (!result.data) {
      setError(await describeFailure(result.res, "Gruppen konnten nicht geladen werden"));
      setGroups([]);
      return;
    }
    setError("");
    setGroups(result.data.groups);
  };

  useEffect(() => {
    void load();
  }, []);

  const companyName = useMemo(() => {
    const map = new Map<number, string>();
    for (const company of companies) map.set(company.id, company.name);
    return map;
  }, [companies]);

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
    if (draft === null) return;
    setSaving(true);
    try {
      const body = {
        companyId: draft.companyId,
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim(),
        permissions: draft.permissions,
      };

      const { res, data } =
        draft.id === null ? await createGroup(body) : await updateGroup(draft.id, body);

      // Never await a mutation and drop the response: a 409 on a duplicate slug
      // used to be indistinguishable from a save.
      if (!data) {
        toast.danger(await describeFailure(res, "Speichern fehlgeschlagen"));
        return;
      }

      const revoked = (data as { sessionsRevoked?: number }).sessionsRevoked ?? 0;
      toast.success(
        revoked > 0
          ? `Gruppe gespeichert. ${revoked} Sitzung${revoked === 1 ? "" : "en"} beendet — die Rechte gelten ab der nächsten Anmeldung.`
          : "Gruppe gespeichert.",
      );
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: Group) {
    const { res, data } = await deleteGroup(group.id);
    setPendingDelete(null);
    if (!data) {
      toast.danger(await describeFailure(res, "Löschen fehlgeschlagen"));
      return;
    }
    toast.success("Gruppe gelöscht.");
    await load();
  }

  function toggle(key: string) {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            permissions: current.permissions.includes(key)
              ? current.permissions.filter((k) => k !== key)
              : [...current.permissions, key],
          },
    );
  }

  if (groups === null) {
    return (
      <p role="status">
        <Spinner />
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <FormAlert message={error} />

      <div className="tds-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDraft(draft === null ? emptyDraft() : null)}
        >
          {draft !== null && draft.id === null ? "Abbrechen" : "Neue Gruppe"}
        </button>
      </div>

      {draft !== null && (
        <form className="tds-card p-4 space-y-4" onSubmit={save}>
          <h3 className="font-medium">{draft.id === null ? "Neue Gruppe" : "Gruppe bearbeiten"}</h3>

          <div className="tds-row">
            <label className="block">
              <span className="text-sm">Name</span>
              <input
                className="field-boxed"
                value={draft.name}
                required
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm">Kürzel (optional)</span>
              <input
                className="field-boxed"
                value={draft.slug}
                placeholder="wird aus dem Namen gebildet"
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm">Gilt für</span>
              <select
                className="field-boxed"
                value={draft.companyId}
                // The scope is what a group IS; changing it on an existing row
                // would move every assignment with it.
                disabled={draft.id !== null}
                onChange={(e) => setDraft({ ...draft, companyId: Number(e.target.value) })}
              >
                <option value={PLATFORM}>Alle Firmen</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm">Beschreibung</span>
            <input
              className="field-boxed"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Rechte</legend>
            {grouped.length === 0 ? (
              <p className="tds-empty">
                Der Rechte-Katalog ist nicht erreichbar. Die Gruppe lässt sich trotzdem
                speichern — die bestehenden Rechte bleiben unverändert.
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
                          checked={draft.permissions.includes(def.id)}
                          onChange={() => toggle(def.id)}
                        />
                        {def.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </fieldset>

          <div className="tds-toolbar">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : "Speichern"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {groups.length === 0 ? (
        <p className="tds-empty">Keine Gruppen.</p>
      ) : (
        <ul className="tds-stack">
          {groups.map((group) => (
            <li key={group.id} className="tds-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{group.name}</p>
                  {group.description && <p className="text-sm opacity-70">{group.description}</p>}
                  <div className="flex flex-wrap gap-2 mt-2 items-center">
                    <span className="chip chip--cat-teal">
                      {group.companyId === PLATFORM
                        ? "Alle Firmen"
                        : (companyName.get(group.companyId) ?? `Firma ${group.companyId}`)}
                    </span>
                    {group.isSystem && <span className="chip chip--cat-violet">System</span>}
                    <span className="text-xs opacity-60">
                      {group.permissions.length} Recht{group.permissions.length === 1 ? "" : "e"}
                      {group.memberCount !== undefined
                        ? ` · ${group.memberCount} Zuweisung${group.memberCount === 1 ? "" : "en"}`
                        : ""}
                    </span>
                  </div>
                </div>
                <div className="tds-toolbar">
                  <button type="button" className="btn btn-ghost" onClick={() => setDraft(draftOf(group))}>
                    Bearbeiten
                  </button>
                  {/* A system group's RIGHTS are editable; the group itself is
                      not removable — assignments point at it. */}
                  {!group.isSystem && (
                    <button type="button" className="btn btn-danger" onClick={() => setPendingDelete(group)}>
                      Löschen
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Gruppe „${pendingDelete?.name ?? ""}“ löschen?`}
        message="Alle Zuweisungen dieser Gruppe entfallen. Betroffene Benutzer verlieren die Rechte, die nur über diese Gruppe kamen."
        onConfirm={() => void (pendingDelete && remove(pendingDelete))}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
