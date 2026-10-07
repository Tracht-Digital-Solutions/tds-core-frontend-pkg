/**
 * Unhide the nav rows that depend on who is signed in.
 *
 * The nav is built during `astro build`, so it cannot know whether this person
 * administers a company — that only arrives with `/me`. Rows declaring
 * `revealFor` are therefore rendered `hidden` and unhidden here.
 *
 * ### Hiding a row is not a permission check
 *
 * `/firma` is gated by `CompanyAdminMiddleware` on every call it makes, and the
 * page itself says so when the principal administers nothing. This only avoids
 * OFFERING a page that would answer 403 — a nav that promises something the
 * server refuses is worse than one that stays quiet.
 *
 * `/users` is the second case and predates this file: it hung in the nav of
 * BOTH products with no condition at all, so every portal user was invited to
 * a screen whose first call (`/admin/users`) answers 403 for them.
 *
 * Runs off the memoised `fetchMe()`, so it costs no extra request: the profile
 * menu and the pre-paint gate have already asked.
 */
import { fetchMe } from "./auth";
import { HINT_PREFIX } from "../config/target";

/** What the reveal decides on — derived from /me, cached for the next paint. */
export interface RevealGrant {
  flags: Record<string, boolean>;
  admin: boolean;
  permissions: string[];
}

/**
 * The last grant, so the next page paints its nav complete instead of popping
 * rows in when /me answers (nearly every admin row carries a permission). It is
 * a hint for the paint only: `revealNav` re-applies the live answer in BOTH
 * directions, so a stale cache — another account on this browser — is corrected
 * within one request. The inline script in NavList reads the same key.
 */
export const REVEAL_CACHE_KEY = `${HINT_PREFIX}_reveal`;

/** Show or hide every gated element under `root` for `grant`. */
export function applyReveal(grant: RevealGrant, root: ParentNode = document): void {
  const granted = new Set(grant.permissions);
  for (const row of root.querySelectorAll<HTMLElement>("[data-reveal-for], [data-reveal-permission]")) {
    // Both the rail and the mobile drawer render the same model, so this
    // deliberately walks ALL matches rather than the first.
    const condition = row.dataset.revealFor;
    const permission = row.dataset.revealPermission;
    row.hidden = condition !== undefined && condition !== ""
      ? grant.flags[condition] !== true
      : !(grant.admin || (permission !== undefined && granted.has(permission)));
  }
  // Einstellungen: say so when nothing is left for this account, rather than
  // showing a heading over an empty page.
  const empty = root.querySelector<HTMLElement>("[data-settings-empty]");
  if (empty) {
    empty.hidden = root.querySelector(".tds-settings-section:not([hidden])") !== null;
  }
}

/**
 * Reveal every `[data-reveal-for]` row whose condition now holds, and every
 * `[data-reveal-permission]` element (nav row, dashboard widget, settings
 * section) whose permission the principal holds.
 *
 * ### Permissions (2026-10-07)
 *
 * `NavEntry`, `WidgetManifest` and `SettingsPanel` have always carried
 * `permission` ("required to see the entry. Admins bypass"), and the shell
 * never read it: a portal user with nine read rights saw "Projekte verwalten",
 * "TDShop", the billing and shop tiles and every admin settings section, each
 * answering 403. The permission is read from the ACTIVE company's set on /me
 * (`me.permissions`), which is what the API checks against.
 */
export async function revealNav(): Promise<void> {
  const rows = document.querySelectorAll<HTMLElement>("[data-reveal-for], [data-reveal-permission]");
  if (rows.length === 0) return;

  try {
    const cached = localStorage.getItem(REVEAL_CACHE_KEY);
    if (cached) applyReveal(JSON.parse(cached) as RevealGrant);
  } catch {
    /* storage disabled or a malformed entry — wait for /me */
  }

  const me = await fetchMe();
  if (me === null) {
    // No principal: whatever the cache painted is not this visitor's.
    applyReveal({ flags: {}, admin: false, permissions: [] });
    return;
  }

  const companies = me.companies ?? [];

  const holds: Record<string, boolean> = {
    // `isCompanyAdmin` on /me is already folded against the company's
    // delegation grant, so a promotion into a company that was never switched
    // on does not light this up — which is the whole point of resolving it
    // server-side rather than reading the stored flag.
    "company-admin": companies.some((c) => c.isCompanyAdmin),
    "platform-admin": me.isAdmin === true,
    // `/firma` is the company-INTERNAL view, so it needs a company: someone who
    // belongs to none has no "meine Firma" and the row is offering them a page
    // about nobody. That MEMBERSHIP requirement binds the platform admin too —
    // the screen still offers them a picker over every company, but a platform
    // admin without a membership manages companies from the Firmen directory,
    // and a nav row named "Meine Firma" pointing at someone else's is worse
    // than no row. Reachable by URL either way; hiding is not a permission
    // check.
    "company-or-platform-admin":
      companies.length > 0 && (me.isAdmin === true || companies.some((c) => c.isCompanyAdmin)),
  };

  const grant: RevealGrant = { flags: holds, admin: me.isAdmin === true, permissions: me.permissions ?? [] };
  applyReveal(grant);
  try {
    localStorage.setItem(REVEAL_CACHE_KEY, JSON.stringify(grant));
  } catch {
    /* storage disabled — the next page waits for /me again */
  }
}
