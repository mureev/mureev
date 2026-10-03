#!/usr/bin/env node
/* =========================================================================
   End-to-end suite for mureev.com — the terminal in a real browser.

   The unit suite (unit.test.js) proves the core logic; this file proves
   the *experience*: boot, typing, history, completion, themes, keyboard
   and screen-reader access, mobile, and the no-JS fallback — in actual
   Chromium via Playwright, the one and only devDependency this repo
   allows itself — and, pointed at a server, what the server sends.

   We do not mock the DOM. The DOM is the product.
   ========================================================================= */
'use strict';

const { chromium, request } = require('playwright');
const path = require('path');
const tls = require('tls');

/* The page under test: the file itself, or — with E2E_URL — a served copy
   (CI aims it at the built image: same suite, plus what only a server can
   get wrong — headers, types, caching, errors). Over https it is
   production, with the TLS proxy in front. */
const SITE = process.env.E2E_URL || 'file://' + path.resolve(__dirname, '..', 'content', 'index.html');
const SERVED = /^https?:/.test(SITE), LIVE = SITE.startsWith('https:');

const DESKTOP = { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' };

/* ---------- the runner (hand-rolled, like the unit suite's) ---------- */
let passed = 0;
const failures = [];
const check = (name, cond, extra = '') => {
    if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
    else { failures.push(name); console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (extra ? '\n      ' + extra : '')); }
};

/* Each section runs in a browser context of its own — storage, permissions,
   pages — opened with its options and closed after it, in the order below.
   A section with no options needs no browser. */
const sections = [];
const section = (title, options, body) => sections.push({ title, options, body });

/* Every page of the session reports here. CSP and Trusted Types violations
   are console errors, so a stale hash in a page's policy surfaces as one —
   and so does anything a page tries to fetch from a host it shouldn't. */
const errors = [], fetched = [];
const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => { if (!r.isNavigationRequest()) fetched.push(r.url()); });
    return page;
};

/* Any key skips the boot theater; the motd is its last line. */
const skipBoot = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'));
};

/* What the sections keep asking a page: what the prompt holds, what has
   focus, how often the output has said something — and a key, pressed and
   given a moment to land. */
const probes = (page) => ({
    prompt: () => page.locator('#kbd').inputValue(),
    focused: () => page.evaluate(() => {
        const a = document.activeElement;
        return a.id || (a.matches('a') ? 'link:' : a.matches('.cmd') ? 'cmd:' : a.tagName + ':') + a.textContent.trim();
    }),
    tally: (s) => page.evaluate((s) => document.querySelector('#out').innerText.split(s).length - 1, s),
    press: async (k) => { await page.keyboard.press(k); await page.waitForTimeout(60); }
});

/* Links get followed; nothing leaves the machine. */
const offline = (context) => context.route((u) => /^https?:$/.test(u.protocol) && u.origin !== new URL(SITE).origin,
    (r) => r.fulfill({ body: '' }));

