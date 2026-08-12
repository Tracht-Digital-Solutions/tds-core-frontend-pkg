// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The panel's one notification poller.
 *
 * This runs on EVERY page of the panel, forever, in every open tab — so the
 * assertions here are mostly about restraint:
 *
 *  - a hidden tab must not poll (thirteen background tabs would otherwise be
 *    thirteen requests every 30 seconds, indefinitely);
 *  - a 401/403 must STOP it, not retry — `frontendFetch` already probed `/me`
 *    and tried a refresh, so continuing is a /me storm;
 *  - a transport failure must never raise a toast, or one flaky moment becomes
 *    a red banner on every navigation, about the notifier rather than about
 *    anything the reader did;
 *  - the cursor must advance, or the same event is announced forever.
 *
 * `frontendFetch` is mocked at the module boundary; `auth.test.ts` covers it.
 */

const { frontendFetch } = vi.hoisted(() => ({ frontendFetch: vi.fn() }));

vi.mock("./auth", () => ({
  frontendFetch,
  API_BASE: "https://api.tracht-digital.de",
}));

const { initNotificationFeed, NOTIFICATION_EVENT } = await import("./notificationFeed");

let toasts: ToastDetail[] = [];
let events: unknown[] = [];
let stop: (() => void) | null = null;

const collectToast = (e: Event) => toasts.push((e as CustomEvent<ToastDetail>).detail);
const collectEvent = (e: Event) => events.push((e as CustomEvent).detail);

const ok = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => body,
});

const ITEM = {
  id: "contact-tickets:42",
  module: "contact-tickets",
  kind: "contact.new",
  message: "Neue Kontaktanfrage: Max Mustermann",
  href: "/kontakt?id=42",
  variant: "info" as const,
  created_at: "2026-08-12T10:00:00+00:00",
};

/** Pretend the tab is hidden/visible and fire the event the browser would. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  toasts = [];
  events = [];
  frontendFetch.mockReset();
  sessionStorage.clear();
  setHidden(false);
  window.addEventListener(TOAST_EVENT, collectToast);
  window.addEventListener(NOTIFICATION_EVENT, collectEvent);
});

afterEach(() => {
  stop?.();
  stop = null;
  window.removeEventListener(TOAST_EVENT, collectToast);
  window.removeEventListener(NOTIFICATION_EVENT, collectEvent);
  vi.useRealTimers();
});

/** Let the in-flight promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the first poll", () => {
  it("asks WITHOUT a cursor, so the backend suppresses the backlog", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "42", items: [] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(frontendFetch).toHaveBeenCalledWith("https://api.tracht-digital.de/me/notifications");
  });

  it("stores the cursor it was given", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "abc", items: [] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(sessionStorage.getItem("tds_notify_cursor_admin")).toBe("abc");
  });

  it("keeps the admin and customer cursors apart in one browser profile", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [] }));
    stop = initNotificationFeed({ target: "customer" });
    await settle();

    expect(sessionStorage.getItem("tds_notify_cursor_customer")).toBe("1");
    expect(sessionStorage.getItem("tds_notify_cursor_admin")).toBeNull();
  });

  it("sends the stored cursor on the next page of the same session", async () => {
    // The panel is a multi-page static site. Keeping the cursor in memory would
    // make every navigation a "first call" and silently drop whatever arrived
    // while the page was changing.
    sessionStorage.setItem("tds_notify_cursor_admin", "abc/def");
    frontendFetch.mockResolvedValue(ok({ cursor: "xyz", items: [] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(frontendFetch).toHaveBeenCalledWith(
      "https://api.tracht-digital.de/me/notifications?since=abc%2Fdef",
    );
  });
});

describe("announcing", () => {
  it("raises a toast per item, keyed by the item id", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "43", items: [ITEM] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      variant: "info",
      message: "Neue Kontaktanfrage: Max Mustermann",
      key: "contact-tickets:42",
      href: "/kontakt?id=42",
    });
  });

  it("re-broadcasts the item so an open list can refresh itself", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "43", items: [ITEM] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ module: "contact-tickets" });
  });

  it("falls back to info for an unknown variant", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [{ ...ITEM, variant: "explode" }] }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(toasts[0]!.variant).toBe("info");
  });

  it("ignores malformed items instead of throwing the whole poll away", async () => {
    frontendFetch.mockResolvedValue(
      ok({ cursor: "1", items: [null, { id: "x" }, "nope", ITEM] }),
    );
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(toasts).toHaveLength(1);
  });

  it("tolerates a response with no items field", async () => {
    frontendFetch.mockResolvedValue(ok({ cursor: "1" }));
    stop = initNotificationFeed({ target: "admin" });
    await settle();

    expect(toasts).toHaveLength(0);
  });
});

describe("restraint", () => {
  it("does NOT poll while the tab is hidden", async () => {
    vi.useFakeTimers();
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [] }));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = frontendFetch.mock.calls.length;

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(frontendFetch.mock.calls.length).toBe(afterFirst);
  });

  it("polls immediately when the tab is looked at again", async () => {
    vi.useFakeTimers();
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [] }));
    stop = initNotificationFeed({ target: "admin", pollMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    const before = frontendFetch.mock.calls.length;

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(frontendFetch.mock.calls.length).toBeGreaterThan(before);
  });

  it("STOPS on a 401 rather than retrying", async () => {
    // frontendFetch already probed /me and tried a refresh. Polling on would be
    // a /me storm every 30 seconds for as long as the tab is open.
    vi.useFakeTimers();
    frontendFetch.mockResolvedValue(ok({}, 401));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const after = frontendFetch.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);

    expect(frontendFetch.mock.calls.length).toBe(after);
  });

  it("STOPS on a 403 too — a principal does not gain rights mid-session", async () => {
    vi.useFakeTimers();
    frontendFetch.mockResolvedValue(ok({}, 403));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const after = frontendFetch.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);

    expect(frontendFetch.mock.calls.length).toBe(after);
  });

  it("NEVER toasts its own transport failure", async () => {
    // This runs on every page. A red toast here would be about the notifier,
    // not about anything the reader did.
    frontendFetch.mockRejectedValue(new TypeError("offline"));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await settle();

    expect(toasts).toHaveLength(0);
  });

  it("does not toast a 500 either", async () => {
    frontendFetch.mockResolvedValue(ok({ error: "boom" }, 500));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await settle();

    expect(toasts).toHaveLength(0);
  });

  it("backs off after repeated failures instead of hammering", async () => {
    vi.useFakeTimers();
    frontendFetch.mockRejectedValue(new TypeError("offline"));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1000); // 2nd try
    await vi.advanceTimersByTimeAsync(2000); // 3rd, at double the delay
    const withBackoff = frontendFetch.mock.calls.length;

    // Without backoff, 3000ms at a 1000ms interval would be four calls.
    expect(withBackoff).toBeLessThan(4);
  });

  it("recovers the normal interval after a failure resolves", async () => {
    vi.useFakeTimers();
    frontendFetch.mockRejectedValueOnce(new TypeError("offline"));
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [] }));
    stop = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // backoff elapses, this one succeeds
    const afterRecovery = frontendFetch.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1000);

    expect(frontendFetch.mock.calls.length).toBe(afterRecovery + 1);
  });

  it("stops for good when stopped", async () => {
    vi.useFakeTimers();
    frontendFetch.mockResolvedValue(ok({ cursor: "1", items: [] }));
    const halt = initNotificationFeed({ target: "admin", pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    halt();
    const after = frontendFetch.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);
    setHidden(false); // the visibility listener must be gone too

    expect(frontendFetch.mock.calls.length).toBe(after);
  });
});
