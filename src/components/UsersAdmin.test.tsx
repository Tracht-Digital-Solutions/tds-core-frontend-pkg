// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";
import UsersAdmin from "./UsersAdmin";

/**
 * User management, for the one failure a status code cannot describe: a request
 * that never reaches the auth API. `frontendFetch` rejects like fetch then, and
 * creating, saving and resetting awaited it without a catch — the submit or the
 * click ended without a word and the rejection went unhandled.
 */

let toasts: ToastDetail[];
const collect = (e: Event) => toasts.push((e as CustomEvent<ToastDetail>).detail);

const USER = { id: 5, email: "erika@example.de", name: "Erika Muster", isAdmin: false, memberships: [] };

/** Answers every read; `unreachable` names the one request that never arrives. */
function mockFetch(unreachable: { method: string; path: RegExp }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === unreachable.method && unreachable.path.test(url)) {
      throw new TypeError("Failed to fetch");
    }
    if (/\/admin\/users$/.test(url) && method === "GET") {
      return new Response(JSON.stringify({ users: [USER] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failedUnreachable = () =>
  toasts.some((t) => t.variant === "danger" && t.message.includes("nicht erreichbar"));

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collect);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collect);
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsersAdmin when the auth API is unreachable", () => {
  it("says so when creating a user, and keeps what was typed", async () => {
    mockFetch({ method: "POST", path: /\/admin\/users$/ });
    const u = userEvent.setup();
    render(<UsersAdmin />);
    await screen.findByText("erika@example.de");
    await u.click(screen.getByRole("button", { name: "Neuer Benutzer" }));
    await u.type(screen.getByLabelText("E-Mail"), "neu@example.de");
    await u.click(screen.getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(failedUnreachable()).toBe(true));
    expect((screen.getByLabelText("E-Mail") as HTMLInputElement).value).toBe("neu@example.de");
  });

  it("says so when saving a user, and leaves the editor open", async () => {
    mockFetch({ method: "PATCH", path: /\/admin\/users\/5$/ });
    const u = userEvent.setup();
    render(<UsersAdmin />);
    await screen.findByText("erika@example.de");
    await u.click(screen.getByRole("button", { name: "Bearbeiten" }));
    // The card cross-fades from its summary to the form (Presence), so the
    // form arrives a moment after the click rather than in the same tick.
    await u.click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(failedUnreachable()).toBe(true));
    expect(screen.getByRole("heading", { name: "Benutzer bearbeiten" })).toBeTruthy();
  });

  it("says so when a password reset never reaches the API", async () => {
    mockFetch({ method: "POST", path: /\/admin\/users\/5\/reset-password$/ });
    const u = userEvent.setup();
    render(<UsersAdmin />);
    await screen.findByText("erika@example.de");
    await u.click(screen.getByRole("button", { name: "Passwort zurücksetzen" }));
    await waitFor(() => expect(failedUnreachable()).toBe(true));
  });
});
