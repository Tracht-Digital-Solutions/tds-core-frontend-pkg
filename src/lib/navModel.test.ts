import { describe, expect, it } from "vitest";

import { activeLabel, buildNavSections, isActivePath, type NavInput, type RegistryNavEntry } from "./navModel";

/**
 * The rail's sections, built once for the rail, the drawer, the quick search
 * and the mobile title. A wrong rule here is silent in the browser: a section
 * heading over one orphaned link, or the Dashboard buried under Verwaltung.
 */

const base: NavInput[] = [
  { href: "/", label: "Dashboard", icon: "layout-dashboard", order: 0, group: "start" },
  { href: "/users", label: "Benutzer", id: "users", order: 1, revealFor: "platform-admin" },
  { href: "/einstellungen", label: "Einstellungen", id: "einstellungen", order: 4, group: "system" },
  { href: "/module", label: "Module", id: "module", order: 5, group: "system" },
  { href: "/wiki", label: "API-Referenz", id: "wiki", order: 6, group: "system" },
  { href: "https://tools.example", label: "Tools-Website", id: "tools-site", order: 90, group: "tools", external: true },
];

const registry: RegistryNavEntry[] = [
  { href: "/tickets", label: "Tickets", group: "support", order: 10, permission: "tickets:read" },
  { href: "/messages", label: "Nachrichten", group: "support", order: 20 },
  { href: "/kontakt", label: "Kontaktanfragen", group: "Support", order: 20 },
  { href: "/firmen", label: "Firmen", group: "Verwaltung", order: 15 },
  { href: "/blog", label: "Blog-CMS", group: "content", order: 10 },
];

describe("buildNavSections", () => {
  it("puts the Dashboard alone and unlabelled first, Verwaltung next, System last", () => {
    const sections = buildNavSections(base, registry, "/");
    expect(sections.map((s) => s.key)).toEqual(["start", "verwaltung", "support", "content", "system"]);
    expect(sections[0]!.label).toBeUndefined();
    expect(sections[0]!.items.map((i) => i.label)).toEqual(["Dashboard"]);
    expect(sections.at(-1)!.label).toBe("System");
    expect(sections.at(-1)!.items.map((i) => i.label)).toEqual(["Einstellungen", "Module", "API-Referenz"]);
  });

  it("lets an extension writing 'Verwaltung' join the base section", () => {
    const verwaltung = buildNavSections(base, registry, "/").find((s) => s.key === "verwaltung")!;
    expect(verwaltung.items.map((i) => i.label)).toEqual(["Benutzer", "Firmen"]);
  });

  it("breaks an order tie alphabetically", () => {
    const support = buildNavSections(base, registry, "/").find((s) => s.key === "support")!;
    expect(support.items.map((i) => i.label)).toEqual(["Tickets", "Kontaktanfragen", "Nachrichten"]);
  });

  it("drops a base entry naming a group no extension created", () => {
    // The tools site joins `tools` only when the tools extension made it.
    const sections = buildNavSections(base, registry, "/");
    expect(sections.some((s) => s.key === "tools")).toBe(false);
    const withTools = buildNavSections(base, [...registry, { href: "/tools-verwaltung", label: "Tools", group: "tools", order: 50 }], "/");
    expect(withTools.find((s) => s.key === "tools")!.items.map((i) => i.label)).toEqual(["Tools", "Tools-Website"]);
  });

  it("keeps System last even when an extension joins it", () => {
    const sections = buildNavSections(base, [{ href: "/x", label: "Diagnose", group: "System", order: 50 }, ...registry], "/");
    expect(sections.at(-1)!.key).toBe("system");
    expect(sections.at(-1)!.items.map((i) => i.label)).toContain("Diagnose");
  });

  it("omits empty sections", () => {
    const sections = buildNavSections([base[0]!], [], "/");
    expect(sections.map((s) => s.key)).toEqual(["start"]);
  });

  it("carries the reveal gates through", () => {
    const sections = buildNavSections(base, registry, "/");
    const items = sections.flatMap((s) => s.items);
    expect(items.find((i) => i.href === "/users")!.revealFor).toBe("platform-admin");
    expect(items.find((i) => i.href === "/tickets")!.permission).toBe("tickets:read");
  });
});

describe("isActivePath", () => {
  it("matches the Dashboard only exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/", "/tickets")).toBe(false);
  });

  it("matches a subtree and ignores trailing slashes", () => {
    expect(isActivePath("/tickets", "/tickets/12/")).toBe(true);
    expect(isActivePath("/tickets/", "/tickets")).toBe(true);
    expect(isActivePath("/time", "/timeline")).toBe(false);
  });

  it("never matches an absolute URL", () => {
    expect(isActivePath("https://tools.example", "/")).toBe(false);
  });
});

describe("activeLabel", () => {
  it("names the page from its nav row", () => {
    expect(activeLabel(buildNavSections(base, registry, "/tickets/4"))).toBe("Tickets");
  });

  it("is undefined for a page the nav does not list", () => {
    expect(activeLabel(buildNavSections(base, registry, "/profil"))).toBeUndefined();
  });
});
