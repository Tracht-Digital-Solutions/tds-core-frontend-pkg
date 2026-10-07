# Testing

`npm run test:run` runs vitest 4. DOM suites opt into jsdom via a `@vitest-environment` docblock; the rest run in
node. The `.astro` shell relies on the product build and `astro check`. CI (`_build.yml`) runs the tests along with
type-check and `lint:primitives`; the products' release workflows don't, so this repo's CI is the gate.

## Setup

- **`vitest.config.ts` sets `unstubGlobals: true`.** `restoreMocks` doesn't undo `vi.stubGlobal`, and a leaked stub
  makes later `vi.spyOn` return the same mock, sharing call history across tests.
- `redirectToLogin` latches on a module-level `redirecting` flag; re-import via `vi.resetModules()` per test.
- jsdom's `window` is shared within a file; unregister listeners per case (e.g. preferences).

## Key suites

| Suite | Covers |
|---|---|
| `auth.test.ts` | The 401 backstop: a scoped 401 with a live `/me` returns to the caller and keeps the hint |
| `target.test.ts` | Different `HINT_PREFIX` per product |
| `astro.test.ts` | Every injected entrypoint exists on disk; the prerendered set is exactly `/404` and `/500` |
| `Layout.test.ts` | Gate hex fallbacks against the installed tds-shared canvas |
| `notificationFeed.test.ts` | Restraint: hidden tabs don't poll, 401/403 stops, transport failures aren't toasted, the cursor advances |
| `dashboardLayout.test.ts` | Progressive enhancement (no layout / API error / unreachable → authored order); all four save branches via `tds:toast` |
| `ModulesAdmin.test.tsx` | One read-only request; no update or deploy control |
| `panelHues.test.ts` | One distinct hue per group; the mapping |
| `moduleInventory`, `activeCompany` / `actAsHeaders` tests | Inventory degradation; auth prefix excluded first |

## Type-checking extension islands: `npm run type-check:extensions`

Nothing in the normal pipeline type-checks an extension's `.tsx`:

- product repos have no `src/`, so their `astro check` checks 0 files;
- `astro build` strips types with esbuild (type errors build green; syntax errors fail);
- extension repos don't install tds-shared (a peer), so `tsc` there can't resolve imports.

`tsconfig.extcheck.json` checks every sibling `tds-ext-*-pkg/islands/**/*.tsx` against this repo's installed
dependencies (with a `paths` block). Run it after touching any island. It needs the full workspace, so it's a local
tool, not CI, and is excluded from the published package.
