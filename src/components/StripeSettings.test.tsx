// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StripeSettings from "./StripeSettings";

/**
 * The Zahlungen (Stripe) section. Guarded: it says where the active key comes
 * from, lists every webhook with its secret state, never sends a blank key
 * (which would read as "keep" and save nothing), and shows Stripe's own reply
 * when the connection test fails.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const status = {
  configured: true,
  source: "env",
  mode: "test",
  last4: "4242",
  webhooks: [
    {
      module: "billing",
      label: "Rechnungen",
      url: "https://api.tracht-digital.de/billing/webhook",
      events: ["invoice.paid"],
      secretNamespace: "billing",
      secretKey: "stripe_webhook_secret",
      secretConfigured: false,
    },
  ],
};

function route(handlers: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(handlers).find((k) => url.endsWith(k));
    return key ? handlers[key]!(init) : new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("StripeSettings", () => {
  it("says the key comes from the host .env and lists the webhooks", async () => {
    route({ "/admin/stripe": () => json(status) });
    render(<StripeSettings />);

    expect(await screen.findByText(/STRIPE_SECRET_KEY aus der \.env/)).toBeTruthy();
    expect(screen.getByText("Testmodus")).toBeTruthy();
    expect(screen.getByText("https://api.tracht-digital.de/billing/webhook")).toBeTruthy();
    expect(screen.getByText("Signing Secret fehlt")).toBeTruthy();
  });

  it("does not send an empty key", async () => {
    const fetchMock = route({ "/admin/stripe": () => json(status) });
    render(<StripeSettings />);
    await screen.findByText("Rechnungen");

    await userEvent.setup().click(screen.getByRole("button", { name: "Speichern" }));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
  });

  it("saves the key into the stripe namespace as a secret", async () => {
    let body = "";
    route({
      "/admin/stripe": () => json(status),
      "/admin/settings/stripe": (init) => {
        body = String(init?.body ?? "");
        return json({ ok: true, written: 1 });
      },
    });
    render(<StripeSettings />);
    await screen.findByText("Rechnungen");

    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Secret Key"), " sk_test_new ");
    await u.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(JSON.parse(body)).toEqual({ settings: [{ key: "secret_key", secret: true, value: "sk_test_new" }] }),
    );
  });

  it("shows Stripe's reply when the test fails", async () => {
    route({
      "/admin/stripe": () => json(status),
      "/admin/stripe/test": () => json({ ok: false, error: "Stripe: Invalid API Key provided" }, 502),
    });
    render(<StripeSettings />);
    await screen.findByText("Rechnungen");

    await userEvent.setup().click(screen.getByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText(/Invalid API Key provided/)).toBeTruthy();
  });
});
