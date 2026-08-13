import { useEffect, useMemo, useState, type CSSProperties, type SubmitEvent } from "react";
import {
  PORTAL_PERMISSIONS,
  PORTAL_PERMISSION_LABELS,
  type PortalPermission,
} from "@tracht-digital-solutions/tds-shared/permissions";
import { ConfirmDialog, FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { AUTH_API_URL, frontendFetch } from "../lib/auth";
import { fetchCompanies, type Company } from "../lib/companies";
import {
  fetchGroups,
  fetchPermissionCatalog,
  type Group,
  type PermissionDef,
} from "../lib/companyAdmin";

interface Membership {
  /** The company. Named `customerId` on the wire for one more release. */
  customerId: number;
  /** Direct grants. NOT the effective set — groups add to this server-side. */
  permissions: string[];
  /** May this membership manage the company's own users? */
  isCompanyAdmin?: boolean;
  /** Groups assigned to this user IN this company. */
  groupIds?: number[];
  /** The most this ONE person may hold; null = inherit the company policy. */
  permissionCeiling?: string[] | null;
}

interface AdminUser {
  id: number;
  email: string;
  name?: string | null;
  isAdmin?: boolean;
  isSupportAgent?: boolean;
  isBlogAuthor?: boolean;
  memberships?: Membership[];
  customerId?: number | null;
  permissions?: PortalPermission[];
  status?: "active" | "disabled";
}

const usersUrl = `${AUTH_API_URL}/admin/users`;

/**
 * Core user management (Benutzerverwaltung) — the base service's own screen. Users
 * live in tds-auth-api (`/admin/users`); the company list comes from
 * `lib/companies.ts`, which prefers the composed `tds-ext-customers` extension
 * and falls back to the legacy customer-api (see that file for why the fallback
 * exists). Beyond list/create/reset/delete this now offers the full
 * per-user editor: admin/support-agent/blog-author flags, account status, and
 * **company memberships with per-company portal permissions** (the fine-grained
 * RBAC). Admins bypass portal permissions, so their memberships are cleared.
 */
export default function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setError(null);
    try {
      // The company list is best-effort and never throws — membership editing
      // still works without names (it falls back to showing ids), so a list
      // outage must not take user management down with it. `fetchCompanies`
      // prefers the composed `tds-ext-customers` endpoint and falls back to the
      // legacy customer-api, which is what lets that service be retired without
      // a second frontend deploy.
      // The catalog and the group list are best-effort for the same reason
      // the company list is: user management must not go down because the
      // composed API is unreachable. Both fall back to empty, and the picker
      // then renders the shared seed labels.
      const [uRes, companyResult, permissionDefs, groupList] = await Promise.all([
        frontendFetch(usersUrl),
        fetchCompanies(),
        fetchPermissionCatalog(),
        fetchGroups(),
      ]);
      if (!uRes.ok) throw new Error(`Benutzer laden fehlgeschlagen (HTTP ${uRes.status}).`);
      const uData = await uRes.json();
      setUsers(uData.users ?? []);
      setCompanies(companyResult.companies);
      setCatalog(permissionDefs);
      setGroups(groupList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUsers([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const companyName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  const createUser = async (payload: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    const res = await frontendFetch(usersUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // A temporary password must be READ and copied, so it stays an in-flow
      // notice — a toast that blends itself away after four seconds would take
      // the credential with it. Everything else here is a transient outcome.
      if (data.tempPassword) {
        setNotice(`Benutzer angelegt. Temporäres Passwort: ${data.tempPassword}`);
      } else {
        toast.success("Benutzer angelegt.");
      }
      setShowCreate(false);
      void load();
    } else {
      toast.danger(
        res.status === 409 ? "E-Mail existiert bereits." : `Anlegen fehlgeschlagen (HTTP ${res.status}).`,
      );
    }
  };

  const updateUser = async (id: number, patch: Record<string, unknown>) => {
    setError(null);
    const res = await frontendFetch(`${usersUrl}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setEditingId(null);
      void load();
      // Used to be silent: the form just closed, which looks identical to
      // hitting Abbrechen.
      toast.success("Benutzer gespeichert.");
    } else {
      toast.danger(
        res.status === 409
          ? "Konflikt (z. B. eigener Admin-Zugang)."
          : `Speichern fehlgeschlagen (HTTP ${res.status}).`,
      );
    }
  };

  const resetPassword = async (u: AdminUser) => {
    const res = await frontendFetch(`${usersUrl}/${u.id}/reset-password`, { method: "POST" });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      // Same rule as above — the new password is in-flow, not a toast.
      if (d.tempPassword) setNotice(`Neues temporäres Passwort für ${u.email}: ${d.tempPassword}`);
      else toast.success(`Passwort für ${u.email} zurückgesetzt.`);
    } else {
      // There was no failure branch here at all: a rejected reset looked
      // exactly like a successful one that happened to return no password.
      toast.danger(`Zurücksetzen fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  // Deletion is two-step: the row button parks the user in `pendingDelete`, the
  // <ConfirmDialog> at the end of the render performs it. `deleting` keeps both
  // dialog buttons disabled while the request is in flight, so the confirm
  // cannot be double-submitted — something `window.confirm()` gave us for free
  // by blocking the thread, and which a non-blocking dialog must do explicitly.
  const confirmRemove = async () => {
    const u = pendingDelete;
    if (!u) return;
    setDeleting(true);
    try {
      // The response used to be discarded entirely — a 403 closed the dialog
      // and reloaded the list, so the row simply reappeared with no reason.
      const res = await frontendFetch(`${usersUrl}/${u.id}`, { method: "DELETE" });
      setPendingDelete(null);
      void load();
      if (res.ok) toast.success(`${u.email} gelöscht.`);
      else toast.danger(`Löschen fehlgeschlagen (HTTP ${res.status}).`);
    } catch {
      setPendingDelete(null);
      toast.danger("Löschen fehlgeschlagen — die API ist nicht erreichbar.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="users-admin space-y-6">
      {/* `.status-pill` is an inline LABEL, not a banner — these were stretched
          <p> pills. <FormAlert> (danger) and `.tds-alert` (any hue) are the
          block-message primitives. */}
      <FormAlert message={error} />
      {notice ? (
        <p className="tds-alert" style={{ "--tds-alert-hue": "var(--color-info)" } as CSSProperties} role="status">
          {notice}
        </p>
      ) : null}

      <div className="tds-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Abbrechen" : "Neuer Benutzer"}
        </button>
      </div>

      {showCreate ? (
        <UserForm companies={companies} catalog={catalog} groups={groups} onSubmit={createUser} onCancel={() => setShowCreate(false)} />
      ) : null}

      {users === null ? (
        <p role="status"><Spinner /></p>
      ) : users.length === 0 ? (
        <p className="tds-empty">Keine Benutzer.</p>
      ) : (
        <ul className="tds-stack">
          {users.map((u) => (
            <li key={u.id} className="tds-card p-4">
              {editingId === u.id ? (
                <UserForm
                  companies={companies}
                  catalog={catalog}
                  groups={groups}
                  initial={u}
                  onSubmit={(patch) => updateUser(u.id, patch)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{u.name ?? "—"}</p>
                    <p className="text-sm opacity-70 break-all">{u.email}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {u.isAdmin ? <span className="chip chip--cat-violet">Admin</span> : null}
                      {u.isAdmin && u.isSupportAgent ? <span className="chip chip--cat-teal">Support-Agent</span> : null}
                      {u.isBlogAuthor && !u.isAdmin ? <span className="chip chip--cat-amber">Blog-Autor</span> : null}
                      {u.status === "disabled" ? <span className="chip chip--cat-rose">Gesperrt</span> : null}
                      {!u.isAdmin ? (
                        <span className="text-xs opacity-60">
                          {(u.memberships?.length ?? 0)} Firma
                          {(u.memberships?.length ?? 0) === 1 ? "" : "s"}
                          {u.memberships && u.memberships.length > 0
                            ? ": " + u.memberships.map((m) => companyName.get(m.customerId) ?? `#${m.customerId}`).join(", ")
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* `.tds-toolbar`, not a hand-rolled flex row: this used to
                      carry `shrink-0`, which pinned three buttons at their full
                      width and pushed the card 52px past a 375px viewport —
                      invisible, because body{overflow-x:hidden} CLIPS it. */}
                  <div className="tds-toolbar">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditingId(u.id)}>Bearbeiten</button>
                    <button type="button" className="btn btn-ghost" onClick={() => void resetPassword(u)}>Passwort zurücksetzen</button>
                    <button type="button" className="btn btn-danger" onClick={() => setPendingDelete(u)}>Löschen</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Benutzer „${pendingDelete?.name ?? pendingDelete?.email ?? ""}“ wirklich löschen?`}
        message="Der Zugang und alle Firmen-Mitgliedschaften werden entfernt. Das lässt sich nicht rückgängig machen."
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** Checkbox grid + role presets for picking a company's portal permissions. */
/**
 * The per-membership permission checkboxes.
 *
 * The options come from the COMPOSED catalog (`GET /admin/permissions`, every
 * module's contribution), falling back to the shared portal seed set when that
 * service is unreachable — the same never-throws contract `fetchCompanies` has.
 * Offering only the nine seed keys is what the whole Phase 2 permission change
 * was about: the panel composes thirteen extensions, and their rights were
 * ungrantable through this screen.
 *
 * A key that is STORED but not in the catalog still renders, as a warning chip.
 * Loosening the backend's validation is one-way, and an admin has to be able to
 * see — and remove — a right nothing recognises any more.
 */
function PermissionPicker({
  value,
  catalog,
  onChange,
}: {
  value: string[];
  catalog: PermissionDef[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((p) => p !== key) : [...value, key]);

  const options: PermissionDef[] =
    catalog.length > 0
      ? catalog
      : PORTAL_PERMISSIONS.map((id) => ({ id, label: PORTAL_PERMISSION_LABELS[id] }));

  const known = new Set(options.map((o) => o.id));
  const unknown = value.filter((key) => !known.has(key));

  // Group headings, in first-appearance order, so thirteen modules' rights are
  // navigable instead of one flat wall of checkboxes.
  const byGroup = new Map<string, PermissionDef[]>();
  for (const option of options) {
    const key = option.group ?? "Allgemein";
    byGroup.set(key, [...(byGroup.get(key) ?? []), option]);
  }

  return (
    <div>
      {/* The four role-preset buttons that used to sit here are real GROUPS
          now (seeded as system groups above), so what is left is the one thing
          a preset could not do: clear the DIRECT grants. It does not touch the
          group boxes — group rights are added by the server. */}
      <div className="tds-toolbar mb-3">
        <button type="button" className="btn btn-ghost text-xs" onClick={() => onChange([])}>
          Einzelrechte zurücksetzen
        </button>
      </div>
      {unknown.length > 0 && (
        <p className="mb-2 flex flex-wrap gap-1 text-xs">
          <span className="opacity-70">Unbekannte gespeicherte Rechte:</span>
          {unknown.map((key) => (
            <button
              key={key}
              type="button"
              className="chip chip--warning"
              title="Kein Modul kennt dieses Recht mehr. Klicken zum Entfernen."
              onClick={() => toggle(key)}
            >
              {key} ×
            </button>
          ))}
        </p>
      )}
      {[...byGroup.entries()].map(([group, entries]) => (
        <div key={group} className="mb-3">
          <p className="text-xs uppercase opacity-60 mb-1">{group}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {entries.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(option.id)}
                  onChange={() => toggle(option.id)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UserForm({
  companies,
  catalog,
  groups,
  initial,
  onSubmit,
  onCancel,
}: {
  companies: Company[];
  /** The composed permission catalog; empty falls back to the seed set. */
  catalog: PermissionDef[];
  /** Groups assignable in the companies this form can reach. */
  groups: Group[];
  initial?: AdminUser;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const editing = initial !== undefined;
  const [email, setEmail] = useState(initial?.email ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [isAdmin, setIsAdmin] = useState(initial?.isAdmin ?? false);
  const [isSupportAgent, setIsSupportAgent] = useState(initial?.isSupportAgent ?? false);
  const [isBlogAuthor, setIsBlogAuthor] = useState(initial?.isBlogAuthor ?? false);
  const [status, setStatus] = useState<"active" | "disabled">(initial?.status ?? "active");
  const [memberships, setMemberships] = useState<Membership[]>(
    initial?.memberships ??
      (initial?.customerId != null ? [{ customerId: initial.customerId, permissions: initial.permissions ?? [] }] : []),
  );

  const usedCompanyIds = new Set(memberships.map((m) => m.customerId));
  const availableCompanies = companies.filter((c) => !usedCompanyIds.has(c.id));

  const addMembership = () => {
    const next = availableCompanies[0];
    if (!next) return;
    setMemberships([...memberships, { customerId: next.id, permissions: [] }]);
  };
  const updateMembership = (index: number, patch: Partial<Membership>) =>
    setMemberships(memberships.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const removeMembership = (index: number) => setMemberships(memberships.filter((_, i) => i !== index));

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    onSubmit({
      email: email.trim(),
      name: name.trim() === "" ? null : name.trim(),
      isAdmin,
      isSupportAgent: isAdmin && isSupportAgent,
      isBlogAuthor,
      status,
      // Admins bypass portal permissions — no company memberships.
      memberships: isAdmin ? [] : memberships.filter((m) => m.customerId > 0),
    });
  };

  return (
    <form className="user-form space-y-4" onSubmit={submit}>
      <h3 className="font-medium">{editing ? "Benutzer bearbeiten" : "Neuer Benutzer"}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm mb-1 block">E-Mail</span>
          <input
            type="email"
            className="field-boxed w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm mb-1 block">Name</span>
          <input
            className="field-boxed w-full"
            value={name ?? ""}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          <span>Admin-Panel-Zugang</span>
        </label>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isSupportAgent} onChange={(e) => setIsSupportAgent(e.target.checked)} />
            <span>Support-Agent (Tickets zuweisbar)</span>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isAdmin || isBlogAuthor}
            disabled={isAdmin}
            onChange={(e) => setIsBlogAuthor(e.target.checked)}
          />
          <span>Blog-Autor{isAdmin ? " (Admins immer)" : ""}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={status === "active"} onChange={(e) => setStatus(e.target.checked ? "active" : "disabled")} />
          <span>Aktiv</span>
        </label>
      </div>

      {isAdmin ? (
        <p className="text-xs opacity-60">
          Admins haben vollen Zugriff — Firmen-Zuordnungen &amp; Portal-Berechtigungen entfallen.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Firmen &amp; Berechtigungen</span>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={addMembership}
              disabled={availableCompanies.length === 0}
            >
              + Firma hinzufügen
            </button>
          </div>
          {memberships.length === 0 ? (
            <p className="text-xs opacity-60">Keine Firma zugeordnet — dieses Konto kann sich anmelden, sieht aber kein Portal.</p>
          ) : null}
          {memberships.map((m, i) => (
            <div key={m.customerId} className="tds-card p-3 space-y-3">
              {/* Wraps: a dropdown's min width is set by its widest option —
                  company names here — so it cannot shrink to share a row with
                  the button on a phone. (Don't write the tag name in this
                  comment: lint-primitives is a regex scan and reads it as an
                  unclassed control.) */}
              <div className="flex flex-wrap items-center gap-3">
                <select
                  className="field-boxed"
                  value={String(m.customerId)}
                  onChange={(e) => updateMembership(i, { customerId: Number(e.target.value) })}
                >
                  {companies
                    .filter((c) => c.id === m.customerId || !usedCompanyIds.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  {/* Fallback when the company list is unavailable but a membership exists. */}
                  {companies.every((c) => c.id !== m.customerId) ? (
                    <option value={m.customerId}>Firma #{m.customerId}</option>
                  ) : null}
                </select>
                <button type="button" className="btn btn-danger text-xs ml-auto" onClick={() => removeMembership(i)}>Entfernen</button>
              </div>

              <label className="tds-list__row" style={{ gap: "0.625rem" }}>
                <input
                  type="checkbox"
                  checked={m.isCompanyAdmin ?? false}
                  onChange={(e) => updateMembership(i, { isCompanyAdmin: e.target.checked })}
                />
                <span className="flex flex-col">
                  <span className="text-sm">Firmenadmin</span>
                  <span className="text-xs opacity-70">
                    Darf die Benutzer DIESER Firma selbst verwalten (Seite „Meine Firma“) —
                    begrenzt durch die Rechte, die der Firma freigegeben sind.
                  </span>
                </span>
              </label>

              {groups.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm">Gruppen</legend>
                  <p className="text-xs opacity-70">
                    Gruppenrechte gelten zusätzlich zu den einzeln vergebenen. Ändert jemand
                    die Gruppe, ändert sich damit auch, was ihre Mitglieder dürfen.
                  </p>
                  {groups
                    .filter((g) => g.scope === "platform" || g.companyId === m.customerId)
                    .map((g) => (
                      <label key={g.id} className="tds-list__row" style={{ gap: "0.625rem" }}>
                        <input
                          type="checkbox"
                          checked={(m.groupIds ?? []).includes(g.id)}
                          onChange={(e) =>
                            updateMembership(i, {
                              groupIds: e.target.checked
                                ? [...(m.groupIds ?? []), g.id]
                                : (m.groupIds ?? []).filter((id) => id !== g.id),
                            })
                          }
                        />
                        <span className="flex flex-col">
                          <span className="text-sm">{g.name}</span>
                          <span className="text-xs opacity-70">
                            {g.permissions.join(", ") || "keine Rechte"}
                          </span>
                        </span>
                      </label>
                    ))}
                </fieldset>
              ) : null}

              <PermissionPicker
                value={m.permissions}
                catalog={catalog}
                onChange={(perms) => updateMembership(i, { permissions: perms })}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={email.trim() === ""}>
          {editing ? "Speichern" : "Anlegen"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Abbrechen
          </button>
        ) : null}
      </div>
    </form>
  );
}
