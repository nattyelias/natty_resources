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
