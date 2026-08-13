import { useState } from "react";

import CompanyQuotasAdmin from "./CompanyQuotasAdmin";
import GroupsAdmin from "./GroupsAdmin";
import UsersAdmin from "./UsersAdmin";

/**
 * The three access-control surfaces, behind one route.
 *
 * Deliberately tabs inside one island rather than three `BASE_ROUTES` entries
 * and three nav rows: groups and quotas are edited a couple of times a year,
 * and they only make sense next to the users they apply to. Splitting them out
 * would cost two permanent nav rows in both products.
 *
 * Each panel loads on first view — mounting all three would fire the company
 * list, the permission catalog and the group list three times on a page most
 * visitors open to edit one user.
 */

type Tab = "users" | "groups" | "quotas";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Benutzer" },
  { id: "groups", label: "Gruppen" },
  { id: "quotas", label: "Firmen-Kontingente" },
];

export default function AccessAdmin() {
  const [tab, setTab] = useState<Tab>("users");
  // Which panels have been opened. A panel mounts on first view and then STAYS
  // mounted, hidden: unmounting on a tab switch would throw away a half-typed
  // user form, and re-mounting would re-fetch the catalog every time.
  const [seen, setSeen] = useState<Tab[]>(["users"]);

  function show(next: Tab) {
    setTab(next);
    setSeen((current) => (current.includes(next) ? current : [...current, next]));
  }

  return (
    <div className="space-y-6">
      {/* `.chip` is the accepted alternative to `.btn` for tab controls. */}
      <div className="tds-toolbar" role="tablist" aria-label="Zugriffsverwaltung">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`access-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`access-panel-${entry.id}`}
            className={`chip ${tab === entry.id ? "chip--info" : "chip--neutral"}`}
            onClick={() => show(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="access-panel-users" aria-labelledby="access-tab-users" hidden={tab !== "users"}>
        {seen.includes("users") && <UsersAdmin />}
      </div>
      <div role="tabpanel" id="access-panel-groups" aria-labelledby="access-tab-groups" hidden={tab !== "groups"}>
        {seen.includes("groups") && <GroupsAdmin />}
      </div>
      <div role="tabpanel" id="access-panel-quotas" aria-labelledby="access-tab-quotas" hidden={tab !== "quotas"}>
        {seen.includes("quotas") && <CompanyQuotasAdmin />}
      </div>
    </div>
  );
}
