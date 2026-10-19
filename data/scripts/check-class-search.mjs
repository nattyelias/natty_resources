// Compares our Spring 2027 data (data/spring2027.json) with a CU class search response.
// Class search is the source of truth. A section missing from it means "not posted yet": it is
// reported as pending and never removed.
//
//   node data/scripts/check-class-search.mjs --input path/to/response.json
//       Compare and report. Writes only data/verification.json and data/checks/<date>.json.
//   node data/scripts/check-class-search.mjs --input path/to/response.json --apply
//       Also update data/spring2027.json, only for fields reported as mismatches, and log what changed
//       to data/checks/applied-<date>.json. Never removes a section.
//   node data/scripts/check-class-search.mjs --fetch [--term 2271]
//       One live request, the same one pull-class-search.mjs makes. Run it yourself; it may be refused
//       with a bot challenge, and this script will not try to get past that.
//
// --input accepts either the raw class search "search" response ({ results: [...] }) or a file already
// normalized by pull-class-search.mjs ({ sections: [...] }, e.g. data/sources/2271.json).
//
// Statuses, one per section:
//   confirmed  in both and every compared field agrees
//   mismatch   in both, a field differs (each one is recorded: class search value and ours)
//   pending    in our data, not in class search yet
//   new        in class search, not in our data
//   cancelled  class search marks it cancelled (the pull script's rule: isCancelled, or stat "X").
//              The response has no confirmed "closed" code, so closed is not detected.
//
// Compared fields: days, start, end, instructor, and room when class search gives one. A field is only
// compared when class search has a value for it; a blank means "not posted", never a mismatch (it is
// listed under skipped). Instructors are compared as "F. Last" names, ignoring case, accents and the
// "A/B" vs "A, B" difference; a missing first initial on either side is not a mismatch.
// Matching is by course code + section. For ATLS 3519, 4519, 4539 and 5519 the titles must also agree
// (ignoring prefixes like "Advanced Special Topics:"); a title with no topic is accepted. If the code and
// section match but the titles clearly differ, the two are treated as different sections.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINT, parseMeets, termNameFromSrcdb } from './pull-class-search.mjs';
import { displayName, findClass } from './lib/match-spring2027.mjs';
import { defaultConfig } from '../../src/core/config.ts';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dataDir = here('../');
const checksDir = path.join(dataDir, 'checks');
const TITLE_CODES = new Set(['ATLS 3519', 'ATLS 4519', 'ATLS 4539', 'ATLS 5519']);
const denverDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
const truthy = (v) => v === true || v === 1 || /^(1|true|y|yes)$/i.test(String(v ?? ''));
const fail = (msg) => { console.error(`\nSTOPPED: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1] ?? null; };
const inputPath = value('input');
const apply = flag('apply');
if (!inputPath && !flag('fetch')) fail('Pass --input <file> (or --fetch to make one live request). See the top of this script.');

// ─── 1. Get the class search response (same checks as pull-class-search.mjs) ──
let body, source;
if (inputPath) {
  if (!existsSync(inputPath)) fail(`No file at ${inputPath}`);
  try { body = JSON.parse(readFileSync(inputPath, 'utf8')); } catch (e) { fail(`${inputPath} is not valid JSON (${e.message})`); }
  source = `file:${path.basename(inputPath)}`;
} else {
  const srcdb = value('term') ?? defaultConfig.classSearchTermCode;
  if (!srcdb) fail('No term. Pass --term 2271.');
  const ours = JSON.parse(readFileSync(path.join(dataDir, 'spring2027.json'), 'utf8')).sections;
  const subjects = [...new Set(ours.map((r) => r.courseCode.split(' ')[0]))];
  if (subjects.length !== 1) fail(`A live fetch handles one subject at a time; the data has ${subjects.join(', ')}. Use --input.`);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'personal checker script (one user, one request per run)' },
    body: JSON.stringify({ other: { srcdb }, criteria: [{ field: 'subject', value: subjects[0] }] }),
  });
  const text = await res.text();
  if (res.headers.get('x-amzn-waf-action') === 'challenge' || res.status === 202 || !text.trim()) {
    fail(`CU's server answered with a bot challenge (HTTP ${res.status}). This script will not try to get past it. Save the "search" response from your own browser and pass it with --input.`);
  }
  if (!res.ok) fail(`CU class search answered HTTP ${res.status}. Not retrying.`);
  try { body = JSON.parse(text); } catch { fail('The response was not JSON. Not retrying.'); }
  source = `${ENDPOINT} (subject ${subjects[0]})`;
}

