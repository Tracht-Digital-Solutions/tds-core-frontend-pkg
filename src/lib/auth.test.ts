// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 401 backstop is the reason this file exists.
 *
 * The rule (root CLAUDE.md): a 401 does NOT mean "logged out". It is confirmed
 * against `/me` first, and only a `/me` that ALSO 401s ends the session. The
 * blanket 401→logout it replaced looped freshly-logged-in users back to the
 * login whenever any single RBAC-scoped endpoint refused them.
 *
 * `redirectToLogin` latches on a module-level `redirecting` flag, so every test
 * re-imports the module through `vi.resetModules()` to get a clean latch.
 */

const AUTH = "https://api.tracht-digital.de/auth";
const LOGIN = "https://auth.tracht-digital.de";

let fetchMock: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;

/** Fresh module instance — resets the `redirecting` latch between tests. */
async function loadAuth() {
  vi.resetModules();
  return import("./auth");
}

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  fetchMock = vi.fn().mockResolvedValue(response(200));
  vi.stubGlobal("fetch", fetchMock);

  replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: "https://management.tracht-digital.de/tickets?id=7",
      origin: "https://management.tracht-digital.de",
      replace,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("presence hint", () => {
  it("defaults to the admin key prefix", async () => {
    const { setAuthed } = await loadAuth();
    setAuthed();

    // The prefix differs per target so a stale admin hint can't reveal the
    // customer portal.
    expect(localStorage.getItem("tds_admin_authed")).toBe("1");
  });

  it("seeds a confirmation timestamp so the next paint skips the /me probe", async () => {
    const { setAuthed, CONFIRM_TTL_MS } = await loadAuth();
    const before = Date.now();
    setAuthed();

    const confirmed = Number(localStorage.getItem("tds_admin_confirmed"));
    expect(confirmed).toBeGreaterThanOrEqual(before + CONFIRM_TTL_MS);
    expect(confirmed).toBeLessThanOrEqual(Date.now() + CONFIRM_TTL_MS);
  });

  it("records an expiry when one is supplied", async () => {
    const { setAuthed } = await loadAuth();
    setAuthed(1893456000);

    expect(localStorage.getItem("tds_admin_authed_exp")).toBe("1893456000");
  });

  it("omits the expiry key when none is supplied", async () => {
    const { setAuthed } = await loadAuth();
    setAuthed();

    expect(localStorage.getItem("tds_admin_authed_exp")).toBeNull();
  });

  it("reports and clears the hint", async () => {
    const { setAuthed, hasAuthedHint, clearAuthed } = await loadAuth();
    expect(hasAuthedHint()).toBe(false);

    setAuthed(123);
    expect(hasAuthedHint()).toBe(true);

    clearAuthed();
    expect(hasAuthedHint()).toBe(false);
    expect(localStorage.getItem("tds_admin_authed_exp")).toBeNull();
    expect(localStorage.getItem("tds_admin_confirmed")).toBeNull();
  });

  it("survives storage being unavailable", async () => {
    // Private mode / blocked storage must not break the app — the cookie and
    // the 401 backstop still gate.
    const { setAuthed, hasAuthedHint, clearAuthed } = await loadAuth();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => setAuthed()).not.toThrow();
    expect(hasAuthedHint()).toBe(false);
    expect(() => clearAuthed()).not.toThrow();
  });
});

