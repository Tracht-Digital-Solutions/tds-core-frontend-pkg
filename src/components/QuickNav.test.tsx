// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuickNav from "./QuickNav";
import { REVEAL_CACHE_KEY } from "../lib/revealNav";
import type { QuickEntry } from "../lib/quickNav";

/**
 * The quick search. What matters: it opens from the shortcut and the header
 * buttons, the keyboard walks and follows the results, it never offers what
 * the cached grant would hide in the rail, and focus goes back to the opener.
 */

const ENTRIES: QuickEntry[] = [
  { href: "/", label: "Dashboard", group: "Start" },
  { href: "/tickets", label: "Tickets", group: "Support", permission: "tickets:read" },
  { href: "/kontakt", label: "Kontaktanfragen", group: "Support" },
  { href: "/einstellungen#settings-mail", label: "E-Mail (SMTP)", group: "Einstellungen", revealFor: "platform-admin" },
];

beforeEach(() => {
  // jsdom ≤ 25 has no <dialog> methods; the component falls back to the attribute.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function setup(grant?: object) {
  if (grant) localStorage.setItem(REVEAL_CACHE_KEY, JSON.stringify(grant));
  const trigger = document.createElement("button");
  trigger.setAttribute("data-quick-nav-open", "");
  trigger.textContent = "Suchen";
  document.body.append(trigger);
  render(<QuickNav entries={ENTRIES} />);
  return { trigger, user: userEvent.setup() };
}

const dialog = () => document.querySelector("dialog")!;
const options = () =>
  screen.queryAllByRole("option", { hidden: true }).map((o) => o.querySelector(".tds-dropdown__label")!.textContent);

describe("QuickNav", () => {
  it("opens on Ctrl+K and focuses the search field", async () => {
    const { user } = setup();
    expect(dialog().hasAttribute("open")).toBe(false);
    await user.keyboard("{Control>}k{/Control}");
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { hidden: true }));
  });

  it("opens from a header trigger and returns focus to it on Escape", async () => {
    const { trigger, user } = setup();
    await user.click(trigger);
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await screen.findByText("Suchen");
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not take '/' typed into a field", async () => {
    const { user } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard("/");
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(input.value).toBe("/");
  });

  it("offers only what the cached grant reveals", async () => {
    const { user } = setup({ flags: {}, admin: false, permissions: ["tickets:read"] });
    await user.keyboard("{Control>}k{/Control}");
    expect(options()).toEqual(["Dashboard", "Tickets", "Kontaktanfragen"]);
  });

  it("filters as you type and moves the active option with the arrows", async () => {
    const { user } = setup({ flags: { "platform-admin": true }, admin: true, permissions: [] });
    await user.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("combobox", { hidden: true });
    await user.type(input, "an");
    // "Kontaktanfragen" (inside the label) — "Dashboard" has no "an".
    expect(options()).toEqual(["Kontaktanfragen"]);
    // With a query the list is flat, so each row names its group.
    expect(screen.getByRole("option", { hidden: true }).textContent).toContain("Support");
    await user.clear(input);
    await user.keyboard("{ArrowDown}");
    const active = input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(active)!.textContent).toBe("Tickets");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)!.textContent).toContain("E-Mail");
  });

  it("follows the active link on Enter and closes", async () => {
    const { user } = setup();
    await user.keyboard("{Control>}k{/Control}");
    const clicked: string[] = [];
    document.addEventListener("click", (e) => {
      const a = (e.target as Element).closest("a");
      if (a) {
        clicked.push(a.getAttribute("href")!);
        e.preventDefault();
      }
    });
    await user.type(screen.getByRole("combobox", { hidden: true }), "kontakt{Enter}");
    expect(clicked).toEqual(["/kontakt"]);
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("says so when nothing matches", async () => {
    const { user } = setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox", { hidden: true }), "xyz");
    expect(screen.getByText("Keine Seite gefunden.")).toBeTruthy();
  });
});