/* ---------- desktop ---------- */
section('desktop (1440×900)', DESKTOP, async (context) => {
    const page = watch(await context.newPage());
    await page.goto(SITE);
    await skipBoot(page);

    const term = () => page.locator('#term').innerText();
    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const run = async (cmd) => {
        await page.keyboard.type(cmd, { delay: 5 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(120);
        return term();
    };

    check('boot greeting rendered', (await term()).includes("G'day, I'm Constantine Mureev."));
    check('motd plants the flag', (await term()).includes('zero dependencies'));

    let t = await run('help');
    check('help lists the full registry', t.includes('thisistheway') && t.includes('neofetch') && t.includes('theme'));
    t = await run('about');
    check('about', t.includes('building teams, fintech, and great coffee'));
    t = await run('whoami');
    check('whoami', t.includes('uid=2009(constantine)'));
    t = await run('uptime');
    check('uptime computes live', /up \d+ years \d+ months/.test(t));
    await run('contacts');
    check('contacts renders real links',
        (await page.locator('#out a[href="https://www.linkedin.com/in/mureev/"]').count()) >= 1);
    await run('cv');
    check('cv links the PDFs',
        (await page.locator('#out a[href*="Constantine%20Mureev.pdf"]').count()) >= 1);
    t = await run('social');
    check('social one-liner', t.includes('Telegram: @mureev'));
    t = await run('neofetch');
    check('neofetch spec sheet', t.includes('Renmoney') && t.includes('csh — the Constantine shell') &&
        (await page.locator('#out .neo .sw').count()) === 6);

    /* themes */
    await run('theme amber');
    check('theme amber applies', (await theme()) === 'amber');
    await page.reload();
    await skipBoot(page);
    check('theme survives a reload (localStorage)', (await theme()) === 'amber', await theme());
    await run('theme crt');
    check('theme crt applies', (await theme()) === 'crt');
    await run('theme green');

    /* the shell around the commands */
    t = await run('sudo');
    check('unknown command → csh error', t.includes('csh: command not found: sudo'));
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(60);
    check('history ↑ recalls', (await page.locator('#row').innerText()).includes('sudo'));
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(60);
    check('history ↑↑ walks back', (await page.locator('#row').innerText()).includes('theme green'));
    await page.keyboard.press('Control+c');
    await page.keyboard.type('neo', { delay: 5 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    check('tab completion', (await page.locator('#row').innerText()).includes('neofetch'));
    await page.keyboard.press('Control+c');

    const before = (await term()).split('this list').length;
    await page.locator('#out .cmd', { hasText: 'help' }).first().click();
    await page.waitForTimeout(120);
    check('clickable commands execute', (await term()).split('this list').length > before);

    /* the one thing loaded from elsewhere: the CSP must let the gif in. giphy
       itself is stubbed — this tests our policy, not their CDN */
    const giphy = (body) => page.route('https://media1.giphy.com/**', (r) => r.fulfill({ contentType: 'image/gif', body }));
    await giphy('');                                  // the gif that never comes
    await run('thisistheway');
    check('a gif that can\'t load leaves its words in its place', await page.waitForFunction(() => {
        const last = document.querySelector('#out').lastElementChild;
        return !last.querySelector('img') && last.textContent === 'This is the way.' &&
            last.previousElementSibling.textContent.endsWith('thisistheway');
    }, null, { timeout: 3000 }).then(() => true, () => false));
    await giphy(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    await run('thisistheway');
    check('thisistheway: the gif gets through the CSP, sending no referrer', await page.waitForFunction(() => {
        const img = document.querySelector('#out img');
        return img && img.complete && img.naturalWidth > 0 && img.referrerPolicy === 'no-referrer';
    }, null, { timeout: 3000 }).then(() => true, () => false));

    await run('clear');
    check('clear wipes the scrollback', !(await page.locator('#out').innerText()).trim());

    /* the hooks */
    const api = await page.evaluate(() => ({
        exposed: typeof window.csh === 'object',
        frozen: Object.isFrozen(window.csh),
        version: window.csh?.VERSION
    }));
    check('window.csh exposed for tests and console explorers',
        api.exposed && api.frozen && api.version === require('../package.json').version);
});

/* ---------- keyboard & screen readers ---------- */
section('keyboard & screen readers', DESKTOP, async (context) => {
    await offline(context);
    const page = watch(await context.newPage());
    await page.goto(SITE);
    await skipBoot(page);
    const { renmoney, themes } = await page.evaluate(() => ({ renmoney: csh.LINKS.renmoney, themes: [...csh.THEMES] }));

    /* what a screen reader can reach once the boot is over: the greeting,
       its link and its command — and nothing hidden but the ASCII logo */
    const readable = async (pg) => {
        const tree = await pg.locator('#out').ariaSnapshot();
        const hidden = await pg.evaluate(() => [...document.querySelectorAll('#out [aria-hidden="true"]')].map((n) => n.className));
        return { ok: tree.includes("G'day, I'm Constantine Mureev.") && tree.includes('link "Renmoney"') &&
            tree.includes('button "help"') && JSON.stringify(hidden) === '["logo"]', hidden };
    };
    const skipped = await readable(page);
    check('a skipped boot leaves the whole greeting to screen readers — only the logo is hidden',
        skipped.ok, JSON.stringify(skipped.hidden));

    const { focused, tally, prompt, press } = probes(page);

    const cursorLook = () => page.evaluate(() => {
        const s = getComputedStyle(document.getElementById('cursor'));
        return s.animationName === 'none' && s.boxShadow.includes('inset') ? 'hollow' : s.animationName;
    });
    const solid = await cursorLook();
    await press('Shift+Tab');
    check('Shift+Tab leaves the prompt for the newest command', (await focused()) === 'cmd:help');
    const hollow = await cursorLook();
    check('…and the blinking block goes hollow: it is the prompt\'s focus indicator',
        solid === 'blink' && hollow === 'hollow', solid + ' → ' + hollow);
    await press('Shift+Tab'); await press('Shift+Tab');          // up past the first link, out of the page
    const walk = [];
    for (let i = 0; i < 3; i++) { await press('Tab'); walk.push(await focused()); }
    check('Tab walks the output — a link, then a command — and back to the prompt',
        walk.join(' ') === 'link:Renmoney cmd:help kbd', walk.join(' → '));

    for (const key of ['Enter', ' ']) {
        await page.locator('#out .cmd', { hasText: 'help' }).first().focus();
        const n = await tally('this list');
        await press(key);
        check(`${key === ' ' ? 'Space' : 'Enter'} on a focused command runs it once, back to an empty prompt`,
            (await tally('this list')) === n + 1 && (await prompt()) === '' && (await focused()) === 'kbd',
            JSON.stringify({ runs: (await tally('this list')) - n, prompt: await prompt() }));
    }

    await page.keyboard.type('about');                     // half-typed, not executed
    const echoes = await tally('~$');
    await page.locator('#out a', { hasText: 'Renmoney' }).first().focus();
    const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await press('Enter');
    const opened = await popup;
    if (opened) await opened.waitForLoadState().catch(() => {});
    await press(' ');
    check('Enter on a focused link follows it — the prompt is neither typed into nor run',
        opened && opened.url().startsWith(renmoney) && (await prompt()) === 'about' && (await tally('~$')) === echoes,
        JSON.stringify({ popup: opened && opened.url(), prompt: await prompt() }));
    if (opened) await opened.close();
    await page.keyboard.type('x');
    check('typing on a focused link still lands in the prompt', (await prompt()) === 'aboutx' && (await focused()) === 'kbd');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.type('y');
    check('…and so does typing with nothing focused', (await prompt()) === 'aboutxy');
    await press('Control+u');

    await page.keyboard.type('neofetch'); await press('Enter');
    await page.keyboard.type('xyzzy');
    const tree = await page.locator('body').ariaSnapshot();
    check('the terminal is a main landmark holding a log and the input — not an application',
        /^- main "Interactive terminal[^"]*":\n {2}- log:/.test(tree) && tree.includes('- textbox "Terminal input"') && !tree.includes('application'),
        tree.slice(0, 120));
    check('the ASCII logo and box-drawing rules stay out of the accessibility tree',
        (await page.locator('#out pre.logo').count()) === 2 && !/[█╗╔║╚╝═─]/.test(tree));
    check('the mirrored prompt row is not read twice', !tree.includes('~$ xyzzy'));
    await press('Control+u');

    for (const theme of themes) {
        await page.locator('#kbd').focus();
        await page.keyboard.type('theme ' + theme); await press('Enter');
        const rings = [];
        for (const el of ['#out a', '#out .cmd']) {
            await press('Shift');                          // keyboard modality, as after a Tab
            await page.locator(el).last().focus();
            rings.push(await page.evaluate(() => {
                const s = getComputedStyle(document.activeElement);
                return document.activeElement.matches(':focus-visible') && s.outlineStyle === 'solid' &&
                    parseFloat(s.outlineWidth) >= 2 && s.outlineColor === s.color;    // both are drawn in --fg-hi
            }));
        }
        check(`keyboard focus on a link and a command: 2px --fg-hi outline (${theme})`, rings.every(Boolean));
    }
    await page.locator('#kbd').focus();
    await page.keyboard.type('theme green'); await press('Enter');

    await page.emulateMedia({ forcedColors: 'active' });
    const cell = () => page.evaluate(() => {
        const s = getComputedStyle(document.getElementById('cursor'));
        return s.backgroundColor + ' / ' + s.outlineStyle;
    });
    await page.locator('#kbd').focus();
    const focusedCell = await cell();
    await press('Shift+Tab');
    const blurredCell = await cell();
    check('forced colors: the cursor still tells focus apart — a solid block, then an outline',
        focusedCell !== blurredCell && !focusedCell.endsWith('solid') && blurredCell.endsWith('solid'),
        focusedCell + ' → ' + blurredCell);
    await page.locator('#kbd').focus();
    await page.emulateMedia({ forcedColors: 'none', contrast: 'more' });
    check('prefers-contrast: more drops the glow and the glass', await page.evaluate(() =>
        getComputedStyle(document.body).textShadow === 'none' && getComputedStyle(document.getElementById('fx')).display === 'none'));
    await page.emulateMedia({ contrast: 'no-preference' });

    /* the boot theater, untouched: every greeting line reaches the live
       region once — never character by character */
    const reader = watch(await context.newPage());
    await reader.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        window.__updates = 0;
        const heard = (r) => {                       // something new, on the page, not hidden from assistive tech
            const n = r.type === 'childList' ? r.addedNodes[0] : r.target;
            const el = n && (n.nodeType === 1 ? n : n.parentElement);
            return !!el && el.isConnected && !el.closest('[aria-hidden="true"]');
        };
        new MutationObserver((recs) => { if (recs.some(heard)) window.__updates++; })
            .observe(document.getElementById('out'), { childList: true, subtree: true, characterData: true, attributes: true });
    }));
    await reader.goto(SITE);
    await reader.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'), null, { timeout: 15000 });
    const updates = await reader.evaluate(() => window.__updates);
    const greeting = await reader.evaluate(() => window.csh.GREETING.length);
    check('screen readers hear the boot line by line, not keystroke by keystroke',
        updates >= greeting && updates <= greeting + 2, updates + ' live updates for ' + greeting + ' lines');
    const watched = await readable(reader);
    check('…and once it is typed out, all of it stays readable — only the logo is hidden',
        watched.ok, JSON.stringify(watched.hidden));

    const reduced = watch(await context.newPage());
    await reduced.emulateMedia({ reducedMotion: 'reduce' });
    await reduced.goto(SITE);
    const first = await reduced.locator('#out').innerText();
    check('reduced motion: the whole greeting is there at load, no typing',
        first.includes("G'day, I'm Constantine Mureev.") && first.includes('Type help for commands.') && first.includes('motd'));
});

/* ---------- mouse & selection ---------- */
section('mouse & selection', DESKTOP, async (context) => {
    await offline(context);
    const page = watch(await context.newPage());
    await page.goto(SITE);
    await skipBoot(page);
    const { focused, tally, prompt, press } = probes(page);

    await page.keyboard.type('whoami'); await press('Enter');
    const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await page.locator('#out a', { hasText: 'Renmoney' }).first().click();
    const opened = await popup;
    if (opened) await opened.close();
    await press('ArrowUp');
    check('after a mouse click on a link, the prompt has the keys again (↑ recalls history)',
        opened && (await focused()) === 'kbd' && (await prompt()) === 'whoami', JSON.stringify({ focus: await focused(), prompt: await prompt() }));
    await press('Control+u');
    const helps = await tally('this list');
    await page.locator('#out .cmd', { hasText: 'help' }).first().click({ button: 'right' });
    await page.waitForTimeout(100);
    check('a right-click on a command runs nothing: the context menu is the browser\'s', (await tally('this list')) === helps);
    await page.locator('#kbd').focus();

    await page.keyboard.type('whoami'); await press('Enter');
    const tabs = context.pages().length;
    await page.locator('#out a', { hasText: 'Renmoney' }).first().click({ button: 'middle' });
    await page.waitForTimeout(150);
    for (const extra of context.pages().slice(tabs)) await extra.close();
    await press('ArrowUp');
    check('…a middle-click (a background tab) hands the keys back too', (await focused()) === 'kbd' && (await prompt()) === 'whoami',
        JSON.stringify({ focus: await focused(), prompt: await prompt() }));
    await press('Control+u');

    /* a drag that ends on a link or a command is a selection: it is kept for
       copying, and nothing opens or runs */
    const drag = async (target) => {
        await target.scrollIntoViewIfNeeded();
        const to = await target.boundingBox(), from = await target.locator('xpath=..').boundingBox();
        await page.mouse.move(from.x + 2, to.y + to.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(100);
        return page.evaluate(() => String(getSelection()));
    };
    await page.keyboard.type('contacts'); await press('Enter');
    const picked = await drag(page.locator('#out a[href^="mailto:"]').last());
    await press('ControlOrMeta+c');
    check('a drag-selection that ends on a link stays selected, and copies',
        picked.startsWith('Email me at') && picked.endsWith('constantine@mureev.com') &&
        (await page.evaluate(() => navigator.clipboard.readText())) === picked, JSON.stringify(picked));
    const ranHelp = await tally('this list');
    const dragged = await drag(page.locator('#out .cmd', { hasText: 'help' }).first());
    check('…and one that ends on a command runs nothing', dragged.endsWith('help') && (await tally('this list')) === ranHelp,
        JSON.stringify(dragged));
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.locator('#kbd').focus();

    await page.evaluate(() => {
        document.activeElement.blur();
        getSelection().selectAllChildren([...document.querySelectorAll('#out .ln')].find((l) => l.textContent === 'Ready to chat?'));
    });
    const carets = await tally('^C');
    await press('ControlOrMeta+c');
    check('copying selected output copies it (no stray ^C, selection kept)',
        (await page.evaluate(() => navigator.clipboard.readText())) === 'Ready to chat?' && (await tally('^C')) === carets &&
        (await page.evaluate(() => String(getSelection()))) === 'Ready to chat?');
});

/* ---------- input edge cases ---------- */
section('input edge cases', DESKTOP, async (context) => {
    const page = watch(await context.newPage());
    await page.goto(SITE);
    await skipBoot(page);
    const typed = () => page.evaluate(() => [...document.querySelectorAll('#out .ln')]
        .map((l) => l.textContent).filter((l) => l.startsWith(csh.PS1)).map((l) => l.slice(csh.PS1.length)));
    const { prompt } = probes(page);

    await page.evaluate(() => navigator.clipboard.writeText('whoami\r\nuptime\nabo'));
    await page.locator('#kbd').focus();
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(150);
    check('a multi-line paste runs line by line; the unfinished last line waits at the prompt',
        JSON.stringify((await typed()).slice(-2)) === '["whoami","uptime"]' && (await prompt()) === 'abo' &&
        (await page.locator('#out').innerText()).includes('uid=2009(constantine)'),
        JSON.stringify({ ran: await typed(), prompt: await prompt() }));
    await page.locator('#kbd').evaluate((k) => {        // what some Android keyboards send for "go"
        k.value = 'who\nami';
        k.dispatchEvent(new InputEvent('input', { inputType: 'insertLineBreak' }));
    });
    check('a newline typed mid-line (a mobile "go" key) runs the whole line',
        (await typed()).at(-1) === 'whoami' && (await prompt()) === '', JSON.stringify((await typed()).slice(-2)));
    const ranBefore = (await typed()).length;
    await page.evaluate(() => navigator.clipboard.writeText('whoami\n'.repeat(150) + 'tail'));
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(300);
    const ranNow = (await typed()).length - ranBefore;
    check('a huge paste runs its first 100 lines and says so, rather than freeze the tab; the unfinished line waits',
        ranNow === 100 && (await page.locator('#out').innerText()).includes('csh: paste: ran 100 of 150 lines') &&
        (await prompt()) === 'tail', ranNow + ' lines ran; prompt ' + JSON.stringify(await prompt()));
    await page.keyboard.press('Control+u');
    await page.keyboard.type('hi \u{1F44B}\u{1F3FD} there');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);                     // the mirror follows on selectionchange
    const cells = await page.evaluate(() => ['pre', 'cursor', 'post'].map((i) => document.getElementById(i).textContent));
    check('the cursor sits on a whole emoji, never half of one',
        JSON.stringify(cells) === JSON.stringify(['hi ', '\u{1F44B}\u{1F3FD}', ' there']), JSON.stringify(cells));
    check('mobile keyboards are asked to leave commands alone: no autocorrect, capitals or spellcheck',
        await page.locator('#kbd').evaluate((k) =>
            k.getAttribute('autocorrect') === 'off' && k.getAttribute('autocapitalize') === 'off' && !k.spellcheck));
    await page.keyboard.press('Control+u');
    await page.keyboard.type('hello');
    const ends = [];
    for (const key of ['Home', 'End']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(100);
        ends.push(await page.evaluate(() => document.getElementById('pre').textContent));
    }
    check('Home and End go to the ends of the line, not one character', JSON.stringify(ends) === '["","hello"]', JSON.stringify(ends));
});

/* ---------- mobile ---------- */
section('mobile (390×844, touch)', PHONE, async (context) => {
    const page = watch(await context.newPage());
    await page.addInitScript(() => {                   // note every mouse listener the page adds
        window.__mouse = [];
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, ...rest) {
            if (/^(mouse(down|up|move|over|out)|click|auxclick|dblclick)$/.test(type))
                window.__mouse.push(type + ' on ' + (this.id || this.nodeName || 'window'));
            return add.call(this, type, ...rest);
        };
    });
    await page.goto(SITE);
    const mice = await page.evaluate(() => window.__mouse);  // the page's own: Playwright adds its listeners later
    await page.waitForFunction(() =>                  // let the boot type itself out
        document.querySelector('#term').innerText.includes('Type help for commands.'),
        null, { timeout: 15000 }).catch(() => {});    // on timeout the check below reports it
    const mt = await page.locator('#term').innerText();
    check('boot completes untouched', mt.includes('Type help for commands.'));
    check('coarse pointers get the tap hint', mt.includes('[tap anywhere to type]'));
    await page.evaluate(() => {                         // count every time the prompt takes focus
        window.__focus = 0;
        document.getElementById('kbd').addEventListener('focus', () => window.__focus++);
    });
    await page.locator('#out .cmd', { hasText: 'help' }).first().tap();
    await page.waitForTimeout(150);
    check('a tapped command runs, and no keyboard rises over its output',
        (await page.locator('#out').innerText()).includes('this list') && (await page.evaluate(() => window.__focus)) === 0);
    await page.locator('#out pre.logo').first().tap();
    await page.waitForTimeout(100);
    check('a tap anywhere else focuses the prompt, and it stays focused',
        (await page.evaluate(() => document.activeElement.id)) === 'kbd');
    const under = await page.evaluate(() => {
        const r = document.getElementById('row').getBoundingClientRect(), k = document.getElementById('kbd').getBoundingClientRect();
        return Math.abs(k.top - r.bottom) <= 2 && Math.abs(k.left - r.left) <= 2;
    });
    check('the hidden input sits under the prompt, so a phone revealing it reveals the prompt', under);
    const swipe = await context.newCDPSession(page);
    await page.evaluate(() => document.activeElement.blur());
    const focusedSoFar = await page.evaluate(() => window.__focus);
    await swipe.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
    for (const dy of [15, 45, 90]) await swipe.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 - dy }] });
    await swipe.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    check('a swipe is not a tap: no keyboard',
        (await page.evaluate(() => window.__focus)) === focusedSoFar && (await page.evaluate(() => document.activeElement.id)) !== 'kbd');
    /* WebKit treats a page with any mousedown/mouseup/click/mousemove
       listener as clickable everywhere: every tap becomes a click, whose
       mousedown blurs the prompt — on iPhones the keyboard rose and fell.
       Chromium can't show that, so hold the cause instead. */
    check('no mouse listeners anywhere — on iOS one would make every tap take the keyboard away',
        mice.length === 0, mice.join(', '));
});

