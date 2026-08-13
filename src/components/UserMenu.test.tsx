// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const AUTH = "https://auth.test/auth";
const API = "https://api.test";
const LOGIN = "https://login.test";

vi.mock("../config/target", () => ({
  FRONTEND_TARGET: "admin",
  HINT_PREFIX: "tds_admin",
  BRAND_SUFFIX: "Panel",
  LOGIN_URL: LOGIN,
}));

const logout = vi.fn();

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../lib/auth");
  return { ...actual, logout };
});

/**
 * The shell's identity control. Two behaviours here are the interesting ones:
 * it must render NOTHING rather than a broken header when `/me` fails, and its
 * logout must actually reach the API — the function it calls had no call sites
 * at all before this component, and shipped with the wrong HTTP verb.
 */
const ME = {
  userId: 7,
  email: "julian@example.test",
  name: "Julian Tracht",
  displayName: "Julian",
  label: "Julian",
  isAdmin: false,
  hasAvatar: false,
  companies: [{ customerId: 3, permissions: [] }],
};

function mockFetch(handlers: Record<string, unknown>, options: { meOk?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [fragment, body] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        return { ok: true, status: 200, json: async () => body } as Response;
      }
    }
    if (url.includes("/me")) {
      return options.meOk === false
        ? ({ ok: false, status: 401, json: async () => ({}) } as Response)
        : ({ ok: true, status: 200, json: async () => ME } as Response);
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

beforeEach(async () => {
  vi.resetModules();
  logout.mockReset();
  vi.stubEnv("PUBLIC_AUTH_API_URL", AUTH);
  vi.stubEnv("PUBLIC_API_BASE", API);
  // `fetchMe` memoises the principal for the page load — that is the point of
  // it — and `vi.resetModules()` does NOT clear it, because the `vi.mock`
  // factory's `importActual` result is cached by the mock registry. Without
  // this, every case after the first renders the FIRST test's user; the admin
  // case passed in isolation and failed in the suite, which is the shape of
  // bug that gets "fixed" by deleting the assertion.
  //
  // A plain `import` (not `importActual`) is deliberate: it resolves to the
  // MOCKED module, whose `invalidateMe` is the same instance the mocked
  // `fetchMe` closes over.
  const auth = await import("../lib/auth");
  auth.invalidateMe();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function mount(fetchImpl: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchImpl);
  const { default: UserMenu } = await import("./UserMenu");
  return render(<UserMenu />);
}

describe("UserMenu", () => {
  it("renders the principal's label once /me resolves", async () => {
    await mount(mockFetch({ "/me/companies": { companies: [{ id: 3, name: "ACME GmbH", active: true }] } }));

    // Twice: the trigger and the panel head both show the identity.
    expect((await screen.findAllByText("Julian")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("ACME GmbH")).length).toBeGreaterThan(0);
  });

  it("renders NOTHING when /me fails", async () => {
    // The pre-paint gate owns "are you logged in". A half-drawn header with an
    // error in it would be worse than no header, and this is reachable
    // whenever the composed API is down.
    const { container } = await mount(mockFetch({}, { meOk: false }));

    await waitFor(() => expect(container.querySelector(".tds-dropdown")).toBeNull());
  });

  it("keeps the panel hidden until the trigger is used", async () => {
    const { container } = await mount(mockFetch({ "/me/companies": { companies: [] } }));
    await screen.findAllByText("Julian");

    const panel = container.querySelector(".tds-dropdown__panel");
    expect(panel?.hasAttribute("hidden")).toBe(true);

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(container.querySelector(".tds-dropdown__panel")?.hasAttribute("hidden")).toBe(false);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    // Without the focus return a keyboard user who dismisses the menu lands at
    // the top of the document.
    await mount(mockFetch({ "/me/companies": { companies: [] } }));
    await screen.findAllByText("Julian");

    const trigger = screen.getByRole("button", { expanded: false });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("wires the logout item", async () => {
    await mount(mockFetch({ "/me/companies": { companies: [] } }));
    await screen.findAllByText("Julian");

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("menuitem", { name: /abmelden/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("links password changes to the central login with a ?next= back here", async () => {
    // The panel deliberately hosts no login UI.
    await mount(mockFetch({ "/me/companies": { companies: [] } }));
    await screen.findAllByText("Julian");
    await userEvent.click(screen.getByRole("button", { expanded: false }));

    const link = screen.getByRole("menuitem", { name: /passwort/i });
    expect(link.getAttribute("href")).toContain(`${LOGIN}/passwort?next=`);
  });

  it("labels an admin with the product instead of a company", async () => {
    // An admin has no memberships — their reach is "any company".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ...ME, isAdmin: true, companies: [] }),
      })) as unknown as typeof fetch,
    );
    const { default: UserMenu } = await import("./UserMenu");
    render(<UserMenu />);

    expect((await screen.findAllByText("Management")).length).toBeGreaterThan(0);
  });

  it("does not ask for company names when there are no memberships", async () => {
    // One fewer cross-origin request on every page load of every admin.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...ME, isAdmin: true, companies: [] }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    const { default: UserMenu } = await import("./UserMenu");
    render(<UserMenu />);
    await screen.findAllByText("Management");

    const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(urls.some((u) => u.includes("/me/companies"))).toBe(false);
  });
});

/**
 * The company switcher.
 *
 * A login can hold a different role in each company it belongs to, so picking
 * the wrong one is not a cosmetic error — it scopes every list in the panel.
 */
describe("UserMenu — Firmenwechsler", () => {
  const TWO = {
    ...ME,
    companies: [
      { companyId: 3, permissions: [] },
      { companyId: 8, permissions: [] },
    ],
  };
  const NAMES = {
    "/me/companies": {
      companies: [
        { id: 3, name: "ACME GmbH" },
        { id: 8, name: "Beispiel AG" },
      ],
    },
  };

  function twoCompanyFetch(handlers: Record<string, unknown> = NAMES) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [fragment, body] of Object.entries(handlers)) {
        if (url.includes(fragment)) return { ok: true, status: 200, json: async () => body } as Response;
      }
      if (url.includes("/me")) return { ok: true, status: 200, json: async () => TWO } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("offers one entry per membership, with the active one checked", async () => {
    await mount(twoCompanyFetch());
    await userEvent.click(await screen.findByRole("button", { expanded: false }));

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["ACME GmbH", "Beispiel AG"]);
    // Nothing stored yet, so the first membership is active.
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("aria-checked")).toBe("false");
  });

  it("stores the pick and reloads", async () => {
    const reload = vi.fn();
    // jsdom's location.reload is not writable; replace the accessor.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload, href: "https://panel.test/" },
    });

    await mount(twoCompanyFetch());
    await userEvent.click(await screen.findByRole("button", { expanded: false }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Beispiel AG" }));

    expect(localStorage.getItem("tds_admin_active_company")).toBe("8");
    // Every island fetched its data long before the menu opened, and the
    // active company scopes nearly all of it.
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays usable when the company DIRECTORY is unavailable", async () => {
    // `/me/companies` lives in the composed API and its outage must not hide
    // the switcher — a multi-company user would be stranded in whichever
    // company happened to be active, with no way to tell or change it.
    await mount(twoCompanyFetch({}));
    await userEvent.click(await screen.findByRole("button", { expanded: false }));

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Firma 3", "Firma 8"]);
  });

  it("is absent for a single membership", async () => {
    // ME carries exactly one, spelled with the deprecated `customerId` alias —
    // which is also the assertion that the alias is still read.
    await mount(mockFetch({ "/me/companies": { companies: [{ id: 3, name: "ACME GmbH" }] } }));
    await userEvent.click(await screen.findByRole("button", { expanded: false }));

    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    expect((await screen.findAllByText("ACME GmbH")).length).toBeGreaterThan(0);
  });
});
