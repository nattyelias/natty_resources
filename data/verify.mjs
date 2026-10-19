// Prints a quick summary of courses.json. Run: node data/verify.mjs
import { readFileSync } from 'node:fs';

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
