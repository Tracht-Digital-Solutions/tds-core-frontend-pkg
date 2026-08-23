// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";
import SiteKeysSettings from "./SiteKeysSettings";

/**
 * The Site-Verbindungen section. Its layout is not the interesting part; these
 * promises are, and every one of them fails without a visible symptom:
 *
 *  - the issued key is rendered IN FLOW and only once. Only a hash is stored,
 *    so a key shown in a toast is a key that is gone when the toast is;
 *  - an origin CORS does not allow is called out as such. A key is useless to a
 *    site the allow-list rejects, and the two settings live in two sections;
 *  - a failed mutation is REPORTED. Awaiting a mutation and dropping the
 *    response was the single most common defect across the extensions: the
 *    dialog closed, the list reloaded, and nothing had happened;
 *  - switching to `enforce` with no valid key anywhere is called out, because
 *    the resulting breakage is a build that silently serves stale fallbacks.
 */

let toasts: ToastDetail[];
const collect = (e: Event) => toasts.push((e as CustomEvent<ToastDetail>).detail);

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collect);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collect);
  cleanup();
  vi.unstubAllGlobals();
});

const statusDefaults = {
  sites: [
    {
      id: "blog",
      label: "Blog",
      known: true,
      origins: [{ origin: "https://blog.tracht-digital.de", cors: "baseline" }],
      keys: [
        {
          id: 7,
          site: "blog",
          label: "Blog",
          key_prefix: "tdsk_blog_A1b2C",
          created_at: "2026-08-20 10:00:00",
          last_used_at: null,
          last_used_origin: null,
          last_used_api_base: null,
          revoked_at: null,
        },
      ],
    },
    {
      id: "kunde-a",
      label: "Kunde A",
      known: false,
      origins: [{ origin: "https://kunde-a.example", cors: null }],
      keys: [],
    },
  ],
  enforcement: "off",
  modes: ["off", "warn", "enforce"],
  protected_routes: ["/content/blog"],
  unkeyed: { count: 0, first_at: null, last_at: null, last_path: null, last_origin: null },
  store_available: true,
};

