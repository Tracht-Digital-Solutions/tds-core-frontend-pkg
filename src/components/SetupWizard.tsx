import { useCallback, useEffect, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";

import { chooseSetup, isOpen, loadSetupStatus, type SetupAction, type SetupItem, type SetupStatus } from "../lib/setupStatus";

const LEVEL: Record<SetupItem["level"], { label: string; chip: string }> = {
  required: { label: "Nötig", chip: "chip--danger" },
  recommended: { label: "Empfohlen", chip: "chip--warning" },
  optional: { label: "Optional", chip: "chip--neutral" },
};

const STATE: Record<SetupItem["state"], { label: string; chip: string }> = {
  ok: { label: "Eingerichtet", chip: "chip--success" },
  partial: { label: "Teilweise", chip: "chip--warning" },
  missing: { label: "Nicht eingerichtet", chip: "chip--danger" },
};

const DONE_TOAST: Record<SetupAction, string> = {
  snooze: "Verschoben — die Erinnerung kommt bei der nächsten Anmeldung wieder.",
  ignore: "Ignoriert. Unter „Ignoriert“ lässt sich das zurückholen.",
  restore: "Wieder in der Liste.",
};

/**
 * The Einrichtungsassistent (`/einrichtung`).
 *
 * Four groups, in the order an operator works through them: what is still
 * open, what was put off until the next sign-in, what is done, what was
 * ignored. Every open item has the same three ways forward — set it up now,
 * later, or never — because "unconfigured" is silent everywhere else in the
 * system and the operator must be able to decide about each one explicitly.
 *
 * "Einrichten" is a plain link: the setting itself lives where it always
 * lived (mostly a section of /einstellungen), so there is one place to edit
 * it and the wizard can never drift from it.
 */
export default function SetupWizard() {
  const [status, setStatus] = useState<SetupStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setStatus(await loadSetupStatus(fresh));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (item: SetupItem, action: SetupAction) => {
    setBusy(item.id);
    try {
      await chooseSetup(item.id, action);
      toast.success(DONE_TOAST[action]);
      await load(true);
      // The banner above every page counts open items; tell it to recount.
      window.dispatchEvent(new CustomEvent("tds:setup-changed"));
    } catch (err) {
      toast.danger(`Speichern fehlgeschlagen (${err instanceof Error ? err.message : "unbekannt"}).`);
    } finally {
      setBusy(null);
    }
  };

  if (status === undefined) return <Spinner />;
  if (status === null) {
    return (
      <div className="tds-alert tds-alert--danger" role="alert">
        Der Einrichtungsstand konnte nicht geladen werden. Bitte später erneut versuchen.
      </div>
    );
  }

  const open = status.items.filter(isOpen);
  const later = status.items.filter((i) => i.state !== "ok" && i.snoozed && !i.ignored);
  const done = status.items.filter((i) => i.state === "ok" && !i.ignored);
  const ignored = status.items.filter((i) => i.ignored);

  const row = (item: SetupItem) => {
    const level = LEVEL[item.level];
    const state = STATE[item.state];
    const isBusy = busy === item.id;
    return (
      <li className="tds-list__row" key={item.id}>
        <div className="tds-stack tds-stack--tight">
          <div className="tds-row">
            <strong>{item.title}</strong>
            <span className={`chip ${state.chip}`}>{state.label}</span>
            {item.state !== "ok" ? <span className={`chip ${level.chip}`}>{level.label}</span> : null}
          </div>
          {item.state !== "ok" && item.description ? <p className="marginalia">{item.description}</p> : null}
        </div>
        <div className="tds-toolbar">
          {item.state !== "ok" && !item.ignored ? (
            <a className="btn btn-primary" href={item.href}>
              Einrichten
            </a>
          ) : null}
          {item.state !== "ok" && !item.snoozed && !item.ignored ? (
            <button type="button" className="btn btn-ghost" disabled={isBusy} aria-busy={isBusy} onClick={() => void choose(item, "snooze")}>
              Später
            </button>
          ) : null}
          {item.state !== "ok" && !item.ignored ? (
            <button type="button" className="btn btn-ghost" disabled={isBusy} aria-busy={isBusy} onClick={() => void choose(item, "ignore")}>
              Ignorieren
            </button>
          ) : null}
          {item.ignored || item.snoozed ? (
            <button type="button" className="btn btn-ghost" disabled={isBusy} aria-busy={isBusy} onClick={() => void choose(item, "restore")}>
              Zurückholen
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const group = (title: string, items: SetupItem[], hint?: string) =>
    items.length > 0 ? (
      <section className="tds-card tds-stack" aria-label={title}>
        <h2>
          {title} ({items.length})
        </h2>
        {hint ? <p className="marginalia">{hint}</p> : null}
        <ul className="tds-list">{items.map(row)}</ul>
      </section>
    ) : null;

  return (
    <div className="tds-stack tds-stack--loose">
      {open.length === 0 ? (
        <div className="tds-alert tds-alert--success">Alles Nötige ist eingerichtet oder bewusst zurückgestellt.</div>
      ) : null}
      {group("Offen", open, "„Später“ blendet einen Punkt bis zur nächsten Anmeldung aus, „Ignorieren“ dauerhaft.")}
      {group("Später", later, "Kommt bei der nächsten Anmeldung wieder.")}
      {group("Eingerichtet", done)}
      {group("Ignoriert", ignored)}
    </div>
  );
}
