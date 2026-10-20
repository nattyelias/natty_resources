// Twin classes: the same class listed twice, once at the 4000 level and once at the 5000 level (ATLS 4040 and ATLS 5040).
// Both records stay in the data. This only finds the pairs and builds the single card the grad list shows. Pure functions.

import { termRank, upcomingTerms } from './terms.ts';
import type { TermContext } from './terms.ts';
import type { CourseData, Section } from './types.ts';

const parseCode = (code: string) => {
  const m = code.match(/^([A-Z]{2,5}) (\d{4})$/);
  return m ? { subject: m[1], number: Number(m[2]) } : null;
};

/** A title with parentheses, "Advanced Special Topics:" style prefixes, punctuation and case taken out, "&" as "and". */
export const normalizeTitle = (title: string) =>
  title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(advanced|adv)\s+((special|critical)\s+)?topics:?/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();

/** The distinct "days|start|end" meeting slots of a class's sections in upcoming terms, sorted. Sections with no time give "||". */
export function meetingSlots(course: CourseData, ctx: TermContext): string[] {
  const slots = new Set<string>();
  for (const term of upcomingTerms(course.termsOffered, ctx)) {
    for (const s of course.sectionsByTerm?.[term] ?? []) slots.add(`${s.days}|${s.start}|${s.end}`);
  }
  return [...slots].sort();
}

// Only courses-extra.json records carry a level (even when it is empty), so that is how the two files are told apart.
const isExtra = (c: CourseData) => c.level !== undefined;

export interface TwinPair<C extends CourseData = CourseData> {
  /** The 4000-level record. */
  lower: C;
  /** The 5000-level record. */
  upper: C;
  /** Which files the two records come from. */
  kind: 'existing+extra' | 'extra+extra' | 'existing+existing';
}
export interface TwinNearMiss<C extends CourseData = CourseData> { lower: C; upper: C; lowerSlots: string[]; upperSlots: string[] }

/**
 * A pair is two records whose codes differ by exactly 1000 (a 4000-level code and the same number at 5000 level, such as
 * ATLS 4040 and ATLS 5040), with the same normalized title and the same meeting days and times in the upcoming terms.
 * A near-miss has the matching codes and title but different meeting times. A record is in at most one pair.
 */
export function findTwins<C extends CourseData>(all: C[], ctx: TermContext): { pairs: TwinPair<C>[]; nearMisses: TwinNearMiss<C>[] } {
  const pairs: TwinPair<C>[] = [];
  const nearMisses: TwinNearMiss<C>[] = [];
  const used = new Set<string>();
  for (const lower of all) {
    const lo = parseCode(lower.code);
    if (!lo || lo.number < 4000 || lo.number >= 5000) continue;
    const upperCode = `${lo.subject} ${lo.number + 1000}`;
    const title = normalizeTitle(lower.title);
    for (const upper of all) {
      if (upper.code !== upperCode || upper.id === lower.id || normalizeTitle(upper.title) !== title) continue;
      const lowerSlots = meetingSlots(lower, ctx), upperSlots = meetingSlots(upper, ctx);
      if (lowerSlots.join(';') !== upperSlots.join(';')) { nearMisses.push({ lower, upper, lowerSlots, upperSlots }); continue; }
      if (used.has(lower.id) || used.has(upper.id)) continue;
      used.add(lower.id); used.add(upper.id);
      const extras = Number(isExtra(lower)) + Number(isExtra(upper));
      pairs.push({ lower, upper, kind: extras === 1 ? 'existing+extra' : extras === 2 ? 'extra+extra' : 'existing+existing' });
    }
  }
  const byCode = (a: { upper: CourseData }, b: { upper: CourseData }) => a.upper.code.localeCompare(b.upper.code, 'en', { numeric: true }) || a.upper.title.localeCompare(b.upper.title);
  return { pairs: pairs.sort(byCode), nearMisses: nearMisses.sort(byCode) };
}

// What a 5000-level record may take from its 4000-level original when it has none of its own: the credits, the description
// and what the card shows (focus area, image, photo, instructor bios). Requirement tags, prerequisites and the like are not borrowed.
const BORROWED = ['credits', 'description', 'category', 'categorySecondary', 'image', 'tools', 'searchKeywords', 'instructors', 'instructor', 'instructorFullName', 'instructorTitle', 'instructorUrl', 'photo', 'photoAlt', 'photoCredit'] as const;
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * The one card for a pair: the 5000-level record, with whatever it lacks from BORROWED taken from the original, and the sections
 * of both with duplicates dropped (a section on both records with the same number, days, times, room and instructor counts once;
 * the 5000-level record's copy is kept). Both source records are left as they are.
 */
export function mergeTwin<C extends CourseData>(pair: { lower: C; upper: C }): C {
  const { lower, upper } = pair;
  const merged: Record<string, unknown> = { ...upper };
  for (const key of BORROWED) {
    const own = merged[key], original = (lower as Record<string, unknown>)[key];
    if (isEmpty(own) && !isEmpty(original)) merged[key] = original;
  }
  // The extra record's two yes/no fields are placeholders with no source (see docs/ARCHITECTURE.md); the original has the real ones.
  if (isExtra(upper) && !isExtra(lower)) { merged.noRequiredPrereqs = lower.noRequiredPrereqs; merged.openToNonMajors = lower.openToNonMajors; }
  merged.termsOffered = [...new Set([...upper.termsOffered, ...lower.termsOffered])].sort((a, b) => termRank(a) - termRank(b));
  merged.instructorsByTerm = { ...lower.instructorsByTerm, ...upper.instructorsByTerm };
  const terms = new Set([...Object.keys(upper.sectionsByTerm ?? {}), ...Object.keys(lower.sectionsByTerm ?? {})]);
  const sectionsByTerm: Record<string, Section[]> = {};
  for (const term of terms) {
    const seen = new Set<string>();
    const out: Section[] = [];
    for (const s of [...(upper.sectionsByTerm?.[term] ?? []), ...(lower.sectionsByTerm?.[term] ?? [])]) {
      const key = [s.section, s.days, s.start, s.end, s.meets, s.instructor, s.room ?? '', s.mode ?? ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    sectionsByTerm[term] = out.sort((a, b) => a.section.localeCompare(b.section));
  }
  merged.sectionsByTerm = sectionsByTerm;
  return merged as C;
}
