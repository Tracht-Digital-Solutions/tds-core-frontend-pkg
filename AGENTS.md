# AGENTS.md — tds-core-frontend-pkg

The **base frontend host** (`@tracht-digital-solutions/tds-core-frontend`): shell and chrome, the
pre-paint auth gate, nav, dashboard widget host, wiki, user and access management, settings framework,
module inventory, and the API fetch wiring. Both panel products (`tds-admin-frontend`,
`tds-customer-frontend`) compose it with their extension sets at build time and render it server-side.
Extensions contribute through `tds-frontend-contract-pkg` and are never edited here.

Read `tds-frontend-contract-pkg/AGENTS.md` first.

## Commands

```bash
npm install --no-package-lock    # never npm ci
npm run type-check               # tsc
npm run lint:primitives
npm run test:run                 # vitest 4
npm run build                    # tsup
npm run type-check:extensions    # local only: type-checks every sibling tds-ext-*-pkg island
```

## Hard rules

- **No runtime plugin loading**; composition stays a build step.
- **No page cache and no server-side session check** in the panels; the gate stays client-side.
- tds-shared is a **peer** dependency; a product must resolve exactly one version.
- One panel design: target differences only via `config/target.ts` (functional values, brand suffix, accent).
- The shell owns the **one** `ToastHost`; never mount another.
- Never redirect on a missing hint; a `/me` 401 tries `/refresh` once before logout.
- `actAsHeaders()` must exclude the auth API prefix first.
- Don't hand-author a radius or colour, or re-declare a shared class; set a token in tds-shared.
- No multi-line `{/* … */}` in `Layout.astro`'s template body.
- `src/styles/global.css` imports `tailwindcss/index.css`; never `@tailwindcss/vite`.
- Release this package before the products that depend on its changes.

## Topic files

| File | Read before |
|---|---|
| [docs/agents/architecture.md](docs/agents/architecture.md) | Changing composition, base routes, targets, client navigation, virtual modules or the module page |
| [docs/agents/auth-session.md](docs/agents/auth-session.md) | Touching the gate, `/me`, refresh, the profile menu, active company or request headers |
| [docs/agents/panel-design.md](docs/agents/panel-design.md) | Changing the shell's look, nav, drawer, rail, motion or permission-based reveal |
| [docs/agents/features.md](docs/agents/features.md) | Touching the dashboard, notifications, wiki, access control, `/firma`, SMTP or CORS settings |
| [docs/agents/testing.md](docs/agents/testing.md) | Writing tests or type-checking extension islands |

Workspace rules: `../CLAUDE.md`. Cross-repo state: `../MIGRATION-STATUS.md`.
