/*
 * Ludo Pro - tests for the controller, storage, data, coins and missions.
 * Run with:  node tests/app.test.js     Developer: Sanaullah Khoso
 */
'use strict';
const assert = require('assert');
const E = require('../www/js/ludo-engine.js');
const Controller = require('../www/js/game-controller.js');
const S = require('../www/js/storage.js');
const D = require('../www/js/data.js');
const Eco = require('../www/js/economy.js');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function section(name) { queue.push({ section: name }); }

const noSleep = () => Promise.resolve();
function cpuConfig(seats, level, mode) {
  const types = {}, difficulty = {}, names = {};
  seats.forEach(s => { types[s] = 'cpu'; difficulty[s] = level; names[s] = 'CPU' + s; });
  return { mode: mode || 'cpu', seats, types, difficulty, names };
}
function waitFor(cond, ms = 15000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return res();
      if (Date.now() - t0 > ms) return rej(new Error('timeout waiting for condition'));
      setImmediate(poll);
    })();
  });
}

// ------------------------------------------------------------------ controller
section('Game controller (headless)');

test('AI-only games run to completion through the controller in every mode size', async () => {
  for (const seats of [[0, 2], [0, 1, 2], [0, 1, 2, 3], [1, 3]]) {
    let over = null;
    const events = { roll: 0, capture: 0 };
    const c = new Controller({
      rng: E.mulberry32(seats.length * 77), sleep: noSleep,
      ui: { onGameOver: s => { over = s; }, onEvent: e => { if (events[e.type] !== undefined) events[e.type]++; },
            onError: e => { throw e; } }
    });
    c.start(cpuConfig(seats, 'medium'));
    await waitFor(() => over);
    assert.ok(seats.includes(over.winnerSeat));
    assert.strictEqual(over.rankings[0], over.winnerSeat);
    assert.strictEqual(over.rankings.length, seats.length);
    assert.strictEqual(E.finishedCount(c.state, over.winnerSeat), 4);
    assert.ok(events.roll > 50);
    c.destroy();
  }
});

test('a human must tap ROLL; tapping is ignored until it is waiting for it', async () => {
  const log = [];
  const c = new Controller({ rng: E.mulberry32(5), sleep: noSleep, ui: { setRollEnabled: v => log.push(v) } });
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  assert.strictEqual(c.state.dice, null);
  assert.ok(c.requestRoll());
  assert.strictEqual(c.requestRoll(), false, 'second tap in same turn must be rejected');
  c.destroy();
});

test('human moves only via tapToken and only legal tokens are accepted', async () => {
  const c = new Controller({ rng: () => 0.99, sleep: noSleep, ui: {}, getSettings: () => ({ speed: 'fast', autoMove: false }) });
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.requestRoll();                                // rng 0.99 -> always a 6
  await waitFor(() => c.awaitingMove);
  assert.strictEqual(c.state.dice, 6);
  assert.strictEqual(c.tapToken(1, 0), false, 'wrong seat');
  assert.strictEqual(c.state.tokens[0][0], -1);
  assert.ok(c.tapToken(0, 2));
  await waitFor(() => c.state.tokens[0][2] === 0);
  await waitFor(() => c.awaitingRoll);            // six -> same player rolls again
  assert.strictEqual(c.state.current, 0);
  c.destroy();
});

test('autoMove plays the only legal move automatically', async () => {
  const c = new Controller({ rng: () => 0.99, sleep: noSleep, ui: {}, getSettings: () => ({ speed: 'normal', autoMove: true }) });
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [10, 56, 56, 56];
  c.state.rules.extraTurnOnSix = false;
  c.rng = () => 0.5;                              // roll 4
  c.requestRoll();
  await waitFor(() => c.state.tokens[0][0] === 14);
  assert.strictEqual(c.state.current, 1);
  c.destroy();
});

test('a roll with no legal move passes the turn automatically', async () => {
  const c = new Controller({ rng: () => 0.2, sleep: noSleep, ui: {} });      // always rolls a 2
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.requestRoll();
  await waitFor(() => c.state.current === 1 && c.awaitingRoll);
  c.destroy();
});

