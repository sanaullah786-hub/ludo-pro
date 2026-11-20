/*
 * Ludo Pro - controller tests: 10 second turn timer and Magic Play.
 * Run with:  node tests/timer.test.js     Developer: Sanaullah Khoso
 */
'use strict';
const assert = require('assert');
const E = require('../www/js/ludo-engine.js');
const Controller = require('../www/js/game-controller.js');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
const noSleep = () => Promise.resolve();
const ms = n => new Promise(r => setTimeout(r, n));
function waitFor(cond, t = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return res();
      if (Date.now() - t0 > t) return rej(new Error('timeout waiting for condition'));
      setTimeout(poll, 5);
    })();
  });
}
function human(extra, settings, rng) {
  const events = [], timers = [];
  const c = new Controller({
    rng: rng || E.mulberry32(3), sleep: noSleep,
    getSettings: () => Object.assign({ speed: 'fast', autoMove: false, turnTimer: 0.35 }, settings || {}),
    ui: { onEvent: e => events.push(e), onTimer: t => timers.push(t), onError: e => { throw e; } }
  });
  c.start(Object.assign({ mode: 'local2', seats: [0, 1], names: { 0: 'A', 1: 'B' } }, extra || {}));
  return { c, events, timers };
}

test('no roll within the time limit: the turn passes to the next player', async () => {
  const { c, events } = human();
  await waitFor(() => c.awaitingRoll);
  assert.strictEqual(c.state.current, 0);
  await waitFor(() => events.some(e => e.type === 'timeout'));
  await waitFor(() => c.state.current === 1 && c.awaitingRoll);
  assert.strictEqual(events.filter(e => e.type === 'timeout')[0].phase, 'roll');
  assert.strictEqual(c.state.dice, null, 'nothing was rolled');
  assert.strictEqual(c.requestRoll(), true, 'next player can roll normally');
  c.destroy();
});

test('the timer reports its countdown and clears when the player acts', async () => {
  const { c, timers } = human({}, { turnTimer: 5 });
  await waitFor(() => c.awaitingRoll);
  await waitFor(() => timers.some(t => t && t.phase === 'roll' && t.left < 5));
  const first = timers.filter(Boolean)[0];
  assert.strictEqual(first.total, 5);
  assert.strictEqual(first.seat, 0);
  const n = timers.length;
  c.requestRoll();
  await waitFor(() => timers.slice(n).some(t => t === null));
  c.destroy();
});

test('turnTimer 0 means unlimited time', async () => {
  const { c, events } = human({}, { turnTimer: 0 });
  await waitFor(() => c.awaitingRoll);
  await ms(450);
  assert.ok(!events.some(e => e.type === 'timeout'));
  assert.strictEqual(c.state.current, 0);
  c.destroy();
});

test('pausing freezes the countdown', async () => {
  const { c, events } = human({}, { turnTimer: 0.4 });
  await waitFor(() => c.awaitingRoll);
  c.pause();
  await ms(700);
  assert.ok(!events.some(e => e.type === 'timeout'), 'no timeout while paused');
  c.unpause();
  await waitFor(() => events.some(e => e.type === 'timeout'));
  c.destroy();
});

test('no move chosen in time: a legal move is played automatically', async () => {
  const { c, events } = human({}, { turnTimer: 0.5 }, () => 0.4);         // dice = 3
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [5, 9, -1, -1];
  c.requestRoll();
  await waitFor(() => c.awaitingMove);
  const before = c.state.tokens[0].slice();
  await waitFor(() => events.some(e => e.type === 'timeout' && e.phase === 'move'));
  await waitFor(() => c.state.tokens[0].join() !== before.join());
  const moved = c.state.tokens[0].filter((p, i) => p !== before[i]);
  assert.strictEqual(moved.length, 1, 'exactly one token moved');
  c.destroy();
});

test('Magic Pick Dice: the human chooses the number and the charge is used', async () => {
  const { c, events } = human({ magic: true }, { turnTimer: 0 });
  await waitFor(() => c.awaitingRoll);
  assert.ok(c.canCast('dice'));
  assert.strictEqual(c.requestMagicDice(9), false);
  assert.ok(c.requestMagicDice(6));
  await waitFor(() => c.state.dice === 6 && c.awaitingMove || c.state.status === 'waiting_move');
  assert.strictEqual(c.state.dice, 6);
  assert.strictEqual(c.state.magic.charges[0].dice, 0);
  assert.ok(events.some(e => e.type === 'magic' && e.kind === 'dice'));
  assert.strictEqual(c.requestMagicDice(6), false, 'cannot cast while a move is pending');
  c.destroy();
});

