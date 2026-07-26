import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { coreFrontendBase } from "./astro";

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
    expect(coreFrontendBase().name).toBe("tds-core-panel-base");
  });

  it("registers the config:setup hook", () => {
    expect(coreFrontendBase().hooks["astro:config:setup"]).toBeTypeOf("function");
  });
});

describe("injected routes", () => {
  it("injects the four base pages", () => {
    expect(injectedRoutes().map((r) => r.pattern).sort()).toEqual([
      "/",
      "/einstellungen",
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
});
