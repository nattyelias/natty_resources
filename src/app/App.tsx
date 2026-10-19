import { useMemo, useRef, useState } from "react";
import { coursesForMode } from "../core/courses.ts";
import { readMode, writeMode } from "../core/mode.ts";
import { matchesQuery, searchText } from "../core/search.ts";
import type { ViewMode } from "../core/types.ts";
import { CourseRow } from "./CourseRow.tsx";
import { ModeToggle } from "./ModeToggle.tsx";
import { all, ctx, termName } from "./data.ts";

// Storage can be missing or blocked (private windows); the core functions cope with null.
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export default function App() {
  const [mode, setMode] = useState<ViewMode>(() => readMode(storage()));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const choose = (next: ViewMode) => {
    setMode(next);
    writeMode(storage(), next);
  };

  const entries = useMemo(
    () =>
      coursesForMode(all, mode, ctx)
        .map((entry) => ({ entry, text: searchText(entry, ctx) }))
        .sort((a, b) => a.entry.displayCode.localeCompare(b.entry.displayCode, undefined, { numeric: true }) || a.entry.course.title.localeCompare(b.entry.course.title)),
    [mode],
  );
  const shown = entries.filter((e) => matchesQuery(e.text, query));
  const label = mode === "grad" ? "Grad" : "Undergrad";

  return (
    <main className="page">
      <header className="header">
        <h1 className="header-title">Classes</h1>
        <p className="header-term">{termName}</p>
      </header>

      <ModeToggle mode={mode} onChange={choose} />

      <section className="search" aria-label="Search">
        <div className="search-row">
          <input
            ref={searchRef}
            className="search-input"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search classes"
            placeholder="Title, code, instructor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="button" onClick={() => {
                setQuery("");
                searchRef.current?.focus(); // the Clear button is about to disappear; keep keyboard focus in the field
              }}>
              Clear
            </button>
          )}
        </div>
        <p className="count" aria-live="polite">
          {shown.length} {shown.length === 1 ? "class" : "classes"}
        </p>
      </section>

      {shown.length ? (
        <ul className="list">
          {shown.map(({ entry }) => (
            <CourseRow key={entry.course.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="empty">No {label.toLowerCase()} classes match “{query}”. Try fewer words.</p>
      )}
    </main>
  );
}