test('pass-and-play asks for a hand-over between different humans', async () => {
  let handOffs = 0;
  const c = new Controller({
    rng: () => 0.2, sleep: noSleep,
    ui: { confirmHandOff: async () => { handOffs++; } }
  });
  c.start({ mode: 'passplay', seats: [0, 1, 2], names: { 0: 'A', 1: 'B', 2: 'C' } });
  await waitFor(() => c.awaitingRoll);
  assert.strictEqual(handOffs, 0, 'first player does not need a hand-over');
  c.requestRoll();
  await waitFor(() => c.state.current === 1 && c.awaitingRoll);
  assert.strictEqual(handOffs, 1);
  c.requestRoll();
  await waitFor(() => c.state.current === 2 && c.awaitingRoll);
  assert.strictEqual(handOffs, 2);
  c.destroy();
});

test('local multiplayer (non pass-play) never asks for a hand-over', async () => {
  let handOffs = 0;
  const c = new Controller({ rng: () => 0.2, sleep: noSleep, ui: { confirmHandOff: async () => { handOffs++; } } });
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.requestRoll();
  await waitFor(() => c.state.current === 1 && c.awaitingRoll);
  assert.strictEqual(handOffs, 0);
  c.destroy();
});

test('vs computer: human plays seat 0, CPU plays seat 2 on its own', async () => {
  const c = new Controller({ rng: () => 0.2, sleep: noSleep, ui: {} });
  c.start({ mode: 'cpu', seats: [0, 2], types: { 2: 'cpu' }, difficulty: { 2: 'hard' }, names: { 0: 'You', 2: 'CPU' } });
  await waitFor(() => c.awaitingRoll);
  c.requestRoll();
  await waitFor(() => c.state.current === 0 && c.state.turn >= 3 && c.awaitingRoll);
  assert.ok(c.state.stats.rolls[2] >= 1, 'CPU rolled by itself');
  c.destroy();
});

test('snapshot -> resume continues the same game', async () => {
  let saved = null;
  const c = new Controller({ rng: E.mulberry32(9), sleep: noSleep, ui: { save: s => { saved = s; } } });
  c.start({ mode: 'local', seats: [0, 1, 3], names: { 0: 'A', 1: 'B', 3: 'D' } });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [5, 7, 56, -1];
  c.state.tokens[1] = [40, -1, -1, -1];
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  c.destroy();

  const c2 = new Controller({ rng: E.mulberry32(10), sleep: noSleep, ui: {} });
  assert.ok(c2.resume(snap));
  await waitFor(() => c2.awaitingRoll);
  assert.deepStrictEqual(c2.state.tokens[0], [5, 7, 56, -1]);
  assert.deepStrictEqual(c2.state.seats, [0, 1, 3]);
  assert.strictEqual(c2.state.current, 0);
  c2.destroy();
  assert.ok(saved, 'autosave hook was called');
});

test('resume rejects corrupt data', () => {
  const c = new Controller({ sleep: noSleep, ui: {} });
  assert.strictEqual(c.resume(null), false);
  assert.strictEqual(c.resume({ state: '{bad', meta: {} }), false);
  assert.strictEqual(c.resume({ state: { version: 1 }, meta: {} }), false);
});

test('resuming a game saved while waiting for a move lets the player choose again', async () => {
  const c = new Controller({ rng: E.mulberry32(3), sleep: noSleep, ui: {}, getSettings: () => ({ speed: 'normal', autoMove: false }) });
  c.start({ mode: 'local', seats: [0, 1], names: { 0: 'A', 1: 'B' } });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0] = [10, 20, 56, 56];
  c.rng = () => 0.4;                                          // roll 3
  c.requestRoll();
  await waitFor(() => c.awaitingMove);
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  c.destroy();
  const c2 = new Controller({ rng: E.mulberry32(3), sleep: noSleep, ui: {}, getSettings: () => ({ speed: 'normal', autoMove: false }) });
  assert.ok(c2.resume(snap));
  await waitFor(() => c2.awaitingMove);
  assert.deepStrictEqual(c2.state.validMoves.slice().sort(), [0, 1]);
  assert.ok(c2.tapToken(0, 1));
  await waitFor(() => c2.state.tokens[0][1] === 23);
  c2.destroy();
});

