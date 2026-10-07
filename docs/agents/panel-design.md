# Panel design, nav and motion

This host is tds-shared's **`panel` surface**. `Layout.astro` sets `<html data-surface="panel" data-frontend=…>`,
and `styles/global.css` imports `base.css` → `primitives.css` → `app.css` → `surfaces/panel.css`. The surface
owns geometry (8 px buttons and cards, 0.75rem chips, soft resting elevation lifting on hover). **Don't
hand-author a radius or colour and don't re-declare a shared class**; set a token in `surfaces/panel.css`.

## Shell elements

| Element | Class | Notes |
|---|---|---|
| Mobile top bar (below `lg`) | `.lg:hidden` header | Wordmark, `ThemeToggle`, compact `UserMenu`, drawer trigger |
| Desktop top bar (`lg`+) | `.panel-topbar` | `ThemeToggle` + `UserMenu`, right-aligned, in a column wrapper with `<main>` |
| Desktop rail | `.portal-sidebar` | Gradient dark panel in both themes; re-maps ink/muted/line/soft/card + `--nav-hue` inside |
| Rail head / foot | `.sidebar-head` / `.sidebar-foot` | Wordmark + collapse toggle / target label |
| Mobile drawer | `.nav-drawer` / `-backdrop` / `-panel` | Same surface and remap as the rail |
| Nav row | `.nav-item` + `__icon` / `__label` | Hue from the section's `--nav-hue` |
| Active nav | `.nav-item--active` + `aria-current="page"` | Resolved from `Astro.url.pathname` |
| Page canvas | `.panel-main` | Accent-tinted warm canvas with two soft brand fields |
| Page head accent | `.tds-page__head::before` | Three-part brand bar starting with `--tds-panel-accent` |
| Widget slot | `.widget-slot` + `__icon` | Carries `--tds-widget-hue` |

## Colour assignment (`lib/panelHues.ts`)

`hueForKey()` maps nav group keys and widget ids to the categorical palette, with a stable string-hash fallback,
so a new extension is colour-coded without a contract change.

- **The section hue reaches items by inheritance.** `NavList` sets `--nav-hue` inline on `.nav-group`; it omits the
  `style` attribute when a section has no hue (never `--nav-hue: undefined`).
- **Every nav group is mapped in `HUES`**; a test pins one distinct hue per group.
- **A distinct token name isn't a distinct colour.** `verwaltung` uses `var(--tds-panel-accent)` (burgundy in
  admin), so `tools` uses `--color-info`. `panelHues.test.ts` pins the mapping; tds-shared's `design.test.ts`
  measures ΔE > 15 between admin zones. **Whenever the panel accent moves, re-check the zones.**

## Nav

- **Icons come from the manifest** (`NavEntry.icon`). `components/Icon.astro` is a hand-inlined Lucide path map,
  no dependency, with a `square` fallback. Add a glyph by adding a key to `PATHS`.
- **Group keys are normalised** (`normaliseGroup()` folds case and whitespace; `groupLabel()` maps to German).
- **The rail and the drawer render the same components** (`<NavList sections={navSections} />`,
  `<BrandWordmark />`) from one resolved `navSections` model. Regression check on a build:
  `grep -o 'data-nav="[^"]*"' dist/index.html | sort | uniq -c` → every key exactly 2. (A bare
  `grep -c data-nav` also counts the drawer's three `data-nav-drawer-close` buttons.)
- `NavList` takes active state pre-resolved (`item.active`); normalisation stays in `Layout.astro`'s `isActive`.
- `BrandWordmark` is the only consumer of `BRAND_SUFFIX` (text, not styling). It stays local (`.brand-wordmark`
  is already the shared abstraction).

### Base entries, groups and external links

`baseNav` in `Layout.astro` may name a `group` to join an extension's section.

- **Group order is seeded by the base group, then extension first-appearance**; base entries naming another group
  merge after the extension loop.
- **A base entry never invents a group**; if no extension created it, the entry is dropped.
- `external: true` renders `target="_blank"` + `rel="noopener noreferrer"` and "(neuer Tab)" in the tooltip (e.g.
  "Tools-Website" in the `tools` group). Panels open other properties in a new tab because the user is mid-task.

### What a principal sees: `permission` and `revealFor`

- Gated elements render `hidden` with `data-reveal-permission` (or `data-reveal-for`); `lib/revealNav.ts` decides
  from `/me` (the **active** company's permissions; admins see everything), both ways, so stale grants are taken
  back.
- **A settings section without `permission` is platform-admin only.** Einstellungen itself is a platform-admin row;
  a direct visit with nothing left shows `[data-settings-empty]`.
- A hidden widget never hydrates (`client:visible`); a settings island on `client:load` still fetches while hidden,
  so prefer `client:visible`.
- The last grant is cached in localStorage (`<prefix>_reveal`) and applied by `NavList`'s inline script before first
  paint.
- A nav group whose rows are all hidden drops its heading (`:has()`).
- Hiding is never a permission check; the API gates every route.

## Collapsed rail and drawer

- **`lib/sidebarCollapse.ts`** persists collapse to localStorage (per device), suppresses the width transition on
  restore, labels the action, and no-ops without a rail or storage.
- **The drawer traps focus, returns it, and closes on navigation** (on the link click, since ClientRouter starts
  preparing while the old drawer is live). The focusable list is recomputed per keystroke; **Escape returns early
  unless the drawer is open** (it once released a `<dialog>`'s scroll lock).

## Motion (tds-shared ≥ 0.38)

- The page swap fades **only `<main>`** (`transition:name="tds-main"`, `--tds-dur-*` / `--tds-ease-out`). Never name
  the rail, top bar or drawer. Reduced motion is handled in tds-shared's `base.css`.
- Islands animate via `@tracht-digital-solutions/tds-shared/motion/react`, never `motion` directly:
  card lists → `AnimatedList` / `AnimatedItem`; summary ↔ edit → `Presence`; an in-place form → `Collapse`; chip
  tabs → `tds-tab` + `TabIndicator`.
- Tables stay static (transforms on `<tr>` render unreliably).
- `Presence` uses `mode="wait"` (~160 ms); tests must `findBy…`.

## Templates

**No multi-line JSX comment (`{/* … */}`) in `Layout.astro`'s template body.** Astro compiles it to a template
literal and fails with `Expected ")" but found "{"` at the comment's closing line. Put notes in frontmatter or use
an HTML comment.
