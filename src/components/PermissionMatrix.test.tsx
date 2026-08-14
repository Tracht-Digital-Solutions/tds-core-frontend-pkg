// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PermissionMatrix from "./PermissionMatrix";
import type { Group, PermissionDef } from "../lib/companyAdmin";

/**
 * The control that decides who may do what.
 *
 * Its whole job is to keep two stored lists apart — granted and withheld — and
 * to show which rights come from a group. The rendering adapts (a checkbox
 * where no group is involved, three options where one is), so the assertions
 * here are about the STATE it writes back, not about the markup.
 */

const CATALOG: PermissionDef[] = [
  { id: "invoices:read", label: "Rechnungen sehen", group: "Abrechnung" },
  { id: "invoices:pay", label: "Rechnungen bezahlen", group: "Abrechnung" },
  { id: "tickets:read", label: "Tickets sehen", group: "Support" },
];

const BUCHHALTUNG: Group = {
  id: 1,
  companyId: 0,
  slug: "buchhaltung",
  name: "Buchhaltung",
  description: null,
  permissions: ["invoices:read", "invoices:pay"],
  isSystem: true,
  scope: "platform",
};

afterEach(cleanup);

function mount(props: Partial<React.ComponentProps<typeof PermissionMatrix>> = {}) {
  const onChange = vi.fn();
  render(
    <PermissionMatrix
      catalog={CATALOG}
      assignedGroups={[]}
      value={[]}
      denies={[]}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe("a right no group grants", () => {
  it("renders as a plain checkbox", () => {
    mount();

    // "inherited" and "denied" both mean "not granted" here, so offering all
    // three would be asking for a choice between two spellings of "no".
    expect(screen.getByRole("checkbox", { name: "Rechnungen sehen" })).toBeDefined();
    expect(screen.queryByRole("radiogroup", { name: "Rechnungen sehen" })).toBeNull();
  });

  it("grants it directly when ticked", async () => {
    const onChange = mount();

    await userEvent.click(screen.getByRole("checkbox", { name: "Tickets sehen" }));

    expect(onChange).toHaveBeenCalledWith({ permissions: ["tickets:read"], denies: [] });
  });
});

describe("a right an assigned group grants", () => {
  const withGroup = { assignedGroups: [BUCHHALTUNG] };

  it("names the group it comes from", () => {
    mount(withGroup);

    expect(screen.getAllByText("aus Gruppe „Buchhaltung“").length).toBe(2);
  });

  it("can be withheld from this one person", async () => {
    // The point of the whole feature: one member of a shared group loses one
    // of its rights without the group being cloned for them.
    const onChange = mount(withGroup);

    const group = screen.getByRole("radiogroup", { name: "Rechnungen bezahlen" });
    await userEvent.click(
      screen.getAllByRole("radio", { name: "Entzogen" })[
        [...screen.getAllByRole("radiogroup")].indexOf(group)
      ],
    );

    expect(onChange).toHaveBeenCalledWith({ permissions: [], denies: ["invoices:pay"] });
  });

  it("clears a deny when set back to inherited", async () => {
    const onChange = mount({ ...withGroup, denies: ["invoices:pay"] });

    const group = screen.getByRole("radiogroup", { name: "Rechnungen bezahlen" });
    await userEvent.click(
      screen.getAllByRole("radio", { name: "Aus Gruppe" })[
        [...screen.getAllByRole("radiogroup")].indexOf(group)
      ],
    );

    expect(onChange).toHaveBeenCalledWith({ permissions: [], denies: [] });
  });

  it("never leaves a key in both lists", async () => {
    // Granted and denied at once has no meaning, and the backend would apply
    // the deny — so the control must not be able to produce it.
    const onChange = mount({ ...withGroup, value: ["invoices:pay"] });

    const group = screen.getByRole("radiogroup", { name: "Rechnungen bezahlen" });
    await userEvent.click(
      screen.getAllByRole("radio", { name: "Entzogen" })[
        [...screen.getAllByRole("radiogroup")].indexOf(group)
      ],
    );

    expect(onChange).toHaveBeenCalledWith({ permissions: [], denies: ["invoices:pay"] });
  });
});

describe("keys the catalog does not know", () => {
  it("still renders a stored one, so it can be removed", () => {
    // Loosening the backend's validation was one-way: a key can be legitimately
    // held and unrecognised. Dropping it here would make it invisible AND
    // unremovable.
    mount({ value: ["legacy:ghost"] });

    expect(screen.getByRole("checkbox", { name: "legacy:ghost" })).toBeDefined();
  });

  it("renders one a group grants, under its group's name", () => {
    mount({
      assignedGroups: [{ ...BUCHHALTUNG, permissions: ["legacy:ghost"] }],
    });

    expect(screen.getByRole("radiogroup", { name: "legacy:ghost" })).toBeDefined();
  });
});

describe("the ceiling", () => {
  it("hides a right this membership may not hold at all", () => {
    // Offering it would be offering a control whose every setting is refused.
    mount({ ceiling: ["tickets:read"] });

    expect(screen.queryByRole("checkbox", { name: "Rechnungen sehen" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Tickets sehen" })).toBeDefined();
  });

  it("still shows a right a group grants outside the ceiling", () => {
    // The ceiling wins at resolve time, so this person does NOT hold it — but
    // hiding it would leave an admin unable to see why the group is not doing
    // what its name says.
    mount({ assignedGroups: [BUCHHALTUNG], ceiling: ["tickets:read"] });

    expect(screen.getByRole("radiogroup", { name: "Rechnungen bezahlen" })).toBeDefined();
  });

  it("says so when nothing is grantable", () => {
    mount({ ceiling: [] });

    expect(screen.getByText(/keine Rechte freigegeben/i)).toBeDefined();
  });
});
