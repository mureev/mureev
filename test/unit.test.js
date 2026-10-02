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
    core + '\n;({ VERSION, PS1, THEMES, LOGO, LINKS, GREETING, parse, tenure, clock, Hist, complete, specsheet, dispatch, COMMANDS })',
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
