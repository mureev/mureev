#!/usr/bin/env node
/* =========================================================================
   Unit suite for csh — the engine inside content/index.html.

   Zero dependencies, including the test runner: it's ~20 lines, below.
   Tests are the documentation that bites back.

   How this works: index.html brackets its pure logic between
   `@core-start` / `@core-end` markers. We slice that text out and run it
   in a bare `node:vm` context — no DOM, no browser, no mocks. If the core
   ever grows a `document.` in it, evaluation fails and this suite goes
   red. That's the architecture *enforced*, not just described.
   ========================================================================= */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const zlib = require('zlib');
const { createHash } = require('crypto');

const HTML_PATH = path.join(__dirname, '..', 'content', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const BYTES = Buffer.byteLength(html);

/* ---------- the runner (hand-rolled, on principle) ---------------------- */
let passed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
    catch (e) { failures.push(name); console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }
function eq(got, want, msg) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error((msg || 'not equal') + '\n      got:  ' + g + '\n      want: ' + w);
}

/* ---------- extract & evaluate the core --------------------------------- */
const MARK_A = '/* @core-start */', MARK_B = '/* @core-end */';
const a = html.indexOf(MARK_A), b = html.indexOf(MARK_B);

console.log('\ncore extraction');
test('both @core markers present, in order, exactly once', () => {
    ok(a !== -1 && b !== -1 && a < b, 'markers missing or out of order');
    ok(html.indexOf(MARK_A, a + 1) === -1 && html.indexOf(MARK_B, b + 1) === -1, 'duplicate markers');
});

const core = html.slice(a + MARK_A.length, b);

test('core is DOM-free (no document/window/localStorage/matchMedia)', () => {
    ok(!/\b(document|window|localStorage|matchMedia|navigator)\b/.test(core),
        'core references a browser global');
});

const csh = vm.runInNewContext(
    core + '\n;({ VERSION, PS1, THEMES, LOGO, LINKS, GREETING, parse, tenure, clock, Hist, complete, glyphAt, specsheet, dispatch, COMMANDS })',
    {}, { filename: 'csh-core.vm.js' });

test('core evaluates headless and exports the API', () => {
    eq(csh.VERSION, require('../package.json').version, 'index.html VERSION ≠ package.json');
    eq(typeof csh.dispatch, 'function');
});

/* ---------- helpers ------------------------------------------------------ */
const textOf   = (parts) => parts.map((p) => typeof p === 'string' ? p : p.t).join('');
const lnText   = (block) => textOf(block.ln);
const allText  = (blocks) => blocks.filter((x) => x.ln).map(lnText).join('\n');
const CTX = (iso = '2026-08-16T14:32:00', theme = 'green') =>
    ({ now: () => new Date(iso), theme: () => theme });

/* ---------- parse -------------------------------------------------------- */
console.log('\nparse');
test('splits on whitespace and trims', () => eq(csh.parse('  theme   amber '), ['theme', 'amber']));
test('whitespace-only input yields empty argv', () => eq(csh.parse('   '), []));

/* ---------- tenure & clock ----------------------------------------------- */
console.log('\ntenure & clock  (career anchored to Sep 2009)');
test('Aug 2026 → 16y 11m', () => eq(csh.tenure(new Date(2026, 7, 16)), { y: 16, m: 11 }));
test('Sep 2026 rolls over → 17y 0m', () => eq(csh.tenure(new Date(2026, 8, 1)), { y: 17, m: 0 }));
test('Aug 2027 → 17y 11m', () => eq(csh.tenure(new Date(2027, 7, 31)), { y: 17, m: 11 }));
test('clock zero-pads', () => eq(csh.clock(new Date(2026, 0, 1, 9, 5)), '09:05'));

