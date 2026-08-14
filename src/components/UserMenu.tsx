import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@tracht-digital-solutions/tds-shared/components";

import {
  API_BASE,
  AUTH_API_URL,
  fetchMe,
  frontendFetch,
  logout,
  membershipIds,
  type Me,
} from "../lib/auth";
import { resolveActiveCompany, setActiveCompany } from "../lib/activeCompany";
import { FRONTEND_TARGET, LOGIN_URL } from "../config/target";

/**
 * The shell's identity control: who you are, and the way out.
 *
 * Until this existed the panel had no desktop header at all — nothing anywhere
 * said which account you were using, and `logout()` sat in `lib/auth.ts`
 * imported by nothing.
 *
 * ### Failure is silence, never a broken header
 *
 * `/me` can fail for reasons that are not the user's problem (the composed API
 * is down, the session is mid-refresh). The menu then renders **nothing** — the
 * pre-paint gate already owns "are you logged in", and a half-drawn header with
 * an error in it would be worse than no header. Same for the company name: it
 * comes from a different service and its absence just means one line fewer.
 */

interface Company {
  id: number;
  name: string;
  active?: boolean;
}

/** Menu geometry that has to match `.tds-dropdown` in tds-shared. */
const ICON = {
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  key: (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  building: (
    <>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
};

function Glyph({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export interface UserMenuProps {
  /** Avatar-only trigger, for the mobile top bar where space is scarce. */
  compact?: boolean;
}

export default function UserMenu({ compact = false }: UserMenuProps) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const principal = await fetchMe();
      if (cancelled) return;
      setMe(principal);
      setLoading(false);

      // Company NAMES live in the composed API (tds-ext-customers), not in
      // auth-api, which only ever holds ids. Admins get an empty list by
      // design — their reach is "any company", so there is nothing to name.
      if (principal && !principal.isAdmin && (principal.companies?.length ?? 0) > 0) {
        try {
          const res = await frontendFetch(`${API_BASE}/me/companies`);
          if (!res.ok) return;
          const body = (await res.json()) as { companies?: Company[] };
          if (!cancelled && Array.isArray(body.companies)) setCompanies(body.companies);
        } catch {
          /* One line fewer in the menu; never a reason to break the header. */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click and on Escape, and return focus to the trigger —
  // otherwise a keyboard user who dismisses the menu lands at the top of the
  // document.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Move focus into the menu when it opens, so the first Tab/Arrow lands on an
  // item rather than walking past the whole menu.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("[data-menu-item]")?.focus();
  }, [open]);

  const onPanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // Wraps, which is what a roving menu is expected to do.
    const next = (current + step + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const label = useMemo(() => me?.label ?? me?.name ?? me?.email ?? "", [me]);

  /**
   * The memberships, as ids, straight from the signed principal.
   *
   * `/me/companies` supplies NAMES and may be unavailable; the ids are what the
   * switcher actually needs, so the list stays usable (as "Firma 12") when the
   * composed API is down — a switcher that disappears whenever a directory
   * lookup fails would strand a multi-company user in the wrong company.
   */
  const memberIds = useMemo(() => membershipIds(me), [me]);

  const activeId = useMemo(() => resolveActiveCompany(memberIds), [memberIds]);

  const companyName = useCallback(
    (id: number) => companies.find((c) => c.id === id)?.name ?? `Firma ${id}`,
    [companies],
  );

  const companyLine = useMemo(() => {
    if (!me) return "";
    if (me.isAdmin) return FRONTEND_TARGET === "customer" ? "Kundenportal" : "Management";
    if (activeId !== null) return companyName(activeId);
    return companies[0]?.name ?? "";
  }, [me, companies, activeId, companyName]);

  /**
   * Switching reloads the page.
   *
   * Every island has fetched its data by the time the menu is open, and the
   * active company scopes nearly all of it. A reload is ten honest lines; the
   * alternative is a global invalidation bus that every extension would have to
   * subscribe to — and forgetting to subscribe would show one company's data
   * under another company's name, which is the worst outcome available here.
   */
  const switchTo = useCallback((id: number) => {
    setActiveCompany(id);
    location.reload();
  }, []);

  // The gate owns "are you logged in"; a skeleton here would only add a
  // flicker to a header that is about to be correct either way.
  if (loading || !me) return null;

  const passwordHref = `${LOGIN_URL}/passwort?next=${encodeURIComponent(
    typeof location !== "undefined" ? location.href : "",
  )}`;

  return (
    <div className="tds-dropdown" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tds-dropdown__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={label} src={me.hasAvatar ? me.avatarUrl : null} seed={me.userId} size="sm" decorative />
        {!compact && (
          <span className="min-w-0 hidden sm:block">
            <span className="tds-dropdown__label text-sm font-medium">{label}</span>
            {companyLine && (
              <span
                className="tds-dropdown__label text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                {companyLine}
              </span>
            )}
          </span>
        )}
        <span aria-hidden="true" style={{ color: "var(--color-muted)" }}>
          <Glyph size={14}>{ICON.chevron}</Glyph>
        </span>
        <span className="sr-only">Profilmenü{label ? ` für ${label}` : ""}</span>
      </button>

      <div
        ref={panelRef}
        className="tds-dropdown__panel"
        role="menu"
        aria-label="Profilmenü"
        hidden={!open}
        onKeyDown={onPanelKeyDown}
      >
        <div className="tds-dropdown__head">
          <Avatar name={label} src={me.hasAvatar ? me.avatarUrl : null} seed={me.userId} decorative />
          <span className="min-w-0">
            <span className="tds-dropdown__label text-sm font-medium">{label}</span>
            <span
              className="tds-dropdown__label text-xs"
              style={{ color: "var(--color-muted)" }}
            >
              {me.email}
            </span>
            {companyLine && (
              <span
                className="tds-dropdown__label text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                {companyLine}
              </span>
            )}
          </span>
        </div>

        {memberIds.length > 1 && (
          <>
            <hr className="tds-dropdown__sep" />
            <p className="tds-dropdown__caption">Firma wechseln</p>
            {memberIds.map((id) => (
              <button
                key={id}
                type="button"
                className="tds-dropdown__item"
                role="menuitemradio"
                aria-checked={id === activeId}
                data-menu-item
                onClick={() => switchTo(id)}
              >
                <span className="tds-dropdown__icon">
                  <Glyph>{id === activeId ? ICON.check : ICON.building}</Glyph>
                </span>
                {companyName(id)}
              </button>
            ))}
          </>
        )}

        <hr className="tds-dropdown__sep" />

        <a className="tds-dropdown__item" role="menuitem" data-menu-item href="/profil">
          <span className="tds-dropdown__icon">
            <Glyph>{ICON.user}</Glyph>
          </span>
          Profileinstellungen
        </a>

        {/* The login UI lives OFF this host (auth.tracht-digital.de), so this
            leaves the panel and comes back via ?next=. */}
        <a className="tds-dropdown__item" role="menuitem" data-menu-item href={passwordHref}>
          <span className="tds-dropdown__icon">
            <Glyph>{ICON.key}</Glyph>
          </span>
          Passwort ändern
        </a>

        <hr className="tds-dropdown__sep" />

        <button
          type="button"
          className="tds-dropdown__item tds-dropdown__item--danger"
          role="menuitem"
          data-menu-item
          onClick={() => void logout()}
        >
          <span className="tds-dropdown__icon">
            <Glyph>{ICON.logout}</Glyph>
          </span>
          Abmelden
        </button>
      </div>
    </div>
  );
}

/** Exported for the profile page, which shows the same identity. */
export { AUTH_API_URL };