test('destroy stops a running game completely (no further moves)', async () => {
  const c = new Controller({ rng: E.mulberry32(2), sleep: () => new Promise(r => setTimeout(r, 1)), ui: {} });
  c.start(cpuConfig([0, 1, 2, 3], 'easy'));
  await new Promise(r => setTimeout(r, 40));
  c.destroy();
  const rolls = c.state.stats.rolls.slice();
  await new Promise(r => setTimeout(r, 80));
  assert.deepStrictEqual(c.state.stats.rolls, rolls);
});

test('restart creates a fresh game with the same setup', async () => {
  const c = new Controller({ rng: E.mulberry32(2), sleep: noSleep, ui: {} });
  c.start({ mode: 'local', seats: [0, 1, 2], names: { 0: 'A', 1: 'B', 2: 'C' } });
  await waitFor(() => c.awaitingRoll);
  c.state.tokens[0][0] = 30;
  c.restart();
  await waitFor(() => c.awaitingRoll);
  assert.deepStrictEqual(c.state.tokens[0], [-1, -1, -1, -1]);
  assert.deepStrictEqual(c.state.seats, [0, 1, 2]);
  c.destroy();
});

test('pause freezes AI play and unpause continues', async () => {
  const c = new Controller({ rng: E.mulberry32(4), sleep: () => new Promise(r => setTimeout(r, 2)), ui: {} });
  c.start(cpuConfig([0, 1], 'easy'));
  await new Promise(r => setTimeout(r, 30));
  c.pause();
  await new Promise(r => setTimeout(r, 30));
  const rolls = c.state.stats.rolls.slice();
  await new Promise(r => setTimeout(r, 120));
  assert.deepStrictEqual(c.state.stats.rolls, rolls);
  c.unpause();
  await new Promise(r => setTimeout(r, 150));
  assert.ok(c.state.stats.rolls[0] + c.state.stats.rolls[1] > rolls[0] + rolls[1]);
  c.destroy();
});

test('game over summary contains rankings, stats and duration', async () => {
  let over = null;
  const c = new Controller({ rng: E.mulberry32(12), sleep: noSleep, ui: { onGameOver: s => { over = s; } } });
  c.start(cpuConfig([0, 1, 2, 3], 'hard'));
  await waitFor(() => over);
  assert.strictEqual(over.players.length, 4);
  assert.ok(over.turns > 10);
  assert.ok(over.stats.moves.reduce((a, b) => a + b, 0) > 50);
  assert.strictEqual(c.snapshot(), null, 'no snapshot once finished');
  c.destroy();
});

// ------------------------------------------------------------------ storage
section('Storage and data');

test('storage round-trips values and falls back to the backup copy', () => {
  S.clearAll();
  S.set('k', { a: 1, b: [1, 2] });
  assert.deepStrictEqual(S.get('k', null), { a: 1, b: [1, 2] });
  assert.strictEqual(S.get('missing', 'dflt'), 'dflt');
  S.remove('k');
  assert.strictEqual(S.get('k', 7), 7);
});

test('settings merge with defaults and keep types', () => {
  S.clearAll();
  assert.strictEqual(D.getSettings().sound, true);
  D.setSettings({ sound: false, rules: { extraTurnOnCapture: false } });
  const s = D.getSettings();
  assert.strictEqual(s.sound, false);
  assert.strictEqual(s.rules.extraTurnOnCapture, false);
  assert.strictEqual(s.rules.extraTurnOnSix, true);
  D.setSettings({ speed: 12 });                    // wrong type is ignored
  assert.strictEqual(D.getSettings().speed, 'normal');
});

test('profile name is sanitised and limited', () => {
  S.clearAll();
  const p = D.updateProfile({ name: '  <b>Sanaullah Khoso Long Name</b> ', avatar: '🎲' });
  assert.ok(p.name.length <= 14);
  assert.ok(!/[<>]/.test(p.name));
  assert.strictEqual(D.updateProfile({ name: '   ' }).name, 'Player');
});