/* ---------- history ------------------------------------------------------- */
console.log('\nhistory  (the readline contract)');
test('walks back through entries, newest first', () => {
    const h = new csh.Hist();
    h.push('help'); h.push('about');
    eq(h.prev(''), 'about');
    eq(h.prev('about'), 'help');
});
test('oldest entry repeats at the top of the walk', () => {
    const h = new csh.Hist();
    h.push('help');
    eq(h.prev(''), 'help');
    eq(h.prev('help'), 'help');
});
test('stashes the live line and restores it walking forward', () => {
    const h = new csh.Hist();
    h.push('help');
    eq(h.prev('half-typed'), 'help');
    eq(h.next(), 'half-typed');
});
test('next() past the live line is a no-op (null)', () => {
    const h = new csh.Hist();
    h.push('help');
    eq(h.next(), null);
});
test('consecutive duplicates collapse', () => {
    const h = new csh.Hist();
    h.push('help'); h.push('help'); h.push('help');
    eq(h.items, ['help']);
});
test('capacity is bounded', () => {
    const h = new csh.Hist(50);
    for (let i = 0; i < 60; i++) h.push('cmd' + i);
    eq(h.items.length, 50);
    eq(h.items[0], 'cmd10');
});
test('empty push records nothing but resets the walk', () => {
    const h = new csh.Hist();
    h.push('help');
    h.prev('');
    h.push('   ');
    eq(h.items, ['help']);
    eq(h.idx, 1);
});

/* ---------- completion ---------------------------------------------------- */
console.log('\ncompletion');
const NAMES = Object.keys(csh.COMMANDS);
test('unique prefix completes with a trailing space', () =>
    eq(csh.complete('neo', NAMES), { set: 'neofetch ' }));
test('ambiguous prefix lists the candidates', () => {
    const r = csh.complete('c', NAMES);
    ok(r && r.list && r.list.includes('cv') && r.list.includes('contacts') && r.list.includes('clear'));
});
test('no match, no action', () => eq(csh.complete('zz', NAMES), null));
test('empty line, no action', () => eq(csh.complete('', NAMES), null));
test('theme arguments complete too', () =>
    eq(csh.complete('theme a', NAMES), { set: 'theme amber ' }));
test('arguments of other commands do not', () =>
    eq(csh.complete('cv x', NAMES), null));

/* ---------- the cursor cell ------------------------------------------------ */
console.log('\nthe cursor cell  (one whole character, however many code units)');
test('plain text: the next character; end of line: nothing', () => {
    eq(csh.glyphAt('help', 1), 'e');
    eq(csh.glyphAt('help', 4), '');
});
const CLUSTERS = { rocket: '\u{1F680}', family: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', flag: '\u{1F1F3}\u{1F1FF}',
    'skin tone': '\u{1F44B}\u{1F3FD}', accent: 'e\u0301' };
test('an emoji, a family, a flag, a skin tone, an accent: each is one cell', () => {
    for (const [what, g] of Object.entries(CLUSTERS)) eq(csh.glyphAt('x' + g + 'y', 1), g, what);
});
test('without Intl.Segmenter (older browsers) an emoji is still never split', () => {
    const old = vm.runInNewContext('delete Intl.Segmenter;' + core + '\n;glyphAt', {});
    eq(old(CLUSTERS.rocket + 'y', 0), CLUSTERS.rocket);
    eq(old('help', 4), '');
});

