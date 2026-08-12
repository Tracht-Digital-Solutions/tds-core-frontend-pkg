/**
 * The panel's live notifications — one poller for every composed module.
 *
 * Polls `GET /me/notifications`, raises a toast per event, and re-broadcasts
 * each one as a `tds:notification` window event so an open list can refresh
 * itself instead of going stale behind a toast that says something arrived.
 *
 * ### Why polling
 *
 * The production host is PHP-FPM behind Plesk: no long-lived workers, no
 * `proc_open`, so neither SSE nor WebSockets are available. Polling is the only
 * mechanism there is, which is also why it must stay cheap and quiet.
 *
 * ### Why ONE poller in the shell
 *
 * Modules contribute events on the BACKEND (the contract's
 * `NotificationSource`), so adding a module does not add an interval here. The
 * alternative — a poller per extension island — would mean thirteen timers on
 * every page.
 */
import { toast } from "@tracht-digital-solutions/tds-shared/toast";
import { API_BASE, frontendFetch } from "./auth";

/** How often to ask, while the tab is visible. */
const POLL_MS = 30_000;

/** Backoff ceiling after repeated transport failures. */
const MAX_BACKOFF_MS = 5 * 60_000;

/** The window event an island listens on to refresh itself. */
export const NOTIFICATION_EVENT = "tds:notification";

const FEED_URL = `${API_BASE}/me/notifications`;

export interface NotificationItem {
  id: string;
  module: string;
  kind: string;
  message: string;
  href?: string;
  variant?: "info" | "success" | "warning" | "danger";
  created_at?: string;
}

/**
 * The cursor lives in `sessionStorage`, per product target.
 *
 * Not in memory: the panel is a multi-page static site, so every navigation
 * would otherwise be a "first call" — which suppresses the backlog and would
 * therefore silently drop anything that arrived while the page was changing.
 * Not `localStorage` either: it is a per-tab conversation, and two tabs sharing
 * one cursor would race to consume events, so each would see only some of them.
 */
const cursorKey = (target: string) => `tds_notify_cursor_${target}`;

const readCursor = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null; // storage disabled — every poll is a first call, i.e. quiet
  }
};

const writeCursor = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const isItem = (value: unknown): value is NotificationItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as NotificationItem).id === "string" &&
  typeof (value as NotificationItem).message === "string";

export interface NotificationFeedOptions {
  /** Distinguishes the admin and customer cursors in one browser profile. */
  target?: string;
  pollMs?: number;
}

/**
 * Start polling. Returns a stop function (used by the tests; the shell just
 * leaves it running for the life of the page).
 */
export function initNotificationFeed(options: NotificationFeedOptions = {}): () => void {
  const target = options.target ?? "panel";
  const interval = options.pollMs ?? POLL_MS;
  const key = cursorKey(target);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let backoff = 0;
  let inFlight = false;

  const schedule = (delay: number): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void poll(), delay);
  };

  const announce = (item: NotificationItem): void => {
    // `key` is the item id, so the toast host counts a repeat up instead of
    // stacking a second copy of the same event.
    const raise = toast[item.variant ?? "info"] ?? toast.info;
    raise(item.message, { key: item.id, href: item.href });
    window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: item }));
  };

  async function poll(): Promise<void> {
    if (stopped || inFlight) return;
    // A hidden tab does not need to know; it polls again the moment it is
    // looked at (visibilitychange below).
    if (typeof document !== "undefined" && document.hidden) {
      schedule(interval);
      return;
    }

    inFlight = true;
    try {
      const since = readCursor(key);
      const url = since === null ? FEED_URL : `${FEED_URL}?since=${encodeURIComponent(since)}`;
      const res = await frontendFetch(url);

      if (res.status === 401 || res.status === 403) {
        // Stop rather than retry. frontendFetch already probed /me and tried a
        // refresh on the 401; polling on would be a /me storm every 30s, and a
        // principal without the rights is not going to grow them mid-session.
        stop();
        return;
      }
      if (!res.ok) {
        backoff = Math.min(backoff === 0 ? interval : backoff * 2, MAX_BACKOFF_MS);
        schedule(backoff);
        return;
      }

      const data = (await res.json()) as { cursor?: unknown; items?: unknown };
      if (typeof data.cursor === "string") writeCursor(key, data.cursor);
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          if (isItem(item)) announce(item);
        }
      }
      backoff = 0;
      schedule(interval);
    } catch {
      // DELIBERATELY silent. This runs on every page of the panel; a toast here
      // would turn one flaky network moment into a red banner on every
      // navigation — and it would be about the notifier, not about anything the
      // reader did. Same reasoning as initDashboardLayout's load path.
      backoff = Math.min(backoff === 0 ? interval : backoff * 2, MAX_BACKOFF_MS);
      schedule(backoff);
    } finally {
      inFlight = false;
    }
  }

  const onVisible = (): void => {
    if (!document.hidden) void poll();
  };

  function stop(): void {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisible);
  }

  document.addEventListener("visibilitychange", onVisible);
  // The first poll establishes the cursor and announces nothing (the backend
  // returns no items without one), so opening a tab is never a burst of toasts
  // about things that happened yesterday.
  void poll();

  return stop;
}
