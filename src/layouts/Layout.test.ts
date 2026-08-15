import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The pre-paint auth gate's hard-coded colours.
 *
 * `Layout.astro` paints a full-screen backdrop BEFORE the CSS bundle loads, so
 * it cannot use a class and cannot rely on any token being defined yet. It
 * writes `var(--tds-panel-canvas, #xxxxxx)`: the token when it exists, a
 * literal for the few milliseconds before it does.
 *
 * That literal deliberately mirrors the panel CANVAS, not `--color-paper` —
 * the page has sat on the tinted canvas since tds-shared 0.15.0, so painting
 * plain paper would step colour at the exact moment the bundle lands, which is
 * the one frame this whole mechanism exists to make seamless.
 *
 * WHY THIS TEST EXISTS: when the canvas formula changed in tds-shared 0.23.0
 * (a 3% accent tint over a 40% sand / 60% paper blend, replacing 4% over bare
 * paper) the literals had to be re-derived BY HAND, and nothing would have
 * complained if they had not been. There is no runtime error, no failing
 * assertion anywhere else, and no way to see it except catching the reveal
 * frame in a browser. So this resolves the real token chain out of the
 * INSTALLED tds-shared and checks the literals against it.
 *
 * It is the first test in this repo that reads a source file rather than
 * importing a module; the pattern comes from `design.test.ts` in tds-shared
 * and `static-posture.test.ts` in tds-auth-frontend.
 */

const require_ = createRequire(import.meta.url);
/**
 * Resolve the stylesheets through the package's own `exports` map — the same
 * specifiers `global.css` imports, so this reads exactly the files a product
 * build consumes. (Resolving `…/package.json` instead does NOT work: the
 * manifest is not in the exports map.)
 */
const sharedStyle = (subpath: string) =>
  require_.resolve(`@tracht-digital-solutions/tds-shared/styles/${subpath}`);

const layout = readFileSync(join(__dirname, "Layout.astro"), "utf8");
const baseCss = readFileSync(sharedStyle("base.css"), "utf8");
const panelCss = readFileSync(sharedStyle("surfaces/panel.css"), "utf8");

/** Strip comments so prose in a docblock never counts as a declaration. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

type RGB = [number, number, number];

const hexOf = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** `color-mix(in srgb, a <share>%, b)` — a's share of a, the rest b. */
const mix = (a: RGB, b: RGB, shareOfA: number): RGB => [
  a[0] * shareOfA + b[0] * (1 - shareOfA),
  a[1] * shareOfA + b[1] * (1 - shareOfA),
  a[2] * shareOfA + b[2] * (1 - shareOfA),
];

/**
 * A colour token's value, read from base.css's light block or its dark one.
 * (Deliberately a small local duplicate of the helpers in tds-shared's
 * design.test.ts — test helpers cannot be shared across package boundaries,
 * and 15 lines of colour maths is not worth an export. Don't promote it.)
 */
const token = (name: string, theme: "light" | "dark"): RGB => {
  const css = stripComments(baseCss);
  const darkAt = css.indexOf('[data-theme="dark"]');
  const scope = theme === "dark" ? css.slice(darkAt) : css.slice(0, darkAt);
  const hex = scope.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!hex) throw new Error(`${name} (${theme}) not found in the installed base.css`);
  return hexOf(hex);
};

/**
 * The canvas as `surfaces/panel.css` actually computes it, with the shares read
 * back out of the stylesheet rather than restated here — restating them is how
 * a test like this goes stale in the same silent way as the thing it guards.
 */
const canvas = (accentToken: string, theme: "light" | "dark"): RGB => {
  const css = stripComments(panelCss);
  const decl = css.match(/--tds-panel-canvas:\s*color-mix\(([\s\S]*?)\);/)?.[1];
  if (!decl) throw new Error("--tds-panel-canvas not found in surfaces/panel.css");
  const shares = [...decl.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
  const [accentShare, sandShare] = shares;
  if (accentShare === undefined || sandShare === undefined) {
    throw new Error(`--tds-panel-canvas no longer has two mix shares: ${decl}`);
  }
  const ground = mix(token("--color-soft", theme), token("--color-paper", theme), sandShare);
  return mix(token(accentToken, theme), ground, accentShare);
};

/** The literal the gate falls back to, per theme. */
const fallback = (theme: "light" | "dark"): RGB => {
  const re =
    theme === "dark"
      ? /html\[data-theme="dark"\]\.auth-checking::before\s*\{[^}]*var\(--tds-panel-canvas,\s*(#[0-9a-f]{6})/i
      : /html\.auth-checking::before\s*\{[^}]*var\(--tds-panel-canvas,\s*(#[0-9a-f]{6})/i;
  const hex = layout.match(re)?.[1];
  if (!hex) throw new Error(`no ${theme} pre-paint fallback found in Layout.astro`);
  return hexOf(hex);
};

describe("pre-paint gate backdrop", () => {
  it("prefers the token and only falls back to a literal", () => {
    // The literal is the few-millisecond stand-in, never the primary value —
    // hard-coding the colour outright would freeze the gate at whatever the
    // canvas looked like the day it was written.
    const uses = [...layout.matchAll(/\.auth-checking::before\s*\{[^}]*background:\s*([^;]+);/g)];
    expect(uses.length, "the gate's backdrop rules moved or were renamed").toBe(2);
    for (const [, value] of uses) {
      expect(value).toMatch(/^var\(--tds-panel-canvas,\s*#[0-9a-f]{6}\)$/i);
    }
  });

  it.each(["light", "dark"] as const)(
    "keeps the %s literal on the canvas the products actually paint",
    (theme) => {
      // The two products render different canvases (the portal tints with
      // --color-primary, the management frontend with --color-management), and
      // ONE literal serves both. Comparing against their midpoint is what makes
      // the tolerance meaningful: today's literals sit within ~1.5 of it, while
      // the pre-0.23.0 pair (#f0f1f1 / #0d101d) sits at 4.9 and 4.5 — so a
      // tolerance of 3 demonstrably catches the drift that actually happened,
      // where "close enough to either product" would have waved it through.
      const portal = canvas("--color-primary", theme);
      const management = canvas("--color-management", theme);
      const midpoint: RGB = [
        (portal[0] + management[0]) / 2,
        (portal[1] + management[1]) / 2,
        (portal[2] + management[2]) / 2,
      ];
      const literal = fallback(theme);
      const channels = ["r", "g", "b"] as const;
      for (const [i, ch] of channels.entries()) {
        expect(
          Math.abs(literal[i] - midpoint[i]),
          `${theme} fallback ${ch}: ${literal[i]} vs computed canvas ${midpoint[i].toFixed(1)} — ` +
            `the --tds-panel-canvas formula moved, re-derive the literal in Layout.astro`,
        ).toBeLessThanOrEqual(3);
      }
    },
  );
});
