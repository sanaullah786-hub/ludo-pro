/*
 * Ludo Pro - end-to-end browser test (Playwright + Chromium).
 * Serves www/ locally, drives the real UI on a phone viewport and fails on any JS error.
 * Run: node tests/browser.test.js [screenshotDir]      Developer: Sanaullah Khoso
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const WWW = path.join(__dirname, '..', 'www');
const SHOTS = process.argv[2] || null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WWW, p);
  if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/play\(\)|NotAllowed|autoplay/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => { if (/\.mp3$/.test(r.url()) && /ABORTED/.test((r.failure() || {}).errorText || '')) return; errors.push('request failed: ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

  console.log('\nBrowser flow');
  await page.goto(url);
  await sleep(500); await shot('01-splash');
  ok(await active() === 'screen-splash', 'splash screen shows first');
  await page.waitForSelector('#screen-home.active', { timeout: 6000 });
  ok(true, 'splash moves to the dashboard');
  await sleep(900); await shot('02-home-daily');
  ok(await page.isVisible('#modal'), 'daily bonus popup appears on first launch');
  await page.click('[data-c="1"]');
  ok((await page.textContent('#home-coins')) === '250', 'claiming daily bonus adds 50 coins to the 200 welcome coins');
  await shot('03-home');

  const startGame = async (kind, variant, n, diff) => {
    await page.click('[data-kind="' + kind + '"]');
    await page.waitForSelector('#screen-modes.active');
    if (variant) await page.click('#variant-list [data-variant="' + variant + '"]');
    await page.click('#btn-variant-play');
    await page.waitForSelector('#screen-setup.active');
    if (n) await page.click('#setup-body [data-n="' + n + '"]');
    if (diff) await page.click('#setup-body [data-diff="' + diff + '"]');
    await page.click('#btn-start-game');
    await page.waitForSelector('#screen-game.active');
    await sleep(500);
  };
  const quitCurrent = async () => {
    await page.click('#btn-pause'); await page.click('[data-a="quit"]'); await page.click('[data-r="1"]');
    await page.waitForSelector('#screen-home.active');
  };
  const rollNow = () => page.click('.holder.ready .hold-box', { force: true });
  const hasModal = () => page.evaluate(() => !!document.querySelector('#modal .btn'));

  // ---- home
  ok(await page.locator('[data-kind]').count() >= 4, 'home shows the big game tiles (Computer / Local / Pass & Play / Power)');
  ok(await page.locator('.bottom-nav button').count() >= 3, 'bottom navigation is present');
  await page.click('[data-kind="cpu"]');
  ok(await active() === 'screen-modes', 'a tile opens the game-mode list');
  await shot('04-modes');
  ok(await page.locator('#variant-list [data-variant]').count() === 5, 'five game modes: Classic, 5 Minutes, Quick, Deathmatch, Power');
  await page.click('#variant-list [data-info="deathmatch"]');
  ok(await hasModal(), 'info button opens the Rules popup');
  ok(await page.locator('#modal [data-rt]').count() === 5, 'Rules popup has 5 tabs');
  ok(await page.locator('#modal .rule-row').count() === 3, 'Deathmatch tab lists its rules');
  await shot('04b-rules-deathmatch');
  await page.click('#modal [data-rt="power"]');
  ok(await page.locator('#modal .rule-row').count() >= 8, 'Power tab lists the power-ups');
  await shot('04c-rules-power');
  await page.click('#modal [data-x]');
  await page.click('#btn-variant-play');
  ok(await active() === 'screen-setup', 'PLAY opens the player/colour select');
  await shot('05-setup-cpu');
  ok(await page.locator('.color-card').count() === 4, 'four colour cards (Nobody / Computer / Human)');
  await page.click('#setup-body [data-n="4"]'); await page.click('#setup-body [data-diff="hard"]');
  await shot('05b-setup-4p');
  ok(await page.locator('.color-card.on').count() === 4, '4P turns on all four colours');
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active'); await sleep(600);
  ok(await page.locator('.token').count() === 16, '4-colour board shows 16 tokens');
  ok(await page.locator('.cell').count() === 52 + 20, 'board has 52 track cells + 20 lane cells');
  ok(await page.locator('.holder').count() === 4, 'every player has a dice holder beside the board');
  await shot('06-game-start');
  await page.waitForSelector('.holder.ready .hold-box', { timeout: 8000, state: 'attached' });
  ok(true, 'human holder is ready to roll');

  // roll through the real UI
  await page.evaluate(() => { window.LudoApp.applySetting({ speed: 'fast' }); });
  let rolls = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && rolls < 10) {
    const st = await page.evaluate(() => { const c = window.LudoApp.controller; return { roll: c.awaitingRoll && !c.paused, move: c.awaitingMove, seat: c.state.current, over: c.state.status === 'finished', idx: c.state.validMoves[0] }; });
    if (st.over) break;
    if (st.roll) { await page.click('.hold-box[data-seat="' + st.seat + '"]', { force: true }); rolls++; await sleep(60); }
    else if (st.move) { await page.click('.token[data-seat="' + st.seat + '"][data-idx="' + st.idx + '"]', { force: true }); await sleep(60); }
    else await sleep(80);
  }
  ok(rolls >= 5, 'played ' + rolls + ' human rolls by tapping the dice holder against 3 hard CPUs');

  // deterministic choice of token
  for (let k = 0; k < 400; k++) {
    const st = await page.evaluate(() => { const c = window.LudoApp.controller; return { roll: c.awaitingRoll, move: c.awaitingMove, seat: c.state.current, idx: c.state.validMoves[0] }; });
    if (st.roll) break;
    if (st.move) await page.click('.token[data-seat="' + st.seat + '"][data-idx="' + st.idx + '"]', { force: true });
    await sleep(60);
  }
  await page.evaluate(() => {
    const c = window.LudoApp.controller;
    c.state.tokens[c.state.current] = [10, 20, -1, -1];
    c.view.layout(c.state);
    c.rng = () => 0.4;
  });
  const seat = await page.evaluate(() => window.LudoApp.controller.state.current);
  await page.click('.hold-box[data-seat="' + seat + '"]', { force: true });
  await page.waitForFunction(() => window.LudoApp.controller.awaitingMove, null, { timeout: 6000 });
  await shot('07-choose-token');
  ok(await page.locator('.token.movable').count() === 2, 'two glowing tokens are offered when two moves are legal');
  ok(await page.locator('.target').count() === 2, 'two landing markers are shown');
  await page.click('.token[data-seat="' + seat + '"][data-idx="1"]', { force: true });
  await page.waitForFunction(s => window.LudoApp.controller.state.tokens[s][1] === 23, seat, { timeout: 5000 });
  ok(true, 'tapped token moved exactly 3 cells (20 -> 23)');
  await page.evaluate(() => { window.LudoApp.controller.rng = Math.random; });
  await shot('08-game-mid');

  // pause / save / continue
  await page.click('#btn-pause');
  ok(await hasModal(), 'pause menu opens');
  await shot('09-pause');
  await page.click('[data-a="save"]');
  await page.waitForSelector('#screen-home.active');
  ok(await page.isVisible('#btn-continue'), 'Save & exit shows Continue on home');
  await shot('10-home-continue');
  await page.click('#btn-continue');
  await page.waitForSelector('#screen-game.active'); await sleep(500);
  ok(await page.locator('.token').count() === 16, 'Continue restores the saved game');
  await quitCurrent();
  ok(!(await page.isVisible('#btn-continue')), 'Quit clears the saved game');

  // ---- token styles
  await page.click('[data-go="tokens"]');
  await page.waitForSelector('#screen-tokens.active'); await sleep(200);
  await shot('11-tokens');
  ok(await page.locator('#tok-grid [data-tok]').count() === 12, 'Select Token offers 12 styles');
  ok(await page.locator('#tok-grid .lock, #tok-grid .ad').count() === 0, 'no token is ad-locked');
  await page.click('#tok-grid [data-tok]:nth-child(2)');
  const picked = await page.evaluate(() => document.querySelector('#tok-grid .sel').getAttribute('data-tok'));
  await page.click('#btn-equip');
  ok(await page.evaluate(p => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /settings/i.test(k))) || '{}').tokenStyle === p, picked), 'equipping a style saves it (' + picked + ')');
  await page.click('#tok-grid [data-tok="pointy"]'); await page.click('#btn-equip');
  await page.click('.screen.active [data-back]');
  await page.waitForSelector('#screen-home.active');

  // ---- pass and play hand-over
  await startGame('passplay');
  await shot('12-passplay');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll);
  await page.evaluate(() => { window.LudoApp.controller.rng = () => 0.4; });   // a 3 with all tokens at home: turn passes
  await rollNow();
  await page.waitForSelector('#modal .handoff-dot', { timeout: 8000 });
  ok(true, 'pass-and-play shows the hand-over screen');
  await shot('13-handoff');
  await page.click('[data-ok]');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll);
  ok(true, 'second player can roll after hand-over');

  // forced win -> result
  await page.evaluate(() => { const c = window.LudoApp.controller, s = c.state; s.tokens[s.current] = [56, 56, 56, 55]; s.dice = null; c.rng = () => 0.0; });
  await rollNow();
  await page.waitForSelector('#screen-result.active', { timeout: 12000 });
  await sleep(300); await shot('14-result');
  ok((await page.textContent('#res-title')).toLowerCase().includes('win'), 'winner screen is displayed');
  ok(await page.locator('.rank-row').count() === 2, 'ranking lists both players');
  ok((await page.textContent('#res-reward')).includes('Match completed'), 'reward breakdown is shown');
  await page.click('#res-menu');
  await page.waitForSelector('#screen-home.active');

  // ---- other screens
  await page.click('.bottom-nav [data-go="history"]'); await sleep(200); await shot('15-history');
  ok(await page.locator('#history-body .card, #history-body .hist').count() >= 1, 'history lists the finished game');
  await page.click('.screen.active [data-back]');
  await page.click('[data-go="profile"]'); await sleep(200); await shot('16-profile');
  ok((await page.textContent('#profile-body')).includes('Statistics'), 'profile shows statistics');
  await page.click('.screen.active [data-back]');
  await page.click('[data-go="rewards"]'); await sleep(200); await shot('17-rewards');
  ok((await page.textContent('#rewards-body')).includes('no monetary value'), 'rewards state coins have no monetary value');
  await page.click('.screen.active [data-back]');

  // ---- player counts
  for (const [kind, n] of [['local', 2], ['local', 3], ['local', 4]]) {
    await startGame(kind, null, n);
    const info = await page.evaluate(() => ({ seats: window.LudoApp.controller.state.seats.length, tokens: document.querySelectorAll('.token').length, holders: document.querySelectorAll('.holder:not(.off):not([hidden])').length }));
    ok(info.seats === n && info.tokens === n * 4, kind + ' ' + n + 'P starts with ' + n + ' players / ' + n * 4 + ' tokens');
    if (n === 3) await shot('18-three-players');
    await quitCurrent();
  }

  // ---- dice flight + timer
  console.log('\nDice, timer');
  await startGame('local', null, 2);
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('dice')).transformStyle === 'preserve-3d'), 'dice is a real 3D cube');
  ok(await page.locator('.dice .face').count() === 6, 'cube has six faces');
  await shot('20-dice-holder');
  await page.evaluate(() => { window.LudoApp.controller.rng = () => 0.99; });
  await rollNow();
  await sleep(350);
  const mid = await page.evaluate(() => { const d = document.getElementById('dice-spot').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect(); return { inBoard: d.left > b.left && d.right < b.right && d.top > b.top && d.bottom < b.bottom }; });
  ok(mid.inBoard, 'dice flies out over the board while rolling');
  await shot('21-dice-flying');
  await page.waitForFunction(() => window.LudoApp.controller.state.dice === 6, null, { timeout: 4000 });
  ok(await page.evaluate(() => document.getElementById('dice').getAttribute('data-v') === '6'), 'cube shows the rolled face');
  await sleep(1800);
  await page.evaluate(() => { window.LudoApp.controller.rng = Math.random; window.LudoApp.applySetting({ turnTimer: 1 }); });
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll, null, { timeout: 8000 });
  const sb = await page.evaluate(() => window.LudoApp.controller.state.current);
  await page.waitForFunction(s => window.LudoApp.controller.state.current !== s, sb, { timeout: 14000 });
  ok(true, 'turn passes to the next player when the timer runs out');
  await page.evaluate(() => window.LudoApp.applySetting({ turnTimer: 10 }));
  await quitCurrent();

  // modal over tokens
  await startGame('local', null, 4);
  await page.evaluate(() => {
    const c = window.LudoApp.controller, s = c.state;
    s.seats.forEach(seat => { s.tokens[seat] = [seat * 13 + 6, seat * 13 + 7, seat * 13 + 8, seat * 13 + 9]; });
    c.view.layout(s);
  });
  await page.click('#btn-pause'); await sleep(300);
  const covered = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#modal .btn').forEach(b => {
      const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !b.contains(top)) bad.push(b.textContent.trim());
    });
    return bad;
  });
  await shot('22-pause-over-tokens');
  ok(covered.length === 0, 'pause menu buttons are never covered by tokens' + (covered.length ? ' (' + covered.join(', ') + ')' : ''));
  await page.click('[data-a="resume"]');
  await quitCurrent();

  // ---- variants
  console.log('\nGame modes');
  for (const v of ['quick', 'deathmatch', 'timed']) {
    await startGame('cpu', v, 2, 'easy');
    const st = await page.evaluate(() => { const s = window.LudoApp.controller.state; return { variant: s.variant, goal: document.getElementById('goal-main').textContent, sub: document.getElementById('goal-sub').textContent }; });
    ok(st.variant === v && st.goal.length > 0, v + ' starts with its goal shown ("' + st.goal.trim() + ' / ' + st.sub.trim() + '")');
    await shot('23-variant-' + v);
    await quitCurrent();
  }
  await startGame('power', null, 2, 'easy');
  ok(await page.evaluate(() => window.LudoApp.controller.state.variant) === 'power', 'Power tile starts the Power variant');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll, null, { timeout: 8000 });
  ok(await page.isVisible('#spell-bar'), 'Power shows the spell bar');
  ok(await page.locator('#spell-bar .spell:not([disabled])').count() === 3, 'all three spells are ready');
  ok(await page.locator('.pad').count() === 9, 'Power board shows 9 power-up pads');
  ok(await page.locator('.pad[data-pad="mine"]').count() === 1, 'one hidden landmine is on the board');
  await shot('24-power');
  await page.click('[data-spell="dice"]');
  ok(await page.locator('#modal [data-n="6"]').count() === 1, 'Pick Dice offers 1-6');
  await page.click('#modal [data-n="6"]');
  await page.waitForFunction(() => window.LudoApp.controller.state.dice === 6, null, { timeout: 5000 });
  ok(true, 'Pick Dice rolled exactly the chosen number');
  await quitCurrent();

  // rocket pad through the real UI
  await startGame('power', null, 2, 'easy');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll, null, { timeout: 8000 });
  const exp = await page.evaluate(() => {
    const c = window.LudoApp.controller, s = c.state, seat = s.current;
    const pad = s.pads.find(p => p.type === 'rocket'); pad.cell = 20;
    s.pads.forEach(p => { if (p !== pad && Math.abs(p.cell - 20) < 4) p.cell = 40 + s.pads.indexOf(p) % 3; });
    const rel = (20 - window.LudoEngine.START_INDEX[seat] + 52) % 52;
    s.tokens[seat] = [rel - 2, -1, -1, -1];
    c.view.setPads(s); c.view.layout(s);
    c.rng = () => 0.2;                                   // roll a 2
    return { seat, to: rel + 8 };
  });
  await page.click('.hold-box[data-seat="' + exp.seat + '"]', { force: true });
  await page.waitForFunction(() => window.LudoApp.controller.awaitingMove || window.LudoApp.controller.state.status === 'animating', null, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => { const c = window.LudoApp.controller; if (c.awaitingMove) c.tapToken && c.tapToken(c.state.current, 0); });
  await page.waitForFunction(e => window.LudoApp.controller.state.tokens[e.seat][0] === e.to, exp, { timeout: 8000 });
  ok(true, 'token landing on a Rocket pad flies 8 steps further');
  await shot('24b-rocket');
  await page.evaluate(() => { window.LudoApp.controller.rng = Math.random; });
  await quitCurrent();

  // settings
  await page.click('[data-go="settings"]');
  ok(await page.locator('[data-timer]').count() === 4, 'settings offer the turn timer options');
  ok(await page.locator('[data-set="r.killToEnterHome"]').count() === 1, 'settings offer "Capture to open home"');
  await shot('25-settings');
  await page.click('.screen.active [data-back]');
  await page.waitForSelector('#screen-home.active');

  // small phone
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame('local', null, 4);
  const box = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const hs = [...document.querySelectorAll('.holder .hold-box')].map(e => e.getBoundingClientRect());
    return { l: b.left, r: b.right, bb: b.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, hsOk: hs.every(r => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0) };
  });
  await shot('19-small-phone');
  ok(box.hsOk, 'small phone (360x640): all dice holders are fully on screen');
  ok(box.sw <= box.iw, 'no horizontal overflow');

  console.log('\nJS / network errors: ' + errors.length);
  errors.forEach(e => console.log('   ' + e));
  ok(errors.length === 0, 'no JavaScript or network errors during the whole session');

  await browser.close(); server.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
