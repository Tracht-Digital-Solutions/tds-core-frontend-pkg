/**
 * Wayfinding colour + labels for the composed nav and the dashboard.
 *
 * tds-shared's app.css has always driven its colour-coding off two custom
 * properties — `--nav-hue` on a nav section and (new in 0.15.0)
 * `--tds-widget-hue` on a dashboard slot. Nothing ever set either, so every
 * nav item fell back to the rail's white and every widget to the same
 * accent: the rail was one grey column and the dashboard a dozen identical
 * cards. This module is what assigns them.
 *
 * WHY HOST-SIDE AND NOT IN THE MANIFEST. `WidgetManifest` has no `icon` or
 * `hue` field, and adding them would mean a `frontend-contract` minor plus a
 * release of all 13 extensions before a single pixel changed. Deriving both
 * from the id the extension already declares gets the same result with no
 * cross-repo churn. If extensions ever want to override their own colour,
 * that is an additive contract minor and this becomes the fallback.
 *
 * Everything here degrades: an unknown key gets a stable hashed hue and the
 * `square` icon, so a brand-new extension is colour-coded on first build.
 */

/** The categorical palette, in the order the hash cycles through it. */
const CATEGORICAL = [
  "var(--color-cat-violet)",
  "var(--color-cat-teal)",
  "var(--color-cat-amber)",
  "var(--color-cat-rose)",
  "var(--color-cat-cyan)",
] as const;

/**
 * Deliberate hues for the keys that exist today, so related surfaces agree:
 * the Tickets nav row, the "Offene Tickets" widget and the tickets pages all
 * read cyan. Chosen for separation in the rail, not per-extension taste.
 */
const HUES: Record<string, string> = {
  // Nav groups (normalised, see normaliseGroup)
  verwaltung: "var(--tds-panel-accent)",
  support: "var(--color-cat-cyan)",
  abrechnung: "var(--color-cat-amber)",
  content: "var(--color-cat-violet)",
  work: "var(--color-cat-teal)",
  tools: "var(--color-cat-rose)",
  // The catch-all bucket deliberately takes the neutral rather than a
  // categorical hue: it is "everything that declared no group", so it has no
  // theme to signal, and leaving it uncoloured keeps all five categorical
  // hues meaning one real zone each.
  allgemein: "var(--color-muted)",

  // Dashboard widget ids
  "tickets-open": "var(--color-cat-cyan)",
  "contact-new": "var(--color-cat-rose)",
  "live-chat-open": "var(--color-cat-cyan)",
  "time-week": "var(--color-cat-teal)",
  "blog-cms-posts": "var(--color-cat-violet)",
  "website-cms-sections": "var(--color-cat-violet)",
  "customers-count": "var(--color-info)",
  "lexware-invoices": "var(--color-cat-amber)",
  "billing-open": "var(--color-cat-amber)",
  "projects-active": "var(--color-cat-teal)",
  "documents-count": "var(--color-info)",
  "messages-unread": "var(--color-cat-rose)",
  "tools-status": "var(--color-cat-violet)",
};

/**
 * Icons for dashboard widgets. Nav icons come from the manifest
 * (`NavEntry.icon`); widgets have no such field, so they are mapped here by
 * id and fall back to the `square` glyph.
 */
const WIDGET_ICONS: Record<string, string> = {
  "tickets-open": "life-buoy",
  "contact-new": "inbox",
  "live-chat-open": "message-circle",
  "time-week": "clock",
  "blog-cms-posts": "book-open",
  "website-cms-sections": "layout",
  "customers-count": "users",
  "lexware-invoices": "receipt",
  "billing-open": "file-text",
  "projects-active": "folder-kanban",
  "documents-count": "file-text",
  "messages-unread": "message-square",
  "tools-status": "wrench",
};

/**
 * Display labels for nav group ids. Extensions declare `group` as a bare id
 * and `.nav-group-label` uppercases it, so the rail read
 * "SUPPORT / ABRECHNUNG / CONTENT / WORK" — a German/English mix of raw
 * identifiers. Anything not listed falls back to Capitalised(id), which is
 * already correct for the German ones.
 */
const GROUP_LABELS: Record<string, string> = {
  verwaltung: "Verwaltung",
  support: "Support",
  abrechnung: "Abrechnung",
  content: "Content",
  work: "Arbeit",
  allgemein: "Allgemein",
};

/**
 * Fold a group id to its canonical key. Extensions are free to write
 * "Verwaltung", "verwaltung" or " Verwaltung " and all three must land in
 * the SAME section as the base shell's own nav — otherwise the rail grows a
 * duplicate heading with one orphaned link under it.
 */
export function normaliseGroup(group: string | undefined): string {
  return (group ?? "Allgemein").trim().toLowerCase();
}

/** Human label for a normalised group key. */
export function groupLabel(key: string): string {
  return GROUP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * djb2-ish string hash. Only needs to be stable and well-spread across five
 * buckets — the same key must pick the same hue on every build, or the nav
 * would change colour between deploys.
 */
function hash(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * The wayfinding hue for a nav group or widget id, as a CSS value ready to
 * drop into a `--nav-hue` / `--tds-widget-hue` inline style. Never returns
 * empty: an unmapped key gets a stable categorical hue.
 */
export function hueForKey(key: string | undefined): string {
  if (!key) return "var(--tds-panel-accent)";
  const known = HUES[key] ?? HUES[normaliseGroup(key)];
  if (known) return known;
  return CATEGORICAL[hash(key) % CATEGORICAL.length];
}

/** The icon key for a dashboard widget id. Unknown → the square fallback. */
export function widgetIcon(id: string | undefined): string {
  return (id && WIDGET_ICONS[id]) || "square";
}
