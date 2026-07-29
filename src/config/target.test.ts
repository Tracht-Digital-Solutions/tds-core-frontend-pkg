import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One codebase builds two products, selected at build time by
 * `PUBLIC_FRONTEND_TARGET`. The security-relevant part is `HINT_PREFIX`: the
 * pre-paint gate reads `<prefix>_authed` from localStorage, which is per-origin.
 * If both products shared a prefix, a stale admin hint could reveal the
 * customer portal's shell before the `/me` check came back.
 */

/** Re-import with a given env, since the values are module-level constants. */
async function loadTarget(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return import("./target");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("target selection", () => {
  it("defaults to admin when unset", async () => {
    const { FRONTEND_TARGET } = await loadTarget({});
    expect(FRONTEND_TARGET).toBe("admin");
  });

  it("selects customer only for the exact string", async () => {
    const { FRONTEND_TARGET } = await loadTarget({ PUBLIC_FRONTEND_TARGET: "customer" });
    expect(FRONTEND_TARGET).toBe("customer");
  });

  it("falls back to admin for any other value", async () => {
    // A typo must not produce a third, undefined target.
    for (const value of ["Customer", "kunde", "portal", "true", ""]) {
      const { FRONTEND_TARGET } = await loadTarget({ PUBLIC_FRONTEND_TARGET: value });
      expect(FRONTEND_TARGET, `value ${JSON.stringify(value)}`).toBe("admin");
    }
  });
});

describe("hint prefix", () => {
  it("differs between the two products", async () => {
    const admin = await loadTarget({ PUBLIC_FRONTEND_TARGET: "admin" });
    const customer = await loadTarget({ PUBLIC_FRONTEND_TARGET: "customer" });

    // THE isolation guarantee: a stale admin hint must not unlock the portal.
    expect(admin.HINT_PREFIX).not.toBe(customer.HINT_PREFIX);
    expect(admin.HINT_PREFIX).toBe("tds_admin");
    expect(customer.HINT_PREFIX).toBe("tds_customer");
  });

  it("is a safe localStorage key stem", async () => {
    for (const target of ["admin", "customer"]) {
      const { HINT_PREFIX } = await loadTarget({ PUBLIC_FRONTEND_TARGET: target });
      expect(HINT_PREFIX).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("branding", () => {
  it("labels each product", async () => {
    const admin = await loadTarget({ PUBLIC_FRONTEND_TARGET: "admin" });
    const customer = await loadTarget({ PUBLIC_FRONTEND_TARGET: "customer" });

    expect(admin.BRAND_SUFFIX).toBe("Panel");
    expect(customer.BRAND_SUFFIX).toBe("Portal");
  });
});

describe("login URL", () => {
  it("defaults to the central login site", async () => {
    const { LOGIN_URL } = await loadTarget({});
    expect(LOGIN_URL).toBe("https://auth.tracht-digital.de");
  });

  it("can be pointed at a local dev server", async () => {
    const { LOGIN_URL } = await loadTarget({ PUBLIC_LOGIN_URL: "http://localhost:4321" });
    expect(LOGIN_URL).toBe("http://localhost:4321");
  });

  it("has no trailing slash — `?next=` is appended directly", async () => {
    // `${LOGIN_URL}?next=…` would otherwise produce a double slash.
    const { LOGIN_URL } = await loadTarget({});
    expect(LOGIN_URL.endsWith("/")).toBe(false);
  });

  it("is not an in-app route — login lives on the central site", async () => {
    const { LOGIN_URL } = await loadTarget({});
    expect(LOGIN_URL.startsWith("http")).toBe(true);
  });
});
