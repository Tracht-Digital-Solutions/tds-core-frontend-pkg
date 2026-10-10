// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "./SetupWizard";
import { resetSetupStatusCache } from "../lib/setupStatus";

/**
 * The setup wizard. Worth guarding: that open, snoozed, done and ignored items
 * land in their own groups (an ignored item counted as open would nag for
 * ever), and that each choice posts to the item's own route — the server keys
 * the user's choice by that id.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSetupStatusCache();
});

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  module: id.split(":")[0],
  title: `Titel ${id}`,
  description: `Beschreibung ${id}`,
  state: "missing",
  level: "recommended",
  href: `/einstellungen#settings-${id.split(":")[0]}`,
  snoozed: false,
  ignored: false,
  ...over,
});

function stubApi(items: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.endsWith("/me/setup-status")) {
      return new Response(JSON.stringify({ items, open: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SetupWizard", () => {
  it("sorts items into open, later, done and ignored", async () => {
    stubApi([
      item("core:mail", { level: "required" }),
      item("shop:amazon", { snoozed: true }),
      item("lexware:api", { state: "ok" }),
      item("blog-cms:deepl", { ignored: true }),
    ]);
    render(<SetupWizard />);

    const open = await screen.findByRole("region", { name: "Offen" });
    expect(within(open).getByText("Titel core:mail")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Später" })).getByText("Titel shop:amazon")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Eingerichtet" })).getByText("Titel lexware:api")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Ignoriert" })).getByText("Titel blog-cms:deepl")).toBeTruthy();
    expect(within(open).getByRole("link", { name: "Einrichten" }).getAttribute("href")).toBe("/einstellungen#settings-core");
  });

  it("posts the choice to the item's own route", async () => {
    const fetchMock = stubApi([item("shop:amazon")]);
    render(<SetupWizard />);
    await userEvent.click(await screen.findByRole("button", { name: "Später" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toMatch(/^https?:\/\/[^/]+.*\/me\/setup-status\/shop:amazon$/);
      expect(JSON.parse(String(post![1]!.body))).toEqual({ action: "snooze" });
    });
  });
});