function mockFetch(over: { status?: unknown; post?: Response; put?: Response; del?: Response } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/admin/cors")) {
      if (method === "PUT") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ custom: ["https://alt.example"] }), { status: 200 });
    }
    if (/\/admin\/sites\/\d+$/.test(url)) {
      return over.del ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/admin/sites")) {
      if (method === "POST") {
        return (
          over.post ??
          new Response(JSON.stringify({ ok: true, id: 9, site: "blog", key: "tdsk_blog_SECRET1234" }), {
            status: 201,
          })
        );
      }
      if (method === "PUT") {
        return over.put ?? new Response(JSON.stringify({ ok: true, rejected: [] }), { status: 200 });
      }
      return new Response(JSON.stringify(over.status ?? statusDefaults), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SiteKeysSettings", () => {
  it("lists known and custom sites with their keys", async () => {
    mockFetch();
    render(<SiteKeysSettings />);

    expect(await screen.findByText("Blog")).toBeTruthy();
    expect(screen.getByText("Kunde A")).toBeTruthy();
    expect(screen.getByText("eigene Site")).toBeTruthy();
    expect(screen.getByText(/tdsk_blog_A1b2C/)).toBeTruthy();
  });

  it("says a key has never been seen rather than showing an empty cell", async () => {
    // "noch nie" and "" look the same to a reader in a hurry, and only one of
    // them means the site has not connected.
    mockFetch();
    render(<SiteKeysSettings />);
    expect(await screen.findByText(/zuletzt gesehen noch nie/)).toBeTruthy();
  });

  it("marks an origin CORS does not allow and offers to allow it", async () => {
    mockFetch();
    render(<SiteKeysSettings />);

    expect(await screen.findByText("nicht freigegeben")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Origin freigeben" })).toBeTruthy();
  });

  it("preserves the existing custom origins when allowing a new one", async () => {
    // PUT /admin/cors stores the WHOLE custom layer, so sending only the new
    // origin would delete every other one — a one-click convenience that
    // quietly removes access somewhere else.
    const fetchMock = mockFetch();
    render(<SiteKeysSettings />);

    await userEvent.click(await screen.findByRole("button", { name: "Origin freigeben" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes("/admin/cors") && init?.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put?.[1]?.body)).origins).toEqual([
        "https://alt.example",
        "https://kunde-a.example",
      ]);
    });
  });

  it("shows the issued key in flow, not as a toast", async () => {
    mockFetch();
    render(<SiteKeysSettings />);

    const buttons = await screen.findAllByRole("button", { name: "Key erzeugen" });
    await userEvent.click(buttons[0]);

    expect(await screen.findByText("tdsk_blog_SECRET1234")).toBeTruthy();
    expect(toasts.some((t) => t.message.includes("tdsk_"))).toBe(false);
  });

  it("says the key is shown only once", async () => {
    mockFetch();
    render(<SiteKeysSettings />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Key erzeugen" }))[0]);
    expect(await screen.findByText(/nur jetzt/)).toBeTruthy();
  });

  it("reports a rejected key creation instead of failing silently", async () => {
    mockFetch({ post: new Response(JSON.stringify({ error: "Unbekannte Site." }), { status: 422 }) });
    render(<SiteKeysSettings />);

    await userEvent.click((await screen.findAllByRole("button", { name: "Key erzeugen" }))[0]);

    await waitFor(() => {
      expect(toasts.some((t) => t.variant === "danger" && t.message.includes("422"))).toBe(true);
    });
    expect(screen.queryByText(/nur jetzt/)).toBeNull();
  });

  it("carries the HTTP status in a failure message", async () => {
    // "session expired" and "service down" are the same sentence without it,
    // and that difference is the whole content of a useful bug report.
    mockFetch({ del: new Response("{}", { status: 500 }) });
    render(<SiteKeysSettings />);

    await userEvent.click(await screen.findByRole("button", { name: "Widerruf" + "en" }));

    await waitFor(() => {
      expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true);
    });
  });

  it("names the routes enforcement would apply to", async () => {
    mockFetch();
    render(<SiteKeysSettings />);
    expect(await screen.findByText("/content/blog", { exact: false })).toBeTruthy();
  });

  it("warns that enforcing would reject every build when no key is valid", async () => {
    mockFetch({
      status: {
        ...statusDefaults,
        sites: [{ ...statusDefaults.sites[0], keys: [] }],
      },
    });
    render(<SiteKeysSettings />);
    expect(await screen.findByText(/würde jeden Build/)).toBeTruthy();
  });

  it("shows the keyless-read counter and offers to reset it", async () => {
    mockFetch({
      status: {
        ...statusDefaults,
        enforcement: "warn",
        unkeyed: {
          count: 37,
          first_at: "2026-08-12T09:00:00Z",
          last_at: "2026-08-23T09:00:00Z",
          last_path: "/content/blog",
          last_origin: "",
        },
      },
    });
    render(<SiteKeysSettings />);

    expect(await screen.findByText(/37 Zugriffe ohne Key/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zähler zurücksetzen" })).toBeTruthy();
  });

  it("says so when no database is configured", async () => {
    mockFetch({ status: { ...statusDefaults, store_available: false } });
    render(<SiteKeysSettings />);

    expect(await screen.findByText(/Noch keine Datenbank konfiguriert/)).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: "Key erzeugen" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("says so when no module declares a protected route", async () => {
    // Otherwise the mode selector reads as if it did something.
    mockFetch({ status: { ...statusDefaults, protected_routes: [] } });
    render(<SiteKeysSettings />);
    expect(await screen.findByText(/kein Modul geschützte Pfade/)).toBeTruthy();
  });

  it("reports a non-admin plainly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    render(<SiteKeysSettings />);
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });
});
