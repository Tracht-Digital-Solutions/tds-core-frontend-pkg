/** Where a package sits in the composed platform. */
export type ModuleKind = "extension" | "platform";

/** One installed package, captured from the product build. */
export interface ModuleEntry {
  /** npm package name, e.g. `@tracht-digital-solutions/tds-ext-blog-cms`. */
  pkg: string;
  /** Extension id from the manifest; absent for platform packages. */
  id?: string;
  /** Human-readable module name. */
  name: string;
  /** Version this product was built with. */
  installed: string;
  /** Dependency range pinned in the product package.json. */
  range: string;
  kind: ModuleKind;
}
