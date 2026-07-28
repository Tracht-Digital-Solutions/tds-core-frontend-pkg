/// <reference types="astro/client" />

// The three virtual modules frontend-contract's Astro integration serves. Declared
// here so the shell type-checks against them.
//
// These were `virtual:panel-*` until the frontend rename; the contract still
// resolves the old spellings as deprecated aliases (so a host one version
// behind keeps building), but the canonical names are `virtual:frontend-*` and
// new code must use those.
declare module "virtual:frontend-registry" {
  import type { ComposedRegistry } from "@tracht-digital-solutions/tds-frontend-contract";
  export const registry: ComposedRegistry;
}

declare module "virtual:frontend-widgets" {
  import type { WidgetManifest } from "@tracht-digital-solutions/tds-frontend-contract";
  // Component is the resolved (Astro) component; typed loosely — the host just
  // renders it. Metadata rides along for permission gating + titles.
  export const widgets: Array<WidgetManifest & { Component: unknown }>;
}

declare module "virtual:frontend-settings" {
  import type { SettingsPanel } from "@tracht-digital-solutions/tds-frontend-contract";
  export const settings: Array<SettingsPanel & { Component: unknown }>;
}
