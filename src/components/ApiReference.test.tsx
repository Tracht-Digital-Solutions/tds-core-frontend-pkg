// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiReference from "./ApiReference";
import type { ModuleEntry } from "../lib/moduleInventory";

/**
 * The admin wiki. What is worth guarding is what makes it usable AS a
 * reference, since the version it replaced was a flat list:
 *
 *  - routes are grouped by the MODULE that mounted them, not by path segment
 *    (the old grouping put every module's `/admin/*` route in one bucket),
 *  - an undocumented route is still listed and says so, because introspection
 *    is authoritative and nobody may shrink the reference by forgetting to
 *    write something down,
 *  - a doc entry with no route is surfaced, not swallowed, and
 *  - filtering reveals its matches instead of leaving them collapsed.
 */

const inventory: ModuleEntry[] = [
  {
    pkg: "@tracht-digital-solutions/tds-ext-support-tickets",
    id: "support-tickets",
    name: "Support-Tickets",
    installed: "0.7.4",
    range: "^0.7.1",
    kind: "extension",
  },
];

const payload = {
  generated_at: "2026-08-13T10:00:00+00:00",
  version: 2,
  modules: [
    {
      id: "base",
      routes: [
        {
          method: "GET",
          pattern: "/healthz",
          documented: true,
          summary: "Health-Check des Frontend-Service",
          description: "Antwortet immer mit 200 und JSON.",
          auth: "public",
          responses: [{ status: 200, description: "Status und komponierte Module." }],
        },
        {
          method: "POST",
          pattern: "/sites/pairings/exchange",
          documented: false,
          summary: "",
        },
      ],
    },
    {
      id: "support-tickets",
      routes: [
        {
          method: "PATCH",
          pattern: "/admin/tickets/{id:[0-9]+}",
          documented: true,
          summary: "Ticket ändern",
          auth: "admin",
          params: [
            { in: "path", name: "id", type: "int", required: true, description: "Id des Tickets." },
            { in: "body", name: "status_id", type: "int", description: "Neuer Status." },
          ],
          responses: [{ status: 404, description: "Unbekannte Id." }],
        },
      ],
    },
  ],
  stats: { routes: 3, documented: 2, modules: 2, orphan_docs: [] as string[] },
};

let body: unknown = payload;
let status = 200;

