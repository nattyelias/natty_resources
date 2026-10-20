# Architecture

Three layers. Each one only depends on the ones above it in this list.

## 1. core (built, partly)

Plain TypeScript with no screens and no globals. Settings come in as an argument (`CoreConfig`).

- **data**: `data/courses.json` (built from the spreadsheet by `data/scripts/`) and the types in `src/core/types.ts`
- **search**: finding classes by text, area and term (to be written; the logic still lives in the old App.tsx)
- **plans**: saved classes and plans, what is stored on the device, credits and warnings (`src/core/plans.ts`)
- **terms**: which term a class runs in, and what to say about it (`src/core/terms.ts`)

## 2. profile (later)

My own saved details, kept as plain local files. Nothing leaves the device.

## 3. modes (later)

Different jobs built on core and profile, for example class planning. Each mode is its own small app inside `src/app/`.

## Rules that carry over

- Only public, unauthenticated CU data. No logins, no grades or enrollment.
- Stored plans keep loading. If the stored shape changes, bump the version and write a migration.

## Data caveats

- **Extra records have placeholder booleans.** The records in `data/courses-extra.json` come only from the Spring 2027 schedule. `noRequiredPrereqs` and `openToNonMajors` are `false` on every one of them because nothing says otherwise. The `Course` type is `boolean`, not `boolean | null`, so they could not be set to null. **No filter may use `noRequiredPrereqs` or `openToNonMajors` on the extra records.** A record from `courses.json` has real values; an extra one does not. (A cleaner fix later is to allow `null` in the type and set both to null on the extra records.)
- **Level exists only on the extra records.** The 52 classes in `data/courses.json` have no `level`, so a level filter never matches them.
- **Independent study.** Records with `independentStudy: true` (ATLS 4900, 5900, 7900, 8990) keep their sections and instructors in the data, but a UI should not list the instructors. Use `showInstructors()` in `src/core/courses.ts`.
- **Graduate view.** `gradCourses()` works the view out from the data (level, own code, cross-list codes on upcoming-term sections). It is not hand-labelled. See `docs/grad-view.md`.
- **Twin classes.** A 4000-level record and a 5000-level record that are the same class (ATLS 4040 and ATLS 5040: codes 1000 apart, same normalized title, same meeting days and times) are found by `findTwins()` in `src/core/twins.ts`. Both records stay in `courses.json` and `courses-extra.json`, untouched. In Grad mode `coursesForMode()` shows a pair as one card: the 5000-level record with its credits, description, focus area, image and instructor bios borrowed from the original when it has none, and the sections of both with duplicates dropped (`mergeTwin()`). In Undergrad mode only the 4000-level record is listed. A near-miss (same title, different times) is reported by `findTwins()` and not merged. `node data/verify.mjs --twins` prints every pair and near-miss.
