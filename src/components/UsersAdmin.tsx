import { useEffect, useMemo, useState, type CSSProperties, type SubmitEvent } from "react";
import {
  PORTAL_PERMISSIONS,
  PORTAL_PERMISSION_LABELS,
  PORTAL_ROLE_PRESETS,
  type PortalPermission,
  type PortalRolePreset,
} from "@tracht-digital-solutions/tds-shared/permissions";
import { ConfirmDialog, FormAlert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { AUTH_API_URL, CUSTOMER_API_URL, frontendFetch } from "../lib/auth";

interface Membership {
  customerId: number;
  permissions: PortalPermission[];
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

interface Company {
  id: number;
  name: string;
}

const usersUrl = `${AUTH_API_URL}/admin/users`;
const companiesUrl = `${CUSTOMER_API_URL}/admin/customers`;

/**
 * Core user management (Nutzerverwaltung) — the base service's own screen. Users
 * live in tds-auth-api (`/admin/users`), companies in tds-customer-api
 * (`/admin/customers`). Beyond list/create/reset/delete this now offers the full
 * per-user editor: admin/support-agent/blog-author flags, account status, and
 * **company memberships with per-company portal permissions** (the fine-grained
 * RBAC). Admins bypass portal permissions, so their memberships are cleared.
 */
export default function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [uRes, cRes] = await Promise.all([frontendFetch(usersUrl), frontendFetch(companiesUrl)]);
      if (!uRes.ok) throw new Error(`Nutzer laden fehlgeschlagen (HTTP ${uRes.status}).`);
      const uData = await uRes.json();
      setUsers(uData.users ?? []);
      // The company list is best-effort — membership editing still works with a
      // reachable list; a failure just shows ids instead of names.
      const cData = cRes.ok ? await cRes.json() : { customers: [] };
      setCompanies(cData.customers ?? []);
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
        setNotice(`Nutzer angelegt. Temporäres Passwort: ${data.tempPassword}`);
      } else {
        toast.success("Nutzer angelegt.");
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
      toast.success("Nutzer gespeichert.");
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
          {showCreate ? "Abbrechen" : "Neuer Nutzer"}
        </button>
      </div>

      {showCreate ? (
        <UserForm companies={companies} onSubmit={createUser} onCancel={() => setShowCreate(false)} />
      ) : null}

      {users === null ? (
        <p role="status"><Spinner /></p>
      ) : users.length === 0 ? (
        <p className="tds-empty">Keine Nutzer.</p>
      ) : (
        <ul className="tds-stack">
          {users.map((u) => (
            <li key={u.id} className="tds-card p-4">
              {editingId === u.id ? (
                <UserForm
                  companies={companies}
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
                  <div className="flex flex-wrap gap-2 shrink-0">
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
        title={`Nutzer „${pendingDelete?.name ?? pendingDelete?.email ?? ""}“ wirklich löschen?`}
        message="Der Zugang und alle Firmen-Mitgliedschaften werden entfernt. Das lässt sich nicht rückgängig machen."
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** Checkbox grid + role presets for picking a company's portal permissions. */
function PermissionPicker({
  value,
  onChange,
}: {
  value: PortalPermission[];
  onChange: (next: PortalPermission[]) => void;
}) {
  const toggle = (key: PortalPermission) =>
    onChange(value.includes(key) ? value.filter((p) => p !== key) : [...value, key]);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {(Object.keys(PORTAL_ROLE_PRESETS) as PortalRolePreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => onChange([...PORTAL_ROLE_PRESETS[preset].permissions])}
          >
            {PORTAL_ROLE_PRESETS[preset].label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost text-xs" onClick={() => onChange([])}>Keine</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PORTAL_PERMISSIONS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(key)} onChange={() => toggle(key)} />
            <span>{PORTAL_PERMISSION_LABELS[key]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function UserForm({
  companies,
  initial,
  onSubmit,
  onCancel,
}: {
  companies: Company[];
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
      <h3 className="font-medium">{editing ? "Nutzer bearbeiten" : "Neuer Nutzer"}</h3>

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
              <div className="flex items-center gap-3">
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
              <PermissionPicker value={m.permissions} onChange={(perms) => updateMembership(i, { permissions: perms })} />
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
