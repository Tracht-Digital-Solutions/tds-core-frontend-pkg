/**
 * The mobile navigation drawer (below `lg`).
 *
 * This was an `is:inline` IIFE in `Layout.astro` until the panel gained
 * client-side navigation. It had to move for one reason: with Astro's
 * `ClientRouter` the shell's markup is **replaced** on every page swap, so the
 * `#nav-drawer` and `#nav-drawer-open` the inline script bound to are gone
 * afterwards and the hamburger stops opening anything. An inline script is
 * de-duplicated by its own text content and never runs a second time, so it
 * could not rebind itself either. As a module it can be called again from
 * `astro:page-load`.
 *
 * ### The panel keeps its own drawer on purpose
 *
 * `@tracht-digital-solutions/tds-shared/nav` carries `mountMobileNav`, which
 * the three public sites share. This shell is the documented non-consumer: a
 * dashboard with ~30 entries across six colour-coded zones is an off-canvas
 * drawer, not a dropdown sheet, and converging the two would mean giving one
 * of them the wrong mechanic. Two implementations is the deliberate choice.
 *
 * ### Why the keydown handler is registered exactly once
 *
 * It lives on `document`, which survives a swap. Re-registering it per page
 * load would stack a new listener on every navigation — a leak whose only
 * symptom is that Escape eventually runs the close routine a dozen times, and
 * whose cause is nowhere near the symptom. The per-page call therefore only
 * rebinds the ELEMENT listeners and hands the document handler a pointer to
 * the current drawer.
 */

/** The live drawer, or null between a swap and the next `initNavDrawer()`. */
let current: { drawer: HTMLElement; trigger: HTMLElement; panel: HTMLElement } | null = null;
let documentBound = false;

const isOpen = (): boolean => current?.drawer.getAttribute("data-open") === "true";

/**
 * Focusable rows inside the panel.
 *
 * Recomputed per use rather than cached: the nav is server-rendered but the
 * theme toggle inside it hydrates late, so a list taken at load time is wrong.
 */
function focusables(): HTMLElement[] {
  if (!current) return [];
  return Array.from(
    current.panel.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((el) => el.offsetParent !== null);
}

function setOpen(open: boolean): void {
  if (!current || open === isOpen()) return;
  current.drawer.setAttribute("data-open", open ? "true" : "false");
  current.trigger.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.style.overflow = open ? "hidden" : "";
  if (open) {
    focusables()[0]?.focus();
  } else {
    // Back where they came from. Without this, closing drops focus to the top
    // of the document and a keyboard user has to tab through the whole page to
    // get anywhere.
    current.trigger.focus();
  }
}

function onKeydown(event: KeyboardEvent): void {
  // Guarded on the open state. Unconditional, this also fired for an Escape
  // inside a <dialog> — and cleared `body.overflow`, releasing a scroll lock
  // that belonged to something else.
  if (!current || !isOpen()) return;
  if (event.key === "Escape") {
    setOpen(false);
    return;
  }
  if (event.key !== "Tab") return;
  // The drawer covers the page but leaves the page focusable, so Tab would
  // walk out of it into content the user cannot see.
  const items = focusables();
  if (items.length === 0) return;
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!current.panel.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Bind (or rebind) the drawer to whatever shell markup is currently in the DOM.
 *
 * Call it on load and again on every `astro:page-load`. Safe on a page that has
 * no drawer — the desktop rail is a different element and the login shell has
 * neither.
 */
export function initNavDrawer(): void {
  const drawer = document.getElementById("nav-drawer");
  const trigger = document.getElementById("nav-drawer-open");
  const panel = drawer?.querySelector<HTMLElement>(".nav-drawer-panel") ?? null;
  if (!drawer || !trigger || !panel) {
    current = null;
    return;
  }

  current = { drawer, trigger, panel };

  // A swap replaces these elements wholesale, so there is nothing to detach —
  // the old nodes go with their listeners.
  trigger.addEventListener("click", () => setOpen(!isOpen()));
  for (const el of drawer.querySelectorAll("[data-nav-drawer-close]")) {
    el.addEventListener("click", () => setOpen(false));
  }
  // Closing on a nav click is still required WITH client-side routing: the
  // router swaps the page under the drawer without unmounting it, so an open
  // drawer would simply stay open over the new page.
  panel.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest("a[href]")) setOpen(false);
  });

  if (!documentBound) {
    document.addEventListener("keydown", onKeydown);
    documentBound = true;
  }
}

/**
 * Test seam: detach the document handler and forget the bound state.
 *
 * It also drops the one-time flag, which is the point — without that, a second
 * `initNavDrawer()` in the same jsdom document would rely on a listener the
 * previous test's DOM already owned.
 */
export function resetNavDrawer(): void {
  document.removeEventListener("keydown", onKeydown);
  documentBound = false;
  current = null;
}
