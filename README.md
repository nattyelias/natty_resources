# natty_resources

My personal hub of tools and notes. Private, local, and for me first. See `CLAUDE.md` for the ground rules.

## Layout

- `src/core/` the shared logic: types, config, plans, terms (search comes next)
- `src/app/` the React shell (empty for now)
- `data/` class data, the scripts that build it, and `verify.mjs` to sanity-check it
- `docs/` notes, starting with `ARCHITECTURE.md`
- `class-tool/` the older clone of Focus Electives (its own repo, ignored here)

## Commands

```bash
node data/verify.mjs   # print counts from data/courses.json
pnpm install           # needs Node 22 and pnpm (not set up on this machine yet)
pnpm dev
```
