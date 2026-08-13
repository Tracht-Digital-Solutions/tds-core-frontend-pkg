// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  actAsHeaders,
  getActiveCompany,
  resolveActiveCompany,
  setActiveCompany,
} from "./activeCompany";
import { API_BASE, AUTH_API_URL } from "./auth";
import { HINT_PREFIX } from "../config/target";

const KEY = `${HINT_PREFIX}_active_company`;

beforeEach(() => {
  localStorage.clear();
});

describe("the stored selection", () => {
  it("round-trips a company id", () => {
    setActiveCompany(7);
    expect(localStorage.getItem(KEY)).toBe("7");
    expect(getActiveCompany()).toBe(7);
  });

  it("clears with null", () => {
    setActiveCompany(7);
    setActiveCompany(null);
    expect(getActiveCompany()).toBeNull();
  });

  it("rejects a non-numeric or non-positive stored value", () => {
    // Hand-edited storage, or a leftover from an older key format.
    for (const raw of ["", "abc", "0", "-3"]) {
      localStorage.setItem(KEY, raw);
      expect(getActiveCompany()).toBeNull();
    }
  });

  it("survives storage being unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getActiveCompany()).toBeNull();
    expect(() => setActiveCompany(4)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("resolveActiveCompany", () => {
  it("keeps a stored id that is still a membership", () => {
    setActiveCompany(9);
    expect(resolveActiveCompany([4, 9])).toBe(9);
  });

  it("falls back to the first membership and CLEARS a revoked one", () => {
    // Leaving the stale id in place would pin the panel to a company the
    // server refuses, so every list comes back empty with nothing on screen
    // saying why.
    setActiveCompany(99);
    expect(resolveActiveCompany([4, 9])).toBe(4);
    expect(getActiveCompany()).toBeNull();
  });

  it("returns null when there are no memberships", () => {
    expect(resolveActiveCompany([])).toBeNull();
  });
});

describe("actAsHeaders", () => {
  beforeEach(() => {
    setActiveCompany(12);
  });

  it("sends the header to the composed API", () => {
    expect(actAsHeaders(`${API_BASE}/tickets`)).toEqual({ "X-Act-As-Company": "12" });
  });

  it("NEVER sends it to auth-api, whose CORS would reject the preflight", () => {
    // The regression this file exists for: AUTH_API_URL starts with API_BASE,
    // so a plain `startsWith(API_BASE)` matches it too — and a failed preflight
    // takes /me, /refresh, logout and user management down together.
    expect(actAsHeaders(`${AUTH_API_URL}/me`)).toEqual({});
    expect(actAsHeaders(`${AUTH_API_URL}/admin/users`)).toEqual({});
    expect(AUTH_API_URL.startsWith(API_BASE)).toBe(true);
  });

  it("sends nothing to a third-party origin", () => {
    expect(actAsHeaders("https://example.com/x")).toEqual({});
  });

  it("sends nothing when no company is selected", () => {
    setActiveCompany(null);
    expect(actAsHeaders(`${API_BASE}/tickets`)).toEqual({});
  });
});
