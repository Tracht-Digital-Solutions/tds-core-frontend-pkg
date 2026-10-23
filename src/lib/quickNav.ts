/**
 * The quick search's data and matching (Strg/⌘+K), kept out of the island so
 * it is testable without a DOM.
 *
 * Entries are every nav row plus every Einstellungen section. What a
 * principal may see is decided by the same rule as the rail (`isGranted`),
 * from the cached grant; hiding is never a permission check, the API gates
 * every route.
 */
import type { NavSection } from "./navModel";
import { isGranted, type RevealGrant } from "./revealNav";
import { sectionReveal, type SettingsSectionInfo } from "./settingsSections";

export interface QuickEntry {
  href: string;
  label: string;
  /** Section heading the entry belongs to ("Support", "Einstellungen", …). */
  group: string;
  icon?: string | undefined;
  external?: boolean | undefined;
  revealFor?: string | undefined;
  permission?: string | undefined;
}

export const SETTINGS_GROUP_LABEL = "Einstellungen";

/** Flatten the nav model and the settings sections into one search list. */
export function quickEntries(
  sections: readonly NavSection[],
  settings: readonly SettingsSectionInfo[],
): QuickEntry[] {
  const entries: QuickEntry[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      entries.push({
        href: item.href,
        label: item.label,
        group: section.label ?? "Start",
        icon: item.icon,
        external: item.external,
        revealFor: item.revealFor,
        permission: item.permission,
      });
    }
  }
  for (const section of settings) {
    entries.push({
      href: `/einstellungen#settings-${section.id}`,
      label: section.label,
      group: SETTINGS_GROUP_LABEL,
      icon: "settings",
      ...sectionReveal(section),
    });
  }
  return entries;
}

/**
 * Entries `grant` may see. Without a grant (first visit, storage off) only
 * the ungated entries are offered; the next page has the cache.
 */
export function visibleEntries(entries: readonly QuickEntry[], grant: RevealGrant | null): QuickEntry[] {
  return entries.filter((e) => {
    if (!e.revealFor && !e.permission) return true;
    return grant !== null && isGranted(grant, e.revealFor, e.permission);
  });
}

/** Lower case, no diacritics, ß → ss — so "anfrage" finds "Anfragen" and "gruss" finds "Grüße". */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/g, "ss");
}

/**
 * Rank for one entry against the folded query terms; null when a term is
 * missing. Lower is better: label prefix, then a word in the label starting
 * with the term, then anywhere in the label, then only in the group.
 */
function rank(entry: QuickEntry, terms: readonly string[]): number | null {
  const label = fold(entry.label);
  const group = fold(entry.group);
  let worst = 0;
  for (const term of terms) {
    let r: number;
    if (label.startsWith(term)) r = 0;
    else if (new RegExp(`[^\\p{L}\\p{N}]${escapeRegExp(term)}`, "u").test(label)) r = 1;
    else if (label.includes(term)) r = 2;
    else if (group.includes(term)) r = 3;
    else return null;
    worst = Math.max(worst, r);
  }
  return worst;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filter and order `entries` for `query`. An empty query keeps the given
 * order (the nav's own, grouped); otherwise best rank first, ties in nav order.
 */
export function searchEntries(entries: readonly QuickEntry[], query: string): QuickEntry[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...entries];
  const ranked: { entry: QuickEntry; r: number; i: number }[] = [];
  entries.forEach((entry, i) => {
    const r = rank(entry, terms);
    if (r !== null) ranked.push({ entry, r, i });
  });
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  return ranked.map((x) => x.entry);
}
