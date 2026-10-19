// Builds data/courses-extra.json (and docs/extra-courses.md): one class record for each group of
// Spring 2027 sections that did not attach to a class in data/courses.json.
// Run: node data/scripts/build-extra-courses.mjs
//
// Grouping: by course code. For ATLS 3519, 4519, 4539 and 5519 (special-topics codes that hold many
// different classes) also by normalized title. Titles are the sheet's, minus tags such as "(Lec)",
// "(Rec)", "(Lab)" and "(1cr - 1st 7 weeks)".
//
// Nothing is invented. Filled from the merged data: id, code, title, termsOffered, instructorsByTerm,
// sectionsByTerm, crossListings, level, and credits (only when every section title that gives credits
// agrees, e.g. "(1cr - ...)" gives "1"). Left empty: description, prerequisites, focus area (category),
// instructor bio fields, format, session length, extra cost, consent, tools, keywords and so on.
// The two yes/no fields have no source, so they are false. specialTopic follows the code (3519, 4519,
// 5519), as in courses.json. courses.json is read only.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { displayName, findClass, norm, toSection } from './lib/match-spring2027.mjs';

const TERM = 'Spring 2027';
const TITLE_GROUPED = new Set(['ATLS 3519', 'ATLS 4519', 'ATLS 4539', 'ATLS 5519']);
const SPECIAL_TOPIC = new Set(['ATLS 3519', 'ATLS 4519', 'ATLS 5519']);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));

const courses = read('../courses.json');
const merged = read('../spring2027.json').sections;

const CREDIT_TAG = /\(\s*(\d+(?:\.\d+)?)\s*cr\b[^)]*\)/i;
const TAGS = /\s*\(\s*(?:lec|rec|lab|sem)\s*\)\s*$|\s*\(\s*\d+(?:\.\d+)?\s*cr\b[^)]*\)\s*/gi;
const cleanTitle = (t) => t.replace(TAGS, ' ').replace(/\s+/g, ' ').trim();
const slug = (t) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ─── Group the sections that did not attach ──────────────────────────────────
const unattached = merged.filter((r) => !r.cancelled && !findClass(r, courses).course);
const groups = new Map();
for (const r of unattached) {
  const key = TITLE_GROUPED.has(r.courseCode) ? `${r.courseCode}|${norm(cleanTitle(r.title))}` : r.courseCode;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
}

const mostCommon = (arr) => {
  const n = new Map();
  for (const x of arr) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
};

