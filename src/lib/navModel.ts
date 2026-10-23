/**
 * The panel's nav model: base entries and the composed registry, grouped into
 * the sections the rail, the drawer, the quick search and the mobile header
 * title all read.
 *
 * It used to live inline in Layout.astro, which neither vitest nor `tsc`
 * compiles, so the grouping rules had no test at all.
 *
 * ### Section order
 *
 *   1. `start`      — the Dashboard on its own, without a heading. It is where
 *                     every session begins, not one administrative task among
 *                     others.
 *   2. `verwaltung` — the day-to-day administration (users, companies, …).
 *   3. extension groups, in first-appearance order.
 *   4. `system`     — configuring the platform itself (Einstellungen,
 *                     Einrichtung, Module, API-Referenz). Rarely visited, so it
 *                     sits last instead of between the Dashboard and the work.
 *
 * `start` and `system` belong to the host: base entries may name them even
 * though no extension creates them. Any other group a base entry names is
 * joined only if an extension created it — a heading over one lone external
 * link reads as a bug.
 */
import { groupLabel, hueForKey, normaliseGroup } from "./panelHues";

export type RevealCondition = "company-admin" | "platform-admin" | "company-or-platform-admin";

/** One entry as the nav model carries it, before active-state resolution. */
export interface NavInput {
  href: string;
  label: string;
  id?: string | undefined;
  icon?: string | undefined;
  order: number;
  /** Nav section. Defaults to BASE_GROUP; set it to join another group. */
  group?: string | undefined;
  /** Absolute link to another property — opens in a new tab. */
  external?: boolean | undefined;
  /** Render hidden and unhide at runtime — see NavList and `revealNav`. */
  revealFor?: RevealCondition | undefined;
  /** The extension's `NavEntry.permission` — revealed when /me holds it. */
  permission?: string | undefined;
}

/** What the registry contributes (`NavEntry` from the contract). */
export interface RegistryNavEntry {
  href: string;
  label: string;
  id?: string | undefined;
  icon?: string | undefined;
  order?: number | undefined;
  group?: string | undefined;
  permission?: string | undefined;
}

export interface NavItem {
  href: string;
  label: string;
  /** Extension/base id — the `data-nav` hook. */
  id?: string | undefined;
  /** Icon key from the extension's manifest (`NavEntry.icon`). */
  icon?: string | undefined;
  active: boolean;
  /** Link to another property — opens in a new tab, with the usual rel guard. */
  external?: boolean | undefined;
  /**
   * Render the row hidden, to be revealed at runtime. The nav is built at
   * BUILD time; who this person is only arrives with `/me`.
   */
  revealFor?: RevealCondition | undefined;
  /** Permission the entry requires (`NavEntry.permission`); hidden until /me holds it. */
  permission?: string | undefined;
}

export interface NavSection {
  /** Normalised group key. */
  key: string;
  /** Heading; absent for the `start` section, which stands without one. */
  label?: string | undefined;
  items: NavItem[];
  /** CSS value for `--nav-hue` — see lib/panelHues.ts. */
  hue?: string | undefined;
}

export const START_GROUP = "start";
export const BASE_GROUP = "verwaltung";
export const SYSTEM_GROUP = "system";

/** Normalised path: no trailing slash, the root stays `/`. */
export function normalisePath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Whether `href` is the page at `pathname`. The Dashboard matches only exactly;
 * every other entry also matches its subtree. Normalised so
 * `trailingSlash: "ignore"` and the `build.format: "directory"` output both
 * match. An absolute URL never matches a pathname.
 */
export function isActivePath(href: string, pathname: string): boolean {
  const here = normalisePath(pathname);
  const h = normalisePath(href);
  return h === "/" ? here === "/" : here === h || here.startsWith(h + "/");
}

/** Order first; a tie falls back to the label, so equal orders stay stable and alphabetical. */
function byOrderThenLabel(a: NavInput, b: NavInput): number {
  return a.order - b.order || a.label.localeCompare(b.label, "de");
}

export function buildNavSections(
  baseNav: NavInput[],
  registryNav: readonly RegistryNavEntry[],
  pathname: string,
): NavSection[] {
  const groups = new Map<string, NavInput[]>();
  // Seeding fixes the leading order: start, then Verwaltung, then the
  // extension groups as they first appear.
  groups.set(START_GROUP, []);
  groups.set(BASE_GROUP, []);

  const adopted: NavInput[] = [];
  const system: NavInput[] = [];
  for (const item of baseNav) {
    const key = normaliseGroup(item.group ?? BASE_GROUP);
    if (key === START_GROUP || key === BASE_GROUP) groups.get(key)!.push(item);
    else if (key === SYSTEM_GROUP) system.push(item);
    else adopted.push(item);
  }

  for (const entry of registryNav) {
    const key = normaliseGroup(entry.group);
    const item: NavInput = {
      href: entry.href,
      label: entry.label,
      id: entry.id,
      icon: entry.icon,
      order: entry.order ?? 100,
      permission: entry.permission,
    };
    if (key === SYSTEM_GROUP) {
      system.push(item);
      continue;
    }
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  for (const item of adopted) {
    groups.get(normaliseGroup(item.group))?.push(item);
  }
  groups.set(SYSTEM_GROUP, system);

  const sections: NavSection[] = [];
  for (const [key, items] of groups) {
    if (items.length === 0) continue;
    sections.push({
      key,
      label: key === START_GROUP ? undefined : groupLabel(key),
      hue: hueForKey(key === START_GROUP ? BASE_GROUP : key),
      items: [...items].sort(byOrderThenLabel).map((item) => ({
        href: item.href,
        label: item.label,
        id: item.id,
        icon: item.icon,
        active: isActivePath(item.href, pathname),
        external: item.external,
        revealFor: item.revealFor,
        permission: item.permission,
      })),
    });
  }
  return sections;
}

/** The label of the entry for the current page, if the nav has one. */
export function activeLabel(sections: readonly NavSection[]): string | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.active) return item.label;
    }
  }
  return undefined;
}
