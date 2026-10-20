// Tests for src/core/conflicts.ts. Run: node data/test-conflicts.mjs
// Synthetic cases for every rule, then a real-data plan built from the Spring 2027 sections of ATLS 4040, 4060 and 4201.
// data/verify.mjs imports runConflictTests() to print the pass/fail counts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conflictsForClass, planConflicts, sectionOverlap, sectionsFor, sectionsOverlap } from '../src/core/conflicts.ts';
import { allCourses } from '../src/core/courses.ts';

const TERM = 'Spring 2027';
const sec = (section, days, start, end, dates = '01-07 to 04-23') => ({ classNumber: '', title: '', section, type: '', campus: '', days, start, end, meets: '', instructor: '', dates, online: false, variesBySection: false });
const course = (id, ...sections) => ({ id, code: id, termsOffered: [TERM], sectionsByTerm: { [TERM]: sections } });
const plan = (...items) => ({ items: items.map(([id, role = 'first']) => ({ id, role })) });

export function runConflictTests() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  const run = (p, courses) => planConflicts(p, courses, TERM);

  // ── the six cases you asked for ──
  {
    const A = course('a', sec('001', 'MW', '10:00', '11:15')), B = course('b', sec('001', 'M', '11:00', '12:15'));
    const r = run(plan(['a'], ['b']), [A, B]);
    check('overlapping pair conflicts', r.conflicts.length === 1);
    const c = r.conflicts[0];
    check('overlap reports the shared day and the window', c && c.days === 'M' && c.overlapWindow.start === '11:00' && c.overlapWindow.end === '11:15', JSON.stringify(c));
    check('overlap names both classes and sections', c && c.classA === 'a' && c.classB === 'b' && c.sectionA === '001' && c.sectionB === '001');
  }
  {
    const A = course('a', sec('001', 'TR', '09:00', '10:15')), B = course('b', sec('001', 'TR', '10:15', '11:30'));
    check('back-to-back does not conflict', run(plan(['a'], ['b']), [A, B]).conflicts.length === 0);
    const C = course('c', sec('001', 'TR', '10:14', '11:30'));
    check('one minute of overlap does conflict', run(plan(['a'], ['c']), [A, C]).conflicts.length === 1);
  }
  {
    const A = course('a', sec('001', 'MW', '10:00', '11:15', '01-07 to 02-26')), B = course('b', sec('001', 'MW', '10:00', '11:15', '03-01 to 04-23'));
    check('first 7 weeks vs second 7 weeks at the same time does not conflict', run(plan(['a'], ['b']), [A, B]).conflicts.length === 0);
    const C = course('c', sec('001', 'MW', '10:00', '11:15', '01-07 to 02-26'));
    check('same 7 weeks at the same time does conflict', run(plan(['a'], ['c']), [A, C]).conflicts.length === 1);
    const D = course('d', sec('001', 'MW', '10:00', '11:15', '02-26 to 04-23'));
    const r = run(plan(['a'], ['d']), [A, D]);
    check('ranges that share one day conflict, and the window is that day', r.conflicts.length === 1 && r.conflicts[0].overlapWindow.from === '02-26' && r.conflicts[0].overlapWindow.to === '02-26', JSON.stringify(r.conflicts[0]?.overlapWindow));
  }
  {
    const X = course('x', sec('010', 'M', '10:00', '11:00'), sec('011', 'M', '10:00', '11:00'), sec('012', 'M', '10:00', '11:00'));
    check('two sections of the same class at the same time do not conflict', run(plan(['x']), [X]).conflicts.length === 0);
    const Y = course('y', sec('001', 'T', '10:00', '11:00'));
    check('sections of one class are not compared even beside another class', run(plan(['x'], ['y']), [X, Y]).conflicts.length === 0);
  }
  {
    const A = course('a', sec('001', 'M', '10:00', '11:00')), N = course('n'), O = course('o', { ...sec('001', '', '', ''), online: true });
    const r = run(plan(['a'], ['n'], ['o']), [A, N, O]);
    check('a class with no sections is listed as untimed and never conflicts', r.conflicts.length === 0 && r.untimed.includes('n'), JSON.stringify(r.untimed));
    check('an online section with no days or times is untimed too', r.untimed.includes('o'));
    check('a timed class is not untimed', !r.untimed.includes('a'));
  }
  {
    const A = course('a', sec('001', 'M', '10:00', '11:00')), B = course('b', sec('001', 'M', '10:30', '11:30')), N = course('n');
    const r = run(plan(['a'], ['b', 'backup'], ['n', 'backup']), [A, B, N]);
    check('a backup is ignored (no conflict with it)', r.conflicts.length === 0);
    check('a backup with no times is not listed as untimed', r.untimed.length === 0);
    check('two backups that overlap each other are ignored', run(plan(['b', 'backup'], ['a', 'backup']), [A, B]).conflicts.length === 0);
  }

  // ── the rules in the definition ──
  check('Tuesday and Thursday do not clash (T vs R)', !sectionsOverlap(sec('1', 'T', '10:00', '11:00'), sec('1', 'R', '10:00', '11:00')));
  check('R is Thursday and clashes with R', sectionsOverlap(sec('1', 'R', '10:00', '11:00'), sec('1', 'R', '10:30', '11:30')));
  check('MWF and F share Friday', sectionOverlap(sec('1', 'MWF', '10:00', '11:00'), sec('1', 'F', '10:00', '11:00'))?.days === 'F');
  check('shared days come out in week order', sectionOverlap(sec('1', 'RM', '10:00', '11:00'), sec('1', 'MR', '10:00', '11:00'))?.days === 'MR');
  check('no days means no overlap', !sectionsOverlap(sec('1', '', '10:00', '11:00'), sec('1', 'M', '10:00', '11:00')));
  check('no times means no overlap', !sectionsOverlap(sec('1', 'M', '', ''), sec('1', 'M', '10:00', '11:00')));
  check('missing dates are assumed to be the full term', sectionsOverlap(sec('1', 'M', '10:00', '11:00', ''), sec('1', 'M', '10:00', '11:00', '03-01 to 04-23')));
  check('unreadable dates are assumed to be the full term', sectionsOverlap(sec('1', 'M', '10:00', '11:00', 'TBA'), sec('1', 'M', '10:00', '11:00', '01-07 to 02-26')));
  check('contained times overlap for the shorter one', sectionOverlap(sec('1', 'M', '09:00', '12:00'), sec('1', 'M', '10:00', '11:00'))?.window.start === '10:00');
  check('sectionsFor returns [] for a term the class has no sections in', sectionsFor(course('a', sec('1', 'M', '10:00', '11:00')), 'Fall 2026').length === 0);
  {
    const A = course('a', sec('001', 'M', '10:00', '11:00')), B = course('b', sec('001', 'M', '10:30', '11:30')), C = course('c', sec('001', 'F', '10:00', '11:00'));
    const p = plan(['a'], ['b'], ['c']);
    check('conflictsForClass finds the class in either position', conflictsForClass('a', p, [A, B, C], TERM).length === 1 && conflictsForClass('b', p, [A, B, C], TERM).length === 1);
    check('conflictsForClass is empty for a class with no overlap', conflictsForClass('c', p, [A, B, C], TERM).length === 0);
    check('a class listed twice in a plan is not compared with itself', run(plan(['a'], ['a']), [A]).conflicts.length === 0);
    check('an id that is not in the data is skipped', run(plan(['a'], ['zzz']), [A]).conflicts.length === 0);
  }

  // ── real data ──
  const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
  const all = allCourses(read('./courses.json'), read('./courses-extra.json'));
  const ids = ['atls-4040-game-design', 'atls-4060-tiny-games', 'atls-4201-biodesign'];
  const real = planConflicts(plan(...ids.map((id) => [id])), all, TERM);
  const sectionLines = ids.map((id) => `${id}: ${sectionsFor(all.find((c) => c.id === id), TERM).map((s) => `${s.section} ${s.days} ${s.start}-${s.end}`).join(', ')}`);
  check('real data: all three classes have Spring 2027 times', real.untimed.length === 0, JSON.stringify(real.untimed));
  check('real data: ATLS 4060 section 010 (Monday) overlaps ATLS 4201 (Monday)', real.conflicts.some((c) => c.days === 'M' && [c.classA, c.classB].includes('atls-4060-tiny-games') && [c.classA, c.classB].includes('atls-4201-biodesign')));
  check('real data: ATLS 4040 has no conflict with the other two', conflictsForClass('atls-4040-game-design', plan(...ids.map((id) => [id])), all, TERM).length === 0);

  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results, real: { sectionLines, conflicts: real.conflicts, untimed: real.untimed } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = runConflictTests();
  for (const r of t.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '  -> ' + r.detail}`);
  console.log('\nReal data: Spring 2027 plan of ATLS 4040, 4060 and 4201');
  for (const l of t.real.sectionLines) console.log('  ' + l);
  console.log(`  Overlaps: ${t.real.conflicts.length}`);
  for (const c of t.real.conflicts) console.log(`    ${c.classA} ${c.sectionA} vs ${c.classB} ${c.sectionB}: ${c.days} ${c.overlapWindow.start}-${c.overlapWindow.end}, dates ${c.overlapWindow.from || '(full term)'} to ${c.overlapWindow.to || '(full term)'}`);
  console.log(`  Untimed: ${t.real.untimed.length ? t.real.untimed.join(', ') : 'none'}`);
  console.log(`\n${t.passed} passed, ${t.failed} failed`);
  process.exitCode = t.failed ? 1 : 0;
}
