# How to update the site each semester

Use this checklist every time a new term (spring, summer or fall) is coming up. It takes about 30 minutes.

**The big picture.** Two things hold everything the site knows about a semester:

1. **The spreadsheet** (`focus-electives-data-vN.xlsx`). It lists every class and which terms it ran in.
2. **The settings file** (`src/config/semester.ts`). It holds a few small settings: which term the class search links use, which term you are planning for, whether that term is posted yet, and the date you last checked.

You change those two, run one command (`npm run data`) so the site reads the new spreadsheet, check the site, and save your work to GitHub. You never need to edit any other code.

**Words you will see**
- **Terminal**: the place where you type commands. In the Claude app you can ask Claude to run a command for you, or use the Terminal panel.
- **Project folder**: the `focus-electives` folder on your Mac. Every command below is run from inside it.
- **Term code**: the number CU uses for a term, like `2261` for Spring 2026.

---

## Step 1. Decide what you are updating

Answer these three questions first. You will use the answers in Step 3.

1. **Which term are students planning for now?** (for example "Spring 2027", "Summer 2027" or "Fall 2027"). This is the *next term*.
2. **Has CU posted that term's classes yet?** Look in CU class search with that term selected. If classes are listed, it is posted.
3. **What is the term code?** (Step 2.) Once CU has posted the next term, that code is the one setting the "View in class search" links use.

Which of these describes you?

| Where you are | What to do |
| --- | --- |
| **The next term is not posted yet.** | Leave the spreadsheet's newest term alone. Keep `classSearchTermCode` as `null`. The home page and class pages will say "[term] isn't posted yet. Check CU class search once it is." and class search links carry no term. |
| **CU just posted the next term.** | Add that term to the spreadsheet (Step 4) and set `classSearchTermCode` to the verified code (Step 2). Every class search link and the "posted" note update from that one value. |
| **A term just ended and you are moving on.** | Set `currentTermName` to the term now running, change `nextTermName` to the following term, and set `classSearchTermCode` back to `null`. |

---

## Step 2. Find the term code

Every term has a code. Summer and fall follow the same pattern:

> **2 + the last two digits of the year + a season digit** (1 = spring, 4 = summer, 7 = fall)

| Term | Code |
| --- | --- |
| Spring 2026 | `2261` |
| Summer 2026 | `2264` |
| Fall 2026 | `2267` |
| Spring 2027 | `2271` |
| Summer 2027 | `2274` |
| Fall 2027 | `2277` |

The 2026 codes come straight from CU's own term dropdown. The 2027 ones follow the same pattern but are not confirmed yet, so **check your code before you use it**:

1. Open this address in your browser, replacing `YOURCODE` with the code you want to check:
   `https://classes.colorado.edu/#keyword=ATLS+3040&srcdb=YOURCODE`
2. Look at the "Search Criteria" box in the middle of the page. It shows a line like **Term: Spring 2027**.
3. **If that line shows the term you wanted, the code is right.** Use it.
4. **If it shows a different term** (for example "Term: Fall 2026" when you asked for Spring 2027), CU does not have that term yet, or the code is wrong. CU does not show an error. It quietly shows its default term instead. Do not set `classSearchTermCode` to that code. Leave it `null` and try again later.

> You can also open CU class search, look at the term dropdown, and see whether the new term is listed. CU's page does not show the term code in the address bar after you search, so the check above is the reliable way.

---

## Step 3. Change the settings file

1. Open `src/config/semester.ts`.
2. Change the values between the quote marks. Save the file.

```ts
export const semester: SemesterSettings = {
  classSearchTermCode: null,          // the verified term code from Step 2 (a string like '2271'), or null until CU posts the term
  currentTermName: 'Fall 2026',       // the term running right now
  nextTermName: 'Spring 2027',        // the term students are planning for
  dataLastChecked: '2026-09-26',      // today's date as YYYY-MM-DD
  feedbackFormUrl: '',                // your feedback form's address (leave as is between terms)
};
```

What each one does:

- **`classSearchTermCode`**: the one setting behind every "View in class search" link and the "posted" note. While it is `null`, links have no term and the site says the next term isn't posted yet. When you set a code, every link adds it and the note goes away. Never guess a code.
- **`currentTermName`**: the term running now. A class that ran in it shows "Running now (term)" on its page.
- **`nextTermName`**: the class page notes about the next term. The Availability filters have one chip per term in the data ("Spring 2026", "Fall 2026", and so on, in time order), so a new term appears on its own once a class lists it. "Not offered recently" comes from the spreadsheet.
- **`dataLastChecked`**: shown in the footer of every page as "Data last checked". Set it to today whenever you check the data.
- **`feedbackFormUrl`**: the address of your feedback form. The footer's "Give feedback" link (opens in a new tab) appears once this is filled in. You only set it once.

Keep the term name written exactly the way the site expects: a season (`Spring`, `Summer` or `Fall`), a space, then the four-digit year.

---

## Step 4. Update the spreadsheet

1. **Make a new copy.** Save the spreadsheet as the next version number, for example `focus-electives-data-v11.xlsx` (if the newest is v10). Put it in the project folder. The site always uses the highest number automatically. Leave the old version files where they are.
2. Open the **Electives** sheet. (Do not rename this sheet.)

### Add the new term

Add **two new columns** for the new term. The column names must be exact, lowercase, with an underscore:

| Term | Column names |
| --- | --- |
| Spring 2027 | `sp27_offered` and `sp27_instructor` |
| Summer 2027 | `su27_offered` and `su27_instructor` |
| Fall 2027 | `fa27_offered` and `fa27_instructor` |

The pattern is: `sp` (spring), `su` (summer) or `fa` (fall), then the **two-digit year**, then `_offered` or `_instructor`.

- In the `..._offered` column, type **Yes** or **No** for every class.
- In the `..._instructor` column, type the instructor's name if you know it. It is fine to leave it blank.
- The new columns can go anywhere. Leave the older term columns in place; they are how the site knows when a class last ran.

That is all the site needs to learn about a new term. No code changes.

### Add new classes and special topics

Add a **new row at the bottom** for each new class. Special topics (ATLS 3519 and ATLS 4519) are new rows too, one per topic. Fill in at least:

- `code` (for example `ATLS 4519`) and `title`. For special topics you can type "Special Topics: Name" or "Advanced Topics: Name" or just the name. The site removes the prefix.
- **`course_id`**: a unique, lowercase ID made from the code and title, with dashes instead of spaces. Example: `atls-4519-neurodesign`. Use only lowercase letters, numbers and dashes.
- `credits`, `counts_toward`, `category_proposed`, `summary_draft`, and the `..._offered` columns for each term.
- If you can, also fill in prerequisites, `restriction`, `open_to_non_majors`, `no_required_prereqs`, `session_length`, `format`, `extra_cost`, `consent_required`, `unlocks`, `cross_listings` and `search_keywords`. The class page shows whatever is filled in and hides the rest.

**Important: never change an existing `course_id`.** Students' saved classes and plans are stored using it. If you change one, anything saved under the old ID disappears.

### Classes that are no longer offered

Set every term's `..._offered` cell to **No**. A class with no "Yes" in any term is left off the site.

Save the spreadsheet when you are done.

---

## Step 5. Run `npm run data`

This command reads the newest spreadsheet and rebuilds the site's class data.

1. In the terminal (or ask Claude to run it), make sure you are in the project folder.
2. Run:

```bash
npm run data
```

3. You should see something like this:

```
Read focus-electives-data-v11.xlsx
Terms found: Spring 2026, Fall 2026, Spring 2027
Wrote 43 courses to src/data/courses.json
Left out 10 rows not offered in any term
```

Check two things:
- **"Terms found"** lists the new term. If it does not, a column name is wrong. Go back to Step 4 and check the spelling.
- **The course count** looks about right.

**If you see an error instead**, it tells you what to fix:

| Message | What it means |
| --- | --- |
| `has a missing or invalid course_id` | A new class has no `course_id`, or it has capital letters, spaces or symbols. Fix it as described in Step 4. |
| `Two classes share the course_id` | Two rows have the same `course_id`. Make each one different. |
| `No term columns found` | The `..._offered` columns are missing or misspelled. |
| `Column "..." not found` | A required column heading was renamed or deleted. Put it back. |

Fix the spreadsheet, save it, and run `npm run data` again.

---

## Step 6. Check the site

1. Start the site:

```bash
PORT=5173 FIGMA_DEV_SERVER_HOST=127.0.0.1 npm run dev
```

   (Or just ask Claude: "run the app".)
2. Open **http://localhost:5173** in your browser.
3. Go down this list:
   - [ ] The home page note is right: it appears (with the right term name) only while `classSearchTermCode` is `null`.
   - [ ] The Availability filters in the Filters panel list every term in the data, oldest first, and each one shows the classes that ran in it.
   - [ ] The class count and the cards look right, and a brand-new class shows up.
   - [ ] Open a class page. The availability line under the title (for example "Running now (Fall 2026)") and **Typical pattern** make sense. Scroll to the footer: **Data last checked** shows today's date.
   - [ ] Click **View in class search** on any class once `classSearchTermCode` is set. It should open CU class search on that class and show "Term:" with the term you expected.
   - [ ] Try a search for a new class or instructor.
4. When you are done, stop the site by pressing **Ctrl + C** in the terminal.

---

## Step 7. Save your work (commit and push)

"Committing" saves a snapshot of your changes. "Pushing" sends it to GitHub.

```bash
git status
```

Look at the list. You should see the spreadsheet, `src/data/courses.json` and `src/config/semester.ts`. Then:

```bash
git add src/config/semester.ts src/data/courses.json focus-electives-data-v11.xlsx
git commit -m "Update for Spring 2027"
git push origin main
```

Change `v11` and the message to match what you did. If you want to check nothing was missed, run `git status` again. It should say your branch is up to date.

---

## Quick reference

| I want to change... | Where |
| --- | --- |
| Which term the class search links use | `classSearchTermCode` in `src/config/semester.ts` (`null` until posted) |
| The term students are planning for | `nextTermName` in `src/config/semester.ts` |
| Show or hide the "isn't posted yet" note | Set or clear `classSearchTermCode` in `src/config/semester.ts` |
| The "Data last checked" date | `dataLastChecked` in `src/config/semester.ts` |
| Which classes exist, and when they ran | the spreadsheet, then `npm run data` |
| A brand-new term | two new spreadsheet columns, like `sp27_offered` and `sp27_instructor`, then `npm run data` |

If anything looks wrong and you are not sure why, do not guess. Ask Claude and share the message you see.