test('statistics: wins, losses, streaks', () => {
  S.clearAll();
  D.recordGame({ won: true, captures: 2, sixes: 5, tokensHome: 4 });
  D.recordGame({ won: true, captures: 1, sixes: 3, tokensHome: 4 });
  let st = D.getProfile().stats;
  assert.strictEqual(st.games, 2); assert.strictEqual(st.wins, 2);
  assert.strictEqual(st.streak, 2); assert.strictEqual(st.captures, 3);
  D.recordGame({ won: false, captures: 0, sixes: 1, tokensHome: 1 });
  st = D.getProfile().stats;
  assert.strictEqual(st.losses, 1); assert.strictEqual(st.streak, 0); assert.strictEqual(st.bestStreak, 2);
});

test('history keeps newest first and is capped', () => {
  S.clearAll();
  for (let i = 0; i < D.HISTORY_LIMIT + 10; i++) D.addHistory({ id: i });
  const h = D.getHistory();
  assert.strictEqual(h.length, D.HISTORY_LIMIT);
  assert.strictEqual(h[0].id, D.HISTORY_LIMIT + 9);
  D.clearHistory();
  assert.strictEqual(D.getHistory().length, 0);
});

test('saved game round-trips through storage and restores in the engine', () => {
  S.clearAll();
  const st = E.createGame({ seats: [0, 1] });
  st.tokens[0][0] = 12;
  D.saveGame({ version: 1, state: E.clone(st), meta: { mode: 'local', config: {} } });
  const g = D.getSavedGame();
  assert.ok(g);
  const back = E.deserialize(g.state);
  assert.strictEqual(back.tokens[0][0], 12);
  D.clearSavedGame();
  assert.strictEqual(D.getSavedGame(), null);
});

// ------------------------------------------------------------------ economy
section('Coins, rewards, missions, levels');

function fakeClock(startISO) {
  let t = new Date(startISO).getTime();
  Eco.setClock(() => new Date(t));
  return { advance: ms => { t += ms; }, days: n => { t += n * 86400000; } };
}

test('new players receive a welcome balance and a logged transaction', () => {
  S.clearAll(); Eco.reset(); fakeClock('2026-03-10T10:00:00');
  Eco.reset();
  assert.strictEqual(Eco.coins(), Eco.START_COINS);
  assert.strictEqual(Eco.coinHistory()[0].reason, 'Welcome gift');
});

test('daily bonus: once per day, streak grows on consecutive days and resets after a gap', () => {
  S.clearAll(); const clk = fakeClock('2026-03-10T10:00:00'); Eco.reset();
  const c0 = Eco.coins();
  const a = Eco.claimDaily();
  assert.strictEqual(a.amount, 50); assert.strictEqual(a.streak, 1);
  assert.strictEqual(Eco.claimDaily(), null, 'second claim same day');
  assert.strictEqual(Eco.dailyBonus().available, false);
  clk.days(1);
  const b = Eco.claimDaily();
  assert.strictEqual(b.streak, 2); assert.strictEqual(b.amount, 75);
  clk.days(3);
  const c = Eco.claimDaily();
  assert.strictEqual(c.streak, 1, 'streak resets after missing days');
  assert.strictEqual(Eco.coins(), c0 + 50 + 75 + 50);
});

test('daily bonus amount is capped after day 7', () => {
  S.clearAll(); const clk = fakeClock('2026-03-10T10:00:00'); Eco.reset();
  let last = 0;
  for (let i = 0; i < 12; i++) { last = Eco.claimDaily().amount; clk.days(1); }
  assert.strictEqual(last, 50 + 25 * 6);
});

test('free coins have a cooldown', () => {
  S.clearAll(); const clk = fakeClock('2026-03-10T10:00:00'); Eco.reset();
  assert.ok(Eco.freeCoins().available);
  const c0 = Eco.coins();
  assert.ok(Eco.claimFree());
  assert.strictEqual(Eco.claimFree(), null);
  assert.strictEqual(Eco.coins(), c0 + 25);
  clk.advance(Eco.FREE_COOLDOWN_MS - 1000);
  assert.strictEqual(Eco.freeCoins().available, false);
  clk.advance(2000);
  assert.ok(Eco.freeCoins().available);
});

