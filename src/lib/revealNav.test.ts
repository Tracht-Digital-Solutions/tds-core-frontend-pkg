// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nav row for `/firma` is baked at build time, so it cannot know whether
 * this visitor administers a company — that only arrives with `/me`. It ships
 * `hidden` and is unhidden here.
 *
 * Hiding is not a permission check (every `/company/*` call is gated server-
 * side); it only avoids OFFERING a page that would answer 403.
 */

const AUTH = "https://auth.test/auth";

vi.mock("../config/target", () => ({
  FRONTEND_TARGET: "customer",
  HINT_PREFIX: "tds_customer",
  BRAND_SUFFIX: "Portal",
  LOGIN_URL: "https://login.test",
}));

function markup() {
  // Both the rail and the mobile drawer render the same model, which is why
  // the implementation walks every match rather than the first.
  document.body.innerHTML = `
    <a id="rail" data-reveal-for="company-admin" hidden>Meine Firma</a>
    <a id="drawer" data-reveal-for="company-admin" hidden>Meine Firma</a>
    <a id="plain">Dashboard</a>
  `;
}

const hidden = (id: string) => (document.getElementById(id) as HTMLElement).hidden;

async function run(me: unknown | null) {
  vi.resetModules();
  vi.stubEnv("PUBLIC_AUTH_API_URL", AUTH);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      me === null
        ? ({ ok: false, status: 401, json: async () => ({}) } as Response)
        : ({ ok: true, status: 200, json: async () => me } as Response),
    ),
  );
  const { revealNav } = await import("./revealNav");
  await revealNav();
}

beforeEach(markup);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("revealNav", () => {
  it("unhides every marked row for a company admin", async () => {
    await run({ userId: 1, email: "a@b.test", companies: [{ companyId: 3, isCompanyAdmin: true }] });

    expect(hidden("rail")).toBe(false);
    expect(hidden("drawer")).toBe(false);
  });

  it("leaves the row hidden for a plain member", async () => {
    await run({ userId: 1, email: "a@b.test", companies: [{ companyId: 3, isCompanyAdmin: false }] });

    expect(hidden("rail")).toBe(true);
  });

  it("leaves the row hidden when /me fails", async () => {
    // Offering a page that will 403 is worse than not offering it; the gate
    // owns the actual "are you logged in" decision.
    await run(null);

    expect(hidden("rail")).toBe(true);
  });

  it("does not touch rows that declare no condition", async () => {
    await run({ userId: 1, email: "a@b.test", companies: [{ companyId: 3, isCompanyAdmin: true }] });

    expect((document.getElementById("plain") as HTMLElement).hidden).toBe(false);
  });

  it("unhides a platform-admin row only for an admin", async () => {
    // /users used to hang in the nav of BOTH products unconditionally, so a
    // portal user was invited to a screen whose first call 403s.
    document.body.innerHTML = `<a id="users" data-reveal-for="platform-admin" hidden>Benutzer</a>`;
    await run({ userId: 1, email: "a@b.test", isAdmin: false, companies: [{ companyId: 3, isCompanyAdmin: true }] });
    expect(hidden("users")).toBe(true);

    markup();
    document.body.insertAdjacentHTML("beforeend", `<a id="users" data-reveal-for="platform-admin" hidden>Benutzer</a>`);
    await run({ userId: 1, email: "a@b.test", isAdmin: true, companies: [] });
    expect(hidden("users")).toBe(false);
    // An admin has no memberships, so the company row stays hidden — the two
    // conditions are independent.
    expect(hidden("rail")).toBe(true);
  });

  it("ignores an unknown condition rather than revealing the row", async () => {
    document.body.innerHTML = `<a id="odd" data-reveal-for="not-a-thing" hidden>?</a>`;
    await run({ userId: 1, email: "a@b.test", isAdmin: true, companies: [] });
    expect(hidden("odd")).toBe(true);
  });

  it("keeps /firma hidden for anyone who belongs to no company — platform admin included", async () => {
    // "Meine Firma" is the company-INTERNAL view. Without a membership there is
    // no "meine Firma" to show, and the row would name someone else's company.
    document.body.innerHTML = `<a id="firma" data-reveal-for="company-or-platform-admin" hidden>Meine Firma</a>`;
    await run({ userId: 1, email: "a@b.test", isAdmin: true, companies: [] });

    expect(hidden("firma")).toBe(true);
  });

  it("reveals /firma for a platform admin who does belong to one", async () => {
    // The membership is what the row promises; the admin flag is what lets them
    // edit it (and switch to any other company from the picker).
    document.body.innerHTML = `<a id="firma" data-reveal-for="company-or-platform-admin" hidden>Meine Firma</a>`;
    await run({
      userId: 1,
      email: "a@b.test",
      isAdmin: true,
      companies: [{ companyId: 3, isCompanyAdmin: false }],
    });

    expect(hidden("firma")).toBe(false);
  });

  it("reveals /firma for a company admin too", async () => {
    document.body.innerHTML = `<a id="firma" data-reveal-for="company-or-platform-admin" hidden>Meine Firma</a>`;
    await run({
      userId: 1,
      email: "a@b.test",
      isAdmin: false,
      companies: [{ companyId: 3, isCompanyAdmin: true }],
    });

    expect(hidden("firma")).toBe(false);
  });

  it("keeps /firma hidden for a plain member", async () => {
    document.body.innerHTML = `<a id="firma" data-reveal-for="company-or-platform-admin" hidden>Meine Firma</a>`;
    await run({
      userId: 1,
      email: "a@b.test",
      isAdmin: false,
      companies: [{ companyId: 3, isCompanyAdmin: false }],
    });

    expect(hidden("firma")).toBe(true);
  });

  it("costs no request when the page has no such row", async () => {
    document.body.innerHTML = "<a id=plain>Dashboard</a>";
    vi.resetModules();
    vi.stubEnv("PUBLIC_AUTH_API_URL", AUTH);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const { revealNav } = await import("./revealNav");
    await revealNav();

    // Most pages have no conditional row; the /me probe must not fire for them.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
