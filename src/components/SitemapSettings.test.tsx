// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SitemapSettings from "./SitemapSettings";

/**
 * Suchmaschinen (Sitemap). The sites read this list since 2026-09, and nothing
 * in the panel wrote it. The promises worth pinning:
 *
 *  - every site's list is SENT on save, because the PUT replaces the whole map
 *    and a site left out would lose its paths;
 *  - an emptied textarea sends `[]` — that is how a site's last path goes;
 *  - rejected paths stay on screen with their reason.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const payload = {
  sites: [
    { id: "blog", label: "Blog", origins: [] },
    { id: "landingpage", label: "Landingpage", origins: [] },
    { id: "tools", label: "Tools", origins: [] },
  ],
  sitemap_exclusions: { blog: ["/tag/*"], tools: ["/legacy"] },
  sitemap_exclusion_limits: { max_per_site: 200, max_length: 255 },
};

function mockFetch(putReply: unknown = { ok: true, rejected: [], sitemap_exclusions: {}, cache_status: {} }) {
  const fn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    (init?.method ?? "GET") === "PUT"
      ? new Response(JSON.stringify(putReply), { status: 200 })
      : new Response(JSON.stringify(payload), { status: 200 }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const putBody = (fn: ReturnType<typeof mockFetch>) => {
  const call = fn.mock.calls.find(([, init]) => init?.method === "PUT");
  return JSON.parse(String(call?.[1]?.body)) as { sitemap_exclusions: Record<string, string[]> };
};

describe("SitemapSettings", () => {
  it("shows one list per site, filled from the API", async () => {
    mockFetch();
    render(<SitemapSettings />);
    expect(((await screen.findByLabelText("Blog")) as HTMLTextAreaElement).value).toBe("/tag/*");
    expect((screen.getByLabelText("Landingpage") as HTMLTextAreaElement).value).toBe("");
    // Tools does not read the list, so it gets no field that would promise an effect.
    expect(screen.queryByLabelText("Tools")).toBeNull();
  });

  it("sends every site on save — an emptied list as []", async () => {
    const fn = mockFetch();
    render(<SitemapSettings />);
    const blog = (await screen.findByLabelText("Blog")) as HTMLTextAreaElement;
    await userEvent.clear(blog);
    await userEvent.type(screen.getByLabelText("Landingpage"), "/preise{enter}  /legal/* ");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(fn.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    // A site without a field keeps what it had — the PUT replaces the map.
    expect(putBody(fn).sitemap_exclusions).toEqual({ blog: [], landingpage: ["/preise", "/legal/*"], tools: ["/legacy"] });
  });

  it("keeps rejected paths on screen with their reason", async () => {
    mockFetch({ ok: true, rejected: [{ value: "tag", reason: "Muss mit / beginnen." }], sitemap_exclusions: {}, cache_status: {} });
    render(<SitemapSettings />);
    await screen.findByLabelText("Blog");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/Muss mit \/ beginnen/)).toBeTruthy();
  });
});
