import { useMemo } from "react";

import type { Group, PermissionDef } from "../lib/companyAdmin";

/**
 * Per-right editor for one membership, shared by the platform user editor and
 * the company admin's own screen.
 *
 * ### Three states, rendered as two or three controls
 *
 * A right is *inherited* (whatever the assigned groups say), *granted*
 * individually, or *withheld* individually. But when no assigned group carries
 * the right, "inherited" and "withheld" are the same outcome — nothing — and
 * offering both would be asking someone to choose between two spellings of
 * "no". So:
 *
 * - **no group grants it** → one checkbox: off = not granted, on = granted.
 * - **a group grants it** → three options, naming the group, because the
 *   interesting question there is "why does this person have it".
 *
 * Switching a group assignment changes which shape a right renders in, so the
 * origin is computed HERE from `groups[].permissions` rather than being
 * delivered by the server — a server-side answer would be stale the moment a
 * checkbox above moves.
 *
 * ### Only the decisions are stored
 *
 * `value` (granted) and `denies` (withheld) are the raw stored decisions, never
 * the effective set. The effective set is derived on every token issue, so
 * writing it back would freeze a group's contribution at the moment somebody
 * last opened this form.
 */

export type PermissionState = "inherited" | "granted" | "denied";

export interface PermissionMatrixProps {
  /** The composed catalog; empty falls back to whatever the groups mention. */
  catalog: PermissionDef[];
  /** Groups assigned to this membership — the source of "inherited". */
  assignedGroups: Group[];
  /** Directly granted keys. */
  value: string[];
  /** Withheld keys, even where a group grants them. */
  denies: string[];
  /** Keys this membership may hold at all; `null` = no ceiling. */
  ceiling?: string[] | null;
  onChange: (next: { permissions: string[]; denies: string[] }) => void;
}

const withoutKey = (list: string[], key: string) => list.filter((k) => k !== key);
const withKey = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);

export default function PermissionMatrix({
  catalog,
  assignedGroups,
  value,
  denies,
  ceiling = null,
  onChange,
}: PermissionMatrixProps) {
  /** Which assigned group grants each key — the "aus Gruppe X" label. */
  const grantedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of assignedGroups) {
      for (const key of group.permissions) {
        if (!map.has(key)) map.set(key, group.name);
      }
    }
    return map;
  }, [assignedGroups]);

  /**
   * Every key worth offering: the catalog, plus anything stored or granted by
   * a group that the catalog does not know.
   *
   * The extras matter. Loosening the backend's validation was one-way, so a
   * key can be legitimately held and unrecognised — dropping it here would
   * make it invisible AND unremovable.
   */
  const rows = useMemo(() => {
    const byKey = new Map<string, PermissionDef>();
    for (const def of catalog) byKey.set(def.id, def);

    for (const key of [...value, ...denies, ...grantedBy.keys()]) {
      if (!byKey.has(key)) {
        byKey.set(key, { id: key, label: key, group: "Unbekannt" });
      }
    }

    const bySection = new Map<string, PermissionDef[]>();
    for (const def of byKey.values()) {
      // A key outside the ceiling cannot be held at all, so offering it would
      // be offering a control whose every setting is refused.
      if (ceiling !== null && !ceiling.includes(def.id) && !grantedBy.has(def.id)) continue;
      const section = def.group ?? "Allgemein";
      bySection.set(section, [...(bySection.get(section) ?? []), def]);
    }

    return [...bySection.entries()];
  }, [catalog, value, denies, grantedBy, ceiling]);

  function setState(key: string, state: PermissionState) {
    onChange({
      permissions: state === "granted" ? withKey(value, key) : withoutKey(value, key),
      denies: state === "denied" ? withKey(denies, key) : withoutKey(denies, key),
    });
  }

  function stateOf(key: string): PermissionState {
    if (denies.includes(key)) return "denied";
    if (value.includes(key)) return "granted";
    return "inherited";
  }

  if (rows.length === 0) {
    return (
      <p className="tds-empty">
        Für diese Firma sind keine Rechte freigegeben.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map(([section, defs]) => (
        <fieldset key={section} className="space-y-2">
          <legend className="text-xs uppercase opacity-60">{section}</legend>
          {defs.map((def) => {
            const from = grantedBy.get(def.id);
            const state = stateOf(def.id);

            // No group involved: the two remaining states are a checkbox.
            if (from === undefined) {
              return (
                <label key={def.id} className="tds-list__row" style={{ gap: "0.625rem" }}>
                  <input
                    type="checkbox"
                    checked={state === "granted"}
                    onChange={(e) => setState(def.id, e.target.checked ? "granted" : "inherited")}
                  />
                  <span className="text-sm">{def.label}</span>
                </label>
              );
            }

            return (
              <div key={def.id} className="tds-list__row" style={{ gap: "0.625rem" }}>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm">{def.label}</span>
                  <span className="text-xs opacity-70">aus Gruppe „{from}“</span>
                </span>
                <span className="tds-toolbar" role="radiogroup" aria-label={def.label}>
                  {(
                    [
                      ["inherited", "Aus Gruppe"],
                      ["granted", "Einzeln erlaubt"],
                      ["denied", "Entzogen"],
                    ] as [PermissionState, string][]
                  ).map(([option, label]) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={state === option}
                      className={`chip ${
                        state === option
                          ? option === "denied"
                            ? "chip--danger"
                            : "chip--info"
                          : "chip--neutral"
                      }`}
                      onClick={() => setState(def.id, option)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
