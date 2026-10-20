// Schedule conflicts between the classes in a plan. Pure functions; no React.
//
// Two sections overlap when all three hold:
//   - they share a weekday (days is letters M T W R F S U, R is Thursday),
//   - their 24-hour start/end times overlap by at least one minute (back-to-back is not an overlap),
//   - their date ranges overlap (a range is read from "01-07 to 04-23"; a missing or unreadable range is assumed to be the full term).
// A section with no days or no times never overlaps anything.

import type { CourseData, OverlapWindow, PlanConflict, PlanConflicts, PlanItemsLike, Section, SectionOverlap } from './types.ts';

const DAY_ORDER = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];

/** The sections a class has in one term (a copy, so callers can sort it). */
export const sectionsFor = (course: CourseData, term: string): Section[] => [...(course.sectionsByTerm?.[term] ?? [])];

const minutes = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** "01-07 to 04-23" -> { from: "01-07", to: "04-23", a: 107, b: 423 }. null when missing, unreadable, or the end is before the start. */
function readDates(dates: string | undefined) {
  const m = /^(\d{2})-(\d{2}) to (\d{2})-(\d{2})$/.exec((dates ?? '').trim());
  if (!m) return null;
  const a = Number(m[1]) * 100 + Number(m[2]);
  const b = Number(m[3]) * 100 + Number(m[4]);
  return a <= b ? { from: `${m[1]}-${m[2]}`, to: `${m[3]}-${m[4]}`, a, b } : null;
}

/** The overlap of two sections, or null when they don't overlap. */
export function sectionOverlap(a: Section, b: Section): SectionOverlap | null {
  if (!a.days || !b.days) return null;
  const days = DAY_ORDER.filter((d) => a.days.includes(d) && b.days.includes(d)).join('');
  if (!days) return null;
  const [aStart, aEnd, bStart, bEnd] = [minutes(a.start), minutes(a.end), minutes(b.start), minutes(b.end)];
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return null;
  const start = Math.max(aStart, bStart), end = Math.min(aEnd, bEnd);
  if (end - start < 1) return null; // back-to-back (end === start) or apart
  const da = readDates(a.dates), db = readDates(b.dates);
  let from = '', to = '';
  if (da && db) {
    if (da.a > db.b || db.a > da.b) return null; // the date ranges never meet (first 7 weeks vs second 7 weeks)
    const lo = da.a >= db.a ? da : db, hi = da.b <= db.b ? da : db;
    from = lo.from; to = hi.to;
  } else if (da || db) {
    const known = (da ?? db)!; // the other one is assumed to run the full term, so the known range is the overlap
    from = known.from; to = known.to;
  }
  return { days, window: { start: hhmm(start), end: hhmm(end), from, to } };
}

/** True when the two sections share a weekday, overlap in time by at least a minute, and overlap in dates. */
export const sectionsOverlap = (a: Section, b: Section): boolean => sectionOverlap(a, b) !== null;

const hasTimes = (s: Section) => !!s.days && !Number.isNaN(minutes(s.start)) && !Number.isNaN(minutes(s.end));

/**
 * Every overlap between two DIFFERENT first-choice classes in the plan, for one term. Sections of the same class are never compared
 * and backups are ignored. `untimed` lists the first-choice classes with no posted times (they can't be checked).
 */
export function planConflicts(plan: PlanItemsLike, allCourses: CourseData[], term: string): PlanConflicts {
  const byId = new Map(allCourses.map((c) => [c.id, c]));
  const firsts: CourseData[] = [];
  for (const item of plan.items) {
    const course = item.role === 'first' ? byId.get(item.id) : undefined;
    if (course && !firsts.includes(course)) firsts.push(course);
  }
  const conflicts: PlanConflict[] = [];
  for (let i = 0; i < firsts.length; i++) {
    for (let j = i + 1; j < firsts.length; j++) {
      const [A, B] = [firsts[i], firsts[j]];
      for (const sa of sectionsFor(A, term)) {
        for (const sb of sectionsFor(B, term)) {
          const o = sectionOverlap(sa, sb);
          if (o) conflicts.push({ classA: A.id, classB: B.id, sectionA: sa.section, sectionB: sb.section, days: o.days, overlapWindow: o.window });
        }
      }
    }
  }
  const untimed = firsts.filter((c) => !sectionsFor(c, term).some(hasTimes)).map((c) => c.id);
  return { conflicts, untimed };
}

/** The overlaps that involve one class, for a badge on its tile. */
export const conflictsForClass = (classId: string, plan: PlanItemsLike, allCourses: CourseData[], term: string): PlanConflict[] =>
  planConflicts(plan, allCourses, term).conflicts.filter((c) => c.classA === classId || c.classB === classId);
