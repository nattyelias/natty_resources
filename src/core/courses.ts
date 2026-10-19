// Course lists worked out from terms. Pure functions: the config arrives as an argument.

import { upcomingTerms } from './terms.ts';
import type { TermContext } from './terms.ts';
import type { CourseData, Level } from './types.ts';

type HasTerms = { termsOffered: string[] };

/** Classes with at least one upcoming term: what a student can still take. */
export const offeredInUpcomingTerms = <C extends HasTerms>(courses: C[], ctx: TermContext): C[] =>
  courses.filter((c) => upcomingTerms(c.termsOffered, ctx).length > 0);

/** Classes that have run in at least one term, but only in past terms. */
export const ranOnlyInPastTerms = <C extends HasTerms>(courses: C[], ctx: TermContext): C[] =>
  courses.filter((c) => c.termsOffered.length > 0 && upcomingTerms(c.termsOffered, ctx).length === 0);

// ─── All courses ─────────────────────────────────────────────────────────────
// data/courses.json holds the focus electives; data/courses-extra.json holds the other classes found in
// the Spring 2027 schedule. Callers import both files and pass them in.

/** The two course files together. An id that appears in both is a data bug, so it throws. */
export function allCourses(main: CourseData[], extra: CourseData[]): CourseData[] {
  const seen = new Set<string>();
  for (const c of [...main, ...extra]) {
    if (seen.has(c.id)) throw new Error(`Duplicate course id: ${c.id}`);
    seen.add(c.id);
  }
  return [...main, ...extra];
}

export interface CourseFilter {
  /** Keep classes with one of these levels. Classes with no level (all of courses.json today) never match. */
  level?: Level | Level[];
  /** true keeps only classes offered in an upcoming term; false keeps only the rest. Omit for all. */
  upcoming?: boolean;
}

export function filterCourses(courses: CourseData[], filter: CourseFilter, ctx: TermContext): CourseData[] {
  const levels = filter.level === undefined ? null : Array.isArray(filter.level) ? filter.level : [filter.level];
  return courses.filter((c) => {
    if (levels && !(c.level !== undefined && (levels as string[]).includes(c.level))) return false;
    if (filter.upcoming !== undefined && (upcomingTerms(c.termsOffered, ctx).length > 0) !== filter.upcoming) return false;
    return true;
  });
}
