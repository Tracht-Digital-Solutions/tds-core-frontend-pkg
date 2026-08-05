import { describe, expect, it } from "vitest";
import {
  classify,
  compareVersions,
  parseVersion,
  satisfiesRange,
  suggestedRange,
  type ModuleEntry,
} from "./moduleUpdates";

/**
 * The verdict this file computes decides what a button does: `update` promises
 * a rebuild will deliver the new version, `repin` says it will not. Getting the
 * 0.x caret rule wrong inverts that promise silently — the admin presses
 * "Aktualisieren", the pipeline runs green, and nothing changes.
 */

const entry = (over: Partial<ModuleEntry> = {}): ModuleEntry => ({
  pkg: "@tracht-digital-solutions/tds-ext-blog-cms",
  id: "blog-cms",
  name: "Blog-CMS",
  installed: "0.1.29",
  range: "^0.1.1",
  kind: "extension",
  ...over,
});

describe("parseVersion", () => {
  it("reads plain and prerelease versions", () => {
    expect(parseVersion("0.16.0")).toEqual({ major: 0, minor: 16, patch: 0, prerelease: "" });
    expect(parseVersion("1.2.3-dev.4")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: "dev.4" });
  });

  it("rejects anything that is not a full triple", () => {
    // A partial version reaching the comparator would compare as equal and
    // report "Aktuell" for a module nobody can account for.
    for (const bad of ["1.2", "v1.2.3", "", "latest", "0.1.x"]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.1", "0.1.1")).toBe(0);
  });

  it("sorts a prerelease BELOW its release", () => {
    // Every package repo publishes a `@dev` prerelease on each push to main. If
    // those outranked the release, every module would permanently claim an
    // available update.
    expect(compareVersions("0.2.0-dev.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-dev.1")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-dev.1", "0.2.0-dev.2")).toBeLessThan(0);
  });
});

describe("satisfiesRange", () => {
  it("locks a 0.x caret to its minor line", () => {
    // The platform's central pin rule: ^0.1.1 is >=0.1.1 <0.2.0.
    expect(satisfiesRange("0.1.29", "^0.1.1")).toBe(true);
    expect(satisfiesRange("0.2.0", "^0.1.1")).toBe(false);
    expect(satisfiesRange("0.1.0", "^0.1.1")).toBe(false);
  });

  it("locks a 1.x caret to its major line", () => {
    expect(satisfiesRange("1.9.9", "^1.4.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.4.0")).toBe(false);
  });

  it("locks a 0.0.x caret to the exact patch", () => {
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("handles tilde, >=, exact and wildcard", () => {
    expect(satisfiesRange("0.1.9", "~0.1.1")).toBe(true);
    expect(satisfiesRange("0.2.0", "~0.1.1")).toBe(false);
    expect(satisfiesRange("9.9.9", ">=0.1.0")).toBe(true);
    expect(satisfiesRange("0.1.1", "0.1.1")).toBe(true);
    expect(satisfiesRange("0.1.2", "0.1.1")).toBe(false);
    expect(satisfiesRange("0.1.2", "*")).toBe(true);
  });

  it("answers null — not false — for a range it cannot parse", () => {
    // "I cannot tell" and "no" must stay distinguishable: a false here would
    // render "Repin erforderlich" for a range that is perfectly fine.
    expect(satisfiesRange("0.1.2", "0.1 || 0.2")).toBeNull();
    expect(satisfiesRange("0.1.2", "github:owner/repo")).toBeNull();
    expect(satisfiesRange("nonsense", "^0.1.0")).toBeNull();
  });
});

describe("classify", () => {
  it("calls an in-range newer version an update", () => {
    expect(classify(entry(), "0.1.30")).toBe("update");
  });

  it("calls an out-of-range newer version a repin", () => {
    // A rebuild would NOT pick 0.2.0 up — telling the admin "Update verfügbar"
    // here promises a deploy that changes nothing.
    expect(classify(entry(), "0.2.0")).toBe("repin");
  });

  it("calls equality current", () => {
    expect(classify(entry({ installed: "0.1.29" }), "0.1.29")).toBe("current");
  });

  it("calls a build ahead of the registry a prerelease, not an update", () => {
    expect(classify(entry({ installed: "0.1.30" }), "0.1.29")).toBe("ahead");
  });

  it("stays unknown when the registry did not answer", () => {
    expect(classify(entry(), null)).toBe("unknown");
    expect(classify(entry(), undefined)).toBe("unknown");
    expect(classify(entry(), "")).toBe("unknown");
  });

  it("stays unknown for an unparseable range rather than guessing", () => {
    expect(classify(entry({ range: "workspace:*" }), "0.9.0")).toBe("unknown");
  });
});

describe("suggestedRange", () => {
  it("spells out the replacement pin", () => {
    expect(suggestedRange("0.2.0")).toBe("^0.2.0");
    expect(suggestedRange("nope")).toBeNull();
  });
});
