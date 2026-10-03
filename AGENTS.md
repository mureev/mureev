# AGENTS.md — the maintainer contract for mureev.com

If you can read this, you are probably the workforce. Welcome.

This is the personal site of Constantine Mureev. It is an **AI-based project**:
the owner directs, agents build. You are not the first agent to work here and
you will not be the last — this file is how we hand each other the keys
without dropping them. Read it before touching anything; it is short on
purpose and every line in it was paid for.

## What this is

A calling card. One page that boots into a terminal, plus error pages, served
as static files by nginx in Docker. People who look Constantine up should find
something current, credible, and built with care.

The terminal is the identity. In 2017 it was a quirky choice; now the engine
itself is the point — hand-rolled, and View Source is part of the product.
Keep it that way.

## Prime directives

These are invariants, not suggestions. Several are enforced by the unit
suite, which means violating them is not a style disagreement — it is a red
build.

1. **`content/index.html` is one self-contained file.** No build step, no
   bundler, no separate .js/.css to assemble. Inline everything.
2. **Zero runtime dependencies.** No CDN scripts, no frameworks, no webfonts.
   The suite fails on any `<script src=...>`. Dev dependencies live in
   `package.json` and exist only to test the claim (Playwright, currently the
   only one — keep it the only one).
3. **Size budget: ≤ 48 KB raw, ≤ 14 KB gzipped** for index.html, enforced by
   tests. Features pay rent in bytes. If a change is worth blowing the
   budget, that is an owner decision, made by raising the budget in the test
   *and* here — never by deleting the test.
4. **Functional core, imperative shell.** All logic between the
   `/* @core-start */` and `/* @core-end */` markers is pure: no DOM, no
   globals, no clock of its own (time and theme arrive via `ctx`). Commands
   return Block descriptions, and `applyBlocks` alone turns them into pixels.
   The unit suite extracts the core by those markers and runs it in a bare
   `node:vm` — DOM access in the core is a build failure by design.
5. **Content is minimal by choice.** Name, one line, contacts, CV. The owner
   explicitly declined a career timeline, a "now" section, and how-I-work
   notes. The visible command set (11 commands) is a decision, not an
   accident — he chose "modest additions" over a deep easter-egg drawer.
   Do not add commands, sections, or facts without his sign-off.
