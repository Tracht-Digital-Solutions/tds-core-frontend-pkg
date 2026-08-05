import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { coreFrontendBase, readInventory } from "./astro";

/**
 * The integration injects the base routes into a product build. Two things bite
 * here, both silently:
 *
 *  - an entrypoint that names a page file which no longer exists fails the
 *    *product* build with an ENOENT (this is exactly what the stale `dist`
 *    carrying a removed `/login` route did),
 *  - a route pattern colliding with an extension's route breaks composition.
 */

const repoRoot = new URL("..", import.meta.url);
const PKG = "@tracht-digital-solutions/tds-core-frontend";

/** Run the integration's config:setup hook and collect the injected routes. */
function injectedRoutes(): { pattern: string; entrypoint: string }[] {
  const injectRoute = vi.fn();
  const integration = coreFrontendBase();
  const setup = integration.hooks["astro:config:setup"];
  if (!setup) throw new Error("integration has no astro:config:setup hook");

  // The hook receives Astro's full setup context, but this integration reads
  // only `injectRoute` — so pass just that, via `unknown` since the partial
  // object deliberately does not satisfy the full parameter type.
  (setup as unknown as (opts: { injectRoute: typeof injectRoute }) => void)({ injectRoute });
  return injectRoute.mock.calls.map((c) => c[0] as { pattern: string; entrypoint: string });
}

describe("integration envelope", () => {
  it("has a stable name", () => {
    // Left behind by the panel -> frontend rename: src/astro.ts renamed the
    // integration to `tds-core-frontend-base` but this assertion kept the old
    // value, so the suite has been red on a clean checkout since.
    expect(coreFrontendBase().name).toBe("tds-core-frontend-base");
  });

  it("registers the config:setup hook", () => {
    expect(coreFrontendBase().hooks["astro:config:setup"]).toBeTypeOf("function");
  });
});

describe("injected routes", () => {
  it("injects the five base pages", () => {
    expect(injectedRoutes().map((r) => r.pattern).sort()).toEqual([
      "/",
      "/einstellungen",
      "/module",
      "/users",
      "/wiki",
    ]);
  });

  it("does NOT inject an in-app /login route", () => {
    // Login lives on the central site; the pre-paint gate bounces there. A
    // resurrected /login route would shadow that and break SSO.
    expect(injectedRoutes().some((r) => r.pattern === "/login")).toBe(false);
  });

  it("has no duplicate patterns", () => {
    const patterns = injectedRoutes().map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("addresses every entrypoint as a package subpath", () => {
    // A relative path would resolve against the *product* repo, not this one.
    for (const route of injectedRoutes()) {
      expect(route.entrypoint.startsWith(`${PKG}/src/pages/`), route.pattern).toBe(true);
      expect(route.entrypoint.endsWith(".astro")).toBe(true);
    }
  });

  it("points every entrypoint at a page file that exists", () => {
    // The stale-dist bug: a removed page left in this list ENOENTs the product
    // build, far from the cause.
    for (const route of injectedRoutes()) {
      const rel = route.entrypoint.slice(`${PKG}/`.length);
      const abs = fileURLToPath(new URL(rel, repoRoot));
      expect(existsSync(abs), `missing page for ${route.pattern}: ${rel}`).toBe(true);
    }
  });

  it("is callable repeatedly without accumulating state", () => {
    expect(injectedRoutes()).toEqual(injectedRoutes());
  });

  it("still injects its routes when the setup context carries no config", () => {
    // The inventory step needs `config.root` + `updateConfig`; the routes must
    // not depend on it. A guard placed before the loop would take the whole
    // base panel down in any context that supplies a partial hook argument.
    expect(injectedRoutes().length).toBe(5);
  });
});

/**
 * A throwaway product checkout. Built on disk rather than committed because a
 * fixture needs a `node_modules/` directory, which every repo here gitignores —
 * a committed one would silently disappear on a fresh clone.
 */
let fixtureRoot: URL;
let fixtureDir: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "tds-inventory-"));
  writeFileSync(
    join(fixtureDir, "package.json"),
    JSON.stringify({
      name: "tds-fake-frontend",
      dependencies: {
        astro: "^6.4.2",
        "@tracht-digital-solutions/tds-shared": "^0.16.0",
        "@tracht-digital-solutions/tds-ext-blog-cms": "^0.1.1",
        "@tracht-digital-solutions/tds-ext-ghost": "^0.1.0",
      },
    }),
  );

  const install = (pkg: string, version: string) => {
    const dir = join(fixtureDir, "node_modules", ...pkg.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version }));
  };
  install("@tracht-digital-solutions/tds-shared", "0.16.0");
  install("@tracht-digital-solutions/tds-ext-blog-cms", "0.1.29");
  // tds-ext-ghost is declared but deliberately NOT installed.

  fixtureRoot = pathToFileURL(fixtureDir + "/");
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("module inventory", () => {
  it("reads versions and pins from a product's package.json", async () => {
    const modules = await readInventory(fixtureRoot);
    const byPkg = new Map(modules.map((m) => [m.pkg, m]));

    const ext = byPkg.get("@tracht-digital-solutions/tds-ext-blog-cms");
    expect(ext?.installed).toBe("0.1.29");
    expect(ext?.range).toBe("^0.1.1");
    expect(ext?.kind).toBe("extension");
  });

  it("ignores third-party dependencies", () => {
    // Only first-party packages are the platform's to update — astro and react
    // move on their own schedule and have no deploy button.
    return readInventory(fixtureRoot).then((modules) => {
      expect(modules.some((m) => m.pkg === "astro")).toBe(false);
      expect(modules.every((m) => m.pkg.startsWith("@tracht-digital-solutions/"))).toBe(true);
    });
  });

  it("lists a package that is declared but not installed, as an empty version", async () => {
    // A missing node_modules entry must still produce a ROW: dropping it would
    // hide the one module whose install actually failed.
    const modules = await readInventory(fixtureRoot);
    const missing = modules.find((m) => m.pkg === "@tracht-digital-solutions/tds-ext-ghost");
    expect(missing).toBeDefined();
    expect(missing?.installed).toBe("");
  });

  it("falls back to a name derived from the package when the manifest will not import", async () => {
    const modules = await readInventory(fixtureRoot);
    expect(modules.find((m) => m.pkg === "@tracht-digital-solutions/tds-ext-blog-cms")?.name).toBe("blog-cms");
  });

  it("sorts platform packages ahead of feature modules", async () => {
    const kinds = (await readInventory(fixtureRoot)).map((m) => m.kind);
    expect(kinds.indexOf("platform")).toBeLessThan(kinds.indexOf("extension"));
    // and no platform entry appears after the first extension
    expect(kinds.lastIndexOf("platform")).toBeLessThan(kinds.indexOf("extension"));
  });

  it("returns an empty inventory instead of throwing on an unreadable root", async () => {
    // The Module page is metadata; a product build must never fail over it.
    await expect(readInventory(new URL("no-such-dir/", repoRoot))).resolves.toEqual([]);
  });
});
