// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initNavDrawer, resetNavDrawer } from "./navDrawer";

/**
 * The mobile drawer, extracted from an inline `<script>` in `Layout.astro` when
 * the panel gained client-side navigation.
 *
 * The reason it moved is the first test below: with the router in place the
 * shell markup is replaced on every page swap, and an inline script — which
 * Astro de-duplicates and never re-runs — could not rebind itself. The
 * hamburger simply stopped opening after the first navigation, with nothing in
 * the console.
 */

/** The shell markup the drawer binds to, as `Layout.astro` renders it. */
function renderShell(): void {
  document.body.innerHTML = `
    <button type="button" id="nav-drawer-open" aria-expanded="false">Menü</button>
    <div class="nav-drawer" id="nav-drawer" data-open="false">
      <div class="nav-drawer-backdrop" data-nav-drawer-close></div>
      <div class="nav-drawer-panel">
        <button type="button" data-nav-drawer-close>Schließen</button>
        <a href="/users">Benutzer</a>
        <a href="/einstellungen">Einstellungen</a>
      </div>
    </div>`;
}

const drawer = () => document.getElementById("nav-drawer") as HTMLElement;
const trigger = () => document.getElementById("nav-drawer-open") as HTMLButtonElement;
const isOpen = () => drawer().getAttribute("data-open") === "true";

beforeEach(() => {
  // jsdom reports every element as having no offset parent, which the
  // focusable filter checks. Force it to the layout-engine answer a real
  // browser gives for a visible element.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return document.body;
    },
  });
  renderShell();
  initNavDrawer();
});

afterEach(() => {
  resetNavDrawer();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("initNavDrawer", () => {
  it("opens and closes from the trigger", () => {
    trigger().click();
    expect(isOpen()).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    trigger().click();
    expect(isOpen()).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("locks and releases the page scroll", () => {
    trigger().click();
    expect(document.body.style.overflow).toBe("hidden");
    trigger().click();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on a nav link even though the router does not unmount it", () => {
    // With client-side navigation the page swaps UNDER the drawer, so without
    // this the drawer stays open over whatever the user just navigated to.
    trigger().click();
    (document.querySelector('.nav-drawer-panel a[href="/users"]') as HTMLElement).click();
    expect(isOpen()).toBe(false);
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    trigger().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("ignores Escape while closed", () => {
    // Unconditional, this also fired for an Escape inside a <dialog> — and
    // cleared body.overflow, releasing a scroll lock that belonged to
    // something else.
    document.body.style.overflow = "hidden";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("traps Tab inside the open panel", () => {
    trigger().click();
    const items = [
      ...document.querySelectorAll<HTMLElement>(".nav-drawer-panel a, .nav-drawer-panel button"),
    ];
    const last = items[items.length - 1] as HTMLElement;
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it("rebinds after the router replaces the shell", () => {
    // THE reason this module exists. A swapped-in drawer with the old
    // listeners gone is a hamburger that does nothing, and nothing errors.
    trigger().click();
    expect(isOpen()).toBe(true);

    renderShell(); // the swap
    expect(isOpen()).toBe(false);
    trigger().click();
    expect(isOpen()).toBe(false); // no listener yet — this is the bug

    initNavDrawer();
    trigger().click();
    expect(isOpen()).toBe(true);
  });

  it("registers the document handler exactly once across rebinds", () => {
    // It lives on `document`, which the swap does NOT replace. Stacking one
    // per navigation is a leak, and it is deliberately asserted on the
    // REGISTRATION rather than on behaviour: the handler returns early while
    // the drawer is closed, so ten copies of it behave exactly like one and
    // the leak is invisible from the outside until a profiler finds it.
    const spy = vi.spyOn(document, "addEventListener");
    for (let i = 0; i < 5; i += 1) {
      renderShell();
      initNavDrawer();
    }
    expect(spy.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    spy.mockRestore();

    // …and exactly one on a cold start.
    resetNavDrawer();
    const fresh = vi.spyOn(document, "addEventListener");
    renderShell();
    initNavDrawer();
    renderShell();
    initNavDrawer();
    expect(fresh.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    fresh.mockRestore();
  });

  it("is a no-op on a page with no drawer", () => {
    document.body.innerHTML = "<main>Nur Inhalt</main>";
    expect(() => initNavDrawer()).not.toThrow();
  });
});
