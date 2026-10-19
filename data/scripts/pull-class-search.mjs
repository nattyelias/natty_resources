// Turns a CU class search "search" response into the section shape courses.json uses.
//
//   npm run data:pull -- --input path/to/search-2271.json          show a diff only (writes nothing)
//   npm run data:pull -- --input path/to/search-2271.json --write  save it, then run `npm run data`
//   npm run data:pull -- --term 2271                               try one live request (see below)
//
// Input is the JSON the class search page itself gets back from its "search" request:
//   POST https://classes.colorado.edu/api/?page=fose&route=search
//   {"other":{"srcdb":"2271"},"criteria":[{"field":"subject","value":"ATLS"}]}
// Only public, unauthenticated data. Nothing here logs in or reads anything personal.
//
// A live request from this script may be refused: on 2026-10-13 the server answered with an AWS WAF bot
// challenge (HTTP 202, empty body). This script does not try to get past that. It stops and says so.
// Save the response from your own browser instead and pass it with --input.
//
// What --write does: saves data-sources/class-search/<srcdb>.json (the normalized sections plus where and when
// they came from). `npm run data` merges those files into courses.json. The spreadsheet stays the fallback and
// the home of everything CU does not publish. Existing course ids are never changed: sections attach to a class
// by its code (and its title, for codes shared by several topics), and anything that does not match is listed,
// not guessed.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coursesPath = path.join(root, 'src/data/courses.json');
const outDir = path.join(root, 'data-sources/class-search');
const semesterPath = path.join(root, 'src/config/semester.ts');
export const ENDPOINT = 'https://classes.colorado.edu/api/?page=fose&route=search';

// ─── Parsing helpers (exported so the round-trip check can reuse them) ───────

const DAY_ORDER = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
const DAY_TOKENS = { M: 'M', Tu: 'T', T: 'T', W: 'W', Th: 'R', F: 'F', Sa: 'S', S: 'S', Su: 'U', U: 'U' };

/** "Spring 2027" for srcdb "2271". Pattern: 2 + two-digit year + season digit (1 spring, 4 summer, 7 fall). */
export function termNameFromSrcdb(srcdb) {
  const m = String(srcdb).match(/^2(\d{2})([147])$/);
  if (!m) return null;
  return `${{ 1: 'Spring', 4: 'Summer', 7: 'Fall' }[m[2]]} ${2000 + Number(m[1])}`;
}

function to24h(hour, minute, meridiem) {
  let h = hour % 12;
  if (meridiem === 'p') h += 12;
  return h * 60 + minute;
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Reads the posted meeting text, e.g. "TTh 2:05-3:55p" or "MW 9a-11:30a".
 * Returns { days, start, end } (days in M T W R F S U order, times 24-hour HH:MM),
 * { days:'', start:'', end:'', online:true } for online text, or null when it can't be read.
 * One meeting pattern only: anything with several (";" or "/") returns null so it is reported, not guessed.
 */
export function parseMeets(raw) {
  const text = String(raw ?? '').trim();
  if (!text || /^no time assigned$/i.test(text)) return { days: '', start: '', end: '', online: false };
  if (/online/i.test(text) && !/\d/.test(text.split(/online/i)[0])) return { days: '', start: '', end: '', online: true };
  const m = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?::(\d{2}))?\s*([ap])?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])$/i);
  if (!m) return null;
  const letters = m[1];
  const days = new Set();
  const tokenRe = /Tu|Th|Sa|Su|M|T|W|F|S|U/g;
  let consumed = 0;
  for (const t of letters.matchAll(tokenRe)) {
    days.add(DAY_TOKENS[t[0]]);
    consumed += t[0].length;
  }
  if (!days.size || consumed !== letters.length) return null;
  const endMer = m[7].toLowerCase();
  const end = to24h(Number(m[5]), Number(m[6] ?? 0), endMer);
  let start;
  if (m[4]) start = to24h(Number(m[2]), Number(m[3] ?? 0), m[4].toLowerCase());
  else {
    start = to24h(Number(m[2]), Number(m[3] ?? 0), endMer);
    if (start >= end) start = to24h(Number(m[2]), Number(m[3] ?? 0), endMer === 'p' ? 'a' : 'p'); // "11-12:15p" starts at 11a
  }
  if (!(start < end)) return null;
  return { days: DAY_ORDER.filter((d) => days.has(d)).join(''), start: hhmm(start), end: hhmm(end), online: false };
}

