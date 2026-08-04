// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The dashboard renders EVERY enabled widget at build time; this module then
 * reorders and hides slots to match the user's saved layout.
 *
 * The property that matters most is the progressive-enhancement promise: with
 * no saved layout, or an unreachable API, every widget must stay visible in its
 * authored order. A regression there doesn't throw — it silently blanks
 * someone's dashboard.
 *
 * `frontendFetch` is mocked at the module boundary; `auth.test.ts` covers it.
 */

const { frontendFetch } = vi.hoisted(() => ({ frontendFetch: vi.fn() }));

vi.mock("./auth", () => ({
  frontendFetch,
  API_BASE: "https://api.tracht-digital.de",
}));

const { initDashboardLayout } = await import("./dashboardLayout");

interface Row {
  widget_id: string;
  visible: boolean;
  sort: number;
}

/** Build the DOM the Dashboard page emits, with the given widget ids. */
function renderGrid(ids: string[]): void {
  document.body.innerHTML = `
    <button data-dashboard-edit hidden>Anpassen</button>
    <button data-dashboard-save hidden>Speichern</button>
    <button data-dashboard-cancel hidden>Abbrechen</button>
    <div data-dashboard-grid>
      ${ids
        .map(
          (id) => `
        <section class="widget-slot" data-widget="${id}">
          <span class="widget-slot__handle"></span>
          <input type="checkbox" data-widget-visible checked />
        </section>`,
        )
        .join("")}
    </div>`;
}

const grid = () => document.querySelector("[data-dashboard-grid]")!;
const order = () =>
  Array.from(grid().querySelectorAll<HTMLElement>(".widget-slot")).map((s) => s.dataset.widget);
const hidden = () =>
  Array.from(grid().querySelectorAll<HTMLElement>(".widget-slot"))
    .filter((s) => s.classList.contains("is-hidden"))
    .map((s) => s.dataset.widget);

const btn = (kind: "edit" | "save" | "cancel") =>
  document.querySelector<HTMLButtonElement>(`[data-dashboard-${kind}]`)!;

/**
 * Toasts are collected off the bus rather than out of the DOM: the save path
 * raises them through the `tds:toast` window event, so no ToastHost has to
 * exist here and the fixture stays exactly as it was.
 */
let toasts: ToastDetail[] = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<ToastDetail>).detail);
};

/** Resolve the layout GET with the given rows and let the promise chain settle. */
async function loadWith(rows: Row[] | null, ok = true) {
  frontendFetch.mockResolvedValueOnce({
    ok,
    json: async () => (rows === null ? {} : { layout: rows }),
  });
  initDashboardLayout();
  await vi.waitFor(() => expect(btn("edit").hidden).toBe(false));
}

beforeEach(() => {
  frontendFetch.mockReset();
  document.body.innerHTML = "";
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  document.body.innerHTML = "";
});

describe("bootstrapping", () => {
  it("does nothing when the dashboard markup is absent", () => {
    // Extension pages share the script bundle; it must be inert elsewhere.
    document.body.innerHTML = "<main>Some other page</main>";
    expect(() => initDashboardLayout()).not.toThrow();
    expect(frontendFetch).not.toHaveBeenCalled();
  });

  it("requests the saved layout once mounted", async () => {
    renderGrid(["a", "b"]);
    await loadWith([]);

    expect(frontendFetch).toHaveBeenCalledWith(
      "https://api.tracht-digital.de/me/dashboard-layout",
    );
  });

  it("reveals the customise button after the layout settles", async () => {
    renderGrid(["a"]);
    expect(btn("edit").hidden).toBe(true);

    await loadWith([]);
    expect(btn("edit").hidden).toBe(false);
  });
});

