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

const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'content', 'index.html');

let passed = 0;
const failures = [];
const check = (name, cond, extra = '') => {
    if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
    else { failures.push(name); console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (extra ? '\n      ' + extra : '')); }
};

(async () => {
    const browser = await chromium.launch();

    /* ---------- desktop ---------- */
    console.log('\ndesktop (1440×900)');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

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

    check('zero console errors on the whole session', errors.length === 0,
        errors.join(' | ').slice(0, 300));

    /* ---------- keyboard & screen readers ---------- */
    console.log('\nkeyboard & screen readers');
    const ax = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ax.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ax.route(/^https?:/, (r) => r.fulfill({ body: '' }));   // links get followed; nothing leaves the machine
    const kp = await ax.newPage();
    await kp.goto(URL);
    await kp.keyboard.press('Escape');
    await kp.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'));
    const { renmoney, themes } = await kp.evaluate(() => ({ renmoney: csh.LINKS.renmoney, themes: [...csh.THEMES] }));

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
    check('forced colors: the cursor cell is outlined, not painted away',
        (await kp.evaluate(() => getComputedStyle(document.getElementById('cursor')).outlineStyle)) === 'solid');
    await kp.emulateMedia({ forcedColors: 'none', contrast: 'more' });
    check('prefers-contrast: more drops the glow and the glass', await kp.evaluate(() =>
        getComputedStyle(document.body).textShadow === 'none' && getComputedStyle(document.getElementById('fx')).display === 'none'));
    await kp.emulateMedia({ contrast: 'no-preference' });

    /* the boot theater, untouched: every greeting line reaches the live
       region once — never character by character */
    const sr = await ax.newPage();
    await sr.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        window.__updates = 0;
        const hidden = (n) => !!(n.nodeType === 1 ? n : n.parentElement)?.closest('[aria-hidden="true"]');
        new MutationObserver((recs) => { if (recs.some((r) => !hidden(r.addedNodes[0] || r.target))) window.__updates++; })
            .observe(document.getElementById('out'), { childList: true, subtree: true, characterData: true, attributes: true });
    }));
    await sr.goto(URL);
    await sr.waitForFunction(() => document.querySelector('#out').innerText.includes('motd'), null, { timeout: 15000 });
    const updates = await sr.evaluate(() => window.__updates);
    check('screen readers hear the boot line by line, not keystroke by keystroke',
        updates > 0 && updates <= (await sr.evaluate(() => window.csh.GREETING.length)) + 2, updates + ' live updates');
    await sr.close();

    const rm = await ax.newPage();
    await rm.emulateMedia({ reducedMotion: 'reduce' });
    await rm.goto(URL);
    const first = await rm.locator('#out').innerText();
    check('reduced motion: the whole greeting is there at load, no typing',
        first.includes("G'day, I'm Constantine Mureev.") && first.includes('Type help for commands.') && first.includes('motd'));
    await ax.close();

    /* ---------- mobile ---------- */
    console.log('\nmobile (390×844, touch)');
    const mob = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    });
    await mob.goto(URL);
    await mob.waitForFunction(() =>                  // let the boot type itself out
        document.querySelector('#term').innerText.includes('Type help for commands.'),
        null, { timeout: 15000 }).catch(() => {});   // on timeout the check below reports it
    const mt = await mob.locator('#term').innerText();
    check('boot completes untouched', mt.includes('Type help for commands.'));
    check('coarse pointers get the tap hint', mt.includes('[tap anywhere to type]'));

    /* ---------- no JavaScript ---------- */
    console.log('\nno-JS fallback');
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const np = await nojs.newPage();
    await np.goto(URL);
    check('fallback visible', await np.locator('#fallback').isVisible());
    check('terminal hidden', !(await np.locator('#term').isVisible()));
    check('name still served', (await np.locator('#fallback h1').innerText()) === 'Constantine Mureev');
    check('CV still reachable',
        (await np.locator('#fallback a[href*=".pdf"]').count()) === 2);
    check('no dead input: the terminal\'s textarea hides with the terminal',
        !(await np.locator('#kbd').isVisible()) && !(await np.locator('body').ariaSnapshot()).includes('textbox'));

    await browser.close();

    console.log('\n' + passed + '/' + (passed + failures.length) + ' e2e tests passed'
        + (failures.length ? '  \x1b[31m(' + failures.length + ' failed)\x1b[0m' : ''));
    process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
