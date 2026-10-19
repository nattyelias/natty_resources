// Turns the saved ATLAS Spring 2027 sheet (data/sources/atlas-spring2027-sheet.csv) into
// data/sources/atlas-spring2027.json: one record per posted section.
// Run: node data/scripts/parse-atlas-sheet.mjs
//
// Sheet layout (columns are counted from A; column A is always empty):
//   B  Course-Section   e.g. "ATLS 4040-010". Empty on graduate-only rows.
//   C  Cross-list code  e.g. "ATLS 5040-010", the graduate twin of the B code. On graduate-only rows
//                       it holds the only code, so it becomes the course code and cross-list is empty.
//   D  Title            as posted, including "(Lec)", "(Rec)", "(Lab)" and "(1cr - 1st 7 weeks)" tags
//   E  Category         Core, Focus, HT (how-to), CPT (critical perspectives), Grad, Grad/Focus
//   F  Instruction Mode In Person, Remote, In Person/Online
//   G  Days             Th is Thursday, so TTh is Tuesday + Thursday
//   H  Time             12-hour clock with no AM/PM, e.g. "12:30 - 1:45"
//   I  Instructor       "Last, F." (several are joined in one cell)
//   J  Room
//   K  Notes            has no header; used by one row so far
//
// Only whitespace and capitalization are normalized, and only in mode and category. Titles,
// instructors, rooms, notes and the time text are kept as posted (apart from trimming/collapsing spaces).
//
// AM/PM RULE (the sheet gives no AM/PM, so start24 and end24 are inferred; time text is never changed):
//   Hour 8, 9, 10, 11 is AM. Hour 12 is noon (PM). Hour 1 to 7 is PM.
//   Applied to the start and the end separately. Based on ATLAS classes running about 8:00 to 8:00.
//   Each record gets timeFlags listing every reason the guess could be wrong:
//     crosses-noon     start is AM and end is PM (e.g. "9:30 - 1:20"): the end relies on the rule
//     edge-hour-7      a start or end at hour 7 (could be 7 AM)
//     edge-hour-8      a start or end at hour 8 (could be 8 PM)
//     long-class       longer than 3 hours
//     end-not-after-start  the rule gave an end at or before the start (certainly wrong)
//     unparsed         the time text was not "H:MM - H:MM"
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const inFile = here('../sources/atlas-spring2027-sheet.csv');
const outFile = here('../sources/atlas-spring2027.json');

// ─── CSV (quotes, commas inside quotes, CRLF or LF) ──────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
// "in Person" -> "In Person" (capitalization only; the slash in "In Person/Online" is kept)
const titleCaseWords = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

const CODE = /^([A-Z]{4} \d{4})-(\d{3})$/;
const splitCode = (c) => { const m = c.match(CODE); return m ? { code: m[1], section: m[2] } : null; };

// ─── Days ────────────────────────────────────────────────────────────────────
// Sheet "TTh" -> class-search letters "TR" (M T W R F S U), the same as 2271.json.
function daysCode(days) {
  const map = { M: 'M', T: 'T', W: 'W', Th: 'R', F: 'F', Sa: 'S', Su: 'U' };
  const tokens = days.match(/Th|Sa|Su|M|T|W|F/g) ?? [];
  const letters = tokens.map((t) => map[t]);
  const joined = tokens.join('');
  return joined === days.replace(/\s/g, '') ? ['M', 'T', 'W', 'R', 'F', 'S', 'U'].filter((d) => letters.includes(d)).join('') : '';
}

// ─── Time ────────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const to24 = (h) => (h >= 8 && h <= 11 ? h : h === 12 ? 12 : h + 12); // the AM/PM rule

function parseTime(text) {
  const flags = [];
  const m = text.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return { start24: '', end24: '', flags: text ? ['unparsed'] : [] };
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const s = to24(sh), e = to24(eh);
  const start24 = `${pad(s)}:${pad(sm)}`;
  const end24 = `${pad(e)}:${pad(em)}`;
  if (s < 12 && e >= 12) flags.push('crosses-noon');
  if (sh === 7 || eh === 7) flags.push('edge-hour-7');
  if (sh === 8 || eh === 8) flags.push('edge-hour-8');
  const minutes = e * 60 + em - (s * 60 + sm);
  if (minutes <= 0) flags.push('end-not-after-start');
  if (minutes > 180) flags.push('long-class');
  return { start24, end24, flags };
}

// ─── Read the sheet ──────────────────────────────────────────────────────────
const rows = parseCsv(readFileSync(inFile, 'utf8'));
const counts = { totalRows: rows.length, blank: 0, banner: 0, columnHeader: 0, sectionHeader: 0, note: 0, course: 0 };
const sections = [];
let group = '';
let seenHeader = false;

rows.forEach((r, i) => {
  const [, b, c, d, e, f, g, h, ins, room, notes] = r.map(clean);
  const line = i + 1;
  if (r.every((x) => clean(x) === '')) { counts.blank++; return; }
  if (b === 'Course-Section') { counts.columnHeader++; seenHeader = true; return; }
  const primary = splitCode(b);
  const secondary = splitCode(c);
  if (!primary && !secondary) {
    // text with no course code: a title banner, a section header (only column B filled), or a note
    if (!seenHeader) counts.banner++;
    else if (/^[A-Z][A-Z &-]+$/.test(b) && !c && !d && !e && !f && !g && !h && !ins && !room) { counts.sectionHeader++; group = b; }
    else counts.note++;
    return;
  }
  counts.course++;
  const t = parseTime(h);
  sections.push({
    courseCode: (primary ?? secondary).code,
    section: (primary ?? secondary).section,
    crossListCode: primary && secondary ? secondary.code : '',
    crossListSection: primary && secondary ? secondary.section : '',
    title: d,
    category: e === 'HT' || e === 'CPT' ? e : titleCaseWords(e),
    mode: titleCaseWords(f),
    days: g,
    daysCode: daysCode(g),
    time: h,
    start24: t.start24,
    end24: t.end24,
    timeFlags: t.flags,
    instructor: ins,
    room,
    notes,
    sectionGroup: group,
    sheetLine: line,
  });
});

const flagged = sections.filter((s) => s.timeFlags.length).map((s) => ({
  course: `${s.courseCode}-${s.section}`, time: s.time, start24: s.start24, end24: s.end24, timeFlags: s.timeFlags,
}));

writeFileSync(outFile, JSON.stringify({
  source: 'data/sources/atlas-spring2027-sheet.csv',
  term: 'Spring 2027',
  amPmRule: 'Hour 8-11 is AM, hour 12 is noon (PM), hour 1-7 is PM; applied to start and end separately. See the header of data/scripts/parse-atlas-sheet.mjs.',
  rowCounts: counts,
  count: sections.length,
  sections,
  flaggedTimes: flagged,
}, null, 2) + '\n');

console.log(`Rows: ${counts.totalRows}. Course rows: ${counts.course}. Section headers: ${counts.sectionHeader}. Blank: ${counts.blank}. Column header: ${counts.columnHeader}. Banners: ${counts.banner}. Notes: ${counts.note}.`);
console.log(`Wrote ${sections.length} sections to data/sources/atlas-spring2027.json. ${flagged.length} have a time flag.`);
