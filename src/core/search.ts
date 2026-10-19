// Searching the class list. Pure functions.

import { showInstructors, upcomingInstructors } from './courses.ts';
import type { ModeCourse } from './courses.ts';
import type { TermContext } from './terms.ts';
import { upcomingTerms } from './terms.ts';

/** Lowercase, with accents removed: "Müller" and "muller" are the same. */
export const normalizeText = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The text a list row is searched on: title, display code, own code, instructor (not for independent
 * study classes, whose instructors are never shown), and every cross-list code (the cross-listings field
 * and the cross-list code on each upcoming-term section).
 */
export function searchText(entry: ModeCourse, ctx: TermContext): string {
  const { course, displayCode } = entry;
  const parts = [course.title, displayCode, course.code, course.crossListings];
  if (showInstructors(course)) parts.push(upcomingInstructors(course, ctx));
  for (const term of upcomingTerms(course.termsOffered, ctx)) {
    for (const s of course.sectionsByTerm?.[term] ?? []) if (s.crossListCode) parts.push(s.crossListCode);
  }
  const text = normalizeText(parts.filter(Boolean).join(' '));
  return `${text} ${text.replace(/\s+/g, '')}`; // the second copy lets "atls5040" match
}

/** True when every word of the query appears in the text. An empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}
