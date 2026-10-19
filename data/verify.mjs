// Prints a quick summary of courses.json. Run: node data/verify.mjs
import { existsSync, readFileSync } from 'node:fs';
import { defaultConfig, termContext } from '../src/core/config.ts';
import { allCourses, filterCourses, offeredInUpcomingTerms, ranOnlyInPastTerms } from '../src/core/courses.ts';

const file = new URL('./courses.json', import.meta.url);
const courses = JSON.parse(readFileSync(file, 'utf8'));

const termRank = (t) => {
  const [season = '', year = ''] = t.split(' ');
  return (Number(year) || 0) * 10 + (['spring', 'summer', 'fall'].indexOf(season.toLowerCase()) + 1);
};

const perTerm = new Map();
for (const c of courses) for (const t of c.termsOffered ?? []) perTerm.set(t, (perTerm.get(t) ?? 0) + 1);

console.log(`Total courses: ${courses.length}`);
console.log('Courses per term:');
for (const t of [...perTerm.keys()].sort((a, b) => termRank(a) - termRank(b))) console.log(`  ${t}: ${perTerm.get(t)}`);
console.log(`With sectionsByTerm: ${courses.filter((c) => c.sectionsByTerm && Object.keys(c.sectionsByTerm).length).length}`);
console.log(`notOfferedRecently: ${courses.filter((c) => c.notOfferedRecently).length}`);
console.log(`No category: ${courses.filter((c) => !c.category?.trim()).length}`);

// ─── Spring 2027 merge (data/spring2027.json, made by merge-spring2027.mjs) ───
const mergedFile = new URL('./spring2027.json', import.meta.url);
if (existsSync(mergedFile)) {
  const m = JSON.parse(readFileSync(mergedFile, 'utf8')).sections;
  const n = (f) => m.filter(f).length;
  const T = 'Spring 2027';
  const withTerm = courses.filter((c) => c.sectionsByTerm?.[T]?.length);
  const attached = withTerm.reduce((sum, c) => sum + c.sectionsByTerm[T].length, 0);
  console.log('\nSpring 2027 merge:');
  console.log(`  Sections merged: ${m.length}`);
  console.log(`  Source both: ${n((r) => r.source === 'both')}, sheet only: ${n((r) => r.source === 'sheet')}, pull only: ${n((r) => r.source === 'pull')}`);
  console.log(`  Day/time conflicts: ${n((r) => r.conflict)}`);
  console.log(`  Unconfirmed ambiguous times: ${n((r) => r.timeAmbiguous)}`);
  console.log(`  Classes in courses.json with ${T} sections: ${withTerm.length} (${attached} sections)`);
  console.log(`  Sections not attached to a class: ${m.length - attached}`);
  // courses.json must agree with itself: termsOffered, instructorsByTerm and sectionsByTerm for the term
  const problems = [];
  for (const c of courses) {
    const has = c.sectionsByTerm?.[T]?.length > 0;
    if (c.termsOffered.filter((t) => t === T).length > 1) problems.push(`${c.id}: ${T} listed twice in termsOffered`);
    if (has !== c.termsOffered.includes(T)) problems.push(`${c.id}: termsOffered and sectionsByTerm disagree about ${T}`);
    if (has && !c.instructorsByTerm?.[T] && c.sectionsByTerm[T].some((s) => s.instructor)) problems.push(`${c.id}: sections name an instructor but instructorsByTerm has none`);
    if (c.notOfferedRecently && c.termsOffered.length) problems.push(`${c.id}: notOfferedRecently is true but it has terms`);
  }
  const keys = m.map((r) => r.key);
  if (new Set(keys).size !== keys.length) problems.push('data/spring2027.json has duplicate section keys');
  console.log(`  Consistency problems: ${problems.length}`);
  for (const p of problems) console.log(`    ${p}`);
  if (problems.length) process.exitCode = 1;
}

// ─── Term status (src/core/config.ts) ───
{
  const ctx = termContext(defaultConfig);
  const upcoming = offeredInUpcomingTerms(courses, ctx);
  const pastOnly = ranOnlyInPastTerms(courses, ctx);
  const neverRan = courses.filter((c) => !c.termsOffered.length);
  console.log('\nTerm status:');
  for (const [t, st] of Object.entries(defaultConfig.termStatus)) console.log(`  ${t}: ${st}`);
  console.log(`  Offered in upcoming terms: ${upcoming.length} of ${courses.length}`);
  console.log(`  Ran only in past terms: ${pastOnly.length}`);
  console.log(`  No terms at all: ${neverRan.length}`);
  const unknown = [...new Set(courses.flatMap((c) => c.termsOffered))].filter((t) => !(t in defaultConfig.termStatus));
  console.log(`  Terms in the data with no status: ${unknown.length}${unknown.length ? ' (' + unknown.join(', ') + ')' : ''}`);
  if (upcoming.length + pastOnly.length + neverRan.length !== courses.length) { console.log('  Counts do not add up'); process.exitCode = 1; }
  if (unknown.length) process.exitCode = 1;
}

// ─── Extra courses (data/courses-extra.json, made by build-extra-courses.mjs) ───
const extraFile = new URL('./courses-extra.json', import.meta.url);
if (existsSync(extraFile)) {
  const extra = JSON.parse(readFileSync(extraFile, 'utf8'));
  const ctx = termContext(defaultConfig);
  const all = allCourses(courses, extra);
  console.log('\nAll courses (courses.json + courses-extra.json):');
  console.log(`  courses.json: ${courses.length}, courses-extra.json: ${extra.length}`);
  console.log(`  Overall total: ${all.length}`);
  console.log('  Per level:');
  for (const level of ['Core', 'Focus', 'HT', 'CPT', 'Grad', 'Grad/Focus']) console.log(`    ${level}: ${filterCourses(all, { level }, ctx).length}`);
  console.log(`    (no level): ${all.filter((c) => !c.level).length}`);
  console.log(`  Offered in upcoming terms: ${filterCourses(all, { upcoming: true }, ctx).length}`);
  const levelled = ['Core', 'Focus', 'HT', 'CPT', 'Grad', 'Grad/Focus'].reduce((n, level) => n + filterCourses(all, { level }, ctx).length, 0);
  if (levelled + all.filter((c) => !c.level).length !== all.length) { console.log('  Level counts do not add up'); process.exitCode = 1; }
  if (all.length !== courses.length + extra.length) process.exitCode = 1;
  const bad = extra.filter((c) => c.termsOffered.join() !== 'Spring 2027' || !c.sectionsByTerm?.['Spring 2027']?.length);
  console.log(`  Extra records not exactly Spring 2027 with sections: ${bad.length}`);
  if (bad.length) process.exitCode = 1;
}
