import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { cachedGrant } from "../lib/revealNav";
import { searchEntries, visibleEntries, type QuickEntry } from "../lib/quickNav";

interface Props {
  entries: QuickEntry[];
}

/** Elements that open the search; server-rendered in both headers by the Layout. */
export const OPEN_SELECTOR = "[data-quick-nav-open]";

/**
 * The quick search: Strg/⌘+K (or "/" outside a text field, or a search button
 * in the top bar) opens a dialog that jumps to any page or settings section.
 *
 * Mounted ONCE per page, outside both headers: the desktop bar is
 * `display: none` below `lg` and the mobile one above it, and a `<dialog>`
 * inside a hidden ancestor never renders, top layer or not. The triggers are
 * plain buttons the Layout renders; this listens for them on the document.
 *
 * Results are real links. Enter clicks the active one, so the ClientRouter
 * handles the navigation like any other nav click, an external entry opens
 * its new tab natively, and a middle click still works.
 *
 * Built on the native `<dialog>` like tds-shared's ConfirmDialog (`.tds-modal`
 * carries the `margin: auto` that centres it); Escape closes it and focus
 * returns to whatever opened it.
 */
export default function QuickNav({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState<QuickEntry[]>(() => visibleEntries(entries, null));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const titleId = useId();

  const results = useMemo(() => searchEntries(visible, query), [visible, query]);

  const show = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Read the grant at open time: revealNav refreshes it once /me answers.
    setVisible(visibleEntries(entries, cachedGrant()));
    setQuery("");
    setActive(0);
    setOpen(true);
  }, [entries]);

  const hide = useCallback(() => setOpen(false), []);

  // Keyboard shortcut and the header triggers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (dialogRef.current?.open) hide();
        else show();
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        if (dialogRef.current?.open) return;
        e.preventDefault();
        show();
      }
    };
    const onClick = (e: MouseEvent) => {
      const trigger = e.target instanceof Element ? e.target.closest(OPEN_SELECTOR) : null;
      if (!trigger) return;
      e.preventDefault();
      show();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [show, hide]);

  // Keep the DOM's modal state in step with `open` (see ConfirmDialog).
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      inputRef.current?.focus();
      for (const t of document.querySelectorAll(OPEN_SELECTOR)) t.setAttribute("aria-expanded", "true");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
      for (const t of document.querySelectorAll(OPEN_SELECTOR)) t.setAttribute("aria-expanded", "false");
      if (openerRef.current?.isConnected) openerRef.current.focus();
    }
  }, [open]);

  // Escape fires `cancel`; React stays the one source of truth for `open`.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      hide();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [hide]);

  // The active option stays in view while the arrows walk the list.
  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [active, results]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      listRef.current?.querySelector<HTMLAnchorElement>(`[data-index="${active}"]`)?.click();
    }
  };

  const optionId = (i: number) => `${listId}-o${i}`;
  const grouped = query.trim() === "";

  return (
    <dialog
      ref={dialogRef}
      className="tds-modal quick-nav"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div className="tds-modal__panel quick-nav__panel">
        <h2 className="sr-only" id={titleId}>
          Schnellsuche
        </h2>
        <input
          ref={inputRef}
          className="field-boxed"
          type="search"
          role="combobox"
          aria-label="Seite oder Einstellung suchen"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          placeholder="Seite oder Einstellung suchen …"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKey}
        />
        <div ref={listRef} id={listId} role="listbox" aria-label="Treffer" className="quick-nav__list">
          {results.length === 0 ? (
            <p className="tds-empty quick-nav__empty" role="presentation">
              Keine Seite gefunden.
            </p>
          ) : (
            results.map((entry, i) => (
              <QuickOption
                key={`${entry.group}|${entry.href}`}
                entry={entry}
                id={optionId(i)}
                index={i}
                selected={i === active}
                caption={grouped && (i === 0 || results[i - 1]!.group !== entry.group) ? entry.group : null}
                showGroup={!grouped}
                onHover={() => setActive(i)}
                onPick={hide}
              />
            ))
          )}
        </div>
        <p className="marginalia quick-nav__hint" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> auswählen · <kbd>Enter</kbd> öffnen · <kbd>Esc</kbd> schließen
        </p>
      </div>
    </dialog>
  );
}

function QuickOption({
  entry,
  id,
  index,
  selected,
  caption,
  showGroup,
  onHover,
  onPick,
}: {
  entry: QuickEntry;
  id: string;
  index: number;
  selected: boolean;
  caption: string | null;
  showGroup: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <>
      {caption ? (
        <p className="tds-dropdown__caption" role="presentation">
          {caption}
        </p>
      ) : null}
      <a
        id={id}
        role="option"
        aria-selected={selected}
        data-index={index}
        tabIndex={-1}
        className="tds-dropdown__item quick-nav__option"
        href={entry.href}
        target={entry.external ? "_blank" : undefined}
        rel={entry.external ? "noopener noreferrer" : undefined}
        onMouseMove={onHover}
        onClick={onPick}
      >
        <span className="tds-dropdown__label">{entry.label}</span>
        {entry.external ? <span className="quick-nav__meta">neuer Tab</span> : null}
        {showGroup ? <span className="quick-nav__meta">{entry.group}</span> : null}
      </a>
    </>
  );
}

/** A keystroke meant for a text field ("/" in a search box) is not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}
