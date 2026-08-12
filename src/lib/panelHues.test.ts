import { describe, expect, it } from "vitest";

import { groupLabel, hueForKey, normaliseGroup, widgetIcon } from "./panelHues";

/**
 * The nav's colour-coding and the dashboard's per-widget hue both flow through
 * here. Every failure mode is silent in the browser: an empty hue makes the
 * `--nav-hue` var() fall back to nothing, and a group key that fails to
 * normalise grows a duplicate section heading in the rail.
 */

describe("normaliseGroup", () => {
  it("folds case and whitespace so extensions land in one section", () => {
    // An extension writing "Verwaltung" must join the base shell's own group,
    // not create a second heading with one orphaned link under it.
    expect(normaliseGroup("Verwaltung")).toBe("verwaltung");
    expect(normaliseGroup("  verwaltung ")).toBe("verwaltung");
  });

  it("defaults an absent group to Allgemein", () => {
    expect(normaliseGroup(undefined)).toBe("allgemein");
  });
});

describe("groupLabel", () => {
  it("gives the raw ids proper German labels", () => {
    // The rail rendered "WORK" and "ABRECHNUNG" — raw identifiers, uppercased
    // by .nav-group-label, in a German/English mix.
    expect(groupLabel("work")).toBe("Arbeit");
    expect(groupLabel("abrechnung")).toBe("Abrechnung");
  });

  it("capitalises an unknown group rather than showing a bare id", () => {
    expect(groupLabel("logistik")).toBe("Logistik");
  });
});

describe("hueForKey", () => {
  it("maps the known groups and widgets to their deliberate hues", () => {
    expect(hueForKey("support")).toBe("var(--color-cat-cyan)");
    expect(hueForKey("tickets-open")).toBe("var(--color-cat-cyan)");
    expect(hueForKey("verwaltung")).toBe("var(--tds-panel-accent)");
  });

  it("resolves a group through normalisation", () => {
    expect(hueForKey("Support")).toBe(hueForKey("support"));
  });

  it("is stable across calls for an unmapped key", () => {
    // A hue that changed between builds would make the nav flicker colour on
    // every deploy.
    const first = hueForKey("brand-new-extension");
    expect(hueForKey("brand-new-extension")).toBe(first);
  });

  it("never returns an empty value", () => {
    for (const key of ["", undefined, "unknown", "x"]) {
      expect(hueForKey(key)).toMatch(/^var\(--/);
    }
  });

  it("gives every real nav group its own hue", () => {
    // The rail's whole colour argument is that a zone is identifiable by its
    // hue. `tools` was missing from the map and its hashed fallback happened
    // to land on violet — the same violet as `content` — so two adjacent
    // sidebar zones read as one. Any group added later must be mapped, not
    // left to the hash.
    const groups = [
      "verwaltung",
      "support",
      "abrechnung",
      "content",
      "work",
      "tools",
      "allgemein",
    ];
    const hues = groups.map((g) => hueForKey(g));
    expect(new Set(hues).size).toBe(groups.length);
  });

  it("keeps Tools off the red end of the wheel", () => {
    // `verwaltung` renders `--tds-panel-accent`, which for the ADMIN product
    // is `--color-management` — the brand burgundy, since tds-shared 0.20.0.
    // Tools was on `--color-cat-rose`, and the two resolved to a ΔE of ~12:
    // distinct token names, one indistinguishable red in the actual rail.
    // The distinctness test above cannot catch that (it compares NAMES), and
    // tds-shared's ΔE test cannot see this file, so the mapping is pinned
    // here. If Tools ever needs rose back, the admin accent has to move.
    expect(hueForKey("tools")).not.toBe("var(--color-cat-rose)");
    expect(hueForKey("tools")).not.toBe(hueForKey("verwaltung"));
  });

  it("spreads unmapped keys across more than one categorical hue", () => {
    const hues = new Set(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"].map((k) =>
        hueForKey(k),
      ),
    );
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("widgetIcon", () => {
  it("maps the known widget ids", () => {
    expect(widgetIcon("time-week")).toBe("clock");
    expect(widgetIcon("messages-unread")).toBe("message-square");
  });

  it("falls back to the square glyph, never to nothing", () => {
    // Icon.astro renders the fallback for an unknown key too, but a blank
    // string here would leave the grid column empty and misalign the title.
    expect(widgetIcon("not-a-widget")).toBe("square");
    expect(widgetIcon(undefined)).toBe("square");
  });
});