/* ---------- commands ------------------------------------------------------- */
console.log('\ncommands  (pure: Blocks in, no DOM anywhere)');
test('help covers every registered command, each clickable', () => {
    const blocks = csh.dispatch('help', CTX());
    eq(blocks.length, NAMES.length);
    blocks.forEach((bl, i) => {
        eq(bl.ln[0].cmd, NAMES[i], 'row ' + i + ' not clickable or misordered');
    });
});
test('about keeps the owner\'s line intact', () => {
    ok(allText(csh.dispatch('about', CTX()))
        .includes('building teams, fintech, and great coffee'));
});
test('contacts carries all four channels as links', () => {
    const parts = csh.dispatch('contacts', CTX())[0].ln.filter((p) => p.a);
    eq(parts.map((p) => p.a),
        [csh.LINKS.email, csh.LINKS.linkedin, csh.LINKS.telegram, csh.LINKS.messenger]);
});
test('cv links both PDFs', () => {
    const hrefs = csh.dispatch('cv', CTX())[0].ln.filter((p) => p.a).map((p) => p.a);
    eq(hrefs, [csh.LINKS.cvEn, csh.LINKS.cvRu]);
});
test('social is the one-liner with @mureev', () => {
    ok(allText(csh.dispatch('social', CTX())).includes('Telegram: @mureev'));
});
test('whoami answers in id(1) format', () => {
    const t = allText(csh.dispatch('whoami', CTX()));
    ok(t.startsWith('constantine'));
    ok(t.includes('uid=2009(constantine) gid=42(engineering)'));
});
test('uptime uses the injected clock, not its own', () => {
    const t = allText(csh.dispatch('uptime', CTX('2026-08-16T14:32:00')));
    ok(t.includes('14:32'), 'clock not injected');
    ok(t.includes('up 16 years 11 months'), 'tenure wrong: ' + t);
});
test('uptime credits the fuel', () => {
    ok(allText(csh.dispatch('uptime', CTX())).includes('powered by good people & coffee'));
});
test('neofetch emits a data-only spec sheet', () => {
    const [blk] = csh.dispatch('neofetch', CTX('2026-08-16T14:32:00'));
    ok(blk.neo, 'no neo block');
    eq(blk.neo.fields.length, 9);
    eq(blk.neo.fields[4], ['Uptime', '16y 11m in software']);
    eq(blk.neo.palette.length, 6);
});
test('theme with no argument lists all five and the current one', () => {
    const t = allText(csh.dispatch('theme', CTX('2026-08-16', 'amber')));
    csh.THEMES.forEach((th) => ok(t.includes(th), th + ' missing'));
    ok(t.includes('(current: amber)'));
});
test('theme <name> confirms and emits the switch effect', () => {
    const blocks = csh.dispatch('theme amber', CTX());
    ok(allText(blocks).includes('theme set to amber'));
    eq(blocks[blocks.length - 1], { theme: 'amber' });
});
test('flat theme owns its past', () => {
    ok(allText(csh.dispatch('theme flat', CTX())).includes('very 2017.'));
});
test('unknown theme is an error, not an effect', () => {
    const blocks = csh.dispatch('theme neon', CTX());
    ok(allText(blocks).includes('unknown theme: neon'));
    ok(!blocks.some((b) => b.theme));
});
test('clear is a single effect block', () =>
    eq(csh.dispatch('clear', CTX()), [{ clear: true }]));
test('thisistheway ships the gif with a spoken fallback', () => {
    const [blk] = csh.dispatch('thisistheway', CTX());
    eq(blk.gif.alt, 'This is the way.');
    eq(blk.gif.w, 200);
});
test('unknown commands fail politely, help one click away', () => {
    const blocks = csh.dispatch('sudo', CTX());
    ok(allText(blocks).includes('csh: command not found: sudo'));
    ok(blocks[0].ln.some((p) => p.cmd === 'help'));
});
test('prototype names are not commands (constructor, __proto__)', () => {
    for (const n of ['constructor', '__proto__', 'CONSTRUCTOR'])
        ok(allText(csh.dispatch(n, CTX())).includes('command not found'), n);
});
test('empty line dispatches to nothing', () => eq(csh.dispatch('   ', CTX()), []));
test('dispatch is case-insensitive', () => {
    ok(allText(csh.dispatch('HELP', CTX())).includes('thisistheway'));
});

/* ---------- the output vocabulary, checked ----------------------------------- */
/* The core documents the only shapes a command may produce ("Output
   vocabulary" in index.html) and the renderer trusts that list blindly.
   Here the list stops being a comment and becomes a contract.             */
console.log('\nvocabulary  (every Block is one the renderer knows)');
const PART_KEYS = ['c', 'a', 'cmd'];
const isPart = (p) => typeof p === 'string'
    || (p !== null && typeof p === 'object' && typeof p.t === 'string'
        && Object.keys(p).every((k) => k === 't' || PART_KEYS.includes(k))
        && PART_KEYS.filter((k) => k in p).length <= 1);
