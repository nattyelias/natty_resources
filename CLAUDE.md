# natty_resources: my personal hub

This folder is the home for my personal tools and notes. It is private and for me first.
If something here becomes useful to other people later, that is a bonus, not the goal.

Read this file first. Then open the project folder that matches the task.

## What I care about

- **Mine and local.** My data stays on my own devices or in files I control. No accounts
  with outside services, no tracking.
- **No subscriptions.** I do not want monthly fees or licences. Pay-per-use services are
  acceptable only if I approve each one and can set a spending cap.
- **Minimal and fast.** One small app per job. Fewer steps, fewer tabs. Shortcuts over
  features.
- **Honest.** Say plainly what you verified and what you did not. If a check failed or was
  skipped, tell me. If an idea is fragile or against a site's terms, say so before
  building it.
- **Ask before:** deleting data, rewriting git history, pushing, deploying, contacting any
  outside service with my information, or touching anything behind a login.

## Projects in this folder

| Folder | What it is | State |
| --- | --- | --- |
| `class-tool/` | A personal class search and planning tool. A clone of my old Focus Electives site, being turned into a full replacement for CU class search. | Active. Start with `class-tool/HANDOFF.md` and `class-tool/PERSONAL-TOOL-PROMPT.md`. |
| natt-dex (not started) | A personal agent for jobs, internships, and Boulder/Denver events and people, with real-time alerts, shortcuts and my own saved profile. | Parked. Do not build until I say so. |

## Rules for the projects here

**class-tool**
- It is a clone with **no git remote**. It cannot push to or redeploy my original
  Focus Electives site, and I want it to stay that way.
- The original lives at `/Users/nattyelias/focus-electives`. Do not change it.
- It is no longer scoped for ATLAS. Do not add ATLAS-facing copy, advisor prompts or
  feedback forms.
- Only read public, unauthenticated CU data. Never log in to my CU account, and never
  read grades, schedules or enrollment.
- Keep saved plans and classes loading from existing localStorage data. If the stored
  shape changes, bump the version and write a migration.

**natt-dex (when it starts)**
- Data layer first: my profile, classes and plans as plain, local, portable data.
- Notifications through the simplest free channel that works on my phone.
- The agent drafts. I send. Nothing goes out automatically on my behalf.
- No LinkedIn scraping. Use public company feeds, event listings, RSS and my own email.

## How I like to work

- Give a recommendation and a plan first. Wait for my go-ahead on anything large.
- Small steps, one change per commit, clear commit messages.
- Verify in the browser or by running checks. Do not ask me to check manually.
- Explain things in plain words. I am not looking for jargon.

## Housekeeping

- This folder is its own git repo and `class-tool/` is a nested repo inside it. Add
  `class-tool/` to `.gitignore` here before running `git add .`, so it is not recorded
  as an embedded repo.
- New projects go in their own subfolder with their own handoff note.
