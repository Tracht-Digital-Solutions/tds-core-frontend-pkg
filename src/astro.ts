import type { AstroIntegration } from "astro";

/**
 * `coreFrontendBase()` — the Astro integration that injects the base panel's routes
 * (Dashboard, Nutzer, Einstellungen, API-Wiki) into a consuming product build.
 * Login lives on the central site (auth.tracht-digital.de / tds-auth), so there
 * is no in-app /login route — the pre-paint gate bounces there instead. A product
 * repo (tds-admin-panel / tds-customer-panel) adds this
 * alongside `frontendHost({ extensions })` (which injects the extension routes +
 * widget/settings virtual modules) — so one shared host codebase serves every
 * product target, each owning only its extension set + pipeline.
 *
 * The entrypoints are package subpaths (resolved from the product's node_modules);
 * their relative imports (Layout, components, lib, styles) resolve within this
 * package. Uses the SAME injectRoute mechanism frontend-contract already uses for
 * extension pages.
 */
const PKG = "@tracht-digital-solutions/tds-core-frontend";

const BASE_ROUTES: ReadonlyArray<{ pattern: string; entrypoint: string }> = [
  { pattern: "/", entrypoint: `${PKG}/src/pages/index.astro` },
  { pattern: "/users", entrypoint: `${PKG}/src/pages/users.astro` },
  { pattern: "/einstellungen", entrypoint: `${PKG}/src/pages/einstellungen.astro` },
  { pattern: "/wiki", entrypoint: `${PKG}/src/pages/wiki.astro` },
];

export function coreFrontendBase(): AstroIntegration {
  return {
    name: "tds-core-frontend-base",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        for (const route of BASE_ROUTES) {
          injectRoute(route);
        }
      },
    },
  };
}

export default coreFrontendBase;