function vocabularyError(b) {
    if (b === null || typeof b !== 'object') return 'not an object';
    const keys = Object.keys(b);
    const only = (...allowed) => keys.every((k) => allowed.includes(k));
    if ('ln' in b)    return only('ln') && Array.isArray(b.ln) && b.ln.every(isPart) ? null : 'malformed ln';
    if ('pre' in b)   return only('pre', 'cls') && typeof b.pre === 'string' ? null : 'malformed pre';
    if ('neo' in b)   return only('neo') && Array.isArray(b.neo?.fields) ? null : 'malformed neo';
    if ('gif' in b)   return only('gif') && typeof b.gif?.src === 'string' && typeof b.gif?.alt === 'string' ? null : 'malformed gif';
    if ('clear' in b) return only('clear') && b.clear === true ? null : 'malformed clear';
    if ('theme' in b) return only('theme') && csh.THEMES.includes(b.theme) ? null : 'malformed theme';
    return 'unknown Block shape {' + keys.join(', ') + '}';
}
test('every command, with or without an argument, speaks only the vocabulary', () => {
    for (const name of NAMES) {
        for (const arg of ['', ' amber', ' nope', ' constructor']) {
            for (const blk of csh.dispatch(name + arg, CTX())) {
                const err = vocabularyError(blk);
                ok(!err, `${name}${arg}: ${err}`);
            }
        }
    }
});

/* ---------- hostile input: the core never throws ------------------------------ */
/* What a visitor types is input from strangers. Every hostile atom is tried
   against every command name, in both orders, in both cases — a fixed table,
   so a red build names its input. Then a seeded generator (same lines every
   run) strings atoms together, because bugs like company. The 2026
   'constructor' crash — a prototype name typed into a terminal — is why
   this section exists. Invisible characters are written as escapes on
   purpose: this file must stay readable, and free of bidi surprises.       */
console.log('\nhostile input  (a fixed table, then seeded combinations)');
const ATOMS = [
    'constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
    '__defineGetter__', 'isPrototypeOf', 'Object', 'null', 'undefined', 'NaN', '-1', '1e309',
    '', ' ', '\t', '\n', '\r\n', '\u00a0', '\u2028', '\u3000', '\u0000', '\u202e', '\ufeff', '\u200d',
    '\ud83d\ude80', '\ud83d\udc69\u200d\ud83d\udcbb', '\u00e9', '\u0130', '\u00df', '\ufb03',
    '\u041a\u043e\u043d\u0441\u0442\u0430\u043d\u0442\u0438\u043d', '"', "'", '\\', '`', '$(rm -rf /)',
    '<script>alert(1)</script>', '&amp;', '%00', '../..', 'javascript:', 'x'.repeat(4096)
];
const WORDS = [...NAMES, ...csh.THEMES];
const show = (s) => JSON.stringify(s).slice(0, 80);
function survives(raw) {
    let blocks;
    try { blocks = csh.dispatch(raw, CTX()); }
    catch (e) { throw new Error(`dispatch threw on ${show(raw)}: ${e.message}`); }
    ok(Array.isArray(blocks), 'not a Block[] for ' + show(raw));
    for (const blk of blocks) { const err = vocabularyError(blk); ok(!err, `${err} for ${show(raw)}`); }
    ok(csh.parse(raw).every((w) => w && !/\s/.test(w)), 'parse leaked whitespace for ' + show(raw));
    const fx = blocks.filter((blk) => blk.theme);
    if (fx.length) {
        const argv = csh.parse(raw);
        ok(argv[0].toLowerCase() === 'theme' && csh.THEMES.includes(argv[1].toLowerCase()),
            'a theme switch from ' + show(raw));
    }
    let r;
    try { r = csh.complete(raw, NAMES); }
    catch (e) { throw new Error(`complete threw on ${show(raw)}: ${e.message}`); }
    ok(r === null || (typeof r.set === 'string' ? r.set.endsWith(' ') && !('list' in r)
        : Array.isArray(r.list) && r.list.length > 1), 'malformed completion for ' + show(raw));
}
const TABLE = [];
for (const atom of ATOMS) {
    TABLE.push(atom);
    for (const w of [...WORDS, 'theme']) {
        TABLE.push(w + ' ' + atom, atom + ' ' + w, w.toUpperCase() + '\t' + atom, ' ' + w + atom + ' ');
    }
}
test(`the table: ${TABLE.length} lines — every hostile atom against every command and theme`, () =>
    TABLE.forEach(survives));