describe("fetchMe", () => {
  it("returns the principal on 200", async () => {
    const me = { id: 1, email: "julian@tracht-digital.de", isAdmin: true };
    fetchMock.mockResolvedValue(response(200, me));

    const { fetchMe } = await loadAuth();
    await expect(fetchMe()).resolves.toEqual(me);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${AUTH}/me`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe("include");
  });

  it("returns null on 401 and on a network error", async () => {
    const { fetchMe } = await loadAuth();

    fetchMock.mockResolvedValue(response(401));
    await expect(fetchMe()).resolves.toBeNull();

    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(fetchMe()).resolves.toBeNull();
  });
});

describe("frontendFetch — the 401 backstop", () => {
  const API = "https://api.tracht-digital.de/tickets";

  it("sends the session cookie", async () => {
    const { frontendFetch } = await loadAuth();
    await frontendFetch(API);

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe("include");
  });

  it("passes the caller's init through", async () => {
    const { frontendFetch } = await loadAuth();
    await frontendFetch(API, { method: "PUT", body: "{}" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("{}");
    expect(init.credentials).toBe("include");
  });

  it("does not probe /me on a successful response", async () => {
    const { frontendFetch } = await loadAuth();
    await frontendFetch(API);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not probe /me on a non-401 error", async () => {
    fetchMock.mockResolvedValue(response(403));
    const { frontendFetch } = await loadAuth();
    await frontendFetch(API);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns a scoped 401 to the caller when /me still succeeds", async () => {
    // THE regression guard: an RBAC-scoped 401 must NOT log the user out.
    fetchMock
      .mockResolvedValueOnce(response(401)) // the API call
      .mockResolvedValueOnce(response(200, { id: 1 })); // the /me probe

    const { frontendFetch } = await loadAuth();
    const res = await frontendFetch(API);

    expect(res.status).toBe(401);
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the hint intact after a scoped 401", async () => {
    fetchMock.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));

    const { setAuthed, frontendFetch, hasAuthedHint } = await loadAuth();
    setAuthed();
    await frontendFetch(API);

    expect(hasAuthedHint()).toBe(true);
  });

  it("redirects to the central login when /me and the refresh both fail", async () => {
    // Three calls now: the API 401, the /me probe, and the remember-me refresh.
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));

    const { setAuthed, frontendFetch } = await loadAuth();
    setAuthed();
    await frontendFetch(API);

    expect(replace).toHaveBeenCalledTimes(1);
    const target = replace.mock.calls[0]?.[0] as string;
    expect(target.startsWith(`${LOGIN}?next=`)).toBe(true);
  });

  it("preserves the current page as an encoded absolute next", async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));

    const { frontendFetch } = await loadAuth();
    await frontendFetch(API);

    const target = new URL(replace.mock.calls[0]?.[0] as string);
    expect(target.searchParams.get("next")).toBe(
      "https://management.tracht-digital.de/tickets?id=7",
    );
  });

  it("clears the hint and hides the document when the session is really dead", async () => {
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401));

    const { setAuthed, frontendFetch, hasAuthedHint } = await loadAuth();
    setAuthed();
    await frontendFetch(API);

    expect(hasAuthedHint()).toBe(false);
    // The gate class blanks the page so the panel never flashes while leaving.
    expect(document.documentElement.classList.contains("auth-checking")).toBe(true);
  });

  it("treats a 401 from /me itself as definitive without re-probing /me", async () => {
    fetchMock.mockResolvedValue(response(401));

    const { frontendFetch } = await loadAuth();
    await frontendFetch(`${AUTH}/me`);

    // Two calls: the /me that 401'd, then the one refresh attempt. Re-probing
    // /me after /me 401s would be pointless — but a remembered device can still
    // refresh its way back in, so that is tried exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${AUTH}/refresh`);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("revives a remembered session instead of logging the user out", async () => {
    // "30 Tage angemeldet bleiben" only works because of this exchange: the
    // session JWT is short-lived on purpose, so an expired one must be traded
    // for a fresh one rather than treated as a logout.
    fetchMock
      .mockResolvedValueOnce(response(401)) // the API call
      .mockResolvedValueOnce(response(401)) // /me — session expired
      .mockResolvedValueOnce(response(200)) // /refresh — remember cookie works
      .mockResolvedValueOnce(response(200, { id: 1 })); // /me re-confirmed

    const { frontendFetch, hasAuthedHint } = await loadAuth();
    const res = await frontendFetch(API);

    expect(replace).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    // The hint is re-seeded so the next paint skips the probe entirely.
    expect(hasAuthedHint()).toBe(true);
  });

  it("does not accept a refresh that fails to re-confirm against /me", async () => {
    // A 200 from /refresh whose cookie did not stick (blocked third-party
    // cookies) must not read as a live session — that would leave the panel
    // rendering for someone who is not signed in.
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200)) // /refresh claims success
      .mockResolvedValueOnce(response(401)); // …but /me still refuses

    const { frontendFetch } = await loadAuth();
    await frontendFetch(API);

    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("redirects only once even when several requests 401 together", async () => {
    // A dashboard fires many parallel requests; N redirects would fight.
    fetchMock.mockResolvedValue(response(401));

    const { frontendFetch } = await loadAuth();
    await Promise.all([
      frontendFetch(`${API}/a`),
      frontendFetch(`${API}/b`),
      frontendFetch(`${API}/c`),
    ]);

    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("accepts a URL object as well as a string", async () => {
    const { frontendFetch } = await loadAuth();
    await frontendFetch(new URL(API));

    expect(fetchMock.mock.calls[0]?.[0]).toBe(API);
  });
});

describe("logout", () => {
  it("posts to the API, clears the hint and leaves for the login site", async () => {
    const { setAuthed, logout, hasAuthedHint } = await loadAuth();
    setAuthed();
    await logout();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${AUTH}/logout`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(hasAuthedHint()).toBe(false);
    expect(replace).toHaveBeenCalledWith(LOGIN);
  });

  it("still logs out locally when the API call fails", async () => {
    // Losing the server session is best-effort; the local state must go anyway.
    fetchMock.mockRejectedValue(new TypeError("offline"));

    const { setAuthed, logout, hasAuthedHint } = await loadAuth();
    setAuthed();
    await logout();

    expect(hasAuthedHint()).toBe(false);
    expect(replace).toHaveBeenCalledWith(LOGIN);
  });
});

describe("API base URLs", () => {
  it("defaults to the production gateway", async () => {
    const { AUTH_API_URL, API_BASE, CUSTOMER_API_URL } = await loadAuth();

    expect(AUTH_API_URL).toBe(AUTH);
    expect(API_BASE).toBe("https://api.tracht-digital.de");
    // The customer API is reached through the gateway's /customer prefix.
    expect(CUSTOMER_API_URL).toBe("https://api.tracht-digital.de/customer");
  });
});
