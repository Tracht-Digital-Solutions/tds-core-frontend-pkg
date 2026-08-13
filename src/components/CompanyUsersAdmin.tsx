import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConfirmDialog,
  FormAlert,
  Spinner,
  toast,
} from "@tracht-digital-solutions/tds-shared/components";

import { fetchMe, membershipIds, type Me } from "../lib/auth";
import { getActiveCompany } from "../lib/activeCompany";
import {
  createCompanyUser,
  describeFailure,
  fetchCompanyUsers,
  removeCompanyUser,
  updateCompanyUser,
  type CompanyMember,
  type CompanyUsersPayload,
  type Group,
} from "../lib/companyAdmin";

/**
 * A company admin managing their OWN company's users.
 *
 * ### Why this lives in the host and not in the Firmen extension
 *
 * `tds-customer-frontend` composes only support-tickets, billing, messages,
 * projects and documents — the Firmen extension is admin-product only. A
 * company admin signs in to the PORTAL, so the screen has to come from the
 * shell, which both products build.
 *
 * ### What the server decides, and what this screen only renders
 *
 * The seat cap, the permission ceiling and the assignable groups all arrive in
 * the list payload. This screen never computes them: it shows what the backend
 * says is allowed and lets the backend refuse anything else. Filtering the
 * checkboxes here is a courtesy — `CompanyUserGuard` is the boundary, and it
 * names its refusals (`seat_limit`, `permission_not_allowed`, …) so a rejection
 * says which right was the problem instead of "Forbidden".
 */

interface Draft {
  email: string;
  name: string;
  permissions: string[];
  groupIds: number[];
  isCompanyAdmin: boolean;
  status: "active" | "disabled";
}

const emptyDraft = (): Draft => ({
  email: "",
  name: "",
  permissions: [],
  groupIds: [],
  isCompanyAdmin: false,
  status: "active",
});

const draftOf = (member: CompanyMember): Draft => ({
  email: member.email,
  name: member.name ?? "",
  permissions: [...member.permissions],
  groupIds: [...member.groupIds],
  isCompanyAdmin: member.isCompanyAdmin,
  status: member.status,
});

