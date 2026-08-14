// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EVENT, type ToastDetail } from "@tracht-digital-solutions/tds-shared/toast";
import MailSettings from "./MailSettings";

/**
 * The SMTP settings section. What is worth guarding is not the layout but the
 * three promises it makes:
 *
 *  - a host that mails through its `.env` must SAY so, or the first edit here
 *    silently overwrites a working transport with an empty form,
 *  - the password must never be sent back when the field was left blank —
 *    the API reads an empty secret as "keep existing", so sending "" would
 *    wipe it, and
 *  - a failed test mail must show the SMTP server's own reply, in flow: that
 *    text is the only thing separating "wrong password" from "port blocked".
 */

let toasts: ToastDetail[];
const collect = (e: Event) => toasts.push((e as CustomEvent<ToastDetail>).detail);

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collect);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collect);
  cleanup();
});

const storedDefaults = {
  settings: [
    { key: "host", secret: false, value: "smtp.example.net" },
    { key: "port", secret: false, value: "587" },
    { key: "security", secret: false, value: "tls" },
    { key: "user", secret: false, value: "no-reply@example.net" },
    { key: "password", secret: true, configured: true, last4: "ter2" },
    { key: "from_email", secret: false, value: "no-reply@example.net" },
    { key: "from_name", secret: false, value: "Tracht Digital" },
  ],
};

const statusDefaults = {
  configured: true,
  source: "db",
  host: "smtp.example.net",
  port: 587,
  security: "tls",
  user: "no-reply@example.net",
  password_configured: true,
  from_email: "no-reply@example.net",
  from_name: "Tracht Digital",
};

/**
 * Route by URL: the section reads two endpoints and writes two more, and which
 * one a request hit is exactly what these tests assert.
 */
function mockFetch(over: {
  settings?: unknown;
  status?: unknown;
  put?: Response;
  test?: Response;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/admin/mail/test")) {
      return over.test ?? new Response(JSON.stringify({ ok: true, to: "chef@example.net" }), { status: 200 });
    }
    if (url.includes("/admin/mail")) {
      return new Response(JSON.stringify(over.status ?? statusDefaults), { status: 200 });
    }
    if (url.includes("/admin/settings/mail")) {
      if ((init?.method ?? "GET") === "PUT") {
        return over.put ?? new Response(JSON.stringify({ ok: true, written: 7 }), { status: 200 });
      }
      return new Response(JSON.stringify(over.settings ?? storedDefaults), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("MailSettings", () => {
  it("loads the stored configuration and reports that it is the active one", async () => {
    mockFetch();
    render(<MailSettings />);

    await screen.findByText("Aktiv über diese Einstellungen");
    expect((screen.getByPlaceholderText("smtp.example.net") as HTMLInputElement).value).toBe(
      "smtp.example.net",
    );
    // The stored secret is only ever hinted at, never filled in.
    expect(screen.getByText(/hinterlegt \(…ter2\)/)).toBeTruthy();
  });

  it("says when the transport comes from the host's .env instead of these fields", async () => {
    // Without this an admin sees an empty form on a host that mails perfectly
    // well, and "fixes" it by overwriting a working transport.
    mockFetch({
      settings: { settings: [] },
      status: { ...statusDefaults, source: "env", host: "", user: "", password_configured: false },
    });
    render(<MailSettings />);

    await screen.findByText("Aktiv über MAIL_DSN aus der .env des Hosts");
  });

  it("reports that nothing is configured and refuses to offer a test", async () => {
    mockFetch({
      settings: { settings: [] },
      status: { ...statusDefaults, configured: false, source: "none", host: "" },
    });
    render(<MailSettings />);

    await screen.findByText("Kein Versand konfiguriert");
    expect((screen.getByText("Testmail senden").closest("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("sends a blank password so the stored one is kept", async () => {
    const fetchMock = mockFetch();
    render(<MailSettings />);
    await screen.findByText("Aktiv über diese Einstellungen");

    await userEvent.click(screen.getByText("Speichern"));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put?.[1] as RequestInit).body)) as {
        settings: { key: string; value: string }[];
      };
      const password = body.settings.find((s) => s.key === "password");
      expect(password?.value).toBe("");
      expect(body.settings.find((s) => s.key === "host")?.value).toBe("smtp.example.net");
    });
  });

  it("reports a failed save with its HTTP status", async () => {
    mockFetch({ put: new Response("{}", { status: 403 }) });
    render(<MailSettings />);
    await screen.findByText("Aktiv über diese Einstellungen");

    await userEvent.click(screen.getByText("Speichern"));

    await waitFor(() => {
      expect(toasts.some((t) => t.variant === "danger" && t.message.includes("403"))).toBe(true);
    });
  });

  it("shows the SMTP server's own reply in flow when the test mail fails", async () => {
    mockFetch({
      test: new Response(
        JSON.stringify({ ok: false, error: "535 5.7.8 Authentication credentials invalid" }),
        { status: 502 },
      ),
    });
    render(<MailSettings />);
    await screen.findByText("Aktiv über diese Einstellungen");

    await userEvent.click(screen.getByText("Testmail senden"));

    // In flow, not as a toast: this is diagnostic text to read, not a notice.
    await screen.findByText(/535 5\.7\.8 Authentication credentials invalid/);
    expect(toasts.filter((t) => t.variant === "danger")).toHaveLength(0);
  });

  it("toasts a successful test mail", async () => {
    mockFetch();
    render(<MailSettings />);
    await screen.findByText("Aktiv über diese Einstellungen");

    await userEvent.click(screen.getByText("Testmail senden"));

    await waitFor(() => {
      expect(toasts.some((t) => t.variant === "success" && t.message.includes("chef@example.net"))).toBe(
        true,
      );
    });
  });
});
