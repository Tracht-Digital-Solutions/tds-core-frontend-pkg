// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@tracht-digital-solutions/tds-shared/design";

const API = "https://api.test";

vi.mock("../config/target", () => ({
  FRONTEND_TARGET: "admin",
  HINT_PREFIX: "tds_admin",
  BRAND_SUFFIX: "Panel",
  LOGIN_URL: "https://login.test",
}));

/**
 * The client half of `/me/preferences`.
 *
 * Two properties matter more than the transport: a failed load must be SILENT
 * (the panel keeps working off localStorage — the backend's database is still
 * an open go-live step), and applying a value that came FROM the server must
 * not be echoed back as a save.
 */
async function load() {
  return import("./preferences");
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/**
 * `initPreferences` guards itself with a module-level flag, and
 * `vi.resetModules()` hands each test a fresh module — but jsdom's `window` is
 * shared for the whole FILE, so a listener registered by one test survives into
 * the next and every later `tds:theme-change` fires it too. Left alone, the
 * idempotency test counted three saves for one change and looked like a bug in
 * the guard. Track and unregister per test instead.
 */
const registered: Array<[string, EventListenerOrEventListenerObject]> = [];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  registered.length = 0;
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    registered.push([type, listener]);
    original(type, listener, options);
  }) as typeof window.addEventListener);
  vi.stubEnv("PUBLIC_API_BASE", API);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, listener] of registered) window.removeEventListener(type, listener);
  registered.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadPreferences", () => {
  it("returns the stored values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ preferences: { theme: "dark", locale: "en" } })),
    );
    const { loadPreferences } = await load();

    expect(await loadPreferences()).toEqual({ theme: "dark", locale: "en" });
  });

  it("drops values the panel does not understand", async () => {
    // The backend whitelists on write, but a response is still untrusted input
    // — and `theme` is applied straight to a DOM attribute.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ preferences: { theme: "chartreuse", locale: "fr", notify_toast: "yes" } }),
      ),
    );
    const { loadPreferences } = await load();

    expect(await loadPreferences()).toEqual({});
  });

  it("resolves to {} on an error status instead of throwing", async () => {
    // `services/frontend/.env` is still an open go-live step, so this is a
    // supported state, not an exception.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 500)));
    const { loadPreferences } = await load();

    expect(await loadPreferences()).toEqual({});
  });

  it("resolves to {} when the request cannot be made at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    const { loadPreferences } = await load();

    expect(await loadPreferences()).toEqual({});
  });
});

describe("savePreferences", () => {
  it("PUTs the partial set and RETURNS the response", async () => {
    // Never await a mutation and drop the result — the caller has to be able
    // to report the status.
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { savePreferences } = await load();

    const res = await savePreferences({ theme: "dark" });

    expect(res?.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/me/preferences`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ preferences: { theme: "dark" } });
  });

  it("resolves to null rather than throwing when offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    const { savePreferences } = await load();

    expect(await savePreferences({ theme: "dark" })).toBeNull();
  });
});

describe("initPreferences", () => {
  it("applies the server's theme without echoing it back as a save", async () => {
    // The echo is the bug this guards: applying a loaded value raises
    // `tds:theme-change`, whose listener would PUT it straight back.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse({ ok: true })
        : jsonResponse({ preferences: { theme: "dark" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { initPreferences } = await load();
    initPreferences();
    await vi.waitFor(() =>
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark"),
    );

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("pushes a LATER change up", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" ? jsonResponse({ ok: true }) : jsonResponse({ preferences: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { initPreferences } = await load();
    initPreferences();

    const { applyThemePreference } = await import("@tracht-digital-solutions/tds-shared/theme");
    applyThemePreference("dark");

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      preferences: { theme: "dark" },
    });
  });

  it("is idempotent — a layout script runs on every page", async () => {
    // A second listener would double every save.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" ? jsonResponse({ ok: true }) : jsonResponse({ preferences: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { initPreferences } = await load();
    initPreferences();
    initPreferences();
    initPreferences();

    const { applyThemePreference } = await import("@tracht-digital-solutions/tds-shared/theme");
    applyThemePreference("dark");

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length).toBe(1),
    );
  });
});