/* ---------- the keyboard's share of the screen ---------- */
/* A phone keyboard shrinks the visual viewport; on iOS the page keeps its
   size and the scroll range grows by the keyboard's height (WebKit:
   adjustedContentInset). Chromium has no such keyboard, so this one is
   drawn by hand: a visualViewport that shrinks, and the extra range. */
section('the keyboard (simulated)', PHONE, async (context) => {
    const page = watch(await context.newPage());
    await page.addInitScript(() => {
        let keys = 0, pan = 0;                              // keyboard height; iOS's offset of what's seen
        const vv = Object.defineProperties(new EventTarget(), {
            offsetLeft: { get: () => 0 }, offsetTop: { get: () => pan }, scale: { get: () => 1 },
            width: { get: () => innerWidth }, height: { get: () => innerHeight - keys }
        });
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
        window.__keyboard = (h, panned = 0) => {
            keys = h; pan = panned;
            document.body.style.paddingBottom = (h && h + 60) + 'px';   // the scroll range iOS adds, and some slack: its bars come and go
            vv.dispatchEvent(new Event('resize'));
        };
    });
    await page.goto(SITE);
    await page.locator('#out pre.logo').first().tap();      // during the boot: the greeting is still typing
    await page.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'));
    check('a tap during the boot skips it and raises the keyboard; the tap hint is spared',
        (await page.evaluate(() => document.activeElement.id)) === 'kbd' && !(await page.locator('#out').innerText()).includes('[tap anywhere'));
    for (let i = 0; i < 4; i++) { await page.keyboard.type('help'); await page.keyboard.press('Enter'); }
    const where = () => page.evaluate(() => {
        const vv = window.visualViewport, r = document.getElementById('row').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), seen: vv.offsetTop + vv.height, y: scrollY };
    });
    const sitsAbove = (p) => p.bottom <= p.seen && p.bottom >= p.seen - 60;
    await page.evaluate(() => __keyboard(320));
    const up = await where();
    check('the keyboard comes up: the prompt sits right above it', sitsAbove(up), JSON.stringify(up));
    /* iOS then scrolls on its own after every key, to keep the caret in view
       with a margin — a little higher than the page put it. The page must not
       argue: typing is no reason to move a prompt that can be seen. */
    await page.evaluate(() => window.scrollBy(0, 24));
    await page.keyboard.type('abc');
    await page.waitForTimeout(100);
    const typed = await where();
    check('typing moves nothing: a prompt in sight stays where the phone put it', typed.y === up.y + 24 && typed.bottom <= typed.seen,
        JSON.stringify({ before: up.y + 24, after: typed.y }));
    await page.evaluate(() => __keyboard(320, 140));
    const panned = await where();
    check('…and so it does when iOS pans the visible part of the page', panned.y === typed.y && panned.bottom <= panned.seen && panned.top >= 140,
        JSON.stringify(panned));
    await page.evaluate(() => __keyboard(320));
    await page.evaluate(() => window.scrollTo(0, 0));        // scrolled up to read, then a key
    await page.keyboard.type('d');
    await page.waitForTimeout(100);
    const back = await where();
    check('a key after scrolling up to read brings the prompt back above the keyboard', sitsAbove(back), JSON.stringify(back));
    await page.keyboard.press('Control+u');
    await page.keyboard.type('clear'); await page.keyboard.press('Enter');
    const cleared = await where();
    check('clear after a long session: back to the top, the prompt in view', cleared.y === 0 && cleared.top >= 0 && cleared.bottom <= cleared.seen,
        JSON.stringify(cleared));
});

