// Everything about terms is worked out from a class's list of terms, e.g. ["Spring 2026", "Fall 2026"].
// Terms are listed oldest to newest by the data script.

const SEASON_ORDER = ['spring', 'summer', 'fall'];

export const seasonOf = (term: string) => term.split(' ')[0].toLowerCase();

// "Fall 2026" -> a number that sorts terms in time order (year first, then spring, summer, fall).
export const termRank = (term: string) => {
  const [season = '', year = ''] = term.split(' ');
  return (Number(year) || 0) * 10 + (SEASON_ORDER.indexOf(season.toLowerCase()) + 1);
};

export const lastOffered = (termsOffered: string[]) => termsOffered[termsOffered.length - 1] ?? '';

// The seasons a class has run in, in calendar order, e.g. ["spring", "fall"].
export const seasonsOffered = (termsOffered: string[]) =>
  SEASON_ORDER.filter(season => termsOffered.some(term => seasonOf(term) === season));

// ["spring", "fall"] -> "spring and fall"
export const joinSeasons = (seasons: string[]) =>
  seasons.length <= 1 ? (seasons[0] ?? '') : `${seasons.slice(0, -1).join(', ')} and ${seasons[seasons.length - 1]}`;

export function typicalPattern(termsOffered: string[]) {
  const seasons = seasonsOffered(termsOffered);
  return seasons.length ? `Runs in ${joinSeasons(seasons)}` : '';
}

// ─── Availability ────────────────────────────────────────────────────────────
// ─── Term status ─────────────────────────────────────────────────────────────
// "upcoming" terms are open for planning: what a student can still take. "past" terms are history
// (including a term that is still running but no longer open for planning). History still feeds the
// season check in plans.ts through seasonsOffered, which looks at every term. A term missing from
// the map is not treated as upcoming.
export type TermStatus = 'past' | 'upcoming';
export type TermStatusMap = Record<string, TermStatus>;

export const isUpcoming = (term: string, ctx: TermContext) => ctx.termStatus[term] === 'upcoming';

/** The terms a student can still take this class in, oldest to newest. */
export const upcomingTerms = (termsOffered: string[], ctx: TermContext) => termsOffered.filter((t) => isUpcoming(t, ctx));

/** True when the class has no upcoming term. Past terms (and the stored notOfferedRecently flag) don't count. */
export const notOfferedRecently = (course: { termsOffered: string[] }, ctx: TermContext) =>
  upcomingTerms(course.termsOffered, ctx).length === 0;

// ─── Availability ────────────────────────────────────────────────────────────
// One place decides what a class says about when it runs, so cards, class pages and the home
// page notice always agree. `short` fits a card; `full` is the class page line. Only upcoming
// terms are mentioned: past terms are hidden here.
export interface TermContext { currentTermName: string; nextTermName: string; nextTermPosted: boolean; termStatus: TermStatusMap }
export interface Availability { kind: 'next' | 'none'; short: string; full: string }

export function availability(course: { termsOffered: string[] }, ctx: TermContext): Availability {
  const upcoming = upcomingTerms(course.termsOffered, ctx);
  if (!upcoming.length) return { kind: 'none', short: 'Not offered recently', full: 'Not offered recently' };
  const line = `Offered ${upcoming.join(', ')}`;
  return { kind: 'next', short: line, full: line };
}

// Shown on the home page and next to the class search link while the next term has no class search code.
export const nextTermNote = (ctx: TermContext) =>
  ctx.nextTermPosted ? '' : `${ctx.nextTermName} isn't posted yet. Check CU class search once it is.`;

// The line under the class search button. The search shows one term only (CU's default, which is
// the current term while the next one isn't posted), so a class that isn't running in that term
// finds 0 courses. Classes running in the searched term need no explanation.
export function searchTermNote(a: Availability, ctx: TermContext): string {
  if (ctx.nextTermPosted) {
    return a.kind === 'next' ? '' : `Search shows ${ctx.nextTermName} only. If it finds 0 courses, this class isn't scheduled for ${ctx.nextTermName}.`;
  }
  return `Search shows ${ctx.currentTermName} only. If it finds 0 courses, this class isn't scheduled this term, and ${ctx.nextTermName} isn't posted yet.`;
}
