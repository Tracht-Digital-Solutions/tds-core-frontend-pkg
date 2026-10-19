import { useState } from "react";
import { TabPanel, Tabs } from "@tracht-digital-solutions/tds-shared/components";

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
      <Tabs
        label="Zugriffsverwaltung"
        idPrefix="access"
        tabs={TABS.map((entry) => [entry.id, entry.label] as const)}
        value={tab}
        onChange={show}
      />

      <TabPanel idPrefix="access" id="users" active={tab === "users"}>
        {seen.includes("users") && <UsersAdmin />}
      </TabPanel>
      <TabPanel idPrefix="access" id="groups" active={tab === "groups"}>
        {seen.includes("groups") && <GroupsAdmin />}
      </TabPanel>
      <TabPanel idPrefix="access" id="quotas" active={tab === "quotas"}>
        {seen.includes("quotas") && <CompanyQuotasAdmin />}
      </TabPanel>
    </div>
  );
}