export default function CompanyUsersAdmin() {
  const [me, setMe] = useState<Me | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [payload, setPayload] = useState<CompanyUsersPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<CompanyMember | null>(null);

  const load = useCallback(async (id: number) => {
    const { res, data } = await fetchCompanyUsers(id);
    if (!data) {
      setError(await describeFailure(res, "Benutzer konnten nicht geladen werden"));
      setPayload(null);
      return;
    }
    setPayload(data);
    setError("");
  }, []);

  useEffect(() => {
    void (async () => {
      const principal = await fetchMe();
      setMe(principal);

      // Only the companies this person ADMINISTERS are manageable here. A
      // plain membership would render a screen where every write 403s.
      const administered = membershipIds(principal, (c) => c.isCompanyAdmin === true);

      // Deliberately NOT `resolveActiveCompany`: that clears the stored pick
      // when it is not in the list, and the list here is a SUBSET of the
      // memberships. Someone who is a plain member of A and an admin of B
      // would lose their panel-wide selection just by opening this page.
      const stored = getActiveCompany();
      const active =
        stored !== null && administered.includes(stored) ? stored : (administered[0] ?? null);
      setCompanyId(active);

      if (active !== null) await load(active);
      setLoading(false);
    })();
  }, [load]);

  const groupById = useMemo(() => {
    const map = new Map<number, Group>();
    for (const group of payload?.groups ?? []) map.set(group.id, group);
    return map;
  }, [payload]);

  /**
   * The rights this admin may hand out. `null` from the server means "no
   * ceiling" — then everything the assignable groups mention is offered, since
   * there is no catalog call on this surface.
   */
  const grantable = useMemo(() => {
    if (payload?.allowedPermissions) return payload.allowedPermissions;
    const fromGroups = new Set<string>();
    for (const group of payload?.groups ?? []) {
      for (const key of group.permissions) fromGroups.add(key);
    }
    return [...fromGroups].sort();
  }, [payload]);

  const seatsFull =
    payload?.seats.remaining !== null && payload?.seats.remaining !== undefined
      ? payload.seats.remaining <= 0
      : false;

  function startCreate() {
    setDraft(emptyDraft());
    setEditingId("new");
    setNotice("");
  }

  function startEdit(member: CompanyMember) {
    setDraft(draftOf(member));
    setEditingId(member.id);
    setNotice("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (companyId === null) return;
    setSaving(true);
    try {
      const body = {
        email: draft.email.trim(),
        name: draft.name.trim() || null,
        permissions: draft.permissions,
        groupIds: draft.groupIds,
        isCompanyAdmin: draft.isCompanyAdmin,
        status: draft.status,
      };

      const { res, data } =
        editingId === "new"
          ? await createCompanyUser(companyId, body)
          : await updateCompanyUser(companyId, editingId as number, body);

      // Never await a mutation and drop the response.
      if (!data) {
        toast.danger(await describeFailure(res, "Speichern fehlgeschlagen"));
        return;
      }

      const temporary = (data as { temporaryPassword?: string | null }).temporaryPassword;
      if (temporary) {
        // A credential has to be READ and copied, so it stays in the flow — a
        // toast would fade it away with the password still uncopied.
        setNotice(`Benutzer angelegt. Temporäres Passwort: ${temporary}`);
      } else {
        toast.success(editingId === "new" ? "Benutzer angelegt." : "Benutzer gespeichert.");
      }

      setEditingId(null);
      await load(companyId);
    } finally {
      setSaving(false);
    }
  }

  async function remove(member: CompanyMember) {
    if (companyId === null) return;
    const { res, data } = await removeCompanyUser(companyId, member.id);
    setPendingRemove(null);
    if (!data) {
      toast.danger(await describeFailure(res, "Entfernen fehlgeschlagen"));
      return;
    }
    // "Entfernt", not "gelöscht": the account survives, it just no longer
    // belongs to this company.
    toast.success("Benutzer aus der Firma entfernt.");
    await load(companyId);
  }

  if (loading) {
    return (
      <div className="tds-card" style={{ padding: "1.5rem" }}>
        <Spinner size="lg" tone="primary" />
      </div>
    );
  }

  if (companyId === null) {
    return (
      <p className="tds-alert" role="status">
        Sie verwalten derzeit keine Firma. Ein Administrator kann Ihnen diese Rolle geben.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <FormAlert message={error} />}
      {notice && (
        <p className="tds-alert tds-alert--success" role="status">
          {notice}
        </p>
      )}

      {payload && (
        <div className="tds-card" style={{ padding: "1rem" }}>
          <div className="tds-row" style={{ justifyContent: "space-between", gap: "1rem" }}>
            <span className="text-sm">
              <strong>{payload.seats.used}</strong>
              {payload.seats.max !== null ? ` von ${payload.seats.max}` : ""} Benutzerplätzen belegt
              {payload.seats.max === null && " (unbegrenzt)"}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={seatsFull || editingId !== null}
              onClick={startCreate}
            >
              Benutzer hinzufügen
            </button>
          </div>
          {seatsFull && (
            <p className="text-xs" style={{ color: "var(--color-muted)", marginTop: "0.5rem" }}>
              Alle Plätze sind belegt. Entfernen Sie einen Benutzer oder fragen Sie nach mehr Plätzen.
            </p>
          )}
        </div>
      )}

      {editingId !== null && (
        <form className="tds-card flex flex-col gap-4" style={{ padding: "1.25rem" }} onSubmit={save}>
          <h2 className="text-sm font-medium">
            {editingId === "new" ? "Neuer Benutzer" : "Benutzer bearbeiten"}
          </h2>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">E-Mail</span>
            <input
              className="field-boxed"
              type="email"
              required
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
            {editingId === "new" && (
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Existiert bereits ein Konto mit dieser Adresse, wird es Ihrer Firma hinzugefügt —
                eine Person braucht keine zweite Anmeldung.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Name</span>
            <input
              className="field-boxed"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>

          {payload && payload.groups.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Gruppen</legend>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Rechte aus einer Gruppe gelten zusätzlich zu den einzeln vergebenen.
              </span>
              {payload.groups.map((group) => (
                <label key={group.id} className="tds-list__row" style={{ gap: "0.625rem" }}>
                  <input
                    type="checkbox"
                    checked={draft.groupIds.includes(group.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        groupIds: e.target.checked
                          ? [...draft.groupIds, group.id]
                          : draft.groupIds.filter((id) => id !== group.id),
                      })
                    }
                  />
                  <span className="flex flex-col">
                    <span className="text-sm">{group.name}</span>
                    {group.description && (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                        {group.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Einzelne Rechte</legend>
            {grantable.length === 0 ? (
              <p className="tds-empty">Für diese Firma sind keine Rechte freigegeben.</p>
            ) : (
              <div className="tds-row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
                {grantable.map((key) => (
                  <label key={key} className="tds-row" style={{ gap: "0.375rem" }}>
                    <input
                      type="checkbox"
                      checked={draft.permissions.includes(key)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          permissions: e.target.checked
                            ? [...draft.permissions, key]
                            : draft.permissions.filter((p) => p !== key),
                        })
                      }
                    />
                    <span className="text-sm">{key}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="tds-list__row" style={{ gap: "0.625rem" }}>
            <input
              type="checkbox"
              checked={draft.isCompanyAdmin}
              onChange={(e) => setDraft({ ...draft, isCompanyAdmin: e.target.checked })}
            />
            <span className="flex flex-col">
              <span className="text-sm">Firmenadmin</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Darf die Benutzer dieser Firma verwalten — also auch diese Seite hier.
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Status</span>
            <select
              className="field-boxed"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}
            >
              <option value="active">Aktiv</option>
              <option value="disabled">Deaktiviert</option>
            </select>
          </label>

          <div className="tds-toolbar">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : "Speichern"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => setEditingId(null)}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <div className="tds-card" style={{ padding: "1.25rem" }}>
        <table className="tds-table">
          <caption className="sr-only">Benutzer dieser Firma</caption>
          <thead>
            <tr>
              <th>Benutzer</th>
              <th>Gruppen</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.users ?? []).map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="block text-sm">{member.label}</span>
                  <span className="block text-xs" style={{ color: "var(--color-muted)" }}>
                    {member.email}
                  </span>
                </td>
                <td>
                  {member.isCompanyAdmin && <span className="chip chip--info">Firmenadmin</span>}{" "}
                  {member.groupIds
                    .map((id) => groupById.get(id)?.name)
                    .filter(Boolean)
                    .join(", ")}
                </td>
                <td>
                  <span
                    className={`status-pill ${member.status === "active" ? "" : "opacity-70"}`}
                  >
                    {member.status === "active" ? "Aktiv" : "Deaktiviert"}
                  </span>
                </td>
                <td>
                  <div className="tds-row" style={{ gap: "0.375rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(member)}>
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setPendingRemove(member)}
                    >
                      Entfernen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(payload?.users.length ?? 0) === 0 && (
          <p className="tds-empty">Noch keine weiteren Benutzer in dieser Firma.</p>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`„${pendingRemove?.label ?? ""}“ entfernen?`}
        message="Das Konto bleibt bestehen und verliert nur den Zugang zu dieser Firma. Wenn die Person noch zu anderen Firmen gehört, bleibt der Zugang dorthin unberührt."
        confirmLabel="Entfernen"
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && void remove(pendingRemove)}
      />
    </div>
  );
}
