import readXlsxFile from 'read-excel-file/node';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTerms } from './terms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'src/data/courses.json');

// Default input: the newest focus-electives-data-vN.xlsx in the project folder.
function newestSpreadsheet() {
  const found = readdirSync(root)
    .map((name) => ({ name, version: Number(name.match(/^focus-electives-data-v(\d+)\.xlsx$/)?.[1]) }))
    .filter((f) => Number.isFinite(f.version))
    .sort((a, b) => b.version - a.version);
  if (!found.length) {
    console.error('No focus-electives-data-vN.xlsx found in the project folder. Pass a path: npm run data -- path/to/file.xlsx');
    process.exit(1);
  }
  return path.join(root, found[0].name);
}
const input = path.resolve(process.argv[2] ?? newestSpreadsheet());

const text = (v) => (v == null ? '' : String(v).trim());
const isYes = (v) => text(v).toLowerCase() === 'yes';

// Instructor name (as it appears in the spreadsheet) -> their real ATLAS profile page.
// Checked by hand against https://www.colorado.edu/atlas/jsonapi/node/ucb_person (the data
// behind the People directory), because a plain "firstname-lastname" guess is wrong almost as
// often as it's right: Drupal appends "-0" when a slug collides with an older page, some staff
// go by a nickname the profile doesn't use, and some names combine a maiden and married name in
// an order nothing would guess. Add new instructors here the same way when the spreadsheet gets
// a name this table doesn't recognize; leave a name out entirely if they have no ATLAS profile.
const INSTRUCTOR_URLS = {
  'Aaron Neyer': 'aaron-neyer',
  'Abraham (Abe) Homer': 'abraham-homer',
  'Aidan Chopra': 'aidan-chopra',
  'Annie Margaret': 'annie-margaret',
  'Anthony Pinter': 'anthony-pinter',
  'Brad (Jonathan) Gallagher': 'brad-gallagher-0',
  'Brittney Urich VanHorssen': 'brittney-vanhorssen',
  'Chris Floyd': 'chris-floyd',
  'Danny (Daniel) Rankin': 'danny-rankin-0',
  'Danny Rankin': 'danny-rankin-0',
  'David Schaal': 'david-schaal',
  'Grace Leslie': 'grace-leslie',
  'Greg Greenstreet': 'greg-greenstreet',
  'Joel Swanson': 'joel-swanson',
  'John Bacus': 'john-bacus',
  'John Weiss': 'john-weiss',
  'Jonas Wills': 'jonas-wills',
  'Laura Devendorf': 'laura-devendorf',
  'Mark D. Gross': 'mark-d-gross',
  'Megan Friesth (Leahy)': 'megan-leahy-friesth',
  'Michael Rivera': 'michael-rivera',
  'Mirela Alistar': 'mirela-alistar',
  'Nikolaus Klassen': 'nikolaus-klassen',
  'Ryo Suzuki': 'ryo-suzuki',
  'Sammie Crowder': 'sammie-crowder',
  'Shaz (Sharri) Zamore': 'shaz-zamore',
  'Shaz Zamore': 'shaz-zamore',
  'Sheiva Rezvani': 'sheiva-rezvani',
  'Suzanne Stoller': 'suzanne-stoller',
  'Wayne Seltzer': 'wayne-seltzer',
  'Zack Jacobson-Weaver': 'zack-weaver',
  'Zack Weaver': 'zack-weaver',
  // No ATLAS profile found for: Howard Kramer, Laura Sunberg, Libi Striegl.
  // Not a single person, so no link: "Team-taught" and any comma-joined list of co-instructors.
};
const instructorUrl = (name) => (INSTRUCTOR_URLS[name] ? `https://www.colorado.edu/atlas/${INSTRUCTOR_URLS[name]}` : '');

