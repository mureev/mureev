#!/usr/bin/env node
/* =========================================================================
   End-to-end suite for mureev.com — the terminal in a real browser.

   The unit suite (unit.test.js) proves the core logic; this file proves
   the *experience*: boot, typing, history, completion, themes, keyboard
   and screen-reader access, mobile, and the no-JS fallback — in actual
   Chromium via Playwright, the one and only devDependency this repo
   allows itself.

   We do not mock the DOM. The DOM is the product.
   ========================================================================= */
'use strict';

const { chromium, request } = require('playwright');
const path = require('path');
const tls = require('tls');

/* The page under test: the file itself, or — with E2E_URL — a served copy
   (CI aims it at the built image: same suite, plus what only a server can
   get wrong — headers, types, caching, errors). The WHATWG URL class,
   where needed, is globalThis.URL. */
const URL = process.env.E2E_URL || 'file://' + path.resolve(__dirname, '..', 'content', 'index.html');

let passed = 0;
const failures = [];
const check = (name, cond, extra = '') => {
    if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
    else { failures.push(name); console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (extra ? '\n      ' + extra : '')); }
};

/* Every page of the session reports here. CSP and Trusted Types violations
   are console errors, so a stale hash in a page's policy surfaces as one —
   and so does anything a page tries to fetch from a host it shouldn't. */
const errors = [], fetched = [];
const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('request', (r) => { if (!r.isNavigationRequest()) fetched.push(r.url()); });
    return p;
};