test('the cursor walks any pair of hostile atoms glyph by glyph and rebuilds it exactly', () => {
    const short = ATOMS.filter((s) => s.length < 64);
    for (const x of short) for (const y of short) {
        const line = x + y;
        let rebuilt = '';
        for (let i = 0; i < line.length;) {
            const g = csh.glyphAt(line, i);
            ok(g.length > 0, 'an empty cell inside ' + show(line));
            rebuilt += g; i += g.length;
        }
        ok(rebuilt === line, 'rebuilt ' + show(rebuilt) + ' from ' + show(line));
    }
});

function mulberry32(seed) {   // tiny, deterministic, good enough for this job
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(20090901);            // the career's first day, as a seed
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const SEPS = [' ', '  ', '\t', '', '\u3000'];
const fuzzLine = () => Array.from({ length: 1 + Math.floor(rand() * 4) },
    () => pick(rand() < 0.5 ? ATOMS : WORDS)).join(pick(SEPS));
const N = 5000;
test(`seeded combinations: ${N} lines of up to four atoms`, () => {
    for (let i = 0; i < N; i++) survives(fuzzLine());
});
test('history: 10,000 seeded operations on a 5-slot history, invariants after each', () => {
    const h = new csh.Hist(5);                // small, so the walk keeps hitting both ends
    for (let i = 0; i < 10000; i++) {
        const op = rand();
        if (op < 0.35) h.push(fuzzLine());
        else if (op < 0.7) h.prev(fuzzLine());
        else if (op < 0.95) h.next();
        else h.reset();
        ok(h.items.length <= 5, 'over capacity');
        ok(h.idx >= 0 && h.idx <= h.items.length, 'walk out of bounds: ' + h.idx);
        ok(h.items.every((v, j) => v && v === v.trim() && v !== h.items[j - 1]),
            'stored an empty, untrimmed or repeated entry');
    }
});

/* ---------- content guards -------------------------------------------------- */
console.log('\ncontent guards');
test('the greeting typo stays fixed ("hard work." — no stray ?)', () => {
    const flat = csh.GREETING.map(textOf).join('\n');
    ok(flat.includes('I believe in good people, curiosity & hard work.'));
    ok(!flat.includes('hard work.?'));
});
test('the greeting links Renmoney', () => {
    ok(csh.GREETING.some((l) => l.some?.((p) => p.a === csh.LINKS.renmoney)));
});
test('the command set is the approved eleven (AGENTS.md rule 5 — change only with sign-off)', () =>
    eq(NAMES, ['help', 'about', 'contacts', 'cv', 'social', 'whoami', 'uptime',
        'neofetch', 'theme', 'clear', 'thisistheway']));
test('the themes are the approved five', () =>
    eq(csh.THEMES, ['green', 'amber', 'mono', 'crt', 'flat']));
test('JSON-LD parses and says what the terminal says', () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    ok(m, 'no JSON-LD block');
    const ld = JSON.parse(m[1]);
    const role = csh.specsheet(CTX()).fields.find(([k]) => k === 'Role')[1];
    eq(ld.name, 'Constantine Mureev');
    eq(ld.email, csh.LINKS.email);
    eq(ld.jobTitle, role, 'jobTitle ≠ the spec sheet Role');
    eq(ld.worksFor.url, csh.LINKS.renmoney);
    for (const k of ['linkedin', 'telegram', 'messenger'])
        ok(ld.sameAs.includes(csh.LINKS[k]), k + ' missing from sameAs');
});

/* ---------- legibility ---------------------------------------------------------
   WCAG 2 AA: text this size needs 4.5:1 against its background, in every
   theme — read from the CSS tokens themselves, so a palette tweak can't
   quietly undo it. Dim text is translucent phosphor: composite it over the
   background first, rounding down to 8 bits (dimmer: the worst case). The
   CRT glass above — scanlines, vignette — dims text and background alike;
   it is decoration, and `prefers-contrast: more` takes it away. */
