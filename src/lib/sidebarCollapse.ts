/**
 * Sidebar collapse (desktop rail → icon strip).
 *
 * tds-shared's app.css has carried `.portal-sidebar.collapsed` for a long
 * time, but the only rule was "hide the active indicator" and no shell ever
 * rendered a control to add the class — so the collapsed rail was
 * unreachable, half-styled dead code. 0.15.0 gives it real geometry (width,
 * hidden labels, label-as-tooltip); this module is the control.
 *
 * The choice is per-device, not per-user: it is a viewport preference, so it
 * lives in localStorage rather than in the `/me` dashboard-layout record.
 * Unlike the auth presence hint there is nothing sensitive here, and a
 * failure is harmless — a browser with storage blocked just gets a rail that
 * forgets, never a broken one.
 *
 * No pre-paint bootstrap. The rail is `hidden lg:flex`, so on the phones and
 * tablets where a flash would be most visible it is not rendered at all, and
 * on desktop the width transition makes the restore read as intentional.
 */

const STORAGE_KEY = "tds-panel-collapsed";

/** Read the stored preference, treating any storage failure as "expanded". */
function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persist(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode / storage disabled — the rail still toggles for this page.
  }
}

export function initSidebarCollapse(): void {
  const sidebar = document.querySelector<HTMLElement>(".portal-sidebar");
  const toggle = document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]");
  if (!sidebar || !toggle) return;

  const apply = (collapsed: boolean, animate: boolean): void => {
    // Suppress the width transition when restoring the stored state on load,
    // so the rail does not visibly slide shut on every navigation.
    if (!animate) sidebar.style.transition = "none";
    sidebar.classList.toggle("collapsed", collapsed);
    // The button controls the rail, so it owns the expanded state; the label
    // has to describe the ACTION, not the current state.
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Navigation ausklappen" : "Navigation einklappen",
    );
    for (const icon of toggle.querySelectorAll<HTMLElement>("[data-collapsed-icon]")) {
      icon.hidden = !collapsed;
    }
    for (const icon of toggle.querySelectorAll<HTMLElement>("[data-expanded-icon]")) {
      icon.hidden = collapsed;
    }
    if (!animate) {
      // Force a reflow before restoring the transition, or the browser
      // batches both style changes and animates anyway.
      void sidebar.offsetWidth;
      sidebar.style.transition = "";
    }
  };

  apply(stored(), false);

  toggle.addEventListener("click", () => {
    const next = !sidebar.classList.contains("collapsed");
    apply(next, true);
    persist(next);
  });
}
