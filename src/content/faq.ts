/**
 * In-frontend FAQ — the short answers a *logged-in* user looks up in `/wiki`.
 *
 * Why this exists as code and not as CMS content: these entries describe how
 * the platform itself behaves (session scope, targets, permissions), so they
 * belong to the shell that implements that behaviour and must ship with it.
 * Customer-facing, editable support content lives in the Live-Chat-Widget FAQ
 * (`tds-ext-live-chat-cta-pkg`, DB-backed, editable under `/live-chat`).
 *
 * `answer` is a paragraph list, NOT markdown/HTML — it is rendered with plain
 * text interpolation, so an entry can never inject markup into the shell.
 *
 * `target` scopes an entry to one product; omit it for entries that apply to
 * both the admin frontend and the customer portal.
 */
import { FRONTEND_TARGET, type FrontendTarget } from "../config/target";

export interface FaqEntry {
  /** Stable anchor id — linkable (`/wiki#faq-<id>`); keep it kebab-case. */
  id: string;
  question: string;
  answer: string[];
  target?: FrontendTarget;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "sso-scope",
    question: "Gilt meine Anmeldung auch in den anderen Bereichen?",
    answer: [
      "Ja. Die Anmeldung läuft zentral über auth.tracht-digital.de und gilt anschließend " +
        "für alle Bereiche, für die Ihr Konto freigeschaltet ist — Verwaltung, Kundenportal " +
        "und die Tools-Seite. Ein zweites Login je Bereich ist nicht nötig.",
      "Technisch liegt dahinter eine gemeinsame Sitzung für alle Adressen unter " +
        "tracht-digital.de; es werden keine Zugangsdaten zwischen den Bereichen übertragen. " +
        "Welche Bereiche Ihnen offenstehen, hängt weiterhin an Ihren Berechtigungen: Die " +
        "Sitzung öffnet keinen Bereich, für den Ihr Konto keine Freigabe hat.",
    ],
  },
  {
    id: "sso-logout",
    question: "Was passiert beim Abmelden?",
    answer: [
      "Das Abmelden beendet die gemeinsame Sitzung und wirkt damit in allen Bereichen " +
        "gleichzeitig — Sie sind anschließend überall abgemeldet, nicht nur in dem Bereich, " +
        "in dem Sie den Abmelden-Knopf gedrückt haben.",
      "Dasselbe gilt automatisch, wenn die Sitzung abläuft oder das Passwort geändert wird: " +
        "In beiden Fällen führt der nächste Aufruf zurück zur zentralen Anmeldung.",
    ],
  },
  {
    id: "password-change",
    question: "Wie ändere ich mein Passwort?",
    answer: [
      "Das Passwort wird ebenfalls zentral geändert, unter auth.tracht-digital.de/passwort " +
        "(mindestens 12 Zeichen). Nach der Änderung werden alle bestehenden Sitzungen " +
        "beendet — Sie melden sich einmal neu an und sind danach wieder in allen Bereichen " +
        "angemeldet.",
    ],
  },
];

/** The entries visible in the current product build (target-scoped ones filtered). */
export function faqForTarget(target: FrontendTarget = FRONTEND_TARGET): FaqEntry[] {
  return FAQ_ENTRIES.filter((entry) => entry.target === undefined || entry.target === target);
}
