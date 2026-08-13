// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The company list is the last live dependency on the legacy `tds-customer-api`.
 * A fallback that silently prefers the wrong leg is invisible in the UI — the
 * names show up either way — so these assertions are about WHICH endpoint was
 * asked, in what order, and what happens when one of them lies.
 */

const API = "https://api.tracht-digital.de";
const COMPOSED = `${API}/admin/customers`;
const LEGACY = `${API}/customer/admin/customers`;

let fetchMock: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return import("./companies");
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Route by URL so a test states its intent rather than counting calls. */
function route(map: Record<string, Response | (() => never)>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = map[url];
    if (!hit) return response(404, {});
    if (typeof hit === "function") return hit();
    return hit;
  });
  vi.stubGlobal("fetch", fetchMock);
}

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "https://management.tracht-digital.de/users", replace: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCompanies", () => {
  it("prefers the composed endpoint and never touches the legacy one", async () => {
    route({ [COMPOSED]: response(200, { customers: [{ id: 1, name: "Acme" }] }) });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    expect(result.source).toBe("composed");
    expect(result.companies).toEqual([{ id: 1, name: "Acme" }]);
    // The whole point: once the composed API answers, the legacy service is out
    // of the picture and can be retired without another frontend deploy.
    expect(urls()).not.toContain(LEGACY);
  });

  it("falls back to the legacy endpoint while the composed API is down", async () => {
    // Exactly today's production state: the frontend service cannot boot without
    // its .env + DB, so every catch-all route answers 500.
    route({
      [COMPOSED]: response(500, {}),
      [LEGACY]: response(200, { customers: [{ id: 7, name: "Beta GmbH" }] }),
    });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    expect(result.source).toBe("legacy");
    expect(result.companies).toEqual([{ id: 7, name: "Beta GmbH" }]);
    expect(urls()).toEqual([COMPOSED, LEGACY]);
  });

  it("falls back when the composed endpoint throws, not just when it 500s", async () => {
    route({
      [COMPOSED]: () => {
        throw new TypeError("Failed to fetch");
      },
      [LEGACY]: response(200, { customers: [{ id: 7, name: "Beta GmbH" }] }),
    });

    const { fetchCompanies } = await load();
    expect((await fetchCompanies()).source).toBe("legacy");
  });

  it("falls back when the composed endpoint answers 200 with junk", async () => {
    // A 200 whose body is not a list is worse than a 500: taken at face value it
    // would render an EMPTY company list, which looks like "no customers exist"
    // rather than like a failure.
    route({
      [COMPOSED]: response(200, { error: "Forbidden" }),
      [LEGACY]: response(200, { customers: [{ id: 7, name: "Beta GmbH" }] }),
    });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    expect(result.source).toBe("legacy");
    expect(result.companies).toHaveLength(1);
  });

  it("reports source 'none' rather than throwing when both fail", async () => {
    route({ [COMPOSED]: response(500, {}), [LEGACY]: response(503, {}) });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    // Membership editing still works without names (it shows ids), so a list
    // outage must never take user management down with it.
    expect(result).toEqual({ companies: [], source: "none" });
  });

  it("drops malformed entries instead of passing them to the editor", async () => {
    route({
      [COMPOSED]: response(200, {
        customers: [
          { id: 1, name: "Acme" },
          { id: "2", name: "Wrong id type" },
          { name: "No id" },
          null,
          { id: 3, name: "Gamma" },
        ],
      }),
    });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    // A `{id: "2"}` reaches `map.set(c.id, …)` and then never matches the numeric
    // membership id — the company would silently render as its raw number.
    expect(result.companies).toEqual([
      { id: 1, name: "Acme" },
      { id: 3, name: "Gamma" },
    ]);
  });

  it("treats an empty composed list as a real answer, not as a failure", async () => {
    // A fresh install genuinely has no customers. Retrying the legacy service
    // here would resurrect the dependency this whole module exists to remove.
    route({ [COMPOSED]: response(200, { customers: [] }), [LEGACY]: response(200, { customers: [{ id: 9, name: "Old" }] }) });

    const { fetchCompanies } = await load();
    const result = await fetchCompanies();

    expect(result).toEqual({ companies: [], source: "composed" });
    expect(urls()).not.toContain(LEGACY);
  });

  it("sends the session cookie on both legs", async () => {
    route({ [COMPOSED]: response(500, {}), [LEGACY]: response(200, { customers: [] }) });

    const { fetchCompanies } = await load();
    await fetchCompanies();

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe("include");
    }
  });
});

describe("the rename transition", () => {
  it("prefers the new `companies` key when the extension sends both", async () => {
    // The composed extension emits both spellings for one release; reading
    // only `customers` would go dark the moment the alias is dropped.
    route({
      [COMPOSED]: response(200, {
        companies: [{ id: 1, name: "Acme" }],
        customers: [{ id: 1, name: "Acme" }],
      }),
    });
    const { fetchCompanies } = await load();

    expect(await fetchCompanies()).toEqual({
      companies: [{ id: 1, name: "Acme" }],
      source: "composed",
    });
  });

  it("still reads a `customers`-only body — the legacy API never learns the new name", async () => {
    route({
      [COMPOSED]: response(500, {}),
      [LEGACY]: response(200, { customers: [{ id: 7, name: "Beta GmbH" }] }),
    });
    const { fetchCompanies } = await load();

    expect(await fetchCompanies()).toEqual({
      companies: [{ id: 7, name: "Beta GmbH" }],
      source: "legacy",
    });
  });
});