(async () => {
    const browser = await chromium.launch();

    /* ---------- desktop ---------- */
    console.log('\ndesktop (1440×900)');
    const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }));

    await page.goto(URL);
    await page.keyboard.press('Escape');            // any key skips the boot theater
    await page.waitForTimeout(700);

    const term = async () => page.locator('#term').innerText();
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
    check('neofetch spec sheet', t.includes('Renmoney') && t.includes('csh — the Constantine shell'));

    /* themes */
    await run('theme amber');
    check('theme amber applies',
        (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'amber');
    await page.reload();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('theme survives a reload (localStorage)',
        (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'amber');
    await run('theme crt');
    check('theme crt applies',
        (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'crt');
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
    await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control');
    await page.keyboard.type('neo', { delay: 5 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    check('tab completion', (await page.locator('#row').innerText()).includes('neofetch'));
    await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control');

    const before = (await term()).split('this list').length;
    await page.locator('#out .cmd', { hasText: 'help' }).first().click();
    await page.waitForTimeout(120);
    check('clickable commands execute', (await term()).split('this list').length > before);

    /* the one thing loaded from elsewhere: the CSP must let the gif in. giphy
       itself is stubbed — this tests our policy, not their CDN */
    await page.route('https://media1.giphy.com/**', (r) => r.fulfill({ contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }));
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


    /* ---------- keyboard & screen readers ---------- */
    console.log('\nkeyboard & screen readers');
    const ax = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ax.grantPermissions(['clipboard-read', 'clipboard-write']);
    const away = (u) => /^https?:$/.test(u.protocol) && u.origin !== new globalThis.URL(URL).origin;
    await ax.route(away, (r) => r.fulfill({ body: '' }));   // links get followed; nothing leaves the machine
    const kp = watch(await ax.newPage());
    await kp.goto(URL);
    await kp.keyboard.press('Escape');
    await kp.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'));
    const { renmoney, themes } = await kp.evaluate(() => ({ renmoney: csh.LINKS.renmoney, themes: [...csh.THEMES] }));

    /* what a screen reader can reach once the boot is over: the greeting,
       its link and its command — and nothing hidden but the ASCII logo */
    const readable = async (pg) => {
        const tree = await pg.locator('#out').ariaSnapshot();
        const hidden = await pg.evaluate(() => [...document.querySelectorAll('#out [aria-hidden="true"]')].map((n) => n.className));
        return { ok: tree.includes("G'day, I'm Constantine Mureev.") && tree.includes('link "Renmoney"') &&
            tree.includes('button "help"') && JSON.stringify(hidden) === '["logo"]', hidden };
    };
    const skipped = await readable(kp);
    check('a skipped boot leaves the whole greeting to screen readers — only the logo is hidden',
        skipped.ok, JSON.stringify(skipped.hidden));

    const focused = () => kp.evaluate(() => {
        const a = document.activeElement;
        return a.id || (a.matches('a') ? 'link:' : a.matches('.cmd') ? 'cmd:' : a.tagName + ':') + a.textContent.trim();
    });
    const tally = (s) => kp.evaluate((s) => document.querySelector('#out').innerText.split(s).length - 1, s);
    const prompt = () => kp.locator('#kbd').inputValue();
    const press = async (k) => { await kp.keyboard.press(k); await kp.waitForTimeout(60); };

    const cursorLook = () => kp.evaluate(() => {
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
        await kp.locator('#out .cmd', { hasText: 'help' }).first().focus();
        const n = await tally('this list');
        await press(key);
        check(`${key === ' ' ? 'Space' : 'Enter'} on a focused command runs it once, back to an empty prompt`,
            (await tally('this list')) === n + 1 && (await prompt()) === '' && (await focused()) === 'kbd',
            JSON.stringify({ runs: (await tally('this list')) - n, prompt: await prompt() }));
    }

    await kp.keyboard.type('about');                       // half-typed, not executed
    const echoes = await tally('~$');
    await kp.locator('#out a', { hasText: 'Renmoney' }).first().focus();
    const popup = kp.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await press('Enter');
    const opened = await popup;
    if (opened) await opened.waitForLoadState().catch(() => {});
    await press(' ');
    check('Enter on a focused link follows it — the prompt is neither typed into nor run',
        opened && opened.url().startsWith(renmoney) && (await prompt()) === 'about' && (await tally('~$')) === echoes,
        JSON.stringify({ popup: opened && opened.url(), prompt: await prompt() }));
    if (opened) await opened.close();
    await kp.keyboard.type('x');
    check('typing on a focused link still lands in the prompt', (await prompt()) === 'aboutx' && (await focused()) === 'kbd');
    await kp.evaluate(() => document.activeElement.blur());
    await kp.keyboard.type('y');
    check('…and so does typing with nothing focused', (await prompt()) === 'aboutxy');
    await press('Control+u');

    await kp.keyboard.type('whoami'); await press('Enter');
    const popup2 = kp.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await kp.locator('#out a', { hasText: 'Renmoney' }).first().click();
    const opened2 = await popup2;
    if (opened2) await opened2.close();
    await press('ArrowUp');
    check('after a mouse click on a link, the prompt has the keys again (↑ recalls history)',
        opened2 && (await focused()) === 'kbd' && (await prompt()) === 'whoami', JSON.stringify({ focus: await focused(), prompt: await prompt() }));
    await press('Control+u');
    const helps = await tally('this list');
    await kp.locator('#out .cmd', { hasText: 'help' }).first().click({ button: 'right' });
    await kp.waitForTimeout(100);
    check('a right-click on a command runs nothing: the context menu is the browser\'s', (await tally('this list')) === helps);
    await kp.locator('#kbd').focus();

    await kp.keyboard.type('whoami'); await press('Enter');
    const tabs = ax.pages().length;
    await kp.locator('#out a', { hasText: 'Renmoney' }).first().click({ button: 'middle' });
    await kp.waitForTimeout(150);
    for (const extra of ax.pages().slice(tabs)) await extra.close();
    await press('ArrowUp');
    check('…a middle-click (a background tab) hands the keys back too', (await focused()) === 'kbd' && (await prompt()) === 'whoami',
        JSON.stringify({ focus: await focused(), prompt: await prompt() }));
    await press('Control+u');

    /* a drag that ends on a link or a command is a selection: it is kept for
       copying, and nothing opens or runs */
    const drag = async (target) => {
        await target.scrollIntoViewIfNeeded();
        const to = await target.boundingBox(), from = await target.locator('xpath=..').boundingBox();
        await kp.mouse.move(from.x + 2, to.y + to.height / 2);
        await kp.mouse.down();
        await kp.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
        await kp.mouse.up();
        await kp.waitForTimeout(100);
        return kp.evaluate(() => String(getSelection()));
    };
    await kp.keyboard.type('contacts'); await press('Enter');
    const picked = await drag(kp.locator('#out a[href^="mailto:"]').last());
    await press('ControlOrMeta+c');
    check('a drag-selection that ends on a link stays selected, and copies',
        picked.startsWith('Email me at') && picked.endsWith('constantine@mureev.com') &&
        (await kp.evaluate(() => navigator.clipboard.readText())) === picked, JSON.stringify(picked));
    const ranHelp = await tally('this list');
    const dragged = await drag(kp.locator('#out .cmd', { hasText: 'help' }).first());
    check('…and one that ends on a command runs nothing', dragged.endsWith('help') && (await tally('this list')) === ranHelp,
        JSON.stringify(dragged));
    await kp.evaluate(() => getSelection().removeAllRanges());
    await kp.locator('#kbd').focus();

    await kp.evaluate(() => {
        document.activeElement.blur();
        getSelection().selectAllChildren([...document.querySelectorAll('#out .ln')].find((l) => l.textContent === 'Ready to chat?'));
    });
    const carets = await tally('^C');
    await press('ControlOrMeta+c');
    check('copying selected output copies it (no stray ^C, selection kept)',
        (await kp.evaluate(() => navigator.clipboard.readText())) === 'Ready to chat?' && (await tally('^C')) === carets &&
        (await kp.evaluate(() => String(getSelection()))) === 'Ready to chat?');
    await kp.locator('#kbd').focus();

    await kp.keyboard.type('neofetch'); await press('Enter');
    await kp.keyboard.type('xyzzy');
    const tree = await kp.locator('body').ariaSnapshot();
    check('the terminal is a main landmark holding a log and the input — not an application',
        /^- main "Interactive terminal[^"]*":\n {2}- log:/.test(tree) && tree.includes('- textbox "Terminal input"') && !tree.includes('application'),
        tree.slice(0, 120));
    check('the ASCII logo and box-drawing rules stay out of the accessibility tree',
        (await kp.locator('#out pre.logo').count()) === 2 && !/[█╗╔║╚╝═─]/.test(tree));
    check('the mirrored prompt row is not read twice', !tree.includes('~$ xyzzy'));
    await press('Control+u');

    for (const theme of themes) {
        await kp.locator('#kbd').focus();
        await kp.keyboard.type('theme ' + theme); await press('Enter');
        const rings = [];
        for (const el of ['#out a', '#out .cmd']) {
            await press('Shift');                          // keyboard modality, as after a Tab
            await kp.locator(el).last().focus();
            rings.push(await kp.evaluate(() => {
                const s = getComputedStyle(document.activeElement);
                return document.activeElement.matches(':focus-visible') && s.outlineStyle === 'solid' &&
                    parseFloat(s.outlineWidth) >= 2 && s.outlineColor === s.color;    // both are drawn in --fg-hi
            }));
        }
        check(`keyboard focus on a link and a command: 2px --fg-hi outline (${theme})`, rings.every(Boolean));
    }
    await kp.locator('#kbd').focus();
    await kp.keyboard.type('theme green'); await press('Enter');

    await kp.emulateMedia({ forcedColors: 'active' });
    const cell = () => kp.evaluate(() => {
        const s = getComputedStyle(document.getElementById('cursor'));
        return s.backgroundColor + ' / ' + s.outlineStyle;
    });
    await kp.locator('#kbd').focus();
    const focusedCell = await cell();
    await press('Shift+Tab');
    const blurredCell = await cell();
    check('forced colors: the cursor still tells focus apart — a solid block, then an outline',
        focusedCell !== blurredCell && !focusedCell.endsWith('solid') && blurredCell.endsWith('solid'),
        focusedCell + ' → ' + blurredCell);
    await kp.locator('#kbd').focus();
    await kp.emulateMedia({ forcedColors: 'none', contrast: 'more' });
    check('prefers-contrast: more drops the glow and the glass', await kp.evaluate(() =>
        getComputedStyle(document.body).textShadow === 'none' && getComputedStyle(document.getElementById('fx')).display === 'none'));
    await kp.emulateMedia({ contrast: 'no-preference' });

    /* the boot theater, untouched: every greeting line reaches the live
       region once — never character by character */
    const sr = watch(await ax.newPage());
    await sr.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        window.__updates = 0;
        const heard = (r) => {                       // something new, on the page, not hidden from assistive tech
            const n = r.type === 'childList' ? r.addedNodes[0] : r.target;
            const el = n && (n.nodeType === 1 ? n : n.parentElement);
            return !!el && el.isConnected && !el.closest('[aria-hidden="true"]');
        };
        new MutationObserver((recs) => { if (recs.some(heard)) window.__updates++; })
            .observe(document.getElementById('out'), { childList: true, subtree: true, characterData: true, attributes: true });
    }));
    await sr.goto(URL);
    await sr.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'), null, { timeout: 15000 });
    const updates = await sr.evaluate(() => window.__updates);
    const greeting = await sr.evaluate(() => window.csh.GREETING.length);
    check('screen readers hear the boot line by line, not keystroke by keystroke',
        updates >= greeting && updates <= greeting + 2, updates + ' live updates for ' + greeting + ' lines');
    const watched = await readable(sr);
    check('…and once it is typed out, all of it stays readable — only the logo is hidden',
        watched.ok, JSON.stringify(watched.hidden));
    await sr.close();

    const rm = watch(await ax.newPage());
    await rm.emulateMedia({ reducedMotion: 'reduce' });
    await rm.goto(URL);
    const first = await rm.locator('#out').innerText();
    check('reduced motion: the whole greeting is there at load, no typing',
        first.includes("G'day, I'm Constantine Mureev.") && first.includes('Type help for commands.') && first.includes('motd'));
    await ax.close();

    /* ---------- input edge cases ---------- */
    console.log('\ninput edge cases');
    const ic = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ic.grantPermissions(['clipboard-read', 'clipboard-write']);
    const ip = watch(await ic.newPage());
    await ip.goto(URL);
    await ip.keyboard.press('Escape');
    await ip.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'));
    const typed = () => ip.evaluate(() => [...document.querySelectorAll('#out .ln')]
        .map((l) => l.textContent).filter((l) => l.startsWith(csh.PS1)).map((l) => l.slice(csh.PS1.length)));
    const promptNow = () => ip.locator('#kbd').inputValue();
    await ip.evaluate(() => navigator.clipboard.writeText('whoami\r\nuptime\nabo'));
    await ip.locator('#kbd').focus();
    await ip.keyboard.press('ControlOrMeta+v');
    await ip.waitForTimeout(150);
    check('a multi-line paste runs line by line; the unfinished last line waits at the prompt',
        JSON.stringify((await typed()).slice(-2)) === '["whoami","uptime"]' && (await promptNow()) === 'abo' &&
        (await ip.locator('#out').innerText()).includes('uid=2009(constantine)'),
        JSON.stringify({ ran: await typed(), prompt: await promptNow() }));
    await ip.locator('#kbd').evaluate((k) => {          // what some Android keyboards send for "go"
        k.value = 'who\nami';
        k.dispatchEvent(new InputEvent('input', { inputType: 'insertLineBreak' }));
    });
    check('a newline typed mid-line (a mobile "go" key) runs the whole line',
        (await typed()).at(-1) === 'whoami' && (await promptNow()) === '', JSON.stringify((await typed()).slice(-2)));
    const ranBefore = (await typed()).length;
    await ip.evaluate(() => navigator.clipboard.writeText('whoami\n'.repeat(150) + 'tail'));
    await ip.keyboard.press('ControlOrMeta+v');
    await ip.waitForTimeout(300);
    const ranNow = (await typed()).length - ranBefore;
    check('a huge paste runs its first 100 lines and says so, rather than freeze the tab; the unfinished line waits',
        ranNow === 100 && (await ip.locator('#out').innerText()).includes('csh: paste: ran 100 of 150 lines') &&
        (await promptNow()) === 'tail', ranNow + ' lines ran; prompt ' + JSON.stringify(await promptNow()));
    await ip.keyboard.press('Control+u');
    await ip.keyboard.type('hi \u{1F44B}\u{1F3FD} there');
    for (let i = 0; i < 7; i++) await ip.keyboard.press('ArrowLeft');
    await ip.waitForTimeout(100);                       // the mirror follows on selectionchange
    const cells = await ip.evaluate(() => ['pre', 'cursor', 'post'].map((i) => document.getElementById(i).textContent));
    check('the cursor sits on a whole emoji, never half of one',
        JSON.stringify(cells) === JSON.stringify(['hi ', '\u{1F44B}\u{1F3FD}', ' there']), JSON.stringify(cells));
    check('mobile keyboards are asked to leave commands alone: no autocorrect, capitals or spellcheck',
        await ip.locator('#kbd').evaluate((k) =>
            k.getAttribute('autocorrect') === 'off' && k.getAttribute('autocapitalize') === 'off' && !k.spellcheck));
    await ip.keyboard.press('Control+u');
    await ip.keyboard.type('hello');
    const ends = [];
    for (const key of ['Home', 'End']) {
        await ip.keyboard.press(key);
        await ip.waitForTimeout(100);
        ends.push(await ip.evaluate(() => document.getElementById('pre').textContent));
    }
    check('Home and End go to the ends of the line, not one character', JSON.stringify(ends) === '["","hello"]', JSON.stringify(ends));
    await ic.close();

    /* ---------- mobile ---------- */
    console.log('\nmobile (390×844, touch)');
    const mob = watch(await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    }));
    await mob.addInitScript(() => {                   // note every mouse listener the page adds
        window.__mouse = [];
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, ...rest) {
            if (/^(mouse(down|up|move|over|out)|click|auxclick|dblclick)$/.test(type))
                window.__mouse.push(type + ' on ' + (this.id || this.nodeName || 'window'));
            return add.call(this, type, ...rest);
        };
    });
    await mob.goto(URL);
    const mice = await mob.evaluate(() => window.__mouse);  // the page's own: Playwright adds its listeners later
    await mob.waitForFunction(() =>                  // let the boot type itself out
        document.querySelector('#term').innerText.includes('Type help for commands.'),
        null, { timeout: 15000 }).catch(() => {});   // on timeout the check below reports it
    const mt = await mob.locator('#term').innerText();
    check('boot completes untouched', mt.includes('Type help for commands.'));
    check('coarse pointers get the tap hint', mt.includes('[tap anywhere to type]'));
    await mob.evaluate(() => {                          // count every time the prompt takes focus
        window.__focus = 0;
        document.getElementById('kbd').addEventListener('focus', () => window.__focus++);
    });
    await mob.locator('#out .cmd', { hasText: 'help' }).first().tap();
    await mob.waitForTimeout(150);
    check('a tapped command runs, and no keyboard rises over its output',
        (await mob.locator('#out').innerText()).includes('this list') && (await mob.evaluate(() => window.__focus)) === 0);
    await mob.locator('#out pre.logo').first().tap();
    await mob.waitForTimeout(100);
    check('a tap anywhere else focuses the prompt, and it stays focused',
        (await mob.evaluate(() => document.activeElement.id)) === 'kbd');
    const swipe = await mob.context().newCDPSession(mob);
    await mob.evaluate(() => document.activeElement.blur());
    const focusedSoFar = await mob.evaluate(() => window.__focus);
    await swipe.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
    for (const dy of [15, 45, 90]) await swipe.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 - dy }] });
    await swipe.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mob.waitForTimeout(150);
    check('a swipe is not a tap: no keyboard',
        (await mob.evaluate(() => window.__focus)) === focusedSoFar && (await mob.evaluate(() => document.activeElement.id)) !== 'kbd');
    /* WebKit treats a page with any mousedown/mouseup/click/mousemove
       listener as clickable everywhere: every tap becomes a click, whose
       mousedown blurs the prompt — on iPhones the keyboard rose and fell.
       Chromium can't show that, so hold the cause instead. */
    check('no mouse listeners anywhere — on iOS one would make every tap take the keyboard away',
        mice.length === 0, mice.join(', '));

    /* ---------- no JavaScript ---------- */
    console.log('\nno-JS fallback');
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const np = watch(await nojs.newPage());
    await np.goto(URL);
    check('fallback visible', await np.locator('#fallback').isVisible());
    check('terminal hidden', !(await np.locator('#term').isVisible()));
    check('name still served', (await np.locator('#fallback h1').innerText()) === 'Constantine Mureev');
    check('CV still reachable',
        (await np.locator('#fallback a[href*=".pdf"]').count()) === 2);
    check('no dead input: the terminal\'s textarea hides with the terminal',
        !(await np.locator('#kbd').isVisible()) && !(await np.locator('body').ariaSnapshot()).includes('textbox'));

    /* ---------- error pages ---------- */
    console.log('\nerror pages');
    for (const name of ['404', '50x']) {
        const ep = watch(await browser.newPage());
        await ep.goto(new globalThis.URL(name + '.html', URL).href);
        check(`${name}.html renders styled, inside its own CSP`, await ep.evaluate(() =>
            getComputedStyle(document.body).backgroundColor === 'rgb(10, 14, 11)' && document.body.innerText.includes('mureev.com')));
        await ep.close();
    }

    /* ---------- served like production (E2E_URL only) ---------- */
    if (/^https?:/.test(URL)) {
        console.log('\nserved like production  (' + URL + ')');
        const http = await request.newContext({ baseURL: URL, maxRedirects: 0 });
        const one = (r, name) => r.headersArray().filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
        const live = URL.startsWith('https:');                // production: the TLS proxy is in front
        const PAGES = ['/', '/no-such-page', '/assets/'];
        const FILES = ['/assets/og.png', '/llms.txt', '/.well-known/security.txt'];
        const heads = [];
        for (const p of [...PAGES, ...FILES]) heads.push([p, await http.get(p)]);
        heads.push(['HEAD /', await http.head('/')]);
        for (const [p, r] of heads) {
            const page = !FILES.includes(p);
            const want = { 'x-content-type-options': ['nosniff'], 'x-clacks-overhead': ['GNU Terry Pratchett'],
                'content-security-policy': page ? ["frame-ancestors 'none'"] : [] };
            if (!live) want['strict-transport-security'] = [];    // HSTS is the proxy's to send, never ours
            const got = Object.fromEntries(Object.keys(want).map((k) => [k, one(r, k)]));
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

        /* what only production can get wrong: the proxy, the certificates,
           the CVs the server mounts. The daily check (production.yml) is this. */
        if (live) {
            console.log('\nproduction only');
            check('HSTS from the proxy: https only, for a year',
                JSON.stringify(one(at('/'), 'strict-transport-security')) === '["max-age=31536000"]',
                JSON.stringify(one(at('/'), 'strict-transport-security')));
            const site = new globalThis.URL(URL).hostname;
            const hosts = site === 'mureev.com' ? ['mureev.com', 'www.mureev.com', 'mureev.ru', 'www.mureev.ru'] : [site];
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
            const expires = /^Expires: *(.+)$/m.exec(await at('/.well-known/security.txt').text());
            const left = expires ? Math.floor((Date.parse(expires[1]) - Date.now()) / 864e5) : NaN;
            check('security.txt is good for another month at least (RFC 9116: Expires)',
                left > 30, `${left} days left: set Expires to just under a year from today`);
            const LINKS = await page.evaluate(() => csh.LINKS);
            const cvs = await Promise.all([LINKS.cvEn, LINKS.cvRu].map((u) => http.head(u)));
            check('both CVs are served (the server mounts them; the image never has them)',
                cvs.every((r) => r.status() === 200 && r.headers()['content-type'] === 'application/pdf'),
                cvs.map((r) => r.status() + ' ' + r.headers()['content-type']).join(', '));
        }
        await http.dispose();
    }

    /* ---------- the whole session ---------- */
    console.log('\nthe whole session');
    check('zero console errors on any page — no CSP or Trusted Types violation among them', errors.length === 0,
        errors.join(' | ').slice(0, 300));
    const home = (u) => ['file:', 'data:'].includes(u.protocol) || u.origin === new globalThis.URL(URL).origin;
    const elsewhere = [...new Set(fetched.map((u) => new globalThis.URL(u)).filter((u) => !home(u)).map((u) => u.host))];
    check('nothing is fetched from elsewhere but the gif', elsewhere.join() === 'media1.giphy.com', elsewhere.join(', '));

    await browser.close();

    console.log('\n' + passed + '/' + (passed + failures.length) + ' e2e tests passed'
        + (failures.length ? '  \x1b[31m(' + failures.length + ' failed)\x1b[0m' : ''));
    process.exit(failures.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    // a script the CSP blocked tends to surface as a timeout; the console says why
    if (errors.length) console.error('\nconsole errors so far: ' + errors.join(' | ').slice(0, 500));
    process.exit(1);
});
