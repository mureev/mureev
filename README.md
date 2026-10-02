### Hey, I'm Constantine.

A human being 😉 leading engineering teams at Renmoney.

I believe in good people, curiosity & hard work.

Have a good day!

--  
Constantine Mureev  
[mureev.com](https://mureev.com/)

---

## This repo is [mureev.com](https://mureev.com)

[![ci](https://github.com/mureev/mureev/actions/workflows/ci.yml/badge.svg)](https://github.com/mureev/mureev/actions/workflows/ci.yml)

My personal site. It's a terminal.

```
constantine@mureev.com:~$ whoami
constantine
uid=2009(constantine) gid=42(engineering) groups=fintech,payments,mobile,teams,coffee
```

### The story

The 2017 version of this site was a jQuery Terminal page — a fine joke,
told with 300 KB of other people's JavaScript pulled off a CDN. In 2026 the
joke got better: the terminal is now **hand-rolled in vanilla JS, zero
runtime dependencies, one self-contained file, no build step**, held to a
size budget by its own tests, and View Source is part of the product.

It is also an **AI-based project**: the owner directs, AI agents build.
[AGENTS.md](AGENTS.md) is the contract they work to, and the tests enforce
the parts of it a machine can check. The site ships an
[`/llms.txt`](content/llms.txt) briefing for agents that come crawling.

### The rules

The full contract lives in [AGENTS.md](AGENTS.md). The short version:

1. One self-contained `index.html`. No build step, ever.
2. Zero runtime dependencies — enforced by a test that fails on any `<script src>`.
3. Size budget ≤ 48 KB raw / ≤ 14 KB gzipped — also a test.
4. Functional core, imperative shell — the pure logic runs headless in `node:vm`.
5. The copy is the owner's voice. The Mandalorian stays.

### What checks it

A promise nobody checks is a wish. Each of these has a check behind it,
and a red build when it stops being true:

| Promise | Checked by |
| --- | --- |
| One file, nothing loaded from elsewhere | unit: no `<script src>` or stylesheet link on any page · e2e: no request leaves the site but the gif |
| ≤ 48 KB raw, ≤ 14 KB gzipped | unit: the size budget |
| A pure core | unit: the core runs in a bare `node:vm` — no DOM to reach for |
| Strangers' input can't break it | unit: a table of hostile input against every command, thousands of seeded lines, a history walked ten thousand times |
| Nothing runs that didn't ship | unit: each page's CSP is exactly its inline code's hashes · e2e: not one CSP or Trusted Types violation, on any page |
| Readable in every theme | unit: WCAG AA contrast, measured from the CSS itself |
| Usable by keyboard and screen reader | e2e: the Tab walk, focus rings, landmarks, what the live region announces |
| Fine without JavaScript, and on a phone | e2e: the no-JS fallback · a touch viewport: the boot, taps, the on-screen keyboard |
| What ships is what was tested | CI: one image, smoke-tested and run through the e2e suite, then published |
| The live site stays that way | daily: the e2e suite against mureev.com, plus certificates and the CVs |

### Run it

```sh
open content/index.html        # that's the whole dev environment
```

Or the way production does:

```sh
docker build -t mureev.com . && docker run -p 8080:80 mureev.com
```

### Release

Push to `master` — that is the deploy. CI runs the suites, builds the image
once, tests that very image (a smoke test, then the e2e suite against it),
and publishes that very image to GHCR as `ghcr.io/mureev/mureev.com`, from
a job that holds the only token that can deploy and runs no npm code. Ship from CI, not
from a laptop: on Apple Silicon a bare `docker build` produces an arm64
image that an x86 server politely refuses to run. The server notices the
new build within a couple of minutes, deploys it behind a health check
through its nginx, and rolls itself back if the check fails. The CV PDFs —
kept private, with their own edit history — never enter this repo or the
image: production mounts them from the server.

### Test it

```sh
npm ci                             # Playwright, the only devDependency
npx playwright install chromium    # once: the browser the e2e suite drives
npm test                           # unit (headless core, zero-dep runner) + e2e (real Chromium)
E2E_URL=http://127.0.0.1:8080/ npm run test:e2e   # e2e against the running image: headers, caching, errors
E2E_URL=https://mureev.com/ npm run test:e2e      # the live site, as the daily check runs it
```

The unit suite slices the engine's pure core out of `index.html` by its
`@core` markers and runs it with no DOM at all; the e2e suite boots the real
page in Chromium and types at it like a visitor would — including
keyboard-only use, what a screen reader is told, a mobile viewport and a
JavaScript-disabled pass. CI runs both on every push, then builds the image
from owner-only (0600) files — so the Dockerfile's permission fix has to keep
earning its place — and runs the e2e suite again against the container.

### Map

| Path | What |
| --- | --- |
| `content/index.html` | the site — markup, styles, and the `csh` engine |
| `content/404.html`, `50x.html` | error pages, self-contained, zero JS |
| `content/llms.txt` | briefing for AI agents |
| `content/.well-known/security.txt` | where to report a vulnerability ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)) |
| `conf/` | nginx, and the response headers (note the X-Clacks-Overhead) |
| `test/` | unit + e2e suites |
| `.github/workflows/ci.yml` | the suites, then the image's smoke test and e2e, on every push; publishes that image from `master` |
| `.github/workflows/production.yml` | daily: the live site — certificates, the proxy's headers, the CVs — through the same e2e suite |
| `tools/` | generators for `og.png` and the favicons |
| `AGENTS.md` / `CLAUDE.md` | the contract for whoever builds next |

### License

Code — the `csh` engine, tests, tools, nginx and Docker config — is
[MIT](LICENSE). The personal content — biography and site copy, the CVs the
site links to, `og.png` and the favicon artwork — is © Constantine Mureev,
all rights reserved.

GNU Terry Pratchett.
