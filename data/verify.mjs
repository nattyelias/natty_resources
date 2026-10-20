// Prints a quick summary of courses.json. Run: node data/verify.mjs
import { existsSync, readFileSync } from 'node:fs';
import { defaultConfig, termContext } from '../src/core/config.ts';
import { allCourses, coursesForMode, filterCourses, gradCourses, offeredInUpcomingTerms, ranOnlyInPastTerms } from '../src/core/courses.ts';
import { findTwins } from '../src/core/twins.ts';
import { verificationFor, verificationLabel } from '../src/core/verification.ts';

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

  // Graduate view (gradCourses in src/core/courses.ts)
  const grad = gradCourses(all, ctx);
  const byReason = (r) => grad.filter((g) => g.reason === r).length;
  console.log('\nGraduate view:');
  console.log(`  In the view: ${grad.length} (grad-only ${byReason('grad-only')}, 5000-level twin ${byReason('5000-level twin')})`);
  console.log(`  Left out: ${all.length - grad.length}`);
  console.log(`  Independent study records: ${all.filter((c) => c.independentStudy).length}`);
  if (byReason('grad-only') + byReason('5000-level twin') !== grad.length) process.exitCode = 1;

  // View modes (coursesForMode in src/core/courses.ts)
  const gradMode = coursesForMode(all, 'grad', ctx);
  const underMode = coursesForMode(all, 'undergrad', ctx);
  // a twin pair is one grad card made of two records, so the grad side counts every record behind a card
  const gradIds = new Set(gradMode.flatMap((m) => m.memberIds ?? [m.course.id]));
  const underIds = new Set(underMode.map((m) => m.course.id));
  const bothIds = underMode.filter((m) => gradIds.has(m.course.id));
  const gradOnlyCount = gradMode.filter((m) => !(m.memberIds ?? [m.course.id]).some((id) => underIds.has(id))).length;
  const distinct = (list) => new Set(list.map((m) => m.displayCode)).size;
  console.log('\nView modes:');
  console.log(`  grad: ${gradMode.length} classes (${distinct(gradMode)} distinct display codes)`);
  console.log(`  undergrad: ${underMode.length} classes (${distinct(underMode)} distinct display codes)`);
  console.log(`  In both modes: ${bothIds.length}`);
  console.log(`  Grad only: ${gradOnlyCount}, undergrad only: ${underMode.length - bothIds.length}`);
  // Twin classes (src/core/twins.ts): a 4000-level and a 5000-level record that are the same class. Both records stay in the data.
  const { pairs, nearMisses } = findTwins(all, ctx);
  const kinds = (k) => pairs.filter((p) => p.kind === k).length;
  console.log('\nTwin classes:');
  console.log(`  Pairs: ${pairs.length} (existing+extra ${kinds('existing+extra')}, extra+extra ${kinds('extra+extra')}, existing+existing ${kinds('existing+existing')})`);
  console.log(`  Near-misses (same title, different times): ${nearMisses.length}`);
  console.log(`  Grad list before de-duplication: ${grad.length}, after: ${gradMode.length} (${grad.length - gradMode.length} fewer, one per pair)`);
  if (process.argv.includes('--twins')) {
    for (const p of pairs) console.log(`    ${p.kind.padEnd(15)} ${p.lower.code} + ${p.upper.code}  ${p.lower.title} | ${p.upper.title}`);
    for (const n of nearMisses) console.log(`    NEAR-MISS ${n.lower.code} (${n.lower.id}) vs ${n.upper.code} (${n.upper.id}): ${JSON.stringify(n.lowerSlots)} vs ${JSON.stringify(n.upperSlots)}`);
  }
  // Grad mode is gradCourses() with each pair as one card: every record is listed once, and nothing is dropped.
  const covered = gradMode.flatMap((m) => m.memberIds ?? [m.course.id]);
  if (new Set(covered).size !== covered.length || covered.length !== grad.length || !grad.every((g) => covered.includes(g.course.id))) { console.log('  Grad mode does not cover gradCourses() exactly once'); process.exitCode = 1; }
  if (gradMode.length !== grad.length - pairs.length) { console.log('  Grad count is not (gradCourses minus pairs)'); process.exitCode = 1; }
  if (underMode.some((m) => pairs.some((p) => p.upper.id === m.course.id))) { console.log('  Undergrad lists a 5000-level twin record'); process.exitCode = 1; }
  const wrongGrad = gradMode.filter((m) => !/\b[5-9]\d{3}$/.test(m.displayCode) && !m.course.level?.startsWith('Grad'));
  const wrongUnder = underMode.filter((m) => !/\b[0-4]\d{3}$/.test(m.displayCode));
  console.log(`  Display codes out of range: grad ${wrongGrad.length}, undergrad ${wrongUnder.length}`);
  if (wrongGrad.length || wrongUnder.length) process.exitCode = 1;

  // Verification against CU class search (data/verification.json)
  const vFile = new URL('./verification.json', import.meta.url);
  const vctx = { verification: existsSync(vFile) ? JSON.parse(readFileSync(vFile, 'utf8')) : null };
  const byStatus = { confirmed: 0, mismatch: 0, pending: 0, unchecked: 0 };
  for (const c of all) byStatus[verificationFor(c.id, vctx).status]++;
  console.log(`\nVerification (class level, across all ${all.length} classes)${vctx.verification ? `, last check ${vctx.verification.meta.checkedAt}` : ', no check file'}:`);
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}  (${verificationLabel(s, vctx.verification?.meta.checkedAt)})`);
  if (Object.values(byStatus).reduce((a, b) => a + b, 0) !== all.length) process.exitCode = 1;
  const known = new Set(all.map((c) => c.id));
  const orphans = Object.keys(vctx.verification?.sections ?? {}).filter((id) => !known.has(id));
  console.log(`  Verification entries for no class in the data: ${orphans.length}${orphans.length ? ' (' + orphans.join(', ') + ')' : ''}`);
}