/* ---------- no JavaScript ---------- */
section('no-JS fallback', { javaScriptEnabled: false }, async (context) => {
    const page = watch(await context.newPage());
    await page.goto(SITE);
    check('fallback visible', await page.locator('#fallback').isVisible());
    check('terminal hidden', !(await page.locator('#term').isVisible()));
    check('name still served', (await page.locator('#fallback h1').innerText()) === 'Constantine Mureev');
    check('CV still reachable',
        (await page.locator('#fallback a[href*=".pdf"]').count()) === 2);
    check('no dead input: the terminal\'s textarea hides with the terminal',
        !(await page.locator('#kbd').isVisible()) && !(await page.locator('body').ariaSnapshot()).includes('textbox'));
});

/* ---------- error pages ---------- */
section('error pages', {}, async (context) => {
    const page = watch(await context.newPage());
    for (const name of ['404', '50x']) {
        await page.goto(new URL(name + '.html', SITE).href);
        check(`${name}.html renders styled, inside its own CSP`, await page.evaluate(() =>
            getComputedStyle(document.body).backgroundColor === 'rgb(10, 14, 11)' && document.body.innerText.includes('mureev.com')));
    }
});

/* ---------- served like production (E2E_URL only) ---------- */
/* every value a response sent for one header, repeats and all */
const sent = (r, name) => r.headersArray().filter((h) => h.name.toLowerCase() === name).map((h) => h.value);