describe("applying a saved layout", () => {
  it("reorders the slots to the saved order", async () => {
    renderGrid(["a", "b", "c"]);
    await loadWith([
      { widget_id: "c", visible: true, sort: 0 },
      { widget_id: "a", visible: true, sort: 1 },
      { widget_id: "b", visible: true, sort: 2 },
    ]);

    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("hides widgets the user switched off", async () => {
    renderGrid(["a", "b"]);
    await loadWith([
      { widget_id: "a", visible: true, sort: 0 },
      { widget_id: "b", visible: false, sort: 1 },
    ]);

    expect(hidden()).toEqual(["b"]);
  });

  it("mirrors visibility onto the checkboxes", async () => {
    renderGrid(["a", "b"]);
    await loadWith([
      { widget_id: "a", visible: false, sort: 0 },
      { widget_id: "b", visible: true, sort: 1 },
    ]);

    const boxes = Array.from(
      grid().querySelectorAll<HTMLInputElement>("[data-widget-visible]"),
    );
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
  });

  it("appends widgets the saved layout has never seen, still visible", async () => {
    // A newly installed extension must show up rather than vanish because the
    // stored layout predates it.
    renderGrid(["a", "brand-new", "b"]);
    await loadWith([
      { widget_id: "a", visible: true, sort: 0 },
      { widget_id: "b", visible: true, sort: 1 },
    ]);

    expect(order()).toEqual(["a", "b", "brand-new"]);
    expect(hidden()).toEqual([]);
  });

  it("ignores saved rows for widgets that no longer exist", async () => {
    // An uninstalled extension leaves a stale row behind.
    renderGrid(["a"]);
    await loadWith([
      { widget_id: "removed", visible: true, sort: 0 },
      { widget_id: "a", visible: true, sort: 1 },
    ]);

    expect(order()).toEqual(["a"]);
  });
});

describe("progressive enhancement", () => {
  it("leaves the authored order untouched when there is no saved layout", async () => {
    renderGrid(["a", "b", "c"]);
    await loadWith([]);

    expect(order()).toEqual(["a", "b", "c"]);
    expect(hidden()).toEqual([]);
  });

  it("leaves everything visible when the response has no layout key", async () => {
    renderGrid(["a", "b"]);
    await loadWith(null);

    expect(order()).toEqual(["a", "b"]);
    expect(hidden()).toEqual([]);
  });

  it("leaves everything visible when the API errors", async () => {
    renderGrid(["a", "b"]);
    await loadWith([], false);

    expect(order()).toEqual(["a", "b"]);
    expect(hidden()).toEqual([]);
  });

  it("leaves everything visible when the API is unreachable", async () => {
    // The dashboard must work offline — this is the promise in the module doc.
    renderGrid(["a", "b"]);
    frontendFetch.mockRejectedValueOnce(new TypeError("offline"));
    initDashboardLayout();

    await vi.waitFor(() => expect(btn("edit").hidden).toBe(false));
    expect(order()).toEqual(["a", "b"]);
    expect(hidden()).toEqual([]);
  });
});

describe("edit mode", () => {
  it("swaps the buttons and marks the grid editing", async () => {
    renderGrid(["a", "b"]);
    await loadWith([]);

    btn("edit").click();

    expect(grid().classList.contains("is-editing")).toBe(true);
    expect(btn("edit").hidden).toBe(true);
    expect(btn("save").hidden).toBe(false);
    expect(btn("cancel").hidden).toBe(false);
  });

  it("saves the current DOM order with sequential sort indices", async () => {
    renderGrid(["a", "b", "c"]);
    await loadWith([]);

    btn("edit").click();
    frontendFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    btn("save").click();

    await vi.waitFor(() => expect(frontendFetch).toHaveBeenCalledTimes(2));
    const [, init] = frontendFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      layout: [
        { widget_id: "a", visible: true, sort: 0 },
        { widget_id: "b", visible: true, sort: 1 },
        { widget_id: "c", visible: true, sort: 2 },
      ],
    });
  });

  it("sends the checkbox state as visibility", async () => {
    renderGrid(["a", "b"]);
    await loadWith([]);

    btn("edit").click();
    grid().querySelectorAll<HTMLInputElement>("[data-widget-visible]")[1]!.checked = false;
    frontendFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    btn("save").click();

    await vi.waitFor(() => expect(frontendFetch).toHaveBeenCalledTimes(2));
    const [, init] = frontendFetch.mock.calls[1] as [string, RequestInit];
    const layout = JSON.parse(init.body as string).layout as Row[];
    expect(layout.map((r) => r.visible)).toEqual([true, false]);
  });

  it("applies the saved layout immediately so a hidden widget collapses", async () => {
    renderGrid(["a", "b"]);
    await loadWith([]);

    btn("edit").click();
    grid().querySelectorAll<HTMLInputElement>("[data-widget-visible]")[0]!.checked = false;
    frontendFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    btn("save").click();

    await vi.waitFor(() => expect(hidden()).toEqual(["a"]));
    expect(grid().classList.contains("is-editing")).toBe(false);
  });

  it("confirms a successful save", async () => {
    renderGrid(["a"]);
    await loadWith([]);

    btn("edit").click();
    frontendFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    btn("save").click();

    await vi.waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0]!.variant).toBe("success");
    expect(toasts[0]!.message).toContain("gespeichert");
  });

  it("stays in edit mode when the save fails, and says so", async () => {
    renderGrid(["a"]);
    await loadWith([]);

    btn("edit").click();
    frontendFetch.mockRejectedValueOnce(new TypeError("offline"));
    btn("save").click();

    await vi.waitFor(() => expect(btn("save").disabled).toBe(false));
    // Both halves of the contract: the work is still there to retry, AND the
    // user was told. Without the second, staying in edit mode reads as "the
    // click didn't register".
    expect(grid().classList.contains("is-editing")).toBe(true);
    expect(toasts.map((t) => t.variant)).toEqual(["danger"]);
  });

  it("reports the HTTP status when the save is rejected", async () => {
    renderGrid(["a"]);
    await loadWith([]);

    btn("edit").click();
    frontendFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    btn("save").click();

    await vi.waitFor(() => expect(btn("save").disabled).toBe(false));
    expect(toasts.length).toBe(1);
    expect(toasts[0]!.variant).toBe("danger");
    // The status is the only clue to WHY, and it is what turns a bug report
    // into a diagnosis (401 = session, 422 = payload, 500 = service down).
    expect(toasts[0]!.message).toContain("500");
  });

  it("restores the pre-edit arrangement on cancel", async () => {
    renderGrid(["a", "b", "c"]);
    await loadWith([]);

    btn("edit").click();
    // Simulate a drag: move "c" to the front, and hide "a".
    grid().prepend(grid().querySelector('[data-widget="c"]')!);
    grid().querySelectorAll<HTMLInputElement>("[data-widget-visible]")[0]!.checked = false;
    expect(order()).toEqual(["c", "a", "b"]);

    btn("cancel").click();

    expect(order()).toEqual(["a", "b", "c"]);
    expect(hidden()).toEqual([]);
    expect(grid().classList.contains("is-editing")).toBe(false);
  });

  it("does not persist anything on cancel", async () => {
    renderGrid(["a", "b"]);
    await loadWith([]);

    btn("edit").click();
    btn("cancel").click();

    expect(frontendFetch).toHaveBeenCalledTimes(1); // the initial GET only
    expect(toasts).toEqual([]); // discarding your own edit is not an outcome
  });

  it("says nothing when the initial layout load fails", async () => {
    // The load runs on EVERY dashboard view and costs the user nothing when it
    // fails (they get the authored order). Toasting here would fire on every
    // page view while the frontend service is down and train everyone to
    // ignore the red box that actually matters.
    renderGrid(["a", "b"]);
    frontendFetch.mockRejectedValueOnce(new TypeError("offline"));
    initDashboardLayout();

    await vi.waitFor(() => expect(btn("edit").hidden).toBe(false));
    expect(toasts).toEqual([]);
  });
});
