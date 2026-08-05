// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";
import ModulesAdmin from "./ModulesAdmin";
import type { ModuleEntry } from "../lib/moduleUpdates";

/**
 * The Module page is the one screen in the panel whose buttons start a
 * PRODUCTION deploy. What is worth guarding is therefore not the layout but the
 * promises it makes:
 *
 *  - a row whose newest version falls outside the pin must offer no deploy
 *    button at all — a rebuild would change nothing,
 *  - the confirmation must say that ONE rebuild updates EVERY in-range module,
 *    because that is what `npm install --no-package-lock` actually does, and
 *  - a failed dispatch must report its HTTP status, which is what separates an
 *    expired token from an unreachable API.
 */

const modules: ModuleEntry[] = [
  {
    pkg: "@tracht-digital-solutions/tds-ext-blog-cms",
    id: "blog-cms",
    name: "Blog-CMS",
    installed: "0.1.29",
    range: "^0.1.1",
    kind: "extension",
  },
  {
    pkg: "@tracht-digital-solutions/tds-ext-tools",
    id: "tools",
    name: "Tools",
    installed: "0.1.12",
    range: "^0.1.0",
    kind: "extension",
  },
  {
    pkg: "@tracht-digital-solutions/tds-shared",
    name: "Design- & i18n-Bibliothek",
    installed: "0.16.0",
    range: "^0.16.0",
    kind: "platform",
  },
];

const frontendTarget = {
  key: "frontend",
  label: "Frontend neu bauen",
  repo: "Tracht-Digital-Solutions/tds-admin-frontend",
  workflow: "release.yml",
  configured: true,
};

function checkBody(over: Record<string, unknown> = {}) {
  return {
    versions: {
      // in range → update
      "@tracht-digital-solutions/tds-ext-blog-cms": "0.1.30",
      // crosses the pinned minor → repin
      "@tracht-digital-solutions/tds-ext-tools": "0.2.0",
      "@tracht-digital-solutions/tds-shared": "0.16.0",
    },
    registry: { configured: true, error: "" },
    targets: [frontendTarget],
    backend: { modules: ["blog-cms", "tools"], packages: {} },
    auto: {
      enabled: false,
      interval_hours: 24,
      last_run: null,
      last_result: null,
      last_dispatch: null,
      next_run: null,
      inventory_known: true,
    },
    checked_at: "2026-08-05T10:00:00+00:00",
    ...over,
  };
}

/** Collect toasts off the shared bus — no ToastHost is mounted in a unit test. */
let toasts: ToastDetail[];
const collect = (e: Event) => toasts.push((e as CustomEvent<ToastDetail>).detail);

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collect);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collect);
  cleanup();
});

/** Respond to /check with `body`, and to everything else with `rest`. */
function mockFetch(body: unknown, rest?: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/admin/modules/check")) {
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return rest ? rest(url) : new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ModulesAdmin", () => {
  it("classifies each row against its pin", async () => {
    mockFetch(checkBody());
    render(<ModulesAdmin modules={modules} />);

    await screen.findByText("Update verfügbar");
    expect(screen.getByText("Repin erforderlich")).toBeTruthy();
    expect(screen.getByText("Aktuell")).toBeTruthy();
  });

  it("posts the inventory, not just the package names", async () => {
    // The API cannot see the product's package.json — without the ranges the
    // unattended updater has nothing to decide against.
    const fetchMock = mockFetch(checkBody());
    render(<ModulesAdmin modules={modules} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = JSON.parse(String(init.body)) as { inventory: { pkg: string; range: string }[] };
    expect(sent.inventory).toHaveLength(3);
    expect(sent.inventory[0]).toMatchObject({ range: "^0.1.1" });
  });

  it("offers no deploy button for a version outside the pin", async () => {
    mockFetch(checkBody());
    render(<ModulesAdmin modules={modules} />);

    await screen.findByText("Repin erforderlich");
    // Exactly one row is updatable — the repin row names the replacement pin
    // instead of a button that would do nothing.
    expect(screen.getAllByRole("button", { name: "Aktualisieren" })).toHaveLength(1);
    expect(screen.getByText(/Pin auf \^0\.2\.0 anheben/)).toBeTruthy();
  });

  it("hides the row button when no frontend deploy is configured", async () => {
    mockFetch(checkBody({ targets: [{ ...frontendTarget, configured: false }] }));
    render(<ModulesAdmin modules={modules} />);

    await screen.findByText("Update verfügbar");
    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
  });

  it("says the rebuild covers every module, not the row it was pressed on", async () => {
    mockFetch(checkBody());
    render(<ModulesAdmin modules={modules} />);

    await userEvent.click(await screen.findByRole("button", { name: "Aktualisieren" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("jedes Modul");
    expect(dialog.textContent).toContain("nicht nur „Blog-CMS“");
  });

  it("reports a failed dispatch with its HTTP status", async () => {
    mockFetch(checkBody(), () => new Response(JSON.stringify({ error: "Token abgelehnt" }), { status: 502 }));
    render(<ModulesAdmin modules={modules} />);

    await userEvent.click(await screen.findByRole("button", { name: "Aktualisieren" }));
    await userEvent.click(await screen.findByRole("button", { name: "Starten" }));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts[0]?.variant).toBe("danger");
    expect(toasts[0]?.message).toContain("HTTP 502");
  });

  it("warns when no registry token is stored", async () => {
    mockFetch(checkBody({ registry: { configured: false, error: "" }, versions: {} }));
    render(<ModulesAdmin modules={modules} />);

    expect(await screen.findByText(/Kein Registry-Token hinterlegt/)).toBeTruthy();
  });

  it("keeps a load failure in the flow rather than in a toast", async () => {
    // Nothing is on screen without the check response — a toast would blend
    // away and leave an empty page behind.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(<ModulesAdmin modules={modules} />);

    expect(await screen.findByText(/HTTP 500/)).toBeTruthy();
    expect(toasts).toHaveLength(0);
  });

  it("surfaces the unattended updater's state", async () => {
    mockFetch(
      checkBody({
        auto: {
          enabled: true,
          interval_hours: 12,
          last_run: "2026-08-05T09:00:00+00:00",
          last_result: "Alle Module sind aktuell.",
          last_dispatch: null,
          next_run: "2026-08-05T21:00:00+00:00",
          inventory_known: true,
        },
      }),
    );
    render(<ModulesAdmin modules={modules} />);

    expect(await screen.findByText("aktiv, alle 12 h")).toBeTruthy();
    expect(screen.getByText(/Alle Module sind aktuell\./)).toBeTruthy();
  });

  it("toasts the outcome of a forced auto-update run", async () => {
    mockFetch(checkBody(), (url) =>
      url.includes("/auto-update")
        ? new Response(
            JSON.stringify({
              report: { dispatched: true, updates: [{}], repins: [], checked: 3, enabled: true, message: "1 Update(s) gefunden — Rebuild gestartet." },
            }),
            { status: 200 },
          )
        : new Response("{}", { status: 200 }),
    );
    render(<ModulesAdmin modules={modules} />);

    await userEvent.click(await screen.findByRole("button", { name: "Jetzt prüfen und aktualisieren" }));

    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts[0]?.variant).toBe("success");
    expect(toasts[0]?.message).toContain("Rebuild gestartet");
  });
});