/** "2027-01-11" / "01/11/2027" / "2027-01-11 00:00:00" -> "01-11". Returns '' when it isn't a date. */
function monthDay(value) {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
// "Advanced Special Topics: Touch Designer" and "TouchDesigner" are the same topic: drop the prefix, ignore spaces.
const topicKey = (s) => norm(String(s ?? '').replace(/^(special|advanced)(\s+special)?\s+topics:\s*/i, '')).replace(/ /g, '');
const truthy = (v) => v === true || v === 1 || /^(1|true|y|yes)$/i.test(String(v ?? ''));

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1] ?? null;
  };
  const inputPath = value('input');
  const write = flag('write');
  const allowDrop = flag('allow-drop');
  let srcdb = value('term');
  const fail = (msg) => {
    console.error(`\nSTOPPED: ${msg}`);
    process.exit(1);
  };

  // 1. Get the response.
  let body;
  let source;
  if (inputPath) {
    if (!existsSync(inputPath)) fail(`No file at ${inputPath}`);
    try {
      body = JSON.parse(readFileSync(inputPath, 'utf8'));
    } catch (e) {
      fail(`${inputPath} is not valid JSON (${e.message})`);
    }
    source = `file:${path.basename(inputPath)}`;
  } else {
    if (!srcdb) {
      const m = readFileSync(semesterPath, 'utf8').match(/classSearchTermCode:\s*'(\d+)'/);
      srcdb = m?.[1] ?? null;
    }
    if (!srcdb) fail('No term. Pass --term 2271 (or set classSearchTermCode in src/config/semester.ts).');
    const subjects = [...new Set(JSON.parse(readFileSync(coursesPath, 'utf8')).map((c) => c.code.split(' ')[0]))];
    if (subjects.length !== 1) fail(`Live pull handles one subject at a time; courses.json has ${subjects.join(', ')}. Use --input.`);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'class-tool personal script (one user, one request per run)' },
      body: JSON.stringify({ other: { srcdb }, criteria: [{ field: 'subject', value: subjects[0] }] }),
    });
    const text = await res.text();
    if (res.headers.get('x-amzn-waf-action') === 'challenge' || res.status === 202 || !text.trim()) {
      fail(
        `CU's server answered with a bot challenge (HTTP ${res.status}, x-amzn-waf-action: ${res.headers.get('x-amzn-waf-action') ?? 'none'}). ` +
          `This script will not try to get past it. Open https://classes.colorado.edu yourself, save the "search" response as JSON, and run:\n` +
          `  npm run data:pull -- --input path/to/search-${srcdb}.json`,
      );
    }
    if (!res.ok) fail(`CU class search answered HTTP ${res.status}. Not retrying.`);
    try {
      body = JSON.parse(text);
    } catch {
      fail('The response was not JSON. Not retrying.');
    }
    source = `${ENDPOINT} (subject ${subjects[0]})`;
  }

  // 2. Shape checks. Bad data is worse than stale data.
  if (!body || !Array.isArray(body.results)) fail('Response has no "results" list. This is not a class search response.');
  srcdb = String(body.srcdb ?? srcdb ?? '');
  const term = termNameFromSrcdb(srcdb);
  if (!term) fail(`Could not read a term from srcdb "${srcdb}". Expected something like 2271.`);
  if (body.results.length === 0) fail('The response has 0 sections. Refusing to treat that as "nothing is offered".');
  const required = ['code', 'crn', 'no', 'schd'];
  const missing = body.results.filter((r) => required.some((k) => !String(r[k] ?? '').trim()));
  if (missing.length) fail(`${missing.length} of ${body.results.length} rows are missing one of ${required.join(', ')}. First: ${JSON.stringify(missing[0]).slice(0, 200)}`);
  if (typeof body.count === 'number' && body.count !== body.results.length) {
    fail(`Response says count ${body.count} but has ${body.results.length} rows. It may be cut off.`);
  }

  // 3. Normalize.
  const courses = JSON.parse(readFileSync(coursesPath, 'utf8'));
  const byCode = new Map();
  for (const c of courses) (byCode.get(c.code) ?? byCode.set(c.code, []).get(c.code)).push(c);
  // A class number the spreadsheet already knows for this term belongs to that class, whatever CU calls it.
  const knownCrn = new Map();
  for (const c of courses) for (const sec of c.sectionsByTerm?.[term] ?? []) knownCrn.set(sec.classNumber, c.id);
  const unparsed = [];
  const unmapped = new Map();
  const cancelled = [];
  const sections = [];
  for (const r of body.results) {
    const code = String(r.code).trim();
    const meets = String(r.meets ?? '').trim();
    const parsed = parseMeets(meets);
    if (!parsed) unparsed.push(`${code} ${r.crn}: "${meets}"`);
    const start = monthDay(r.start_date);
    const end = monthDay(r.end_date);
    // Which class in courses.json does this section belong to?
    const candidates = byCode.get(code) ?? [];
    let courseId = null;
    if (candidates.length === 1) courseId = candidates[0].id;
    else if (candidates.length > 1) {
      const known = knownCrn.get(String(r.crn).trim());
      if (known && candidates.some((c) => c.id === known)) courseId = known;
      else {
        const t = topicKey(r.title);
        const words = (x) => norm(String(x ?? '').replace(/^(special|advanced)(\s+special)?\s+topics:\s*/i, '')).split(' ').filter(Boolean);
        const hits = candidates.filter((c) => {
          if (!t) return false;
          if (t.includes(topicKey(c.title)) || topicKey(c.title).includes(t)) return true;
          const have = new Set(words(c.title));
          return words(r.title).every((w) => have.has(w));
        });
        // "Pedagogy 1" and "Pedagogy 2" both belong to "Pedagogy 1 and 2": one class, so one hit is enough.
        if (hits.length === 1) courseId = hits[0].id;
      }
    }
    const isCancelled = truthy(r.isCancelled) || String(r.stat ?? '').toUpperCase() === 'X';
    if (isCancelled) cancelled.push(`${code} ${r.crn}`);
    if (!courseId && !isCancelled) {
      const k = candidates.length > 1 ? `${code} "${r.title}" (shared code, no title match)` : code;
      unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
    }
    sections.push({
      courseId,
      code,
      classNumber: String(r.crn).trim(),
      title: String(r.title ?? '').trim(),
      section: String(r.no).trim(),
      type: String(r.schd).trim(),
      campus: '', // not in the search response
      days: parsed?.days ?? '',
      start: parsed?.start ?? '',
      end: parsed?.end ?? '',
      meets,
      instructor: String(r.instr ?? '').trim(),
      dates: start && end ? `${start} to ${end}` : '',
      online: parsed?.online ?? /online/i.test(meets),
      variesBySection: false,
      cancelled: isCancelled,
      stat: String(r.stat ?? ''), // raw CU status code, meaning not confirmed
    });
  }
  if (unparsed.length > Math.max(2, Math.floor(sections.length * 0.1))) {
    fail(`${unparsed.length} of ${sections.length} meeting texts could not be read, which is too many to trust. First few:\n  ${unparsed.slice(0, 5).join('\n  ')}`);
  }

  // 4. Compare with what is there now: the last pull for this term if there is one, else courses.json.
  const outFile = path.join(outDir, `${srcdb}.json`);
  const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')).sections : null;
  const baselineLabel = previous ? `the last pull (${path.relative(root, outFile)})` : `courses.json (spreadsheet) sections for ${term}`;
  const baseline = new Map();
  if (previous) for (const s of previous) baseline.set(s.classNumber, s);
  else for (const c of courses) for (const s of c.sectionsByTerm?.[term] ?? []) baseline.set(s.classNumber, { ...s, code: c.code, courseId: c.id });

  const fields = ['section', 'type', 'days', 'start', 'end', 'meets', 'instructor', 'dates', 'cancelled'];
  const added = [];
  const changed = [];
  const nextByCrn = new Map(sections.map((s) => [s.classNumber, s]));
  for (const s of sections) {
    const old = baseline.get(s.classNumber);
    if (!old) added.push(s);
    else {
      const diffs = fields.filter((f) => String(old[f] ?? '') !== String(s[f] ?? '') && !(f === 'cancelled' && !old.cancelled && !s.cancelled));
      if (diffs.length) changed.push({ s, diffs: diffs.map((f) => `${f}: "${old[f] ?? ''}" -> "${s[f]}"`) });
    }
  }
  const dropped = [...baseline.values()].filter((o) => !nextByCrn.has(o.classNumber));

  const mapped = sections.filter((s) => s.courseId && !s.cancelled);
  const coursesNow = new Set(mapped.map((s) => s.courseId));
  const sheetHasTerm = courses.filter((c) => c.termsOffered.includes(term)).map((c) => c.id);
  const sheetOnly = sheetHasTerm.filter((id) => !coursesNow.has(id));

  console.log(`Source: ${source}`);
  console.log(`Term: ${term} (srcdb ${srcdb}). ${sections.length} sections, ${mapped.length} matched to ${coursesNow.size} of ${courses.length} classes in courses.json.`);
  console.log(`Compared with ${baselineLabel}: ${baseline.size} sections there.\n`);
  const list = (title, items, fmt, max = 12) => {
    console.log(`${title}: ${items.length}`);
    for (const i of items.slice(0, max)) console.log(`  ${fmt(i)}`);
    if (items.length > max) console.log(`  ... and ${items.length - max} more`);
  };
  list('New sections', added, (s) => `${s.code} ${s.section} (${s.classNumber}) ${s.type} ${s.meets || 'no time'}${s.courseId ? '' : '  [not matched to a class]'}`);
  list('Changed sections', changed, (c) => `${c.s.code} ${c.s.section} (${c.s.classNumber}): ${c.diffs.join('; ')}`);
  list('Dropped sections', dropped, (o) => `${o.code} ${o.section} (${o.classNumber}) ${o.meets || ''}`);
  list('Cancelled sections', cancelled, (x) => x);
  list('Codes in CU search with no class in courses.json (nothing is added for them)', [...unmapped], ([k, n]) => `${k}: ${n} section${n === 1 ? '' : 's'}`);
  list('Classes the spreadsheet says run this term but CU search does not list', sheetOnly, (id) => id);
  list('Meeting texts that could not be read (kept as posted, no days or times)', unparsed, (x) => x);

  // 5. Sanity check against the baseline before anything is written.
  if (baseline.size >= 10 && sections.length < baseline.size * 0.75 && !allowDrop) {
    fail(`Section count fell from ${baseline.size} to ${sections.length} (more than 25%). That usually means a cut-off or filtered response, not a real change. Check the file, or pass --allow-drop if it is real.`);
  }
  if (coursesNow.size === 0) fail('No section matched any class in courses.json. Wrong subject or term? Nothing written.');

  if (!write) {
    console.log('\nNothing written. Add --write to save this pull.');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify({ srcdb, term, source, fetchedAt: new Date().toISOString(), count: sections.length, sections }, null, 2) + '\n',
  );
  console.log(`\nWrote ${path.relative(root, outFile)}`);

  // The footer's "last checked" date comes from semester.ts, so keep it true.
  // America/Denver calendar date, not UTC (en-CA formats as YYYY-MM-DD).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const sem = readFileSync(semesterPath, 'utf8');
  const next = sem.replace(/(dataLastChecked:\s*')\d{4}-\d{2}-\d{2}(')/, `$1${today}$2`);
  if (next !== sem) {
    writeFileSync(semesterPath, next);
    console.log(`Set dataLastChecked to ${today} in src/config/semester.ts`);
  }
  console.log('Now run: npm run data');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