if (SERVED) section('served like production  (' + SITE + ')', null, async () => {
    const http = await request.newContext({ baseURL: SITE, maxRedirects: 0 });
    const PAGES = ['/', '/no-such-page', '/assets/'];
    const FILES = ['/assets/og.png', '/llms.txt', '/.well-known/security.txt'];
    const heads = [];
    for (const p of [...PAGES, ...FILES]) heads.push([p, await http.get(p)]);
    heads.push(['HEAD /', await http.head('/')]);
    for (const [p, r] of heads) {
        const page = !FILES.includes(p);
        const want = { 'x-content-type-options': ['nosniff'], 'x-clacks-overhead': ['GNU Terry Pratchett'],
            'content-security-policy': page ? ["frame-ancestors 'none'"] : [] };
        if (!LIVE) want['strict-transport-security'] = [];    // HSTS is the proxy's to send, never ours
        const got = Object.fromEntries(Object.keys(want).map((k) => [k, sent(r, k)]));
        check(`${p}: its headers, each exactly once${page ? '' : ' (no framing rule: not a page)'}`,
            JSON.stringify(got) === JSON.stringify(want) && r.headers().server === 'nginx', JSON.stringify(got));
    }
    const at = (p) => heads.find(([q]) => q === p)[1];
    check('pages revalidate on every visit; images keep for a day',
        at('/').headers()['cache-control'] === 'no-cache' && at('/assets/og.png').headers()['cache-control'] === 'max-age=86400');
    const again = await http.get('/assets/og.png', { headers: { 'if-none-match': at('/assets/og.png').headers().etag } });
    check('…and keep it when revalidated: a 304 sends no cache headers to overrule the day',
        again.status() === 304 && !again.headers()['cache-control'] && !again.headers().expires,
        again.status() + ' ' + JSON.stringify(again.headers()['cache-control']));
    check('text says it is utf-8 (llms.txt has em dashes and Cyrillic; RFC 9116 requires it of security.txt)',
        ['/llms.txt', '/.well-known/security.txt'].every((p) => at(p).headers()['content-type'] === 'text/plain; charset=utf-8'));
    check('gzip, and Vary says so', at('/').headers()['content-encoding'] === 'gzip' && /accept-encoding/i.test(at('/').headers().vary));
    check('a missing page or a bare directory: the terminal 404, status 404',
        (await Promise.all(['/no-such-page', '/assets/'].map(async (p) =>
            at(p).status() === 404 && (await at(p).text()).includes('csh: 404:')))).every(Boolean));
    const slash = await http.get('/assets');
    check('the trailing-slash redirect stays relative (so on https behind the proxy)',
        slash.status() === 301 && slash.headers().location === '/assets/', slash.status() + ' → ' + slash.headers().location);
    await http.dispose();
});