// ─── 2. Read it into one shape ───────────────────────────────────────────────
let rows;
if (Array.isArray(body?.results)) {
  if (body.results.length === 0) fail('The response has 0 sections. Refusing to treat that as "nothing is posted".');
  if (typeof body.count === 'number' && body.count !== body.results.length) fail(`Response says count ${body.count} but has ${body.results.length} rows. It may be cut off.`);
  const bad = body.results.filter((r) => ['code', 'crn', 'no', 'schd'].some((k) => !String(r[k] ?? '').trim()));
  if (bad.length) fail(`${bad.length} rows are missing code, crn, no or schd. First: ${JSON.stringify(bad[0]).slice(0, 200)}`);
  rows = body.results.map((r) => {
    const parsed = parseMeets(String(r.meets ?? '').trim());
    return {
      code: String(r.code).trim(), section: String(r.no).trim(), classNumber: String(r.crn).trim(), title: String(r.title ?? '').trim(),
      days: parsed?.days ?? '', start: parsed?.start ?? '', end: parsed?.end ?? '', unparsed: !parsed, meets: String(r.meets ?? '').trim(),
      instructor: String(r.instr ?? '').trim(), room: '', // the pull script reads no room from the response, so none is compared here
      cancelled: truthy(r.isCancelled) || String(r.stat ?? '').toUpperCase() === 'X',
    };
  });
} else if (Array.isArray(body?.sections)) {
  if (body.sections.length === 0) fail('The file has 0 sections. Refusing to treat that as "nothing is posted".');
  rows = body.sections.map((s) => ({
    code: s.code, section: s.section, classNumber: s.classNumber ?? '', title: s.title ?? '', days: s.days ?? '', start: s.start ?? '', end: s.end ?? '',
    unparsed: false, meets: s.meets ?? '', instructor: s.instructor ?? '', room: s.room ?? '', cancelled: truthy(s.cancelled) || String(s.stat ?? '').toUpperCase() === 'X',
  }));
} else fail('Neither "results" nor "sections" is a list. This is not a class search response.');

const srcdb = String(body.srcdb ?? value('term') ?? defaultConfig.classSearchTermCode ?? '');
const term = termNameFromSrcdb(srcdb) ?? body.term ?? '';
if (term && term !== 'Spring 2027') fail(`This response is for ${term}, but the data is Spring 2027.`);

const csByKey = new Map();
let duplicateKeys = 0;
for (const r of rows) {
  const k = `${r.code}-${r.section}`;
  if (csByKey.has(k)) { duplicateKeys++; continue; }
  csByKey.set(k, r);
}

