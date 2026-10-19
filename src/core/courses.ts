// Course lists worked out from terms. Pure functions: the config arrives as an argument.

import { upcomingTerms } from './terms.ts';
import type { TermContext } from './terms.ts';
import type { CourseData, Level, ViewMode } from './types.ts';

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

// ─── Graduate view ───────────────────────────────────────────────────────────
// Worked out from the data, never labelled by hand. A class is a graduate option when its level is
// Grad or Grad/Focus, or when its own code, or any cross-list code on its sections in an upcoming
// term, has a course number of 5000 or higher.
//   "5000-level twin": the class is cross-listed across the 5000 line (one code under 5000 and one at
//                      5000 or above), e.g. ATLS 4040 and ATLS 5040. Both sides of the pair count.
//   "grad-only":       it qualifies with no undergraduate counterpart.
export type GradReason = 'grad-only' | '5000-level twin';
export interface GradCourse<C extends CourseData = CourseData> { course: C; reason: GradReason }

const GRAD_LEVELS = ['Grad', 'Grad/Focus'];
const courseNumber = (code: string) => {
  const m = code.match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
};

/** The class's own code plus every cross-list code on its sections in an upcoming term, as { code, number }. */
function upcomingCodes(course: CourseData, ctx: TermContext) {
  const codes = [course.code];
  for (const term of upcomingTerms(course.termsOffered, ctx)) {
    for (const s of course.sectionsByTerm?.[term] ?? []) if (s.crossListCode) codes.push(s.crossListCode);
  }
  const out: { code: string; number: number }[] = [];
  for (const raw of codes) {
    const m = raw.match(/^([A-Z]{2,5}) (\d{4})/); // "ATLS 5040-010" -> ATLS 5040
    const number = courseNumber(raw);
    if (m && number !== null && !out.some((c) => c.code === `${m[1]} ${m[2]}`)) out.push({ code: `${m[1]} ${m[2]}`, number });
  }
  return out;
}

/** Why this class counts as a graduate option, or null if it doesn't. Ignores whether it is offered. */
export function gradReason(course: CourseData, ctx: TermContext): GradReason | null {
  const numbers = upcomingCodes(course, ctx).map((c) => c.number);
  const hasGrad = numbers.some((n) => n >= 5000);
  const hasUnder = numbers.some((n) => n < 5000);
  if (hasGrad && hasUnder) return '5000-level twin';
  if (hasGrad || (course.level !== undefined && GRAD_LEVELS.includes(course.level))) return 'grad-only';
  return null;
}

/** Classes a graduate student can take in an upcoming term, each with the reason it qualifies. */
export function gradCourses<C extends CourseData>(all: C[], ctx: TermContext): GradCourse<C>[] {
  const out: GradCourse<C>[] = [];
  for (const course of all) {
    if (!upcomingTerms(course.termsOffered, ctx).length) continue;
    const reason = gradReason(course, ctx);
    if (reason) out.push({ course, reason });
  }
  return out;
}

/** False for independent study and dissertation classes: a UI should not list their instructors. */
export const showInstructors = (course: CourseData) => !course.independentStudy;

// ─── View modes ──────────────────────────────────────────────────────────────
// What the app lists in each mode, worked out from the data. A class can appear in both modes, and
// a twin pair (ATLS 4040 and ATLS 5040) is two records that both appear in both modes, one display
// code each way. Nothing here removes the duplicate; callers can group by displayCode.
export interface ModeCourse<C extends CourseData = CourseData> {
  course: C;
  /** The code to show in this mode. */
  displayCode: string;
  /** Why it is a graduate option (grad mode only). */
  reason?: GradReason;
}

/**
 * grad:      exactly gradCourses(); displayCode is the 5000-level code when the class has one (its own, else a
 *            cross-list code on its upcoming-term sections), otherwise its own code.
 * undergrad: every class offered in an upcoming term whose own code is under 5000, plus any class with an
 *            under-5000 cross-list code on its upcoming-term sections; displayCode is the under-5000 code
 *            (its own, else the cross-list one).
 */
export function coursesForMode<C extends CourseData>(all: C[], mode: ViewMode, ctx: TermContext): ModeCourse<C>[] {
  if (mode === 'grad') {
    return gradCourses(all, ctx).map(({ course, reason }) => {
      const codes = upcomingCodes(course, ctx);
      const own = codes.find((c) => c.code === course.code);
      const displayCode = own && own.number >= 5000 ? own.code : (codes.find((c) => c.number >= 5000)?.code ?? course.code);
      return { course, displayCode, reason };
    });
  }
  const out: ModeCourse<C>[] = [];
  for (const course of all) {
    if (!upcomingTerms(course.termsOffered, ctx).length) continue;
    const codes = upcomingCodes(course, ctx);
    const own = codes.find((c) => c.code === course.code);
    const under = own && own.number < 5000 ? own : codes.find((c) => c.number < 5000);
    if (under) out.push({ course, displayCode: under.code });
  }
  return out;
}
