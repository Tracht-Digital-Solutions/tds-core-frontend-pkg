/**
 * Version arithmetic for the Module page.
 *
 * The frontend platform composes at BUILD time, and every module is pinned in
 * the product's `package.json` with a **caret range**. A caret on a `0.x` line
 * is minor-LOCKED (`^0.1.1` means `>=0.1.1 <0.2.0`), which is the rule the whole
 * release model rests on: a module may ship patches freely, but crossing its
 * minor takes a coordinated repin in the product repo.
 *
 * That rule is what makes "Update verfügbar" and "Repin erforderlich" two
 * genuinely different answers, and it is why this file exists rather than a
 * `semver` dependency: the shared packages are dependency-lean by convention,
 * and the ranges in play are exactly the ones npm generates (`^`, `~`, `>=`,
 * exact, `*`). Anything else resolves to "unbekannt" instead of a wrong verdict.
 */

/** Where a package sits in the platform: a feature module or the host/SDK itself. */
export type ModuleKind = "extension" | "platform";

/** One composed package, as the build knows it. */
export interface ModuleEntry {
  /** npm package name, e.g. `"@tracht-digital-solutions/tds-ext-blog-cms"`. */
  pkg: string;
  /** Extension id from the manifest (`"blog-cms"`); absent for platform packages. */
  id?: string;
  /** German display name. */
  name: string;
  /** Version this build was composed from. */
  installed: string;
  /** The range pinned in the product's package.json, e.g. `"^0.1.1"`. */
  range: string;
  kind: ModuleKind;
}

/**
 * - `current` — the registry's latest is what is installed.
 * - `update`  — a newer version exists AND the pinned range admits it, so a
 *               rebuild picks it up.
 * - `repin`   — a newer version exists but falls OUTSIDE the range: the product
 *               repo has to bump its pin first. A rebuild would change nothing.
 * - `ahead`   — installed is newer than the registry's latest (a local build, or
 *               a release that has not published yet).
 * - `unknown` — no answer from the registry, or a range/version this file does
 *               not parse.
 */
export type UpdateState = "current" | "update" | "repin" | "ahead" | "unknown";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease tag (`"dev.1"`), or "" for a plain release. */
  prerelease: string;
}

/** Parse `1.2.3` / `0.1.29-dev.4`. Returns null for anything else. */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/**
 * Compare two versions: negative when `a < b`, 0 when equal, positive when
 * `a > b`. A prerelease sorts BELOW its release (`0.2.0-dev.1 < 0.2.0`), per
 * semver — otherwise a `@dev` publish would read as an available update.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === "") return 1;
  if (pb.prerelease === "") return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Does `version` satisfy the npm `range` as the product pins it?
 *
 * Supported: `^`, `~`, `>=`, exact, `*`/`latest`. An unsupported range returns
 * null — "I cannot tell" — which the caller renders as `unknown` rather than
 * guessing, because guessing wrong here means either hiding a real update or
 * promising a rebuild that will not deliver one.
 */
export function satisfiesRange(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  const trimmed = range.trim();
  if (!v) return null;
  if (trimmed === "*" || trimmed === "latest" || trimmed === "") return true;

  const operator = /^(\^|~|>=)?\s*(.+)$/.exec(trimmed);
  if (!operator) return null;
  const base = parseVersion(operator[2] ?? "");
  if (!base) return null;

  if (compareVersions(version, operator[2] ?? "") < 0) return false;

  switch (operator[1]) {
    case "^":
      // The 0.x rule: a caret locks the leftmost NON-ZERO segment, so ^0.1.1
      // admits 0.1.x only and ^0.0.3 admits 0.0.3 exactly. This is why a host
      // minor bump is never a one-repo change.
      if (base.major > 0) return v.major === base.major;
      if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
      return v.major === 0 && v.minor === 0 && v.patch === base.patch;
    case "~":
      return v.major === base.major && v.minor === base.minor;
    case ">=":
      return true;
    default:
      // Exact pin.
      return compareVersions(version, operator[2] ?? "") === 0;
  }
}

/** Classify one row against the registry's latest (null ⇒ not answered). */
export function classify(entry: ModuleEntry, latest: string | null | undefined): UpdateState {
  if (!latest || !parseVersion(latest) || !parseVersion(entry.installed)) return "unknown";

  const diff = compareVersions(latest, entry.installed);
  if (diff === 0) return "current";
  if (diff < 0) return "ahead";

  const admitted = satisfiesRange(latest, entry.range);
  if (admitted === null) return "unknown";
  return admitted ? "update" : "repin";
}

/** German label + shared chip variant per state — the only place they are paired. */
export const STATE_META: Record<UpdateState, { label: string; chip: string }> = {
  current: { label: "Aktuell", chip: "chip--success" },
  update: { label: "Update verfügbar", chip: "chip--warning" },
  repin: { label: "Repin erforderlich", chip: "chip--danger" },
  ahead: { label: "Vorab-Version", chip: "chip--info" },
  unknown: { label: "Unbekannt", chip: "chip--neutral" },
};

/**
 * The caret range that WOULD admit `latest` — what a maintainer types into the
 * product's package.json to resolve a `repin`. Rendering the exact replacement
 * beats saying "please repin": the 0.x rule is the thing people get wrong.
 */
export function suggestedRange(latest: string): string | null {
  return parseVersion(latest) ? `^${latest}` : null;
}