console.log('\nlegibility  (WCAG 2 AA, measured from the CSS tokens)');
const STYLE = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const tokensOf = (selector) => {
    const at = STYLE.indexOf(selector + ' {');
    if (at === -1) return {};
    const body = STYLE.slice(at, STYLE.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const rgbOf = (value, under) => {
    const h = /^#([0-9a-f]{6})$/i.exec(value);
    if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16));
    const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
    return m && under ? under.map((u, i) => Math.floor(m[i + 1] * m[4] + u * (1 - m[4]))) : null;
};
const luminance = (rgb) => rgb.map((c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (x, y) => {
    const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
};
for (const theme of csh.THEMES) {
    const t = { ...tokensOf(':root'), ...tokensOf(`html[data-theme="${theme}"]`) };
    const bg = rgbOf(t['--bg']);
    const ratios = ['--fg', '--fg-dim', '--fg-hi'].map((k) => {
        const fg = bg && rgbOf(t[k], bg);
        return [k, fg ? contrast(fg, bg) : NaN];
    });
    test(`${theme}: ` + ratios.map(([k, r]) => `${k.slice(2)} ${r.toFixed(2)}`).join(', ') + ' — each ≥ 4.5:1', () => {
        for (const [k, r] of ratios) ok(r >= 4.5, `${k} = ${t[k]} on ${t['--bg']} is ${r.toFixed(2)}:1`);
    });
}

/* ---------- the CSP keeps up with the code -------------------------------------
   Every page carries its own Content-Security-Policy in a <meta>, ahead of
   anything it governs. Each inline <script> and <style> is allowed by its
   sha256 and nothing else is, so an edit to one changes its hash and this
   section goes red, printing the policy to paste. The e2e suite is the
   second opinion: a stale hash there is a blocked script and a console
   error. A <script> typed as data (the JSON-LD) never runs, so needs none. */
console.log('\nCSP  (each page\'s <meta> policy vs. its own inline blocks)');
const CONTENT = path.join(__dirname, '..', 'content');
const BLOCKS  = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const JS_TYPE = /^(module|(text|application)\/(x-)?(java|ecma)script)$/i;
const sha256  = (s) => `'sha256-${createHash('sha256').update(s.replace(/\r\n?/g, '\n')).digest('base64')}'`;
const policyOf = (content) => new Map(content.split(';').map((d) => d.trim().split(/\s+/))
    .filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
for (const f of fs.readdirSync(CONTENT).filter((n) => n.endsWith('.html')).sort()) {
    const page = fs.readFileSync(path.join(CONTENT, f), 'utf8');
    const metas = [...page.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
    const want = { 'script-src': [], 'style-src': [] };
    let firstBlock = page.length;
    for (const m of page.matchAll(BLOCKS)) {
        const [, tag, attrs, body] = m;
        if (!tag) continue;                                         // a comment
        firstBlock = Math.min(firstBlock, m.index);
        const type = (/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs) || [])[1];
        if (tag.toLowerCase() === 'script' && type && !JS_TYPE.test(type)) continue;   // data, not code
        want[tag.toLowerCase() === 'script' ? 'script-src' : 'style-src'].push(sha256(body));
    }
    test(`${f}: exactly one CSP <meta>, ahead of every <script> and <style>`, () =>
        ok(metas.length === 1 && metas[0].index < firstBlock,
            metas.length === 1 ? 'the CSP <meta> must come before the first <script> or <style>' : `${metas.length} CSP <meta> tags`));
    if (metas.length !== 1) continue;
    const policy = policyOf(metas[0][1]);
    test(`${f}: script-src and style-src allow its inline blocks, by hash, and nothing else`, () => {
        const fixed = new Map(policy);
        for (const [dir, hashes] of Object.entries(want)) {
            if (hashes.length) fixed.set(dir, hashes); else fixed.delete(dir);
        }
        const line = [...fixed].map(([d, s]) => [d, ...s].join(' ')).join('; ');
        ok(line === [...policy].map(([d, s]) => [d, ...s].join(' ')).join('; '),
            `inline code changed; paste this as the CSP <meta> content in ${f}:\n      ${line}`);
    });
    test(`${f}: everything else is denied — no base, no forms, no default sources`, () => {
        for (const d of ['default-src', 'base-uri', 'form-action']) eq(policy.get(d), ["'none'"], d);
        ok(![...policy.values()].flat().some((s) => /unsafe|^\*$|^(data|blob|https?):$/.test(s)), 'a wildcard or unsafe- source');
    });
}
const INDEX_POLICY = policyOf((/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html) || [])[1] || '');
test('index.html: Trusted Types on, no policies — no string can become markup', () => {
    eq(INDEX_POLICY.get('require-trusted-types-for'), ["'script'"]);
    eq(INDEX_POLICY.get('trusted-types'), ["'none'"]);
});
test('index.html: img-src admits the gif, and nothing else from elsewhere', () =>
    eq(INDEX_POLICY.get('img-src'), ["'self'", new URL(csh.LINKS.gif).origin]));
test('the gif link carries no tracking parameters', () =>
    ok(!new URL(csh.LINKS.gif).search, csh.LINKS.gif));

/* ---------- whole-file invariants: the soul of the project ------------------ */
console.log('\ninvariants  (regression tests for the soul of the project)');
test('zero external scripts — the whole point', () =>
    ok(!/<script[^>]*\ssrc=/i.test(html), 'found a <script src=...>'));
test('jQuery survives only in the eulogy (comments), never in code', () =>
    ok(!/jquery/i.test(html.replace(/<!--[\s\S]*?-->/g, '')),
        'jquery referenced outside an HTML comment'));
test('no page loads anything from elsewhere (every content/*.html)', () => {
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'content')).filter((f) => f.endsWith('.html'))) {
        const page = fs.readFileSync(path.join(__dirname, '..', 'content', f), 'utf8');
        ok(!/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet/i.test(page), f + ' loads an external script or stylesheet');
    }
});
test('contact facts agree: LINKS = no-JS fallback = llms.txt', () => {
    const llms = fs.readFileSync(path.join(__dirname, '..', 'content', 'llms.txt'), 'utf8');
    const fallback = html.slice(html.indexOf('<main id="fallback">'), html.indexOf('</main>'));
    for (const k of ['email', 'linkedin', 'telegram', 'messenger', 'cvEn', 'cvRu']) {
        ok(fallback.includes(csh.LINKS[k]), k + ' missing from #fallback');
        ok(llms.includes(csh.LINKS[k].replace(/^mailto:/, '')), k + ' missing from llms.txt');
    }
});
test('the GitHub profile intro (top of README.md) names what the greeting links to', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const intro = readme.slice(0, readme.indexOf('\n---'));
    const linked = csh.GREETING.flat().filter((p) => p && p.a).map((p) => p.t);
    ok(linked.length > 0, 'the greeting links nothing — give this test a new anchor');
    for (const name of linked) ok(intro.includes(name), name + ' missing from the README profile intro');
});
test('no Trojan Source: no bidi controls or invisible characters in any text file', () => {
    const ROOT = path.join(__dirname, '..'), hidden = /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200E\u200F\uFEFF]/;
    const TEXT = /\.(html|txt|md|js|py|ya?ml|conf|inc|json)$|^(Dockerfile|LICENSE|\.[a-z]+ignore)$/;
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === '.git' || e.name === 'node_modules' ? []
            : e.isDirectory() ? walk(path.join(dir, e.name))
            : TEXT.test(e.name) ? [path.join(dir, e.name)] : []);
    for (const f of walk(ROOT)) {
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        const i = lines.findIndex((l) => hidden.test(l));
        ok(i === -1, path.relative(ROOT, f) + ':' + (i + 1) + ' hides a character (write it as an escape)');
    }
});
test('the dead analytics snippet stays dead', () =>
    ok(!html.includes('UA-111817231')));
test(`size budget: raw ≤ 48 KB (now ${(BYTES / 1024).toFixed(1)} KB)`, () =>
    ok(BYTES <= 48 * 1024, 'index.html got fat — features pay rent in bytes'));
test((() => {
    const gz = zlib.gzipSync(html).length;
    return `size budget: gzipped ≤ 14 KB (now ${(gz / 1024).toFixed(1)} KB)`;
})(), () => ok(zlib.gzipSync(html).length <= 14 * 1024, 'gzipped budget blown'));

/* ---------- summary ---------------------------------------------------------- */
console.log('\n' + passed + '/' + (passed + failures.length) + ' unit tests passed'
    + (failures.length ? '  \x1b[31m(' + failures.length + ' failed)\x1b[0m' : ''));
process.exit(failures.length ? 1 : 0);
