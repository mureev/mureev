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

### Run it

```sh
open content/index.html        # that's the whole dev environment
```

Or the way production does:

```sh
docker build -t mureev.com . && docker run -p 8080:80 mureev.com
```

### Release

Push to `master`. CI runs the suite, builds the image for `linux/amd64` and
publishes it to GHCR as `ghcr.io/mureev/mureev.com` (on Apple Silicon a bare
`docker build` produces an arm64 image that an x86 server politely refuses
to run). The server notices the new build within a couple of minutes,
deploys it behind a health check through its nginx, and rolls itself back if
the check fails. The CV PDFs — kept private, with their own edit history —
never enter this repo or the image: production mounts them from the server.

### Test it

```sh
npm ci                             # Playwright, the only devDependency
npx playwright install chromium    # once: the browser the e2e suite drives
npm test                           # unit (headless core, zero-dep runner) + e2e (real Chromium)
E2E_URL=http://127.0.0.1:8080/ npm run test:e2e   # e2e against the running image: headers, caching, errors
```

The unit suite slices the engine's pure core out of `index.html` by its
`@core` markers and runs it with no DOM at all; the e2e suite boots the real
page in Chromium and types at it like a visitor would — including
keyboard-only use, what a screen reader is told, a mobile viewport and a
JavaScript-disabled pass. CI runs both on every push; it also builds the
image from owner-only (0600) files — so the Dockerfile's permission fix has
to keep earning its place — and runs the e2e suite again against the
container.

### Map

| Path | What |
| --- | --- |
| `content/index.html` | the site — markup, styles, and the `csh` engine |
| `content/404.html`, `50x.html` | error pages, self-contained, zero JS |
| `content/llms.txt` | briefing for AI agents |
| `conf/` | nginx, and the response headers (note the X-Clacks-Overhead) |
| `test/` | unit + e2e suites |
| `.github/workflows/ci.yml` | the suites, plus the image's smoke test and e2e, on every push; publishes the image from `master` |
| `tools/` | generators for `og.png` and the favicons |
| `AGENTS.md` / `CLAUDE.md` | the contract for whoever builds next |

### License

Code — the `csh` engine, tests, tools, nginx and Docker config — is
[MIT](LICENSE). The personal content — biography and site copy, the CVs the
site links to, `og.png` and the favicon artwork — is © Constantine Mureev,
all rights reserved.

GNU Terry Pratchett.
