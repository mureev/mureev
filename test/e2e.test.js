#!/usr/bin/env node
/* =========================================================================
   End-to-end suite for mureev.com — the terminal in a real browser.

   The unit suite (unit.test.js) proves the core logic; this file proves
   the *experience*: boot, typing, history, completion, themes, mobile,
   and the no-JS fallback — in actual Chromium via Playwright, the one
   and only devDependency this repo allows itself.

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

    await browser.close();

    console.log('\n' + passed + '/' + (passed + failures.length) + ' e2e tests passed'
        + (failures.length ? '  \x1b[31m(' + failures.length + ' failed)\x1b[0m' : ''));
    process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
