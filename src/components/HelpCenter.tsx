import { useEffect, useMemo, useState } from "react";
import { FormAlert, Spinner } from "@tracht-digital-solutions/tds-shared/components";
import { renderMarkdown } from "@tracht-digital-solutions/tds-shared/markdown";
import { API_BASE, frontendFetch } from "../lib/auth";

/**
 * The CUSTOMER wiki: the FAQs and handbooks for the software the customer has
 * been given. No API reference — that is the admin frontend's wiki.
 *
 * The content is the `live_chat_faq` / `live_chat_doc` rows maintained under
 * *Wiki-Inhalte* in the admin frontend, read through the public `/help/*`
 * routes. One source, two surfaces: the same entries appear in the floating
 * support widget. There is deliberately no second, code-side FAQ list — there
 * used to be one (`src/content/faq.ts`) that had to be hand-synced with the
 * seeded database rows, and it drifted.
 *
 * Those routes belong to `tds-ext-live-chat-cta-pkg`, which the customer
 * product does NOT compose on the frontend. That is fine and not new: the shell
 * already mounts the `LiveChatCta` island unconditionally against the same
 * module's public API. If the extension is absent from a build of the backend,
 * the calls 404 and the page shows its empty state.
 */

interface FaqEntry {
  id: number;
  category: string | null;
  question: string;
  answer: string;
}

interface ArticleEntry {
  id: number;
  slug: string;
  title: string;
  updated_at: string | null;
}

interface ArticleBody {
  slug: string;
  title: string;
  body_markdown: string;
  updated_at: string | null;
}

interface Props {
  lang?: "de" | "en";
}

/** Anchor-safe id, so an answer can be linked to directly. */
const faqAnchor = (entry: FaqEntry) => `faq-${entry.id}`;

export default function HelpCenter({ lang = "de" }: Props) {
  const [faqs, setFaqs] = useState<FaqEntry[] | null>(null);
  const [articles, setArticles] = useState<ArticleEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [f, a] = await Promise.all([
          frontendFetch(`${API_BASE}/help/faqs?lang=${lang}`),
          frontendFetch(`${API_BASE}/help/articles?lang=${lang}`),
        ]);
        if (!alive) return;
        // A 404 means the help module is not composed into this backend —
        // an empty wiki, not an error worth alarming a customer with.
        setFaqs(f.ok ? ((await f.json()).faqs ?? []) : []);
        setArticles(a.ok ? ((await a.json()).articles ?? []) : []);
        if (!f.ok && !a.ok && f.status !== 404) setFailed(true);
      } catch {
        if (alive) {
          setFaqs([]);
          setArticles([]);
          setFailed(true);
        }
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [lang]);

  const query = q.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!faqs) return [];
    const matching = faqs.filter(
      (e) => !query || `${e.question} ${e.answer} ${e.category ?? ""}`.toLowerCase().includes(query),
    );
    const byCategory = new Map<string, FaqEntry[]>();
    for (const entry of matching) {
      const key = entry.category?.trim() || "Allgemein";
      byCategory.set(key, [...(byCategory.get(key) ?? []), entry]);
    }
    return [...byCategory.entries()];
  }, [faqs, query]);

  const shownArticles = useMemo(
    () => (articles ?? []).filter((a) => !query || a.title.toLowerCase().includes(query)),
    [articles, query],
  );

  if (faqs === null || articles === null) {
    return (
      <p role="status">
        <Spinner />
      </p>
    );
  }

  const empty = faqs.length === 0 && articles.length === 0;

  return (
    <div className="help-center">
      {failed && (
        // A load failure is persistent state, so it stays in the flow rather
        // than becoming a toast that scrolls away (root CLAUDE.md).
        <p className="tds-alert tds-alert--warning">
          Die Hilfeinhalte konnten gerade nicht geladen werden. Bitte später erneut
          versuchen.
        </p>
      )}

      {!empty && (
        <div className="tds-toolbar">
          <input
            className="field-boxed"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Frage oder Handbuch suchen …"
            aria-label="Hilfe durchsuchen"
          />
        </div>
      )}

      {empty ? (
        <p className="tds-empty">
          Hier sind noch keine Inhalte hinterlegt. Bei Fragen erreichen Sie uns jederzeit
          über den Support.
        </p>
      ) : (
        <>
          <h2 className="mt-6 mb-3 text-lg font-semibold">Häufige Fragen</h2>
          {groups.length === 0 ? (
            <p className="tds-empty">Keine Frage passt zur Suche.</p>
          ) : (
            groups.map(([category, entries]) => (
              <section key={category} className="mb-5">
                {groups.length > 1 && (
                  <h3 className="mb-2 text-sm font-semibold opacity-70">{category}</h3>
                )}
                <div className="tds-stack">
                  {entries.map((entry) => (
                    <details key={entry.id} id={faqAnchor(entry)} className="tds-card p-4">
                      <summary className="cursor-pointer font-semibold">{entry.question}</summary>
                      {/* Answers are plain text by contract (the widget's renderer
                          splits on newlines and emits text nodes), so they are
                          interpolated per paragraph — never set as HTML. */}
                      <div className="mt-3 flex flex-col gap-2 text-sm opacity-80">
                        {entry.answer.split(/\n{2,}|\n/).map((p, i) =>
                          p.trim() ? <p key={i}>{p.trim()}</p> : null,
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))
          )}

          <h2 className="mt-8 mb-3 text-lg font-semibold">Handbücher</h2>
          {shownArticles.length === 0 ? (
            <p className="tds-empty">Kein Handbuch passt zur Suche.</p>
          ) : (
            <div className="tds-stack">
              {shownArticles.map((article) => (
                <Article key={article.slug} article={article} lang={lang} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One handbook. The body is fetched when it is first opened, not with the list:
 * an article is markdown of arbitrary length, and shipping every one of them to
 * draw a list of headings is the difference between a page that opens and one
 * that stalls.
 */
function Article({ article, lang }: { article: ArticleEntry; lang: "de" | "en" }) {
  const [body, setBody] = useState<ArticleBody | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  const load = async () => {
    if (body !== null || state === "loading") return;
    setState("loading");
    try {
      const res = await frontendFetch(
        `${API_BASE}/help/articles/${encodeURIComponent(article.slug)}?lang=${lang}`,
      );
      if (!res.ok) {
        setState("failed");
        return;
      }
      setBody((await res.json()).article ?? null);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <details
      id={`artikel-${article.slug}`}
      className="tds-card p-4"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer font-semibold">{article.title}</summary>
      <div className="mt-3">
        {state === "loading" && (
          <p role="status">
            <Spinner size="sm" />
          </p>
        )}
        {state === "failed" && (
          <FormAlert message="Dieses Handbuch konnte nicht geladen werden." />
        )}
        {body && (
          // Safe by provenance AND by construction: the text is admin-authored,
          // and renderMarkdown escapes every text run before any markdown
          // transform, so raw HTML in it can only ever render as text.
          <div
            className="tds-prose text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body.body_markdown) }}
          />
        )}
      </div>
    </details>
  );
}