// ─── 3. Our data and course ids ──────────────────────────────────────────────
const specPath = path.join(dataDir, 'spring2027.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const classes = [...JSON.parse(readFileSync(path.join(dataDir, 'courses.json'), 'utf8')), ...JSON.parse(readFileSync(path.join(dataDir, 'courses-extra.json'), 'utf8'))];
const courseIdOf = (code, title) => findClass({ courseCode: code, title }, classes).course?.id ?? `code:${code}`;

// ─── Comparison helpers ──────────────────────────────────────────────────────
const strip = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const topicWords = (t) =>
  strip(t).replace(/\([^)]*\)/g, ' ').replace(/^\s*adv(anced)?\s*((special|critical)\s+)?topics\s*:?/, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
function titlesAgree(a, b) {
  const x = topicWords(a), y = topicWords(b);
  if (!x.length || !y.length) return true; // one side names no topic: cannot disagree
  return x.every((w) => y.includes(w)) || y.every((w) => x.includes(w));
}
function parseNames(text) {
  return displayName(String(text ?? '').trim()).split(/[,/]/).map((n) => n.trim()).filter(Boolean).map((n) => {
    const m = n.match(/^([A-Za-z])\.\s*(.+)$/);
    return { initial: m ? strip(m[1]) : null, last: strip(m ? m[2] : n).replace(/[^a-z-]/g, '') };
  });
}
function sameInstructors(a, b) {
  const x = parseNames(a), y = parseNames(b);
  if (x.length !== y.length) return false;
  const left = [...y];
  return x.every((n) => {
    const i = left.findIndex((m) => m.last === n.last && (!m.initial || !n.initial || m.initial === n.initial));
    if (i === -1) return false;
    left.splice(i, 1);
    return true;
  });
}
const sameRoom = (a, b) => strip(a).replace(/\s+/g, ' ').trim() === strip(b).replace(/\s+/g, ' ').trim();

// ─── 4. Compare ──────────────────────────────────────────────────────────────
const date = denverDate();
const results = [];
const matchedCs = new Set();

for (const rec of spec.sections) {
  const cs = csByKey.get(rec.key);
  const entry = { courseId: courseIdOf(rec.courseCode, rec.title), code: rec.courseCode, section: rec.section, key: rec.key, status: '', checkedAt: date, mismatchedFields: [], skipped: [], notes: [] };
  const titleOk = !cs || !TITLE_CODES.has(rec.courseCode) || titlesAgree(rec.title, cs.title);
  if (!cs || !titleOk) {
    entry.status = 'pending';
    if (cs && !titleOk) entry.notes.push(`class search has this code and section with a different title: "${cs.title}" (ours: "${rec.title}")`);
    results.push(entry);
    continue;
  }
  matchedCs.add(rec.key);
  const add = (field, csValue, ourValue) => entry.mismatchedFields.push({ field, classSearch: csValue, ours: ourValue });
  if (cs.unparsed) entry.skipped.push(`days/start/end: class search meeting text not readable ("${cs.meets}")`);
  else if (cs.days || cs.start) {
    if (cs.days !== rec.days) add('days', cs.days, rec.days);
    if (cs.start !== rec.start) add('start', cs.start, rec.start);
    if (cs.end !== rec.end) add('end', cs.end, rec.end);
  } else if (rec.days || rec.start) entry.skipped.push('days/start/end: class search has no meeting time (not posted)');
  if (cs.instructor) { if (!sameInstructors(rec.instructor, cs.instructor)) add('instructor', cs.instructor, rec.instructor); }
  else if (rec.instructor) entry.skipped.push('instructor: class search blank');
  if (cs.room) { if (!sameRoom(rec.room, cs.room)) add('room', cs.room, rec.room); }
  entry.status = cs.cancelled ? 'cancelled' : entry.mismatchedFields.length ? 'mismatch' : 'confirmed';
  results.push(entry);
}
for (const [key, cs] of csByKey) {
  if (matchedCs.has(key)) continue;
  const sameKeyOurs = spec.sections.find((r) => r.key === key);
  results.push({
    courseId: courseIdOf(cs.code, cs.title), code: cs.code, section: cs.section, key, status: cs.cancelled ? 'cancelled' : 'new', checkedAt: date, mismatchedFields: [], skipped: [],
    notes: [sameKeyOurs ? `our data has this code and section with a different title: "${sameKeyOurs.title}" (class search: "${cs.title}")` : 'in class search, not in our data'],
  });
}

const STATUSES = ['confirmed', 'mismatch', 'pending', 'new', 'cancelled'];
const counts = Object.fromEntries(STATUSES.map((s) => [s, results.filter((r) => r.status === s).length]));

// ─── 5. Write the report files ───────────────────────────────────────────────
mkdirSync(checksDir, { recursive: true });
const sections = {};
for (const r of results.sort((a, b) => a.courseId.localeCompare(b.courseId) || a.section.localeCompare(b.section))) {
  (sections[r.courseId] ??= {})[r.section] = { code: r.code, status: r.status, checkedAt: r.checkedAt, mismatchedFields: r.mismatchedFields, skipped: r.skipped, notes: r.notes };
}
const meta = { checkedAt: date, input: source, srcdb, term: term || 'Spring 2027', classSearchSections: rows.length, duplicateClassSearchKeys: duplicateKeys, counts };
writeFileSync(path.join(dataDir, 'verification.json'), JSON.stringify({ meta, sections }, null, 2) + '\n');

// Keep every distinct run: <date>.json, then <date>-2.json and so on. A run identical to one already saved is not saved again.
function saveRun(prefix, content) {
  const text = JSON.stringify(content, null, 2) + '\n';
  for (let n = 1; ; n++) {
    const file = path.join(checksDir, `${prefix}${date}${n === 1 ? '' : `-${n}`}.json`);
    if (!existsSync(file)) { writeFileSync(file, text); return path.relative(dataDir, file); }
    if (readFileSync(file, 'utf8') === text) return `${path.relative(dataDir, file)} (identical run, not saved again)`;
  }
}
const runFile = saveRun('', { meta, mismatches: results.filter((r) => r.mismatchedFields.length).map((r) => ({ key: r.key, courseId: r.courseId, status: r.status, fields: r.mismatchedFields })), sections });

// ─── 6. --apply: only mismatched fields, never remove a section ──────────────
let appliedFile = null;
const changes = [];
if (apply) {
  const FIELDS = new Set(['days', 'start', 'end', 'instructor', 'room']);
  const byKey = new Map(spec.sections.map((r) => [r.key, r]));
  for (const r of results.filter((x) => x.status === 'mismatch')) {
    const rec = byKey.get(r.key);
    for (const m of r.mismatchedFields) {
      if (!FIELDS.has(m.field)) continue;
      changes.push({ key: r.key, field: m.field, from: rec[m.field], to: m.classSearch });
      rec[m.field] = m.classSearch;
    }
  }
  if (changes.length) {
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
    appliedFile = saveRun('applied-', { appliedAt: date, input: source, changes });
  }
}

// ─── 7. Print ────────────────────────────────────────────────────────────────
console.log(`Checked ${spec.sections.length} of our sections against ${rows.length} class search sections (${source}), ${date} (America/Denver).`);
for (const s of STATUSES) console.log(`  ${s}: ${counts[s]}`);
if (duplicateKeys) console.log(`  (${duplicateKeys} duplicate code+section rows in class search ignored)`);
const mism = results.filter((r) => r.mismatchedFields.length);
console.log(`\nMismatches${mism.length ? ` (first ${Math.min(10, mism.length)} of ${mism.length}):` : ': none'}`);
for (const r of mism.slice(0, 10)) console.log(`  ${r.key}: ${r.mismatchedFields.map((m) => `${m.field} ours "${m.ours}" vs class search "${m.classSearch}"`).join('; ')}`);
console.log(`\nWrote data/verification.json and data/${runFile}`);
if (apply) console.log(changes.length ? `Applied ${changes.length} change(s) to data/spring2027.json; logged in data/${appliedFile}. Re-running merge-spring2027.mjs overwrites them, so save this response as a source and merge instead if you want them to last.` : 'Nothing to apply.');
