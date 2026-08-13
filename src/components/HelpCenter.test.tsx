// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelpCenter from "./HelpCenter";

/**
 * The customer wiki. Two things carry most of the value here:
 *
 *  - **an empty or unreachable help API must read as "nothing here yet", not as
 *    a broken portal.** The frontend service's database is still a go-live step,
 *    so the empty state is the state a real customer may meet first.
 *  - **a handbook body is fetched only when its article is opened.** Bodies are
 *    markdown of arbitrary length; loading every one to draw a list of headings
 *    is the difference between a page that opens and one that stalls.
 */

const FAQS = {
  faqs: [
    { id: 1, category: "Konto & Anmeldung", question: "Gilt meine Anmeldung überall?", answer: "Ja.\n\nEine Sitzung gilt für alle Bereiche." },
    { id: 2, category: "Rechnungen", question: "Wo finde ich meine Rechnungen?", answer: "Unter Rechnungen." },
  ],
};

const ARTICLES = {
  articles: [
    { id: 10, slug: "erste-schritte", title: "Erste Schritte", updated_at: "2026-08-01 10:00:00" },
  ],
};

const ARTICLE = {
  article: {
    id: 10,
    slug: "erste-schritte",
    title: "Erste Schritte",
    body_markdown: "# Los geht's\n\nText mit **fett** und <script>alert(1)</script>.",
    updated_at: "2026-08-01 10:00:00",
  },
};

let routes: Record<string, { status: number; body: unknown }>;
let calls: string[];

beforeEach(() => {
  calls = [];
  routes = {
    "/help/faqs": { status: 200, body: FAQS },
    "/help/articles": { status: 200, body: ARTICLES },
    "/help/articles/erste-schritte": { status: 200, body: ARTICLE },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const path = url.replace(/^https?:\/\/[^/]+/i, "").split("?")[0]!;
      const hit = routes[path];
      return new Response(JSON.stringify(hit?.body ?? {}), { status: hit?.status ?? 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = async () => {
  render(<HelpCenter />);
  await screen.findByText("Häufige Fragen");
};

describe("FAQs", () => {
  it("lists the published questions, grouped by category", async () => {
    await show();
    expect(screen.getByText("Gilt meine Anmeldung überall?")).toBeTruthy();
    expect(screen.getByText("Konto & Anmeldung")).toBeTruthy();
    expect(screen.getByText("Rechnungen")).toBeTruthy();
  });

  it("renders an answer as paragraphs of TEXT, never as markup", async () => {
    // Answers are plain text by contract with the widget's renderer. Setting
    // them as HTML would make an admin typo an injection.
    await show();
    const entry = screen.getByText("Gilt meine Anmeldung überall?").closest("details")!;
    expect(within(entry).getByText("Ja.")).toBeTruthy();
    expect(within(entry).getByText("Eine Sitzung gilt für alle Bereiche.")).toBeTruthy();
  });

  it("gives every answer a linkable anchor", async () => {
    await show();
    expect(document.getElementById("faq-1")).toBeTruthy();
  });
});

describe("handbooks", () => {
  it("lists titles without fetching any body", async () => {
    await show();
    expect(screen.getByText("Erste Schritte")).toBeTruthy();
    expect(calls.some((u) => u.includes("/help/articles/erste-schritte"))).toBe(false);
  });

  it("fetches the body when the article is opened", async () => {
    await show();
    const details = screen.getByText("Erste Schritte").closest("details")!;
    details.setAttribute("open", "");
    details.dispatchEvent(new Event("toggle"));

    await waitFor(() =>
      expect(calls.some((u) => u.includes("/help/articles/erste-schritte"))).toBe(true),
    );
  });

  it("renders the markdown body and keeps injected HTML inert", async () => {
    await show();
    const details = screen.getByText("Erste Schritte").closest("details")!;
    details.setAttribute("open", "");
    details.dispatchEvent(new Event("toggle"));

    const prose = await waitFor(() => {
      const el = details.querySelector(".tds-prose");
      if (!el) throw new Error("not rendered yet");
      return el;
    });
    expect(prose.querySelector("h1")?.textContent).toContain("Los geht");
    expect(prose.querySelector("strong")?.textContent).toBe("fett");
    // The renderer is escape-first — a script tag is text, not an element.
    expect(prose.querySelector("script")).toBeNull();
    expect(prose.textContent).toContain("<script>");
  });

  it("reports a body that fails to load, without taking the page down", async () => {
    routes["/help/articles/erste-schritte"] = { status: 500, body: {} };
    await show();
    const details = screen.getByText("Erste Schritte").closest("details")!;
    details.setAttribute("open", "");
    details.dispatchEvent(new Event("toggle"));

    expect(await screen.findByText("Dieses Handbuch konnte nicht geladen werden.")).toBeTruthy();
    expect(screen.getByText("Häufige Fragen")).toBeTruthy();
  });
});

describe("search", () => {
  it("narrows both halves at once", async () => {
    await show();
    await userEvent.type(screen.getByLabelText("Hilfe durchsuchen"), "rechnung");

    expect(screen.getByText("Wo finde ich meine Rechnungen?")).toBeTruthy();
    expect(screen.queryByText("Gilt meine Anmeldung überall?")).toBeNull();
    expect(screen.getByText("Kein Handbuch passt zur Suche.")).toBeTruthy();
  });
});

describe("the empty and broken states", () => {
  it("says nothing is maintained yet when the API answers empty", async () => {
    routes["/help/faqs"] = { status: 200, body: { faqs: [] } };
    routes["/help/articles"] = { status: 200, body: { articles: [] } };
    render(<HelpCenter />);
    expect(await screen.findByText(/noch keine Inhalte hinterlegt/)).toBeTruthy();
  });

  it("treats a missing help module as empty, not as an error", async () => {
    // The customer product does not compose the extension's frontend half; if
    // the backend lacks it too, the routes 404. That is an empty wiki, not a
    // failure worth alarming a customer with.
    routes = {};
    render(<HelpCenter />);
    expect(await screen.findByText(/noch keine Inhalte hinterlegt/)).toBeTruthy();
    expect(screen.queryByText(/konnten gerade nicht geladen werden/)).toBeNull();
  });

  it("does say so when the request actually fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    render(<HelpCenter />);
    expect(await screen.findByText(/konnten gerade nicht geladen werden/)).toBeTruthy();
  });
});

describe("the request", () => {
  it("calls the API host absolutely, never the product's own origin", async () => {
    // A relative path would hit the static product host, whose SPA fallback
    // answers 200 + HTML — so `res.ok` is true, json() throws, and the page
    // renders a calm permanent empty state with nothing in any log.
    await show();
    expect(calls[0]).toMatch(/^https?:\/\/[^/]+\/help\/faqs/);
  });

  it("asks for the requested language", async () => {
    render(<HelpCenter lang="en" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.every((u) => u.includes("lang=en"))).toBe(true);
  });
});