/* ---------- production only (an https E2E_URL) ---------- */
/* what only production can get wrong: the proxy, the certificates,
   the CVs the server mounts. The daily check (production.yml) is this. */
if (LIVE) section('production only', {}, async (context) => {
    const http = await request.newContext({ baseURL: SITE, maxRedirects: 0 });
    const hsts = sent(await http.get('/'), 'strict-transport-security');
    check('HSTS from the proxy: https only, for a year', JSON.stringify(hsts) === '["max-age=31536000"]', JSON.stringify(hsts));
    const domain = new URL(SITE).hostname;
    const hosts = domain === 'mureev.com' ? ['mureev.com', 'www.mureev.com', 'mureev.ru', 'www.mureev.ru'] : [domain];
    const daysLeft = (host) => new Promise((resolve) => {
        const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
            resolve(s.authorized ? Math.floor((Date.parse(s.getPeerCertificate().valid_to) - Date.now()) / 864e5) : -1);
            s.end();
        });
        s.on('error', () => resolve(-1));
        s.on('timeout', () => { s.destroy(); resolve(-1); });
    });
    const days = await Promise.all(hosts.map(daysLeft));
    check('every hostname: a valid certificate, two weeks from expiry or more',
        days.every((d) => d >= 14), hosts.map((h, i) => `${h}: ${days[i]}d`).join(', '));
    const expires = /^Expires: *(.+)$/m.exec(await (await http.get('/.well-known/security.txt')).text());
    const left = expires ? Math.floor((Date.parse(expires[1]) - Date.now()) / 864e5) : NaN;
    check('security.txt is good for another month at least (RFC 9116: Expires)',
        left > 30, `${left} days left: set Expires to just under a year from today`);
    const page = watch(await context.newPage());
    await page.goto(SITE);
    const LINKS = await page.evaluate(() => csh.LINKS);
    const cvs = await Promise.all([LINKS.cvEn, LINKS.cvRu].map((u) => http.head(u)));
    check('both CVs are served (the server mounts them; the image never has them)',
        cvs.every((r) => r.status() === 200 && r.headers()['content-type'] === 'application/pdf'),
        cvs.map((r) => r.status() + ' ' + r.headers()['content-type']).join(', '));
    await http.dispose();
});

