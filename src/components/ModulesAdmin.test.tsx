// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModulesAdmin from "./ModulesAdmin";
import type { ModuleEntry } from "../lib/moduleInventory";

const modules: ModuleEntry[] = [
  {
    pkg: "@tracht-digital-solutions/tds-ext-blog-cms",
    id: "blog-cms",
    name: "Blog-CMS",
    installed: "0.2.0",
    range: "^0.2.0",
    kind: "extension",
  },
  {
    pkg: "@tracht-digital-solutions/tds-shared",
    name: "Design- & i18n-Bibliothek",
    installed: "0.34.0",
    range: "^0.34.0",
    kind: "platform",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModulesAdmin", () => {
  it("combines the baked frontend inventory with locally installed Composer versions", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          modules: ["blog-cms", "tools"],
          packages: {
            "tracht-digital-solutions/tds-ext-blog-cms": "0.2.0",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ModulesAdmin modules={modules} />);

    expect(screen.getByText("Blog-CMS")).toBeTruthy();
    expect(screen.getByText("0.34.0")).toBeTruthy();
    expect(await screen.findByText("Im API-Bundle komponiert: blog-cms, tools.")).toBeTruthy();
    expect(screen.getAllByText("0.2.0").length).toBeGreaterThanOrEqual(2);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toContain("/admin/modules");
    expect(init?.method).toBeUndefined();
  });

  it("never exposes update or deployment controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ modules: [], packages: {} }), { status: 200 })),
    );

    render(<ModulesAdmin modules={modules} />);
    await screen.findAllByText("—");

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Update verfügbar/)).toBeNull();
    expect(screen.queryByText(/Deployment starten/)).toBeNull();
  });

  it("keeps a backend inventory failure visible in the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    render(<ModulesAdmin modules={modules} />);

    expect(await screen.findByText(/HTTP 503/)).toBeTruthy();
  });
});