test('three distinct daily missions, stable within a day and new on the next day', () => {
  S.clearAll(); const clk = fakeClock('2026-03-10T10:00:00'); Eco.reset();
  const m1 = Eco.missions();
  assert.strictEqual(m1.length, 3);
  assert.strictEqual(new Set(m1.map(m => m.ev)).size, 3);
  assert.deepStrictEqual(Eco.missions().map(m => m.id), m1.map(m => m.id));
  const ids = new Set(m1.map(m => m.id));
  let changed = false;
  for (let d = 0; d < 6 && !changed; d++) { clk.days(1); Eco.missions(); changed = Eco.missions().some(m => !ids.has(m.id)); }
  assert.ok(changed, 'missions rotate over days');
});

test('mission progress, completion, claiming and double-claim protection', () => {
  S.clearAll(); fakeClock('2026-03-10T10:00:00'); Eco.reset();
  const m = Eco.missions()[0];
  assert.strictEqual(Eco.claimMission(m.id), null, 'cannot claim before completion');
  Eco.track(m.ev, m.target + 5);
  const done = Eco.missions().find(x => x.id === m.id);
  assert.ok(done.done);
  assert.strictEqual(done.progress, done.target, 'progress capped at target');
  const c0 = Eco.coins();
  const r = Eco.claimMission(m.id);
  assert.strictEqual(r.amount, m.reward);
  assert.strictEqual(Eco.coins(), c0 + m.reward);
  assert.strictEqual(Eco.claimMission(m.id), null, 'second claim rejected');
});

test('game rewards: winner gets more than loser; harder CPU pays more', () => {
  S.clearAll(); fakeClock('2026-03-10T10:00:00'); Eco.reset();
  const lose = Eco.awardGame({ won: false, captures: 0, vsCpu: true, difficulty: 'hard' });
  const winE = Eco.awardGame({ won: true, captures: 0, vsCpu: true, difficulty: 'easy' });
  const winH = Eco.awardGame({ won: true, captures: 0, vsCpu: true, difficulty: 'hard' });
  assert.ok(winE.coins > lose.coins);
  assert.ok(winH.coins > winE.coins);
  const cap = Eco.awardGame({ won: true, captures: 5, vsCpu: false });
  assert.ok(cap.breakdown.some(b => b.label === 'Captures'));
});

test('levels: xp accumulates, levels up with a bonus, requirement grows', () => {
  S.clearAll(); fakeClock('2026-03-10T10:00:00'); Eco.reset();
  assert.strictEqual(Eco.levelInfo().level, 1);
  const c0 = Eco.coins();
  const up = Eco.addXp(130);
  assert.ok(up && up.to === 2 && up.bonus > 0);
  assert.strictEqual(Eco.levelInfo().level, 2);
  assert.ok(Eco.coins() > c0);
  assert.ok(Eco.xpNeeded(5) > Eco.xpNeeded(2));
});

test('coin history records every change newest-first with running balance', () => {
  S.clearAll(); fakeClock('2026-03-10T10:00:00'); Eco.reset();
  Eco.claimDaily(); Eco.claimFree();
  const h = Eco.coinHistory();
  assert.strictEqual(h[0].reason, 'Free coins gift');
  assert.strictEqual(h[0].balance, Eco.coins());
  assert.ok(h.every(x => x.amount > 0), 'coins are only ever earned, never wagered');
});

test('economy persists across re-initialisation', () => {
  S.clearAll(); fakeClock('2026-03-10T10:00:00'); Eco.reset();
  Eco.addCoins(500, 'test');
  const c = Eco.coins();
  Eco.init();
  assert.strictEqual(Eco.coins(), c);
});

test('there is no API that spends or withdraws coins (no gambling surface)', () => {
  const names = Object.keys(Eco).join(' ').toLowerCase();
  ['bet', 'wager', 'withdraw', 'deposit', 'cashout', 'buy', 'purchase'].forEach(w => assert.ok(!names.includes(w), w));
});

// ------------------------------------------------------------------ run
(async function main() {
  for (const t of queue) {
    if (t.section) { console.log('\n' + t.section); continue; }
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