const taken = new Set(courses.map((c) => c.id));
const extra = [];
const notes = []; // per record: what is empty beyond the usual, and anything worth a look
for (const [, recs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const code = recs[0].courseCode;
  const sheetTitles = recs.filter((r) => r.titleFrom === 'sheet').map((r) => cleanTitle(r.title));
  const title = mostCommon(sheetTitles.length ? sheetTitles : recs.map((r) => cleanTitle(r.title)));

  // credits: only from "(1cr - ...)" tags, and only if they all agree
  const credits = [...new Set(recs.map((r) => r.title.match(CREDIT_TAG)?.[1]).filter(Boolean))];
  const creditsValue = credits.length === 1 ? credits[0] : '';

  const levels = [...new Set(recs.map((r) => r.category).filter(Boolean))];
  const level = levels.length === 1 ? levels[0] : '';

  const crossListings = [...new Set(recs.map((r) => r.crossListCode.slice(0, 9)).filter(Boolean))].sort().join(', ');

  const sections = recs.map(toSection).sort((a, b) => a.section.localeCompare(b.section));
  const names = [];
  for (const s of sections) for (const n of s.instructor.split(', ').filter(Boolean)) if (!names.includes(n)) names.push(n);
  const instructors = names.join(', ');

  let id = `${slug(code)}-${slug(title)}`;
  if (!slug(title)) id = slug(code);
  if (taken.has(id)) throw new Error(`Duplicate id ${id}`);
  taken.add(id);

  extra.push({
    id,
    code,
    specialTopic: SPECIAL_TOPIC.has(code),
    title,
    credits: creditsValue,
    category: '',
    countsToward: '',
    termsOffered: [TERM],
    notOfferedRecently: false,
    instructors: [],
    advisorConfirmation: null,
    instructorsByTerm: instructors ? { [TERM]: instructors } : {},
    instructor: '',
    instructorTitle: '',
    instructorUrl: '',
    description: '',
    tools: [],
    image: '',
    categorySecondary: '',
    classNumber: '',
    instructorFullName: '',
    crossListings,
    sessionLength: '',
    format: '',
    extraCost: '',
    consentRequired: '',
    unlocks: '',
    searchKeywords: '',
    prereqRequired: '',
    prereqRecommended: '',
    noRequiredPrereqs: false,
    restriction: '',
    openToNonMajors: false,
    sectionsByTerm: { [TERM]: sections },
    level,
  });

  const also = [];
  if (!creditsValue) also.push(credits.length > 1 ? `credits (titles disagree: ${credits.join(', ')})` : 'credits (no "cr" tag in the title)');
  if (!level) also.push(levels.length > 1 ? `level (sections disagree: ${levels.join(', ')})` : 'level (no sheet category; pull only)');
  if (!crossListings) also.push('crossListings (none on the sheet)');
  if (!instructors) also.push('instructorsByTerm (no instructor posted)');
  notes.push({ id, code, title, level, sections: sections.length, sectionNumbers: sections.map((s) => s.section), credits: creditsValue, crossListings, instructors, sources: [...new Set(recs.map((r) => r.source))].join('/'), also });
}

writeFileSync(here('../courses-extra.json'), JSON.stringify(extra, null, 2) + '\n');

// ─── docs/extra-courses.md ───────────────────────────────────────────────────
const L = [];
L.push('# Extra course records', '');
L.push(`Generated by \`data/scripts/build-extra-courses.mjs\` into \`data/courses-extra.json\`. ${extra.length} records, one for each group of Spring 2027 sections that did not attach to a class in \`data/courses.json\` (${unattached.length} sections). \`courses.json\` is not changed.`, '');
L.push('## What is filled and what is empty', '');
L.push('Filled from the merged sheet + class search data: `id`, `code`, `title`, `termsOffered` (Spring 2027 only), `instructorsByTerm`, `sectionsByTerm`, `crossListings`, `level`, and `credits` when the title has a "(1cr - ...)" tag.', '');
L.push('Always empty on every record: `description`, `category` and `categorySecondary` (focus areas), `countsToward`, `prereqRequired`, `prereqRecommended`, `restriction`, `consentRequired`, `extraCost`, `format`, `sessionLength`, `unlocks`, `searchKeywords`, `tools`, `image`, `classNumber`, `instructor`, `instructorFullName`, `instructorTitle`, `instructorUrl`, `instructors`, `advisorConfirmation` (null). `noRequiredPrereqs` and `openToNonMajors` are `false` because nothing says otherwise. A record is not a statement that a class has no prerequisites.', '');
L.push('Rules: groups are by course code, and also by normalized title for ATLS 3519, 4519, 4539 and 5519. Titles drop "(Lec)", "(Rec)", "(Lab)" and credit tags. `specialTopic` is true for codes 3519, 4519 and 5519. Instructors are written "F. Last". `level` is the sheet category and is empty for sections found only in the class search pull. The classes already in courses.json keep no `level`, and their cross-listings are not updated with the new graduate twins.', '');
L.push('## Records', '');
L.push('| id | code | title | level | sections | credits | cross-listed | instructors | also empty |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const n of notes) {
  const secs = n.sectionNumbers.length > 4 ? `${n.sections} (${n.sectionNumbers[0]} to ${n.sectionNumbers[n.sectionNumbers.length - 1]})` : `${n.sections} (${n.sectionNumbers.join(', ')})`;
  L.push(`| ${n.id} | ${n.code} | ${n.title} | ${n.level || '(empty)'} | ${secs} | ${n.credits || '(empty)'} | ${n.crossListings || '(empty)'} | ${n.instructors || '(empty)'} | ${n.also.join('; ') || 'none'} |`);
}
writeFileSync(here('../../docs/extra-courses.md'), L.join('\n') + '\n');

const byLevel = {};
for (const e of extra) byLevel[e.level || '(none)'] = (byLevel[e.level || '(none)'] ?? 0) + 1;
console.log(`${unattached.length} unattached sections -> ${extra.length} records in data/courses-extra.json`);
console.log('By level:', byLevel);
