import { describe, expect, it } from "vitest";
import { FAQ_ENTRIES, faqForTarget } from "./faq";

/**
 * The FAQ is shell content, so what is worth pinning is the contract the page
 * relies on: stable anchor ids, target scoping, and the fact that answers stay
 * PLAIN TEXT — FaqList interpolates them, so markup here would ship escaped
 * (and a future `set:html` would be an injection vector).
 */
describe("FAQ entries", () => {
  it("has unique, anchor-safe ids", () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("documents the central-login scope", () => {
    // The login page deliberately no longer advertises the cross-surface
    // session (tds-auth-frontend); this entry is where that moved to.
    const sso = FAQ_ENTRIES.find((e) => e.id === "sso-scope");
    expect(sso).toBeDefined();
    expect(sso!.answer.join(" ")).toMatch(/auth\.tracht-digital\.de/);
  });

  it("carries no markup in questions or answers", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.question).not.toMatch(/[<>]/);
      for (const paragraph of entry.answer) expect(paragraph).not.toMatch(/[<>]/);
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });
});

describe("faqForTarget", () => {
  it("keeps untargeted entries for both products", () => {
    const shared = FAQ_ENTRIES.filter((e) => e.target === undefined).map((e) => e.id);
    for (const target of ["admin", "customer"] as const) {
      const ids = faqForTarget(target).map((e) => e.id);
      expect(ids).toEqual(expect.arrayContaining(shared));
    }
  });

  it("drops entries scoped to the other product", () => {
    const ids = faqForTarget("customer").map((e) => e.id);
    const adminOnly = FAQ_ENTRIES.filter((e) => e.target === "admin").map((e) => e.id);
    for (const id of adminOnly) expect(ids).not.toContain(id);
  });
});
