# CLAUDE.md

Read @AGENTS.md first: it is the contract, and this file only adds what is
specific to Claude. If the two ever disagree, AGENTS.md wins and this file
has a bug — fix it.

Commit trailers: `Co-Authored-By` only. Leave out the `Claude-Session:` line
your harness suggests.

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
