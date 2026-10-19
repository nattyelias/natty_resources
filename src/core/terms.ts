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
// One place decides what a class says about when it runs, so cards, class pages and the home
// page notice always agree. `short` fits a card; `full` is the class page line.
export interface TermContext { currentTermName: string; nextTermName: string; nextTermPosted: boolean }
export interface Availability { kind: 'now' | 'next' | 'past' | 'none'; short: string; full: string }

export function availability(course: { termsOffered: string[]; notOfferedRecently: boolean }, ctx: TermContext): Availability {
  const { currentTermName: now, nextTermName: next, nextTermPosted } = ctx;
  if (course.notOfferedRecently || !course.termsOffered.length) {
    return { kind: 'none', short: 'Not offered recently', full: 'Not offered recently' };
  }
  if (course.termsOffered.includes(now)) {
    const line = `Running now (${now})`;
    return { kind: 'now', short: line, full: line };
  }
  if (nextTermPosted && course.termsOffered.includes(next)) {
    const line = `Offered ${next}`;
    return { kind: 'next', short: line, full: line };
  }
  const last = `Last offered ${lastOffered(course.termsOffered)}`;
  return { kind: 'past', short: last, full: nextTermPosted ? `${last}. Not listed for ${next}` : `${last}. ${next} isn't posted yet` };
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
  return a.kind === 'now' ? '' : `Search shows ${ctx.currentTermName} only. If it finds 0 courses, this class isn't scheduled this term, and ${ctx.nextTermName} isn't posted yet.`;
}
