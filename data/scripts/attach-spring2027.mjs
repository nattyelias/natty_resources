// Puts the merged Spring 2027 schedule (data/spring2027.json) into data/courses.json.
// Run: node data/scripts/attach-spring2027.mjs            (prints the plan, then writes)
//      node data/scripts/attach-spring2027.mjs --dry-run  (prints the plan only)
//
// Matching: a section belongs to a class when the course code is the same. If the code is shared by
// several classes, or the class is a special-topics number (ATLS 3519, 4519), the section's title must
// also match the class title once normalized (lowercase, no accents, no "(1cr ...)" or "(Lec)" tags, no
// "Advanced Special Topics:" prefix, "&" as "and"). Equal wins; otherwise a title whose words all appear
// in exactly one class title matches (so "Pedagogy 1" and "Pedagogy 2" both match "Pedagogy 1 and 2").
// Anything that does not match exactly one class stays in data/spring2027.json only.
//
// For each class that has matched sections, its "Spring 2027" entries in sectionsByTerm,
// instructorsByTerm and termsOffered are replaced (never added to) from the merged data. Every other
// term, and every other field, is left alone. A class that has Spring 2027 today but gets no merged
// sections is left as it is and reported. Running it twice changes nothing the second time.
//
// Section instructors are written as "F. Last" (the style already in courses.json): the sheet's
// "Rankin, D." becomes "D. Rankin". Several names are joined with ", ".
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { displayName, findClass, termRank, toSection } from './lib/match-spring2027.mjs';

const TERM = 'Spring 2027';
const dryRun = process.argv.includes('--dry-run');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const coursesPath = here('../courses.json');
const courses = JSON.parse(readFileSync(coursesPath, 'utf8'));
const merged = JSON.parse(readFileSync(here('../spring2027.json'), 'utf8')).sections;

// ─── Helpers ─────────────────────────────────────────────────────────────────
// ─── Match ───────────────────────────────────────────────────────────────────
const bySection = new Map(); // course id -> merged records
const unmatched = [];
for (const rec of merged) {
  if (rec.cancelled) continue;
  const m = findClass(rec, courses);
  if (m.course) (bySection.get(m.course.id) ?? bySection.set(m.course.id, []).get(m.course.id)).push(rec);
  else unmatched.push({ rec, reason: m.reason });
}

// ─── Plan ────────────────────────────────────────────────────────────────────
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plan = [];
for (const c of courses) {
  const recs = bySection.get(c.id);
  const before = c.sectionsByTerm?.[TERM] ?? [];
  if (!recs) {
    if (before.length || c.termsOffered.includes(TERM)) plan.push({ c, status: 'untouched', note: `has ${TERM} today but no merged sections; left as is` });
    continue;
  }
  const after = recs.map(toSection).sort((a, b) => a.section.localeCompare(b.section));
  const names = [];
  for (const s of after) for (const n of s.instructor.split(', ').filter(Boolean)) if (!names.includes(n)) names.push(n);
  const instr = names.join(', ');
  const termsAfter = [...new Set([...c.termsOffered.filter((t) => t !== TERM), TERM])].sort((a, b) => termRank(a) - termRank(b));
  const instrBefore = c.instructorsByTerm?.[TERM];
  const hadTerm = c.termsOffered.includes(TERM);

  const bySec = (arr) => new Map(arr.map((s) => [s.section, s]));
  const b = bySec(before), a = bySec(after);
  const added = [...a.keys()].filter((k) => !b.has(k));
  const removed = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k)).map((k) => {
    const fields = new Set([...Object.keys(a.get(k)), ...Object.keys(b.get(k))]);
    const diff = [...fields].filter((f) => !sameJson(a.get(k)[f], b.get(k)[f]));
    return diff.length ? `${k}[${diff.join(',')}]` : null;
  }).filter(Boolean);
  const same = !added.length && !removed.length && !changed.length && hadTerm && instrBefore === instr && sameJson(termsAfter, c.termsOffered);
  plan.push({ c, status: same ? 'unchanged' : before.length ? 'changed' : 'gained', after, instr, instrBefore, termsAfter, added, removed, changed, hadTerm, notOfferedFlag: c.notOfferedRecently });
}

// ─── Print the plan ──────────────────────────────────────────────────────────
console.log(`Plan for ${TERM}${dryRun ? ' (dry run)' : ''}\n`);
for (const p of plan) {
  if (p.status === 'untouched') { console.log(`  [untouched] ${p.c.id}: ${p.note}`); continue; }
  const parts = [];
  if (p.added.length) parts.push(`+${p.added.length} sections (${p.added.join(', ')})`);
  if (p.removed.length) parts.push(`-${p.removed.length} sections (${p.removed.join(', ')})`);
  if (p.changed.length) parts.push(`${p.changed.length} edited: ${p.changed.join(' ')}`);
  if ((p.instrBefore ?? '') !== p.instr) parts.push(`instructor "${p.instrBefore ?? ''}" -> "${p.instr}"`);
  if (!p.hadTerm) parts.push('termsOffered +Spring 2027');
  if (p.notOfferedFlag) parts.push('NOTE notOfferedRecently is true; not changed');
  console.log(`  [${p.status}] ${p.c.id}: ${p.after.length} sections${parts.length ? ' | ' + parts.join(' | ') : ''}`);
}

// ─── Apply ───────────────────────────────────────────────────────────────────
for (const p of plan) {
  if (p.status === 'untouched') continue;
  const c = p.c;
  c.termsOffered = p.termsAfter;
  // Assigning by key keeps every other term, and the order of the keys, exactly as they were.
  (c.sectionsByTerm ??= {})[TERM] = p.after;
  if (p.instr) (c.instructorsByTerm ??= {})[TERM] = p.instr;
}
const text = JSON.stringify(courses, null, 2) + '\n';
const wrote = !dryRun && text !== readFileSync(coursesPath, 'utf8');
if (wrote) writeFileSync(coursesPath, text);

// ─── Counts ──────────────────────────────────────────────────────────────────
const attached = merged.filter((r) => !r.cancelled).length - unmatched.length;
const unmatchedKeys = new Set(unmatched.map(({ rec, reason }) => (reason.startsWith('shared') || reason.startsWith('special') ? `${rec.courseCode} "${rec.title}"` : rec.courseCode)));
const n = (s) => plan.filter((p) => p.status === s).length;
const summary = {
  sectionsMerged: merged.length,
  sourceBoth: merged.filter((r) => r.source === 'both').length,
  sheetOnly: merged.filter((r) => r.source === 'sheet').length,
  pullOnly: merged.filter((r) => r.source === 'pull').length,
  conflicts: merged.filter((r) => r.conflict).length,
  sectionsAttachedToClasses: attached,
  classesGained: n('gained'),
  classesChanged: n('changed'),
  classesUnchanged: n('unchanged'),
  classesWithSpring2027LeftUntouched: n('untouched'),
  unmatchedSections: unmatched.length,
  unmatchedClasses: unmatchedKeys.size,
  coursesJsonWritten: wrote,
};
console.log('\nCounts');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
