// Plans and saved classes: the data shape, what gets stored on the device, and the
// pure logic (credits, warnings, shareable text). No screens live here.

import { joinSeasons, seasonOf, seasonsOffered } from './terms.ts';

export type PlanRole = 'first' | 'backup';
export interface PlanItem { id: string; role: PlanRole }
export interface Plan { id: string; name: string; /** e.g. "Fall 2027", or "" for no semester */ term: string; items: PlanItem[] }
export interface SavedState { savedIds: string[]; plans: Plan[] }

export const STORAGE_KEY = 'focus-electives:saved';
export const STORAGE_VERSION = 3;

// What a new plan's semester can be. Older plans may still hold a Summer term (or none); they are read and shown as saved.
export const SEASONS = ['Spring', 'Fall'] as const;
export const PLAN_YEARS = [2026, 2027, 2028] as const;
const TERM_PATTERN = /^(Spring|Summer|Fall) \d{4}$/;

// The plan's semester, unless it just repeats the plan's name (e.g. a plan named "Spring 2027").
export const planTermText = (plan: { name: string; term: string }) =>
  plan.term && plan.term.toLowerCase() !== plan.name.trim().toLowerCase() ? plan.term : '';

export const roleLabel = (role: PlanRole) => (role === 'first' ? 'First choice' : 'Backup');

// ─── Reading what was stored ─────────────────────────────────────────────────
// Understands version 3 (this shape) and version 2 (plans held a plain list of class IDs).
// Anything else, or any class ID that no longer exists, is dropped.
// Rule enforced here: every class in a plan is also in Saved.
export function parseSaved(raw: string | null, validIds: Set<string>): { state: SavedState; discard: boolean } {
  const empty: SavedState = { savedIds: [], plans: [] };
  if (!raw) return { state: empty, discard: false };
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: empty, discard: true };
  }
  if (data?.version !== 3 && data?.version !== 2) return { state: empty, discard: true };

  const validId = (id: unknown): id is string => typeof id === 'string' && validIds.has(id);
  const savedIds = new Set<string>((Array.isArray(data.savedIds) ? data.savedIds : []).filter(validId));

  const rawPlans: any[] = Array.isArray(data.version === 3 ? data.plans : data.packages) ? (data.version === 3 ? data.plans : data.packages) : [];
  const plans: Plan[] = [];
  for (const p of rawPlans) {
    if (typeof p?.id !== 'string' || typeof p?.name !== 'string') continue;
    const seen = new Set<string>();
    const items: PlanItem[] = [];
    const entries: any[] = data.version === 3 ? (Array.isArray(p.items) ? p.items : []) : (Array.isArray(p.courseIds) ? p.courseIds.map((id: unknown) => ({ id, role: 'first' })) : []);
    for (const entry of entries) {
      if (!validId(entry?.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      items.push({ id: entry.id, role: entry.role === 'backup' ? 'backup' : 'first' });
      savedIds.add(entry.id);
    }
    plans.push({ id: p.id, name: p.name, term: typeof p.term === 'string' && TERM_PATTERN.test(p.term) ? p.term : '', items });
  }
  return { state: { savedIds: [...savedIds], plans }, discard: false };
}

export const serializeSaved = (savedIds: Iterable<string>, plans: Plan[]) =>
  JSON.stringify({ version: STORAGE_VERSION, savedIds: [...savedIds], plans });

// ─── Credits ─────────────────────────────────────────────────────────────────
// Credits are text like "3", "1-3" or "1-4". A range counts as its lowest and highest.
export function creditRange(credits: string): { min: number; max: number } | null {
  const match = credits.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function totalCredits(creditStrings: string[]) {
  let min = 0;
  let max = 0;
  let unknown = 0;
  for (const c of creditStrings) {
    const range = creditRange(c);
    if (!range) { unknown++; continue; }
    min += range.min;
    max += range.max;
  }
  return { min, max, unknown };
}

const num = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 10) / 10);

export function creditsText(creditStrings: string[]) {
  const { min, max, unknown } = totalCredits(creditStrings);
  const base = min === max ? `${num(min)} ${min === 1 ? 'credit' : 'credits'}` : `${num(min)}–${num(max)} credits`;
  return unknown ? `${base} (plus ${unknown} with credits to confirm)` : base;
}

// How one class's credits read on a plan row: "3 credits", "1–3 credits", "1 credit each".
export function creditsLabel(credits: string) {
  const each = credits.trim().match(/^(\d+(?:\.\d+)?)\s+each$/i);
  if (each) return `${each[1]} ${each[1] === '1' ? 'credit' : 'credits'} each`;
  return creditRange(credits) ? creditsText([credits]) : credits;
}

// ─── Warnings under a class in a plan ────────────────────────────────────────
export interface WarnInput {
  prereqRequired: string;
  prereqRecommended: string;
  consentRequired: string;
  extraCost: string;
  needsAdvisor: boolean;
  termsOffered: string[];
}

const isNone = (v: string) => v === '' || /^(none|no)\b/i.test(v);

export function planWarnings(course: WarnInput, planTerm: string): string[] {
  const warnings: string[] = [];
  if (!isNone(course.prereqRequired)) warnings.push(`Prerequisite: ${course.prereqRequired}`);
  if (course.prereqRecommended) warnings.push(`Recommended first: ${course.prereqRecommended}`);
  if (!isNone(course.consentRequired)) warnings.push(`Consent required: ${course.consentRequired}`);
  if (!isNone(course.extraCost)) warnings.push(`Extra cost: ${course.extraCost}`);
  if (course.needsAdvisor) warnings.push('Check with your academic advisor. Sources disagree on this class.');
  // a plan with no term, or an old Summer term, has no season to check against
  if ((seasonOf(planTerm) === 'spring' || seasonOf(planTerm) === 'fall') && course.termsOffered.length) {
    const seasons = seasonsOffered(course.termsOffered);
    if (!seasons.includes(seasonOf(planTerm))) warnings.push(`Usually runs in ${joinSeasons(seasons)}`);
  }
  return warnings;
}

// ─── Text version of a plan (copy / share) ───────────────────────────────────
export interface ExportItem { title: string; code: string; credits: string; prerequisites: string; searchUrl: string; classNumber: string; availability: string; advisorNote: string }
export interface ExportAdvisor { url: string }

// `flat` is for the All saved list: one plain list with no first choice or backup split.
export function planAsText(plan: { name: string; term: string }, first: ExportItem[], backup: ExportItem[], advisor?: ExportAdvisor, opts: { flat?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(plan.term && !plan.name.includes(plan.term) ? `${plan.name} (${plan.term})` : plan.name);
  lines.push(`${opts.flat ? 'Total' : 'Total for first choices'}: ${creditsText(first.map(i => i.credits))}`);
  const section = (heading: string, items: ExportItem[]) => {
    lines.push('', heading.toUpperCase());
    if (!items.length) { lines.push('None yet'); return; }
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} (${item.code}), ${creditsLabel(item.credits)}`);
      if (item.availability) lines.push(`   Availability: ${item.availability}`);
      if (item.advisorNote) lines.push(`   ${item.advisorNote}`);
      if (item.classNumber) lines.push(`   Class number: ${item.classNumber}`);
      lines.push(`   Prerequisites: ${item.prerequisites || 'No prerequisites'}`);
      lines.push(`   Class search: ${item.searchUrl}`);
    });
  };
  section(opts.flat ? 'Saved classes' : 'First choices', first);
  if (!opts.flat) section('Backups', backup);
  if (advisor?.url) lines.push('', `Not sure if a class counts or will run? Book time with an advisor: ${advisor.url}`);
  return lines.join('\n');
}
