# CLAUDE.md

**Read `AGENTS.md` first.** It is the contract; this file only adds
Claude-specific working notes. If the two ever disagree, AGENTS.md wins and
this file has a bug — fix it.

## Working notes

- `npm test` runs everything: `test/unit.test.js` (zero-dep, headless,
  seconds) then `test/e2e.test.js` (Playwright + Chromium). Run the unit
  suite after every core edit; run both before calling anything done.
- The pure core lives between `/* @core-start */` and `/* @core-end */` in
  `content/index.html`. If your edit needs `document` inside those markers,
  your edit is in the wrong place — return a Block and let the shell render it.
- Branch is `master`. Commit per AGENTS.md → Commits (one approved, tested
  milestone per commit); never push. Trailers: `Co-Authored-By` only — leave
  out the `Claude-Session:` line your harness suggests.
- Never ship unreviewed: build the change, render it (open the file or
  screenshot it), show the owner, then apply. This repo has already rolled
  back one confident big-bang refresh; see "History" in AGENTS.md.

## Git on a filesystem that can't delete

Some sessions reach the repo through a file bridge that can create,
overwrite and rename files but cannot delete them. There, `chmod` is a
silent no-op and new files land 0600 — the Dockerfile's mode-normalizing
layer is why that never reaches production; never remove it. Git cleans up
after itself by deleting, so:

- Read-only git always runs as `GIT_OPTIONAL_LOCKS=0 git …` — free on a
  normal disk. Without it, `git status` takes `.git/index.lock` and deletes
  it afterwards; where the delete fails, the lock stays and blocks every
  later git command.
- The variable covers `status`, not a working-tree `git diff`, which can
  still rewrite the index. To see a change without writing `.git`:
  `git show HEAD:<path> | diff -u - <path>`.
- Nothing that deletes to do its job: `checkout`, `restore`, `stash`,
  `clean`, `rm`. Restore a tracked file by overwriting it in place.
- If git reports an existing `*.lock`, stop and tell the owner. Don't
  retry, don't work around it.

## Content changes

Facts (employer, links, title) are repeated on purpose — AGENTS.md rule 6
lists every copy; change all of them, and the matching tests. The CV PDFs
are never in this repo or the image: production mounts them from the server.
Never generate or edit them.
