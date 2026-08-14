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

/** Reveal every `[data-reveal-for]` row whose condition now holds. */
export async function revealNav(): Promise<void> {
  const rows = document.querySelectorAll<HTMLElement>("[data-reveal-for]");
  if (rows.length === 0) return;

  const me = await fetchMe();
  if (me === null) return;

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

  for (const row of rows) {
    // Both the rail and the mobile drawer render the same model, so this
    // deliberately walks ALL matches rather than the first.
    const condition = row.dataset.revealFor ?? "";
    if (holds[condition] === true) row.hidden = false;
  }
}
