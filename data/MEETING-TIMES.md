# Meeting times

Days and times for each class live in the **Meeting times** sheet of `focus-electives-data-vN.xlsx`, one row per section.
`npm run data` reads that sheet and adds an optional `sectionsByTerm` to each class in `src/data/courses.json`.
The app does not show these yet.

| Column | What it holds |
| --- | --- |
| `course_id` | The class in the Electives sheet this section belongs to. Leave it empty for a class that isn't in the app (the row is skipped). |
| `term`, `course`, `title` | As posted in CU class search. |
| `class_nbr`, `section`, `type` | Class number, section (keep leading zeros) and LEC, REC, LAB, SEM or IND. |
| `days` | `M T W R F S U`, where `R` is Thursday. Empty when there is no meeting time. |
| `start`, `end` | 24-hour `HH:MM`, or empty. |
| `raw_meets` | The "Meets" text exactly as posted. `days`, `start` and `end` are read from it, never the other way round. |
| `online`, `varies_by_section`, `no_time` | `yes` when the class meets online, the parent says "Varies by section", or no time is assigned. |
| `instructor`, `status`, `closed_flag`, `dates`, `notes`, `campus` | As posted. Only instructor, dates and campus reach `courses.json`; status goes stale, so it stays in the sheet. |

Cross-listed classes share meeting times, so a section is matched to the ATLS class by class number and the cross-listing is noted in `notes`.
Nothing is guessed: a class with no posted time simply has no `sectionsByTerm` for that term.
