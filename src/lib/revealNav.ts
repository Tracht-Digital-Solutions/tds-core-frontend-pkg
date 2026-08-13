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

  const holds: Record<string, boolean> = {
    "company-admin": (me.companies ?? []).some((c) => c.isCompanyAdmin),
    "platform-admin": me.isAdmin === true,
  };

  for (const row of rows) {
    // Both the rail and the mobile drawer render the same model, so this
    // deliberately walks ALL matches rather than the first.
    const condition = row.dataset.revealFor ?? "";
    if (holds[condition] === true) row.hidden = false;
  }
}