test('Magic Shield: pick mode glows own tokens and a tap casts it', async () => {
  const { c, events } = human({ magic: true }, { turnTimer: 0 });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [10, -1, -1, -1];
  assert.ok(c.beginPick('shield'));
  assert.strictEqual(c.pickMode(), 'shield');
  assert.strictEqual(c.tapToken(1, 0), false, 'only own tokens can be shielded');
  assert.ok(c.tapToken(0, 0));
  await waitFor(() => E.isShielded(c.state, 0, 0));
  assert.strictEqual(c.pickMode(), null);
  assert.strictEqual(c.beginPick('shield'), false, 'charge is used up');
  assert.ok(events.some(e => e.type === 'magic' && e.kind === 'shield'));
  assert.ok(c.canHumanRoll(), 'casting does not use the turn');
  c.destroy();
});

test('Magic Blast: tapping an opponent token sends it home and opens the home lane', async () => {
  const { c, events } = human({ magic: true, rules: { killToEnterHome: true } }, { turnTimer: 0 });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[1] = [30, -1, -1, -1];
  assert.ok(c.beginPick('blast'));
  assert.strictEqual(c.tapToken(0, 0), false, 'own token is not a blast target');
  assert.ok(c.tapToken(1, 0));
  await waitFor(() => c.state.tokens[1][0] === -1);
  assert.strictEqual(c.state.kills[0], 1);
  assert.ok(events.some(e => e.type === 'homeUnlocked'));
  c.destroy();
});

test('Magic Play vs computers: the AI casts spells and the game finishes', async () => {
  let over = null; const ev = { magic: 0, homeUnlocked: 0 };
  const c = new Controller({
    rng: E.mulberry32(21), sleep: noSleep, getSettings: () => ({ speed: 'fast', turnTimer: 0 }),
    ui: { onGameOver: s => { over = s; }, onEvent: e => { if (ev[e.type] !== undefined) ev[e.type]++; }, onError: e => { throw e; } }
  });
  c.start({ mode: 'magic', magic: true, rules: { killToEnterHome: true }, seats: [0, 1, 2, 3],
            types: { 0: 'cpu', 1: 'cpu', 2: 'cpu', 3: 'cpu' }, difficulty: { 0: 'hard', 1: 'medium', 2: 'easy', 3: 'hard' },
            names: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' } });
  await waitFor(() => over, 20000);
  assert.strictEqual(over.magic, true);
  assert.ok(ev.magic > 0, 'spells were cast');
  assert.ok(ev.homeUnlocked >= 1);
  assert.ok(over.kills[over.winnerSeat] > 0, 'winner had to capture first');
  c.destroy();
});

test('a saved Magic game restores with its spells, shields and kills', async () => {
  const { c } = human({ magic: true, rules: { killToEnterHome: true } }, { turnTimer: 0 });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [10, -1, -1, -1];
  c.beginPick('shield'); c.tapToken(0, 0);
  await waitFor(() => E.isShielded(c.state, 0, 0));
  const snap = JSON.parse(JSON.stringify(c.snapshotNow()));
  c.destroy();
  const d = new Controller({ rng: E.mulberry32(1), sleep: noSleep, getSettings: () => ({ turnTimer: 0 }), ui: {} });
  assert.ok(d.resume(snap));
  assert.ok(E.isShielded(d.state, 0, 0));
  assert.strictEqual(d.state.magic.charges[0].shield, 0);
  assert.strictEqual(d.state.rules.killToEnterHome, true);
  d.destroy();
});

test('5 Minutes mode: when the clock runs out the best score wins', async () => {
  let over = null; const clocks = [];
  const c = new Controller({
    rng: E.mulberry32(8), sleep: noSleep, getSettings: () => ({ speed: 'fast', turnTimer: 0 }),
    ui: { onGameOver: s => { over = s; }, onClock: k => clocks.push(k), onError: e => { throw e; } }
  });
  c.start({ mode: 'timed', variant: 'timed', timeLimitMs: 700, seats: [0, 1], types: { 0: 'human', 1: 'human' }, names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[1][0] = 20;                       // B is ahead
  await waitFor(() => over, 5000);
  assert.strictEqual(over.variant, 'timed');
  assert.strictEqual(over.winnerSeat, 1);
  assert.ok(clocks.some(k => k && k.left < 700 && k.total === 700), 'the clock counted down');
  c.destroy();
});

(async () => {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
