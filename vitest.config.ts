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
  },
});
