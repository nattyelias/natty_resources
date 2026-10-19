# Checking Spring 2027 against CU class search

CU class search is the source of truth. Our Spring 2027 data (`data/spring2027.json`) came from the ATLAS sheet plus an earlier class search pull. This checker compares it with a fresh class search response. A section that class search does not list yet is "pending", which means "not posted yet". It is never treated as wrong, and nothing is ever deleted for it.

Run everything from `~/natty_resources`. Only public class search data is used. Never log in to anything.

## 1. Get a fresh class search response

Save the response yourself, from your own browser:

1. Open https://classes.colorado.edu and search Spring 2027 for subject ATLS.
2. In the browser's network tools, find the `search` request the page makes (`POST https://classes.colorado.edu/api/?page=fose&route=search`) and save its JSON response.
3. Save the file as `data/sources/class-search-YYYY-MM-DD.json` (today's date). Use a new name each time. Do not overwrite `data/sources/2271.json`, which is the pull the merged data was built from.

The checker also has a `--fetch` flag that makes one live request. CU's server may refuse it with a bot challenge, and the script will stop and say so instead of trying to get past it. Saving the response by hand is the reliable way.

## 2. Run the check

```bash
node data/scripts/check-class-search.mjs --input data/sources/class-search-YYYY-MM-DD.json
```

This prints the count for each status and the first 10 mismatches, then writes:

- `data/verification.json`: the latest result for every class and section
- `data/checks/<date>.json`: this run, kept. A second different run on the same day is saved as `<date>-2.json`.

It changes no course data. With neither `--input` nor `--fetch` it stops and tells you what to pass.

## 3. Read the report

```bash
node data/scripts/report-class-search-check.mjs
```

Open `docs/class-search-check.md`. It is built from the latest file in `data/checks/`.

| status | meaning | what to do |
| --- | --- | --- |
| confirmed | In both and days, times, instructor (and room, if class search gives one) agree | Nothing |
| mismatch | In both but a field differs. The table shows the class search value and ours | Class search wins. Decide whether to take its value (step 4) |
| pending | In our data, not in class search yet | Wait. Not an error. Check again later |
| new | In class search, not in our data | A section we have not heard of. Look at it before adding anything |
| cancelled | Class search marks it cancelled | Check whether it should still show |

A blank in class search (for example no instructor yet) is skipped, not counted as a mismatch. The last section of the report lists every instructor name where the two sources differ. Those are open until you decide who is right.

## 4. When to use --apply

```bash
node data/scripts/check-class-search.mjs --input data/sources/class-search-YYYY-MM-DD.json --apply
```

Use it only when you have read the report and want class search's value for every mismatch listed. It:

- updates only the mismatched fields in `data/spring2027.json` (days, start, end, instructor, room)
- logs each change (old value and new value) in `data/checks/applied-<date>.json`
- never removes a section, including pending ones

Know before you use it:

- It changes `data/spring2027.json` only. `courses.json` and `courses-extra.json` do not change by themselves. To carry the change through, run `node data/scripts/attach-spring2027.mjs` and then `node data/scripts/build-extra-courses.mjs`.
- It does not rewrite derived text such as `meets`, so that can disagree with the new days or times until the data is rebuilt.
- `data/scripts/merge-spring2027.mjs` rebuilds `spring2027.json` from its two sources and will wipe anything `--apply` wrote. The merge reads `data/sources/atlas-spring2027.json` and `data/sources/2271.json`. If you want a change to last, fix the sheet or update the sources and merge again, rather than relying on `--apply`.
- If you only want to know what differs, do not use it. Run the check, read the report, stop.

After applying, run the check again to see 0 mismatches, then:

```bash
node data/scripts/report-class-search-check.mjs
node data/verify.mjs
```