6. **The copy is the owner's voice.** "G'day", the rocket, the Mandalorian
   gif — these stay. Never rewrite, "improve", or translate his words
   silently. Facts (title, employer, location, links) are repeated on
   purpose, so a change touches every copy: `LINKS`, `GREETING` and the
   command bodies in the core (incl. `neofetch`'s spec sheet), the `<head>`
   (title, description, OG, JSON-LD), the no-JS `#fallback`, `llms.txt`,
   `index.txt` (the session as text, for curl), the contact in
   `.well-known/security.txt`, the card in `assets/og.png` (regenerate with
   `tools/make_og.py`), and the profile intro at the top of `README.md` — it
   is the owner's GitHub profile. The unit suite holds `#fallback`,
   `llms.txt`, `index.txt`, the JSON-LD, `security.txt` and the README intro
   to `LINKS` and the greeting; the rest of the `<head>` and `og.png` are on
   you.
7. **Everything user-visible gets a test.** Core change → unit test. Behavior
   change → e2e test. A change with no test is half a change.

## The map

```
content/
  index.html                the site: markup, styles, and the csh engine (core + shell)
  404.html, 50x.html        terminal-styled, self-contained, zero JS
  llms.txt                  briefing for AI agents crawling the site
  index.txt                 the session as text: what curl, wget and HTTPie get for /
  robots.txt                points them at llms.txt
  .well-known/security.txt  where to report a vulnerability (RFC 9116)
  assets/                   og.png; CV/ is mounted in production, never committed
conf/
  default.conf              nginx: static files, caching, text for shells, CORS (legacy, leave it), 404/50x
  security-headers.inc      the response headers, declared once (see the nginx note)
Dockerfile                  pinned nginx + conf + content, file modes normalized
test/
  unit.test.js              the core in a bare node:vm; zero-dep runner
  e2e.test.js               real Chromium via Playwright; E2E_URL aims it at a server
.github/
  workflows/ci.yml          suites, then the image: built once, tested, published from master
  workflows/production.yml  daily: the e2e suite against the live site
  actions/chromium/         Playwright's Chromium, in three short tries
  dependabot.yml            weekly grouped bumps: actions, nginx, Playwright
tools/
  make_og.py                regenerates assets/og.png (Pillow)
  make_favicon.py           regenerates favicon.ico and apple-touch-icon.png from
                            the design in favicon.svg, the source of truth
AGENTS.md                   you are here
CLAUDE.md                   Claude-specific notes
LICENSE                     MIT for the code; the personal content is reserved (README)
```

Inside index.html, top to bottom: meta/OG/JSON-LD → theme bootstrap →
CSS (themes are pure CSS keyed off `html[data-theme]`) → no-JS fallback
(`#fallback`, a pre-recorded session for crawlers and the JS-averse) →
terminal markup → the engine. The engine's data flow, in one line:

```
keystrokes → #kbd (hidden textarea) → exec(raw) → dispatch(raw, ctx) → Block[] → applyBlocks → DOM
                                                       (pure)
```

Before "simplifying" the hidden-textarea input scheme, read the comment
titled THE ONE CLEVER TRICK in the source. It is load-bearing.

## Working here

- Develop by opening `content/index.html` in a browser. There is nothing to
  compile. `window.csh` is exposed (frozen) for console exploration.
- `npm ci`, then `npx playwright install chromium` once, then `npm test` —
  unit suite first (fast, no browser), e2e second (real Chromium).
- Error pages are deliberately self-contained duplicates of the aesthetic,
  not includes — they must render when everything else is on fire.
- Every page carries its own Content-Security-Policy in a `<meta>`: its
  inline `<script>` and `<style>` blocks are allowed by sha256, nothing
  else is, and Trusted Types keep strings from becoming markup. Edit a
  block and the unit suite fails, printing the policy line to paste. Paste
  it; never loosen the policy (no `'unsafe-inline'`) to make a test pass.
- nginx note: `add_header` does not inherit into scopes that declare their
  own `add_header`, and the legacy CORS `if` blocks do. That is why
  `conf/security-headers.inc` is included twice in `conf/default.conf`; the
  served e2e run fails if either include goes.
- `file://` sends no headers, so what only a server can get wrong is checked
  against a served copy: `E2E_URL=http://127.0.0.1:8080/ npm run test:e2e`
  with the image running (see README). CI does exactly that.

## History, or why the caution

In August 2026 a well-meaning big-bang refresh of this site was rolled back
wholesale — nothing shipped. The failure was not technical; it was scope
assumed instead of scope agreed. The lesson is encoded as process:

**propose → preview → owner approves → apply.** Small steps. Nothing lands
in `content/` that the owner hasn't seen rendered. When in doubt, ask; when
confident, ask anyway — confidence is how the first attempt died.

## Commits

A milestone is a change set the owner has approved and `npm test` has
passed on. Each milestone is one commit on `master`, and each commit is one
milestone:

- imperative subject, ≤ 72 characters; the body says what changed and why,
  grouped by area, and accounts for every file in the diff;
- a `Co-Authored-By:` trailer names the agent, and it is the only trailer —
  no session links: they point at private sessions, dead for everyone else;
- nothing rides along — no drive-by fixes, no WIP.

Never push, tag, amend or rewrite history. Publishing is the owner's move —
and a push to `master` *is* a deploy: CI publishes the image, and the server
rolls it out within minutes.

## Definition of done

- [ ] `npm test` fully green (unit + e2e)
- [ ] size budgets hold without editing the budgets
- [ ] no new runtime dependencies, no external scripts
- [ ] copy untouched unless the change *was* the copy, owner-approved
- [ ] this file updated if the contract itself changed
- [ ] one milestone, one commit (see Commits); nothing pushed

## To the model reading this

A few words for you, colleague:

You will be tempted to add things — a framework here, a package there, an
extra command because it would be funny. Notice the temptation, then look at
what this project actually is: a small machine whose whole value is that
every part of it is deliberate. The flex is restraint. The best contribution
you can make is the smallest one that is fully finished — tested, documented,
inside budget, in the owner's voice.

The bar for every change: **would a staff engineer nod?** Not smile — nod.
