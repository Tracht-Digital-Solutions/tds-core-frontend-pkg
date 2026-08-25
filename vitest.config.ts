import { defineConfig } from "vitest/config";

/**
 * The host ships its `src/` verbatim (products import `…/tds-core-frontend/src/*`
 * subpaths), so tests run against exactly the files a product build consumes.
 * Only `src/astro.ts` is bundled by tsup.
 *
 * DOM-dependent suites opt into jsdom with a `@vitest-environment` docblock;
 * the rest run in node.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
    // `restoreMocks` covers spies; it does NOT undo `vi.stubGlobal`, which a
    // dozen suites here use for `fetch` and `localStorage`. A leaked stub is
    // close to undebuggable, because `vi.spyOn` on an already-mocked function
    // returns that same mock instead of wrapping it — so every later test in
    // the file quietly shares one call history and only fails when the whole
    // file runs. tds-shared hit exactly that on the vitest 4 upgrade.
    unstubGlobals: true,
  },
});
