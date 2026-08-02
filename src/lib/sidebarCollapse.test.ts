// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The collapsed rail is persisted per device in localStorage. The failure
 * modes here are all silent in a browser: a rail that forgets its state, a
 * toggle whose aria-label describes the state instead of the action, or a
 * storage exception (private mode) taking the whole shell down with it.
 */

const { initSidebarCollapse } = await import("./sidebarCollapse");

const STORAGE_KEY = "tds-panel-collapsed";

function render(): void {
  document.body.innerHTML = `
    <aside class="portal-sidebar">
      <div class="sidebar-head">
        <button data-sidebar-toggle aria-expanded="true" aria-label="Navigation einklappen">
          <span data-expanded-icon></span>
          <span data-collapsed-icon hidden></span>
        </button>
      </div>
    </aside>
  `;
}

const sidebar = () => document.querySelector<HTMLElement>(".portal-sidebar")!;
const toggle = () => document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")!;

beforeEach(() => {
  localStorage.clear();
  render();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("will-change gating", () => {
  /**
   * `.is-animating` is what gates `will-change: width` in tds-shared's
   * app.css. Held permanently it costs a retained compositor layer for a rail
   * that is static ~100% of the time — the textbook way to turn `will-change`
   * into a pessimisation — so it must go on only for the toggle and come off
   * again when the transition ends.
   */
  it("does not hint the compositor when restoring state on load", () => {
    // The restore path deliberately suppresses the transition, so no
    // `transitionend` will ever fire to clean the class up.
    localStorage.setItem(STORAGE_KEY, "1");
    initSidebarCollapse();
    expect(sidebar().classList.contains("is-animating")).toBe(false);
  });

  it("hints on toggle and clears the hint when the width settles", () => {
    initSidebarCollapse();
    toggle().click();
    expect(sidebar().classList.contains("is-animating")).toBe(true);

    sidebar().dispatchEvent(
      Object.assign(new Event("transitionend"), { propertyName: "width" }),
    );
    expect(sidebar().classList.contains("is-animating")).toBe(false);
  });

  it("ignores a transitionend for any other property", () => {
    // The rail transitions only `width`, but its children animate colour and
    // those events bubble up to this same listener.
    initSidebarCollapse();
    toggle().click();
    sidebar().dispatchEvent(
      Object.assign(new Event("transitionend"), { propertyName: "background-color" }),
    );
    expect(sidebar().classList.contains("is-animating")).toBe(true);
  });
});

describe("initSidebarCollapse", () => {
  it("starts expanded when nothing is stored", () => {
    initSidebarCollapse();
    expect(sidebar().classList.contains("collapsed")).toBe(false);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("restores a stored collapsed rail on load", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    initSidebarCollapse();
    expect(sidebar().classList.contains("collapsed")).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles and persists both directions", () => {
    initSidebarCollapse();

    toggle().click();
    expect(sidebar().classList.contains("collapsed")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");

    toggle().click();
    expect(sidebar().classList.contains("collapsed")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("labels the ACTION, not the current state", () => {
    // The button controls the rail, so "einklappen" must mean "clicking this
    // collapses it" — a label that names the current state reads backwards to
    // a screen reader.
    initSidebarCollapse();
    expect(toggle().getAttribute("aria-label")).toBe("Navigation einklappen");
    toggle().click();
    expect(toggle().getAttribute("aria-label")).toBe("Navigation ausklappen");
  });

  it("swaps the direction icons with the state", () => {
    initSidebarCollapse();
    const expanded = document.querySelector<HTMLElement>("[data-expanded-icon]")!;
    const collapsed = document.querySelector<HTMLElement>("[data-collapsed-icon]")!;
    expect(expanded.hidden).toBe(false);
    expect(collapsed.hidden).toBe(true);

    toggle().click();
    expect(expanded.hidden).toBe(true);
    expect(collapsed.hidden).toBe(false);
  });

  it("is a no-op when the shell renders no rail (bare layout)", () => {
    document.body.innerHTML = "<main></main>";
    expect(() => initSidebarCollapse()).not.toThrow();
  });

  it("survives localStorage throwing (private mode)", () => {
    const proto = Object.getPrototypeOf(localStorage);
    const getItem = proto.getItem;
    const setItem = proto.setItem;
    proto.getItem = () => {
      throw new Error("denied");
    };
    proto.setItem = () => {
      throw new Error("denied");
    };
    try {
      initSidebarCollapse();
      expect(sidebar().classList.contains("collapsed")).toBe(false);
      // Still toggles for this page even though it cannot be remembered.
      expect(() => toggle().click()).not.toThrow();
      expect(sidebar().classList.contains("collapsed")).toBe(true);
    } finally {
      proto.getItem = getItem;
      proto.setItem = setItem;
    }
  });
});
