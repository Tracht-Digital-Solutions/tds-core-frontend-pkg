/**
 * The Einstellungen page's sections as data: the base-service ones the host
 * renders itself, plus whatever the extensions contribute.
 *
 * One list for the page, its section index and the quick search, so a
 * section's title is written once. The page still renders the base sections'
 * islands itself (Astro cannot hydrate a component named by a string).
 */
import { FRONTEND_TARGET } from "../config/target";

export interface SettingsSectionInfo {
  /** Anchor id suffix: `#settings-<id>`. */
  id: string;
  label: string;
  /** Present on extension sections that declare one; otherwise platform-admin only. */
  permission?: string | undefined;
}

/**
 * Admin-product only: SMTP, Stripe, CORS and the sitemap configure the
 * platform. Order is the page order.
 */
export const BASE_SETTINGS: readonly SettingsSectionInfo[] =
  FRONTEND_TARGET === "admin"
    ? [
        { id: "mail", label: "E-Mail (SMTP)" },
        { id: "stripe", label: "Zahlungen (Stripe)" },
        { id: "cors", label: "CORS / Freigegebene Origins" },
        { id: "sitemap", label: "Suchmaschinen (Sitemap)" },
      ]
    : [];

/** Every section in page order: base first, then the extensions'. */
export function settingsSections(
  extensions: readonly { id: string; label: string; permission?: string | undefined }[],
): SettingsSectionInfo[] {
  return [
    ...BASE_SETTINGS,
    ...extensions.map((s) => ({ id: s.id, label: s.label, permission: s.permission })),
  ];
}

/**
 * The reveal attributes a section (and anything pointing at it) carries: a
 * section without `permission` is platform-admin only.
 */
export function sectionReveal(section: SettingsSectionInfo): {
  revealFor?: "platform-admin";
  permission?: string;
} {
  return section.permission ? { permission: section.permission } : { revealFor: "platform-admin" };
}
