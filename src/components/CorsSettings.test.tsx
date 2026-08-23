// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";
import CorsSettings from "./CorsSettings";

/**
 * The CORS settings section. Layout is not what is worth guarding — these three
 * promises are, and each one fails silently when it breaks:
 *
 *  - the LAYER of every effective origin is shown, or the baseline entries that
 *    cannot be deleted read as a bug;
 *  - only the `db` layer is loaded into the editable field, or the first save
 *    would try to "store" the baseline and the host's `.env` as custom rows;
 *  - a rejected entry is rendered IN FLOW with its reason. The server compares
 *    an exact string, so `https://kunde.de/` unblocks nothing forever — if the
 *    form swallowed the reject, the entry would look saved and the site it was
 *    meant to unblock would stay broken with nothing to connect the two.
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
});

const statusDefaults = {
  origins: [
    { origin: "https://management.tracht-digital.de", source: "baseline" },
    { origin: "http://localhost:4321", source: "env" },
    { origin: "https://kunde.example", source: "db" },
  ],
  custom: ["https://kunde.example"],
  store_available: true,
};

function mockFetch(over: { status?: unknown; put?: Response } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/admin/cors")) {
      if ((init?.method ?? "GET") === "PUT") {
        return (
          over.put ??
          new Response(
            JSON.stringify({ ok: true, saved: ["https://kunde.example"], rejected: [], ...statusDefaults }),
            { status: 200 },
          )
        );
      }
      return new Response(JSON.stringify(over.status ?? statusDefaults), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CorsSettings", () => {
  it("names the layer every effective origin came from", async () => {
    mockFetch();
    render(<CorsSettings />);

    await screen.findByText("https://management.tracht-digital.de");
    // Without the layer, an entry the admin cannot delete looks like a bug.
    expect(screen.getByText("fest eingebaut")).toBeTruthy();
    expect(screen.getByText(".env des Hosts")).toBeTruthy();
    expect(screen.getByText("hier gepflegt")).toBeTruthy();
  });

  it("loads only the editable layer into the field", async () => {
    // The baseline and the host's `.env` are unioned in by the API. Prefilling
    // them here would turn them into stored custom rows on the first save.
    mockFetch();
    render(<CorsSettings />);

    const field = (await screen.findByPlaceholderText(/kunde\.example/)) as HTMLTextAreaElement;
    expect(field.value).toBe("https://kunde.example");
  });

  it("shows a rejected entry with its reason, in flow, and warns rather than reporting plain success", async () => {
    mockFetch({
      put: new Response(
        JSON.stringify({
          ok: true,
          saved: ["https://kunde.example"],
          rejected: [{ value: "https://kunde.de/app", reason: "Nur Schema, Host und ggf. Port — kein Pfad." }],
          ...statusDefaults,
        }),
        { status: 200 },
      ),
    });
    render(<CorsSettings />);
    await screen.findByText("hier gepflegt");

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    // The value, then the reason on the same row. Matching the reason text
    // alone would also hit the standing hint above the field.
    const rejected = await screen.findByText("https://kunde.de/app");
    expect(rejected.closest("li")?.textContent).toContain("kein Pfad");
    // "Gespeichert." alone over a rejected entry would read as full success.
    await waitFor(() => expect(toasts.at(-1)?.variant).toBe("warning"));
  });

  it("reports a failed save with its HTTP status instead of closing quietly", async () => {
    // The status is what separates "session expired" from "service down" in a
    // bug report, and awaiting a mutation without reading the response was the
    // single most common defect across the extensions.
    mockFetch({ put: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) });
    render(<CorsSettings />);
    await screen.findByText("hier gepflegt");

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toasts.at(-1)?.variant).toBe("danger"));
    expect(toasts.at(-1)?.message).toContain("403");
  });

  it("says so when there is no database to store custom origins in", async () => {
    mockFetch({ status: { ...statusDefaults, custom: [], store_available: false } });
    render(<CorsSettings />);

    await screen.findByText(/Noch keine Datenbank konfiguriert/);
  });

  it("sends the field as-is so the API owns normalisation", async () => {
    // Normalising in the browser would put the rule in two places, and the API
    // is the one that has to be right — it is what compares the string.
    const fetchMock = mockFetch();
    render(<CorsSettings />);
    await screen.findByText("hier gepflegt");

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        origins: "https://kunde.example",
      });
    });
  });
});
