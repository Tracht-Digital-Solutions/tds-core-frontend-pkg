import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import type { ModuleEntry } from "./lib/moduleUpdates.js";

/**
 * `coreFrontendBase()` — the Astro integration that injects the base panel's routes
 * (Dashboard, Nutzer, Module, Einstellungen, API-Wiki) into a consuming product
 * build. Login lives on the central site (auth.tracht-digital.de / tds-auth), so there
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
 *
 * It also serves one virtual module of its own — `virtual:frontend-modules`, the
 * composed package inventory the Module page renders. See {@link readInventory}.
 */
const PKG = "@tracht-digital-solutions/tds-core-frontend";

const BASE_ROUTES: ReadonlyArray<{ pattern: string; entrypoint: string }> = [
  { pattern: "/", entrypoint: `${PKG}/src/pages/index.astro` },
  { pattern: "/users", entrypoint: `${PKG}/src/pages/users.astro` },
  { pattern: "/module", entrypoint: `${PKG}/src/pages/module.astro` },
  { pattern: "/einstellungen", entrypoint: `${PKG}/src/pages/einstellungen.astro` },
  { pattern: "/wiki", entrypoint: `${PKG}/src/pages/wiki.astro` },
];

/** The virtual module id the Module page imports. */
export const MODULES_MODULE_ID = "virtual:frontend-modules";

/** Scope every platform package shares. */
const SCOPE = "@tracht-digital-solutions/";

/** German display names for the packages that are not feature modules. */
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  "tds-core-frontend": "Frontend-Host (Basis)",
  "tds-frontend-contract": "Frontend-Contract (SDK)",
  "tds-shared": "Design- & i18n-Bibliothek",
};

export function coreFrontendBase(): AstroIntegration {
  return {
    name: "tds-core-frontend-base",
    hooks: {
      "astro:config:setup": async (options) => {
        const { injectRoute, config, updateConfig } = options;
        for (const route of BASE_ROUTES) {
          injectRoute(route);
        }

        // Only reachable in a real product build — the unit tests call this hook
        // with `injectRoute` alone, and a host without a resolvable product root
        // still builds (the Module page then simply has nothing to list).
        if (!config?.root || typeof updateConfig !== "function") return;
        const modules = await readInventory(config.root);
        updateConfig({ vite: { plugins: [modulesVitePlugin(modules)] } });
      },
    },
  };
}

/**
 * Read the composed package inventory from the PRODUCT repo at build time.
 *
 * This is the only moment the truth exists in one place: the pinned range lives
 * in the product's `package.json`, the installed version in its `node_modules`,
 * and the German module name inside each extension's manifest. At runtime the
 * static build has none of it and the API knows only the Composer half — so the
 * inventory is baked in here, and the browser only asks the API what the
 * registry currently publishes.
 *
 * Every step degrades rather than failing: a product whose `package.json` cannot
 * be read yields an empty list, and an extension whose manifest will not import
 * still lists with a name derived from its package name. A build must never
 * break over an admin page's metadata.
 */
export async function readInventory(root: URL): Promise<ModuleEntry[]> {
  let deps: Record<string, string>;
  try {
    const raw = readFileSync(fileURLToPath(new URL("package.json", root)), "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    deps = parsed.dependencies ?? {};
  } catch {
    return [];
  }

  const entries: ModuleEntry[] = [];
  for (const [pkg, range] of Object.entries(deps)) {
    if (!pkg.startsWith(SCOPE)) continue;
    const short = pkg.slice(SCOPE.length);
    const isExtension = short.startsWith("tds-ext-");

    let installed = "";
    try {
      const raw = readFileSync(fileURLToPath(new URL(`node_modules/${pkg}/package.json`, root)), "utf8");
      installed = String((JSON.parse(raw) as { version?: string }).version ?? "");
    } catch {
      /* not installed (yet) — the row still renders, as "unbekannt" */
    }

    let id: string | undefined;
    let name = PLATFORM_NAMES[short] ?? short;
    if (isExtension) {
      // Fallback name derived from the package: tds-ext-blog-cms → blog-cms.
      // It is only a fallback — the manifest carries the real German label and
      // the real module id, which need NOT match the repo suffix (tds-ext-
      // support-tickets declares the id `tickets`).
      name = short.slice("tds-ext-".length);
      try {
        const manifest = (await import(/* @vite-ignore */ pkg)) as {
          default?: { id?: string; name?: string };
        };
        if (manifest.default?.id) id = manifest.default.id;
        if (manifest.default?.name) name = manifest.default.name;
      } catch {
        /* manifest not importable in this context — keep the derived name */
      }
    }

    entries.push({
      pkg,
      ...(id ? { id } : {}),
      name,
      installed,
      range: String(range ?? ""),
      kind: isExtension ? "extension" : "platform",
    });
  }

  // Platform packages first (they gate everything else), then modules by name.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "platform" ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
}

/** Minimal structural mirror of the two Vite plugin hooks this uses. */
interface VitePluginLike {
  name: string;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
}

/** Serves `virtual:frontend-modules` as plain data (no components involved). */
function modulesVitePlugin(modules: ModuleEntry[]): VitePluginLike {
  const resolved = "\0" + MODULES_MODULE_ID;
  return {
    name: "tds-frontend-modules",
    resolveId(id) {
      return id === MODULES_MODULE_ID ? resolved : undefined;
    },
    load(id) {
      return id === resolved ? `export const modules = ${JSON.stringify(modules)};\n` : undefined;
    },
  };
}

export default coreFrontendBase;
