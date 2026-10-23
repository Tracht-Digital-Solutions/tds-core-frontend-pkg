import { describe, expect, it } from "vitest";

import type { NavSection } from "./navModel";
import { fold, quickEntries, searchEntries, visibleEntries, type QuickEntry } from "./quickNav";

const sections: NavSection[] = [
  { key: "start", items: [{ href: "/", label: "Dashboard", active: false }] },
  {
    key: "support",
    label: "Support",
    items: [
      { href: "/tickets", label: "Tickets", active: false, permission: "tickets:read" },
      { href: "/kontakt", label: "Kontaktanfragen", active: false },
    ],
  },
  {
    key: "system",
    label: "System",
    items: [{ href: "/einstellungen", label: "Einstellungen", active: false, revealFor: "platform-admin" }],
  },
];

const entries = quickEntries(sections, [
  { id: "mail", label: "E-Mail (SMTP)" },
  { id: "support-tickets", label: "Support-Tickets", permission: "tickets:manage" },
]);

describe("quickEntries", () => {
  it("lists every nav row and every settings section", () => {
    expect(entries.map((e) => e.href)).toEqual([
      "/",
      "/tickets",
      "/kontakt",
      "/einstellungen",
      "/einstellungen#settings-mail",
      "/einstellungen#settings-support-tickets",
    ]);
  });

  it("gates a settings section like the page does: permission, else platform admin", () => {
    expect(entries[4]).toMatchObject({ group: "Einstellungen", revealFor: "platform-admin" });
    expect(entries[5]).toMatchObject({ permission: "tickets:manage" });
    expect(entries[5]!.revealFor).toBeUndefined();
  });
});

describe("visibleEntries", () => {
  it("offers only ungated entries without a grant", () => {
    expect(visibleEntries(entries, null).map((e) => e.label)).toEqual(["Dashboard", "Kontaktanfragen"]);
  });

  it("applies permissions and flags", () => {
    const grant = { flags: {}, admin: false, permissions: ["tickets:read"] };
    expect(visibleEntries(entries, grant).map((e) => e.label)).toEqual(["Dashboard", "Tickets", "Kontaktanfragen"]);
  });

  it("shows everything to a platform admin", () => {
    const grant = { flags: { "platform-admin": true }, admin: true, permissions: [] };
    expect(visibleEntries(entries, grant)).toHaveLength(entries.length);
  });
});

describe("searchEntries", () => {
  const list: QuickEntry[] = [
    { href: "/a", label: "Rechnungen", group: "Abrechnung" },
    { href: "/b", label: "Support-Tickets", group: "Einstellungen" },
    { href: "/c", label: "Tickets", group: "Support" },
    { href: "/d", label: "Grüße", group: "Content" },
  ];

  it("keeps nav order for an empty query", () => {
    expect(searchEntries(list, "  ")).toEqual(list);
  });

  it("ranks a label prefix before a word start before the group", () => {
    expect(searchEntries(list, "tick").map((e) => e.href)).toEqual(["/c", "/b"]);
    expect(searchEntries(list, "support").map((e) => e.href)).toEqual(["/b", "/c"]);
  });

  it("requires every term", () => {
    expect(searchEntries(list, "tickets einst").map((e) => e.href)).toEqual(["/b"]);
  });

  it("ignores case, accents and ß", () => {
    expect(fold("Grüße")).toBe("grusse");
    expect(searchEntries(list, "GRUSS").map((e) => e.href)).toEqual(["/d"]);
  });

  it("treats regex characters literally", () => {
    expect(searchEntries(list, "(")).toEqual([]);
  });
});
