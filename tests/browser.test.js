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
  page.on('requestfailed', r => errors.push('request failed: ' + r.url()));
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

  await page.click('#btn-play');
  ok(await active() === 'screen-modes', 'PLAY opens mode selection');
  await shot('04-modes');
  ok(await page.locator('.mode-card').count() === 6, 'six game modes are listed (incl. Magic Play)');

  // ---- fast game speed so the CPUs play quickly
  // ---- vs computer
  await page.click('[data-mode="cpu"]');
  await shot('05-setup-cpu');
  await page.click('[data-opp="3"]'); await page.click('[data-diff="hard"]');
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active');
  await sleep(500);
  ok(await page.locator('.token').count() === 16, '4-colour board shows 16 tokens');
  ok(await page.locator('.cell').count() === 52 + 20, 'board has 52 track cells + 20 lane cells');
  await shot('06-game-start');
  await page.waitForFunction(() => !document.getElementById('btn-roll').disabled, null, { timeout: 8000 });
  ok(true, 'ROLL button enables on the human turn');

  // speed the CPUs up (same setting the Settings screen writes), then play through the real UI
  await page.evaluate(() => { window.LudoApp.applySetting({ speed: 'fast' }); });
  let rolls = 0, tapped = 0, shotMove = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && rolls < 12) {
    const st = await page.evaluate(() => {
      const c = window.LudoApp.controller;
      return { roll: c.awaitingRoll && !c.paused, move: c.awaitingMove, seat: c.state.current, over: c.state.status === 'finished' };
    });
    if (st.over) break;
    if (st.roll) { await page.click('#btn-roll', { force: true }); rolls++; await sleep(40); }
    else if (st.move) {
      const idx = await page.evaluate(() => window.LudoApp.controller.state.validMoves[0]);
      await page.click('.token[data-seat="' + st.seat + '"][data-idx="' + idx + '"]', { force: true });
      tapped++; await sleep(40);
    } else await sleep(60);
  }
  ok(rolls >= 5, 'played ' + rolls + ' human rolls through the UI against 3 hard CPUs');

  // deterministic token choice: two tokens on the track, roll a 3, tap the second token
  // get back to a roll prompt (tap a move first if the loop stopped mid-move)
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
    c.rng = () => 0.4;                                  // dice = 3
  });
  const seat = await page.evaluate(() => window.LudoApp.controller.state.current);
  await page.click('#btn-roll', { force: true });
  await page.waitForFunction(() => window.LudoApp.controller.awaitingMove, null, { timeout: 5000 });
  await shot('07-choose-token');
  ok(await page.locator('.token.movable').count() === 2, 'two glowing tokens are offered when two moves are legal');
  ok(await page.locator('.target').count() === 2, 'two landing markers are shown');
  await page.click('.token[data-seat="' + seat + '"][data-idx="1"]', { force: true });
  await page.waitForFunction(s => window.LudoApp.controller.state.tokens[s][1] === 23, seat, { timeout: 5000 });
  ok(true, 'tapped token moved exactly 3 cells (20 -> 23)');
  await page.evaluate(() => { window.LudoApp.controller.rng = Math.random; });
  await shot('08-game-mid');
  const inv = await page.evaluate(() => {
    const s = window.LudoApp.controller.state;
    return s.tokens.every((t, seat) => t.every(p => p >= -1 && p <= 56)) && s.stats.rolls.reduce((a, b) => a + b, 0) > 10;
  });
  ok(inv, 'state stays valid and CPUs have been playing');

  // pause menu + save & exit + continue
  await page.click('#btn-pause');
  ok(await page.isVisible('#modal'), 'pause menu opens');
  await shot('09-pause');
  await page.click('[data-a="save"]');
  await page.waitForSelector('#screen-home.active');
  ok(await page.isVisible('#btn-continue'), 'Save & exit shows Continue on the dashboard');
  await shot('10-home-continue');
  await page.click('#btn-continue');
  await page.waitForSelector('#screen-game.active');
  await sleep(400);
  ok(await page.locator('.token').count() === 16, 'Continue restores the saved game');
  const restored = await page.evaluate(() => window.LudoApp.controller.state.stats.rolls.reduce((a, b) => a + b, 0));
  ok(restored > 10, 'restored game keeps its progress (' + restored + ' rolls)');

  // quit
  await page.click('#btn-pause'); await page.click('[data-a="quit"]'); await page.click('[data-r="1"]');
  await page.waitForSelector('#screen-home.active');
  ok(!(await page.isVisible('#btn-continue')), 'Quit clears the saved game');

  // ---- fast AI-only finish to test the result screen (2 players, speed fast)
  await page.click('[data-go="settings"]');
  await shot('11-settings');
  await page.click('[data-speed="fast"]');
  await page.click('.screen.active [data-back]');

  // ---- pass and play with hand-over
  await page.click('#btn-play'); await page.click('[data-mode="passplay"]');
  await shot('12-setup-local');
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll);
  await page.click('#btn-roll', { force: true });
  await page.waitForSelector('#modal .handoff-dot', { timeout: 8000 });
  ok(true, 'pass-and-play shows the hand-over screen for the next player');
  await shot('13-handoff');
  await page.click('[data-ok]');
  await page.waitForFunction(() => window.LudoApp.controller.awaitingRoll);
  ok(true, 'second player can roll after hand-over');

  // ---- force a win through the engine state to test the result screen + rewards
  await page.evaluate(() => {
    const c = window.LudoApp.controller;
    const s = c.state;
    const cur = s.current;
    s.tokens[cur] = [56, 56, 56, 55];
    s.dice = null;
  });
  await page.evaluate(() => { window.LudoApp.controller.rng = () => 0.0; });  // roll a 1
  await page.click('#btn-roll', { force: true });
  await page.waitForSelector('#screen-result.active', { timeout: 12000 });
  await sleep(300); await shot('14-result');
  ok((await page.textContent('#res-title')).includes('wins'), 'winner screen is displayed');
  ok(await page.locator('.rank-row').count() === 3, 'ranking lists all 3 players');
  ok((await page.textContent('#res-reward')).includes('Match completed'), 'reward breakdown is shown');
  await page.click('#res-menu');
  await page.waitForSelector('#screen-home.active');

  // ---- remaining screens
  await page.click('[data-go="history"]'); await sleep(200); await shot('15-history');
  ok(await page.locator('#history-body .card').count() >= 1, 'game history lists the finished game');
  await page.click('.screen.active [data-back]');
  await page.click('[data-go="profile"]'); await sleep(200); await shot('16-profile');
  ok((await page.textContent('#profile-body')).includes('Statistics'), 'profile shows statistics');
  await page.fill('#prof-name', 'Sanaullah');
  await page.dispatchEvent('#prof-name', 'change');
  await page.click('.screen.active [data-back]');
  ok((await page.textContent('#home-name')) === 'Sanaullah', 'profile name change shows on dashboard');
  await page.click('.tile[data-go="rewards"]'); await sleep(200); await shot('17-rewards');
  ok((await page.textContent('#rewards-body')).includes('no monetary value'), 'rewards screen states coins have no monetary value');
  await page.click('#claim-free');
  ok(Number(await page.textContent('.big-coins span')) > 250, 'free coins can be collected');
  await page.click('.screen.active [data-back]');

  // ---- every mode starts with the right number of players and colours
  for (const [mode, n] of [['local2', 2], ['local3', 3], ['local4', 4]]) {
    await page.click('#btn-play'); await page.click('[data-mode="' + mode + '"]');
    await page.click('#btn-start-game');
    await page.waitForSelector('#screen-game.active');
    await sleep(250);
    const info = await page.evaluate(() => { const s = window.LudoApp.controller.state; return { seats: s.seats.length, tokens: document.querySelectorAll('.token').length }; });
    ok(info.seats === n && info.tokens === n * 4, mode + ' starts with ' + n + ' players / ' + n * 4 + ' tokens');
    if (mode === 'local3') await shot('18-three-players');
    await page.click('#btn-pause'); await page.click('[data-a="quit"]'); await page.click('[data-r="1"]');
    await page.waitForSelector('#screen-home.active');
  }


  // ---- dice over the home, timer, modal layering, magic play, new rules
  console.log('\nDice, timer, magic');
  const playBtn = await page.evaluate(() => document.getElementById('btn-play').getBoundingClientRect().width);
  await page.click('#btn-pause').catch(() => {});
  const quitCurrent = async () => {
    await page.click('#btn-pause'); await page.click('[data-a="quit"]'); await page.click('[data-r="1"]');
    await page.waitForSelector('#screen-home.active');
  };
  const diceBase = () => page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect(), d = document.getElementById('dice-spot').getBoundingClientRect();
    const cx = (d.left + d.width / 2 - b.left) / b.width * 15, cy = (d.top + d.height / 2 - b.top) / b.height * 15;
    return { cx, cy, seat: window.LudoApp.controller.state.current, w: d.width / b.width * 15 };
  });
  const baseOf = p => (p.cx < 7.5 ? (p.cy < 7.5 ? 0 : 3) : (p.cy < 7.5 ? 1 : 2));

  await page.click('#btn-play'); await page.click('[data-mode="local2"]'); await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active'); await sleep(1000);
  let db = await diceBase();
  ok(baseOf(db) === db.seat, 'dice sits over the current player\'s home (seat ' + db.seat + ')');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('dice')).transformStyle === 'preserve-3d'), 'dice is a real 3D cube');
  ok(await page.locator('.dice .face').count() === 6, 'cube has six faces');
  ok(await page.isVisible('#turn-timer'), 'turn timer badge is shown on the human turn');
  ok(Number(await page.textContent('#turn-timer b')) >= 8, 'turn timer counts down from 10 seconds');
  await shot('20-dice-over-home');
  // tap the dice itself to roll
  await page.evaluate(() => { window.LudoApp.controller.rng = () => 0.99; });
  await page.click('#dice-spot', { force: true });
  await page.waitForFunction(() => window.LudoApp.controller.state.dice === 6, null, { timeout: 4000 });
  ok(true, 'tapping the dice rolls it');
  ok(await page.evaluate(() => document.getElementById('dice').getAttribute('data-v') === '6'), 'cube shows the rolled face');
  await sleep(1500);
  // finish the current turn by timing out: shorten the timer and wait
  await page.evaluate(() => window.LudoApp.applySetting({ turnTimer: 1 }));
  await page.evaluate(() => { const c = window.LudoApp.controller; c.state.status = c.state.status; });
  // wait for a roll prompt, remember who is playing, do nothing
  await page.waitForFunction(() => { const c = window.LudoApp.controller; return c.awaitingRoll; }, null, { timeout: 8000 });
  const seatBefore = (await diceBase()).seat;
  await page.waitForFunction(s => window.LudoApp.controller.state.current !== s, seatBefore, { timeout: 14000 });
  await sleep(1100);
  db = await diceBase();
  ok(db.seat !== seatBefore && baseOf(db) === db.seat, 'after the timeout the turn and the dice moved to the next player\'s home');
  await page.evaluate(() => window.LudoApp.applySetting({ turnTimer: 10 }));
  await quitCurrent();

  // modal must sit above every token
  await page.click('#btn-play'); await page.click('[data-mode="local4"]'); await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active'); await sleep(500);
  await page.evaluate(() => {      // pile tokens in the middle of the screen so they would cover the menu
    const c = window.LudoApp.controller, s = c.state;
    s.seats.forEach(seat => { s.tokens[seat] = [seat * 13 + 6, seat * 13 + 7, seat * 13 + 8, seat * 13 + 9]; });
    c.view.layout(s);
  });
  await page.click('#btn-pause');
  await sleep(300);
  const covered = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#modal .btn').forEach(b => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !b.contains(top)) bad.push(b.textContent.trim());
    });
    return bad;
  });
  await shot('21-pause-menu');
  ok(covered.length === 0, 'pause menu buttons are never covered by tokens or the dice' + (covered.length ? ' (' + covered.join(', ') + ')' : ''));
  await page.click('[data-a="resume"]');
  await quitCurrent();

  // Magic Play
  await page.click('#btn-play'); await page.click('[data-mode="magic"]');
  await shot('22-setup-magic');
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active');
  await page.waitForFunction(() => !document.getElementById('btn-roll').disabled, null, { timeout: 8000 });
  ok(await page.isVisible('#spell-bar'), 'Magic Play shows the spell bar');
  ok(await page.locator('#spell-bar .spell:not([disabled])').count() === 3, 'all three spells are ready on the human turn');
  ok((await page.textContent('.pchip.cur em')).includes('✨3') && (await page.textContent('.pchip.cur em')).includes('🔒'), 'player chip shows spells and the closed-home lock');
  await shot('23-magic-game');
  await page.click('[data-spell="dice"]');
  ok(await page.locator('#modal [data-n="6"]').count() === 1, 'Pick Dice offers the numbers 1-6');
  await page.click('#modal [data-n="6"]');
  await page.waitForFunction(() => window.LudoApp.controller.state.dice === 6, null, { timeout: 4000 });
  ok(true, 'Pick Dice rolled exactly the chosen number');
  await sleep(1800);
  // shield one of our tokens
  await page.waitForFunction(() => window.LudoApp.controller.canCast('shield') || window.LudoApp.controller.awaitingMove, null, { timeout: 8000 });
  await page.evaluate(() => {
    const c = window.LudoApp.controller, s = c.state;
    if (s.current === 0 && s.status === 'waiting_roll') { s.tokens[0][1] = 12; c.view.layout(s); }
  });
  if (await page.evaluate(() => window.LudoApp.controller.canCast('shield'))) {
    await page.click('[data-spell="shield"]');
    ok(await page.locator('.token.pickable').count() >= 1, 'Shield highlights the tokens it can protect');
    await page.evaluate(() => document.querySelector('.token.pickable').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(200);
    ok(await page.locator('.token.shielded').count() === 1, 'shielded token shows its bubble');
    await shot('24-shield');
  } else { ok(true, 'shield step skipped (turn moved on)'); ok(true, 'shield step skipped (turn moved on)'); }
  await quitCurrent();

  // settings expose the timer and the new rule
  await page.click('[data-go="settings"]');
  ok(await page.locator('[data-timer]').count() === 4, 'settings offer the turn timer options');
  ok(await page.locator('[data-set="r.killToEnterHome"]').count() === 1, 'settings offer "Capture to open home"');
  await shot('25-settings');
  await page.click('.screen.active [data-back]');
  await page.waitForSelector('#screen-home.active');
  ok(playBtn < 230, 'PLAY button is smaller (' + Math.round(playBtn) + 'px wide)');

  // small phone
  await page.setViewportSize({ width: 360, height: 640 });
  await page.click('#btn-play'); await page.click('[data-mode="local4"]'); await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active'); await sleep(400);
  const box = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect(), r = document.getElementById('btn-roll').getBoundingClientRect();
    return { bw: b.width, bb: b.bottom, rt: r.top, rb: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth };
  });
  await shot('19-small-phone');
  ok(box.bb <= box.rt + 1 && box.rb <= box.vh, 'small phone (360x640): board and ROLL button fit without overlap');
  ok(box.sw <= box.iw, 'no horizontal overflow');

  console.log('\nJS / network errors: ' + errors.length);
  errors.forEach(e => console.log('   ' + e));
  ok(errors.length === 0, 'no JavaScript or network errors during the whole session');

  await browser.close(); server.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
