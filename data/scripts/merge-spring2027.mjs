// Merges the ATLAS sheet (data/sources/atlas-spring2027.json) and the CU class search pull
// (data/sources/2271.json) into data/spring2027.json, one record per section.
// Run: node data/scripts/merge-spring2027.mjs
//
// Sections are matched on course code + section number. A sheet row with a graduate twin
// (ATLS 4040-010 / ATLS 5040-010) becomes two records with the same posted data.
//
// Field rules
//   Sheet wins:  title, category, mode, room, notes, instructor, crossListCode.
//                (If the sheet cell is empty the pull's value is used and instructorFrom/titleFrom says "pull".)
//   Pull wins:   classNumber, dates, type (LEC, REC, ...). Sheet-only sections have these empty.
//   Days/times:  compared as class-search letters (M T W R F) and 24-hour start/end.
//                If they disagree, nothing is picked: days/start/end are null, both sides are kept in
//                daysSheet/daysPull/startSheet/endSheet/startPull/endPull, and conflict is true.
//                The sheet's own 24-hour times are inferred (see parse-atlas-sheet.mjs). timeFlags lists why
//                that could be wrong; timeConfirmedByPull is true when the pull gives the same start and end.
//   source:      "both", "sheet" or "pull".
// The output has no timestamps, so running this twice gives an identical file.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sheet = JSON.parse(readFileSync(here('../sources/atlas-spring2027.json'), 'utf8'));
const pull = JSON.parse(readFileSync(here('../sources/2271.json'), 'utf8'));

// ─── Index both sides by "ATLS 4040-010" ─────────────────────────────────────
const sheetByKey = new Map();
for (const s of sheet.sections) {
  const primary = `${s.courseCode}-${s.section}`;
  const twin = s.crossListCode ? `${s.crossListCode}-${s.crossListSection}` : '';
  sheetByKey.set(primary, { ...s, crossFull: twin });
  if (twin) sheetByKey.set(twin, { ...s, courseCode: s.crossListCode, section: s.crossListSection, crossFull: primary });
}
const pullByKey = new Map(pull.sections.map((p) => [`${p.code}-${p.section}`, p]));

const keys = [...new Set([...sheetByKey.keys(), ...pullByKey.keys()])].sort();
const records = [];

for (const key of keys) {
  const s = sheetByKey.get(key);
  const p = pullByKey.get(key);
  const source = s && p ? 'both' : s ? 'sheet' : 'pull';
  const [courseCode, section] = [key.slice(0, 9), key.slice(10)];

  const rec = {
    key,
    source,
    courseCode,
    section,
    crossListCode: s?.crossFull ?? '',
    title: s?.title || p?.title || '',
    titleFrom: s?.title ? 'sheet' : 'pull',
    category: s?.category ?? '',
    mode: s?.mode ?? '',
    type: p?.type ?? '',
    classNumber: p?.classNumber ?? '',
    instructor: s?.instructor || p?.instructor || '',
    instructorFrom: s?.instructor ? 'sheet' : p?.instructor ? 'pull' : '',
    room: s?.room ?? '',
    notes: s?.notes ?? '',
    dates: p?.dates ?? '',
    online: p ? p.online : s?.mode === 'Remote',
    cancelled: p?.cancelled ?? false,
  };
  if (s && p && s.instructor && p.instructor && s.instructor !== p.instructor) rec.instructorPull = p.instructor;

  // Days and times.
  const sheetTimed = s ? { days: s.daysCode, start: s.start24, end: s.end24 } : null;
  const pullTimed = p ? { days: p.days, start: p.start, end: p.end } : null;
  const conflicts = [];
  if (sheetTimed && pullTimed) {
    if (sheetTimed.days !== pullTimed.days) conflicts.push({ field: 'days', sheet: s.days, pull: p.days });
    if (sheetTimed.start !== pullTimed.start || sheetTimed.end !== pullTimed.end) {
      conflicts.push({ field: 'time', sheet: `${s.time} (${sheetTimed.start}-${sheetTimed.end})`, pull: `${p.meets} (${pullTimed.start}-${pullTimed.end})` });
    }
  }
  rec.conflict = conflicts.length > 0;
  rec.conflicts = conflicts;
  rec.time = s?.time ?? '';
  rec.meets = p?.meets ?? '';
  if (rec.conflict) {
    Object.assign(rec, {
      days: null, start: null, end: null,
      daysSheet: sheetTimed.days, daysPull: pullTimed.days,
      startSheet: sheetTimed.start, endSheet: sheetTimed.end,
      startPull: pullTimed.start, endPull: pullTimed.end,
    });
  } else {
    const t = pullTimed ?? sheetTimed;
    Object.assign(rec, { days: t.days, start: t.start, end: t.end });
  }
  rec.sheetDays = s?.days ?? '';
  rec.timeFlags = s?.timeFlags ?? [];
  rec.timeConfirmedByPull = !!(s && p && s.start24 && s.start24 === p.start && s.end24 === p.end);
  // A sheet time that relied on the AM/PM guess and has nothing from the pull to back it up.
  rec.timeAmbiguous = rec.timeFlags.length > 0 && !rec.timeConfirmedByPull;
  records.push(rec);
}

const count = (f) => records.filter(f).length;
const out = {
  term: 'Spring 2027',
  sources: ['data/sources/atlas-spring2027.json', 'data/sources/2271.json'],
  counts: {
    sections: records.length,
    both: count((r) => r.source === 'both'),
    sheet: count((r) => r.source === 'sheet'),
    pull: count((r) => r.source === 'pull'),
    conflicts: count((r) => r.conflict),
    ambiguousTimes: count((r) => r.timeAmbiguous),
  },
  sections: records,
};
writeFileSync(here('../spring2027.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote data/spring2027.json: ${out.counts.sections} sections (both ${out.counts.both}, sheet only ${out.counts.sheet}, pull only ${out.counts.pull}), ${out.counts.conflicts} conflicts, ${out.counts.ambiguousTimes} unconfirmed ambiguous times.`);
