import { useEffect, useState } from "react";

import { loadSetupStatus } from "../lib/setupStatus";

/**
 * "N Funktionen sind noch nicht eingerichtet" — a quiet line above every page
 * while something is open, plus the same count on the Einrichtung nav row.
 *
 * Open means not set up and neither put off ("Später", until the next
 * sign-in) nor ignored; the API decides that per user. A non-admin gets an
 * empty answer, so this needs no permission logic of its own. On the
 * wizard page itself the line would only repeat the page, so it stays away.
 *
 * The count on the nav row is written into the existing link rather than
 * rendered by the nav: the nav is server markup shared by every page, and
 * the count is per user and per moment.
 */
export default function SetupBanner() {
  const [open, setOpen] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async (fresh: boolean) => {
      const status = await loadSetupStatus(fresh);
      if (!alive || !status) return;
      setOpen(status.open);
      markNav(status.open);
    };
    void refresh(false);
    const onChange = () => void refresh(true);
    window.addEventListener("tds:setup-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("tds:setup-changed", onChange);
    };
  }, []);

  if (open === 0 || window.location.pathname.startsWith("/einrichtung")) return null;

  return (
    <div className="tds-alert tds-alert--warning setup-banner" role="status">
      <span>
        {open === 1 ? "1 Funktion ist" : `${open} Funktionen sind`} noch nicht eingerichtet.
      </span>{" "}
      <a className="link-underline" href="/einrichtung">
        Zur Einrichtung
      </a>
    </div>
  );
}

function markNav(open: number) {
  const link = document.querySelector<HTMLAnchorElement>('[data-nav="einrichtung"]');
  if (!link) return;
  let badge = link.querySelector<HTMLSpanElement>(".setup-nav-count");
  if (open === 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "chip chip--warning setup-nav-count";
    // Inside the label, so the collapsed rail hides it together with the text.
    (link.querySelector(".nav-item__label") ?? link).append(" ", badge);
  }
  badge.textContent = String(open);
  badge.setAttribute("aria-label", `${open} offen`);
}