beforeEach(() => {
  body = structuredClone(payload);
  status = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = async () => {
  render(<ApiReference modules={inventory} />);
  await screen.findByText(/Route(n)? in/);
};

describe("grouping", () => {
  it("groups by the module that mounted the route, not by path segment", async () => {
    await show();
    // A base route and an extension route are intentionally distinguished by
    // their owner rather than inferred from a path prefix.
    const base = screen.getByText("Basis (Kernel)").closest("details")!;
    const tickets = screen.getByText("Support-Tickets").closest("details")!;

    expect(within(base).getByText("/sites/pairings/exchange")).toBeTruthy();
    expect(within(tickets).getByText("/admin/tickets/{id:[0-9]+}")).toBeTruthy();
    expect(base).not.toBe(tickets);
  });

  it("names a module from the build inventory, not from the API", async () => {
    // The API emits ids only; the German name lives in the manifest the build
    // composed. An id with no matching package must still render.
    await show();
    expect(screen.getByText("Support-Tickets")).toBeTruthy();
    expect(screen.queryByText("support-tickets")).toBeNull();
  });

  it("puts the base first", async () => {
    // The kernel everything else mounts onto, then the modules in composition
    // order — so the page reads like the build.
    await show();
    const sections = [...document.querySelectorAll(".api-reference > details > summary")];
    expect(sections[0]?.textContent).toContain("Basis");
    expect(sections[1]?.textContent).toContain("Support-Tickets");
  });
});

describe("route detail", () => {
  it("shows parameters and responses as tables", async () => {
    await show();
    const params = screen.getByRole("region", { name: /Parameter von PATCH/ });
    expect(within(params).getByText("status_id")).toBeTruthy();
    // A table with no focusable cell needs a keyboard-reachable scrollport.
    expect(params.getAttribute("tabindex")).toBe("0");

    const responses = screen.getByRole("region", { name: /Antworten von PATCH/ });
    expect(within(responses).getByText("Unbekannte Id.")).toBeTruthy();
  });

  it("marks the required parameter as required", async () => {
    await show();
    const row = screen.getByText("id").closest("tr")!;
    expect(row.textContent).toContain("ja");
  });

  it("translates the auth mode instead of printing the raw key", async () => {
    await show();
    expect(screen.getByText("Nur Admin")).toBeTruthy();
    expect(screen.queryByText("admin", { exact: true })).toBeNull();
  });
});

describe("undocumented routes", () => {
  it("still lists them, and says the description is missing", async () => {
    // Introspection is authoritative: forgetting to document a route must not
    // remove it from the reference.
    await show();
    expect(screen.getByText("/sites/pairings/exchange")).toBeTruthy();
    expect(screen.getByText(/noch keine Beschreibung/)).toBeTruthy();
  });

  it("counts them in the header", async () => {
    await show();
    expect(screen.getByText(/1 ohne Beschreibung/)).toBeTruthy();
  });

  it("gets the German plural right for a single route or module", async () => {
    // "1 Routen in 1 Modulen" is the kind of wart that makes a reference look
    // unmaintained, and a composed build has one module often enough to see it.
    body = {
      ...structuredClone(payload),
      modules: [structuredClone(payload.modules[1])],
      stats: { routes: 1, documented: 1, modules: 1, orphan_docs: [] },
    };
    await show();
    expect(screen.getByText("1 Route in 1 Modul")).toBeTruthy();
  });
});

describe("stale documentation", () => {
  it("reports a doc entry whose route no longer exists", async () => {
    // A renamed path leaves prose behind. A reference that confidently
    // describes a route nobody can call is worse than one that admits the gap.
    body = { ...structuredClone(payload), stats: { ...payload.stats, orphan_docs: ["GET /umbenannt"] } };
    await show();
    expect(screen.getByText(/GET \/umbenannt/)).toBeTruthy();
  });
});

describe("filtering", () => {
  it("narrows to the matching routes", async () => {
    await show();
    await userEvent.type(screen.getByLabelText("API-Referenz durchsuchen"), "healthz");

    expect(screen.getByText("/healthz")).toBeTruthy();
    expect(screen.queryByText("/admin/tickets/{id:[0-9]+}")).toBeNull();
  });

  it("reveals the matches instead of leaving them collapsed", async () => {
    // Filtering down to two routes and still making the reader click each
    // module open would defeat the point of filtering.
    await show();
    await userEvent.type(screen.getByLabelText("API-Referenz durchsuchen"), "healthz");
    const base = screen.getByText("Basis (Kernel)").closest("details")!;
    expect(base.hasAttribute("open")).toBe(true);
  });

  it("filters by method", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "PATCH" }));

    expect(screen.getByText("/admin/tickets/{id:[0-9]+}")).toBeTruthy();
    expect(screen.queryByText("/healthz")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    await show();
    await userEvent.type(screen.getByLabelText("API-Referenz durchsuchen"), "gibtesnicht");
    expect(screen.getByText("Keine Route passt zum Filter.")).toBeTruthy();
  });
});

describe("failure modes", () => {
  it("explains a 403 rather than showing an empty page", async () => {
    status = 403;
    body = { error: "Forbidden" };
    render(<ApiReference modules={inventory} />);
    expect(await screen.findByText("Nur für Admins.")).toBeTruthy();
  });

  it("refuses a payload version it does not understand", async () => {
    // The backend ships separately from the frontend. Rendering v1 data through
    // a v2 component would produce a page of blanks with no explanation.
    body = { ...structuredClone(payload), version: 1 };
    render(<ApiReference modules={inventory} />);
    expect(await screen.findByText(/Version 2.*Version 1/s)).toBeTruthy();
  });
});