/* ---------- the whole session ---------- */
section('the whole session', null, async () => {
    check('zero console errors on any page — no CSP or Trusted Types violation among them', errors.length === 0,
        errors.join(' | ').slice(0, 300));
    const home = (u) => ['file:', 'data:'].includes(u.protocol) || u.origin === new URL(SITE).origin;
    const elsewhere = [...new Set(fetched.map((u) => new URL(u)).filter((u) => !home(u)).map((u) => u.host))];
    check('nothing is fetched from elsewhere but the gif', elsewhere.join() === 'media1.giphy.com', elsewhere.join(', '));
});

/* ---------- run them ---------- */
(async () => {
    const browser = await chromium.launch();
    for (const { title, options, body } of sections) {
        console.log('\n' + title);
        const context = options && await browser.newContext(options);
        /* a section that throws is one failure, not the end of the run: the
           rest still report, and the console errors of "the whole session"
           usually say why (a script the CSP blocked surfaces as a timeout) */
        try { await body(context); }
        catch (e) { check('…and the section ran to its end', false, String(e.message || e).split('\n')[0]); }
        finally { await context?.close(); }
    }
    await browser.close();

    console.log('\n' + passed + '/' + (passed + failures.length) + ' e2e tests passed'
        + (failures.length ? '  \x1b[31m(' + failures.length + ' failed)\x1b[0m' : ''));
    process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