// A comma-joined list of co-instructors becomes one entry per person, each linked only if we have their
// verified profile. "Team-taught" is not a person, so it gets no entry.
const instructorList = (names) =>
  /^team-taught$/i.test(names.trim()) ? [] : names.split(',').map((n) => n.trim()).filter(Boolean).map((name) => ({ name, url: instructorUrl(name) }));

const sheets = await readXlsxFile(input);
const sheet = sheets.find((s) => s.sheet === 'Electives');
if (!sheet) {
  console.error(`No sheet called "Electives" in ${input}. Found: ${sheets.map((s) => s.sheet).join(', ')}`);
  process.exit(1);
}

const [header, ...rows] = sheet.data;
const col = (row, name) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Column "${name}" not found in the Electives sheet`);
  return row[i];
};

const terms = detectTerms(header);
if (!terms.length) {
  console.error('No term columns found. Add columns like sp26_offered and sp26_instructor (sp = Spring, su = Summer, fa = Fall, then the 2-digit year).');
  process.exit(1);
}
const optional = (row, name) => (header.includes(name) ? text(row[header.indexOf(name)]) : '');

const courses = [];
let keptNotOffered = 0;
let badIds = 0;

for (const row of rows) {
  if (!text(col(row, 'code')) || !text(col(row, 'title'))) continue;

  const termsOffered = terms.filter((t) => isYes(col(row, t.offeredColumn))).map((t) => t.name);
  // Classes that haven't run in any tracked term stay on the site, flagged notOfferedRecently.
  const notOfferedRecently = !termsOffered.length;
  if (notOfferedRecently) keptNotOffered++;
  const instructorsByTerm = {};
  for (const t of terms) {
    const name = optional(row, t.instructorColumn);
    if (termsOffered.includes(t.name) && name && !/^\(?\s*not listed\s*\)?$/i.test(name)) instructorsByTerm[t.name] = name;
  }
  const latestInstructor = [...termsOffered].reverse().map((t) => instructorsByTerm[t]).find(Boolean) ?? '';

  const code = text(col(row, 'code'));
  const id = text(col(row, 'course_id'));
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    console.error(`${code} "${text(col(row, 'title'))}" has a missing or invalid course_id "${id}". IDs use lowercase letters, numbers and dashes.`);
    badIds++;
    continue;
  }

  // advisor_status like "Confirmed (BS-CTD advisor, 2026-09-29)" becomes a structured confirmation.
  // The audit caveat only shows when the notes carry the sentence "Degree audit may not list it yet."
  const confirmed = optional(row, 'advisor_status').match(/^Confirmed \((.+),\s*(\d{4}-\d{2}-\d{2})\)/);
  const advisorConfirmation = confirmed
    ? { by: confirmed[1], date: confirmed[2], auditMayNotListIt: /Degree audit may not list it yet\./.test(optional(row, 'notes')) }
    : null;

  const specialTopic = code === 'ATLS 3519' || code === 'ATLS 4519';
  const rawTitle = text(col(row, 'title'));

  courses.push({
    id,
    code,
    specialTopic,
    title: specialTopic ? rawTitle.replace(/^(Special|Advanced) Topics:\s*/i, '') : rawTitle,
    credits: text(col(row, 'credits')),
    category: text(col(row, 'category_proposed')),
    categorySecondary: text(col(row, 'category_secondary')),
    countsToward: text(col(row, 'counts_toward')),
    termsOffered,
    notOfferedRecently,
    advisorConfirmation,
    instructorsByTerm,
    instructor: text(col(row, 'instructor_full_name')) || latestInstructor,
    instructorFullName: text(col(row, 'instructor_full_name')),
    instructorTitle: text(col(row, 'instructorTitle')),
    instructorUrl: instructorUrl(text(col(row, 'instructor_full_name')) || latestInstructor),
    instructors: instructorList(text(col(row, 'instructor_full_name')) || latestInstructor),
    description: text(col(row, 'summary_draft')),
    tools: text(col(row, 'tools')).split(/[\n;,]/).map((t) => t.trim()).filter(Boolean),
    image: text(col(row, 'image')),
    crossListings: text(col(row, 'cross_listings')),
    sessionLength: text(col(row, 'session_length')),
    format: text(col(row, 'format')),
    extraCost: text(col(row, 'extra_cost')),
    consentRequired: text(col(row, 'consent_required')),
    unlocks: text(col(row, 'unlocks')),
    searchKeywords: text(col(row, 'search_keywords')),
    classNumber: optional(row, 'class_number'),
    prereqRequired: text(col(row, 'prereq_required')),
    prereqRecommended: text(col(row, 'prereq_recommended')),
    noRequiredPrereqs: isYes(col(row, 'no_required_prereqs')),
    restriction: text(col(row, 'restriction')),
    openToNonMajors: isYes(col(row, 'open_to_non_majors')),
  });
}

if (badIds) process.exit(1);

// Meeting times: the optional "Meeting times" sheet has one row per section (see MEETING-TIMES.md). Each row names the
// course_id it belongs to; rows with no course_id are classes that aren't in the app and are skipped. A class with no rows
// simply has no sectionsByTerm, so everything below is optional. Times are kept exactly as posted: nothing is guessed.
const timesSheet = sheets.find((s) => s.sheet === 'Meeting times');
let sectionRows = 0;
let sectionRowsSkipped = 0;
if (timesSheet) {
  const [th, ...tr] = timesSheet.data;
  const tcol = (row, name) => (th.includes(name) ? text(row[th.indexOf(name)]) : '');
  const byId = new Map(courses.map((c) => [c.id, c]));
  for (const row of tr) {
    const id = tcol(row, 'course_id');
    if (!id) { sectionRowsSkipped++; continue; }
    const course = byId.get(id);
    if (!course) { console.error(`Meeting times: course_id "${id}" (class number ${tcol(row, 'class_nbr')}) is not in the Electives sheet.`); process.exit(1); }
    const term = tcol(row, 'term');
    const section = {
      classNumber: tcol(row, 'class_nbr'),
      title: tcol(row, 'title'), // the topic title as posted, for classes whose sections cover different topics
      section: tcol(row, 'section'),
      type: tcol(row, 'type'),
      campus: tcol(row, 'campus'),
      days: tcol(row, 'days'), // M T W R F S U in teaching order; R is Thursday. Empty when there is no meeting time.
      start: tcol(row, 'start'), // 24-hour HH:MM, or empty
      end: tcol(row, 'end'),
      meets: tcol(row, 'raw_meets'), // the text exactly as posted
      instructor: tcol(row, 'instructor'),
      dates: tcol(row, 'dates'),
      online: tcol(row, 'online').toLowerCase() === 'yes',
      variesBySection: tcol(row, 'varies_by_section').toLowerCase() === 'yes',
    };
    ((course.sectionsByTerm ??= {})[term] ??= []).push(section);
    sectionRows++;
  }
}

const seen = new Map();
for (const c of courses) {
  if (seen.has(c.id)) {
    console.error(`Two classes share the course_id "${c.id}": "${seen.get(c.id)}" and "${c.title}". Give each class its own course_id, then run again.`);
    process.exit(1);
  }
  seen.set(c.id, c.title);
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(courses, null, 2) + '\n');

console.log(`Read ${path.basename(input)}`);
console.log(`Terms found: ${terms.map((t) => t.name).join(', ')}`);
console.log(`Wrote ${courses.length} courses to ${path.relative(root, output)}`);
console.log(`Kept ${keptNotOffered} classes not offered in any term (flagged notOfferedRecently)`);
if (timesSheet) console.log(`Meeting times: ${sectionRows} sections on ${courses.filter((c) => c.sectionsByTerm).length} classes (${sectionRowsSkipped} rows skipped: not in the app)`);
console.log(`${courses.filter((c) => !c.category).length} courses have no category (they show under "All" only)`);
console.log(`${courses.filter((c) => c.categorySecondary).length} courses have a second category (they show under both filters)`);
