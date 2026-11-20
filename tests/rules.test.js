/*
 * Ludo Pro - tests for the kill-to-open-home rule, magic spells and turn skipping.
 * Run with:  node tests/rules.test.js      Developer: Sanaullah Khoso
 */
'use strict';
const assert = require('assert');
const E = require('../www/js/ludo-engine.js');
const AI = require('../www/js/ludo-ai.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function section(n) { console.log('\n' + n); }
function game(seats, extra) { return E.createGame(Object.assign({ seats: seats || [0, 1] }, extra || {})); }
function kill(extra) { return game([0, 1], Object.assign({ rules: { killToEnterHome: true } }, extra || {})); }
function roll(s, v) { const r = E.rollWithValue(s, v); E.settleRoll(s); return r; }

// ------------------------------------------------------------ kill rule
section('Kill to open home');

test('the rule is off by default (classic behaviour unchanged)', () => {
  const s = game();
  assert.strictEqual(s.rules.killToEnterHome, false);
  s.tokens[0][0] = 48;
  assert.strictEqual(E.targetPosition(s, 0, 0, 5), 53);
});
test('without a kill a token passing the last track cell keeps circling the board', () => {
  const s = kill();
  s.tokens[0][0] = 48;
  assert.ok(E.isGateLocked(s, 0));
  assert.strictEqual(E.targetPosition(s, 0, 0, 5), 2);          // 48 + 5 = 53 -> second lap, cell 2
  roll(s, 5);
  const m = E.applyMove(s, 0);
  assert.deepStrictEqual(m.path, [49, 50, 0, 1, 2]);
  assert.ok(m.wraps && !m.entersHomeLane);
  assert.ok(E.isOnTrack(s.tokens[0][0]));
});
test('a locked token can stop exactly on the last track cell and move on again', () => {
  const s = kill();
  s.tokens[0][0] = 47;
  assert.strictEqual(E.targetPosition(s, 0, 0, 3), 50);
  s.tokens[0][0] = 50;
  assert.strictEqual(E.targetPosition(s, 0, 0, 1), 0);
  assert.strictEqual(E.targetPosition(s, 0, 0, 6), 5);
});
test('locked tokens never reach the lane or the finish, whatever is rolled', () => {
  const s = kill();
  for (let pos = 0; pos <= 50; pos++) for (let v = 1; v <= 6; v++) {
    s.tokens[0][0] = pos;
    const t = E.targetPosition(s, 0, 0, v);
    assert.ok(t >= 0 && t <= 50, 'pos ' + pos + ' dice ' + v + ' -> ' + t);
  }
});
test('the first capture opens the home lane (unlockedHome flag) and it stays open', () => {
  const s = kill();
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;                       // green on abs 4
  roll(s, 1);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 1);
  assert.ok(m.unlockedHome);
  assert.strictEqual(s.kills[0], 1);
  assert.ok(!E.isGateLocked(s, 0));
  E.completeMove(s);
  s.tokens[0][1] = 48;
  assert.strictEqual(E.targetPosition(s, 0, 1, 5), 53);          // lane now open
  // a second capture does not report an unlock again
  s.current = 0; s.status = 'waiting_roll'; s.tokens[0][0] = 3; s.tokens[1][1] = 43;
  roll(s, 1);
  assert.ok(!E.applyMove(s, 0).unlockedHome);
});
test('the lock is per player: one player\'s kill does not open the others', () => {
  const s = kill();
  s.kills[0] = 2;
  assert.ok(!E.isGateLocked(s, 0));
  assert.ok(E.isGateLocked(s, 1));
});
test('tokens on their second lap can capture and are safe on start cells', () => {
  const s = kill();
  s.tokens[0][0] = 2;                                            // second-lap token
  s.tokens[1][0] = 43;                                           // green on abs 4
  roll(s, 2);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 1);
  assert.strictEqual(s.tokens[0][0], 4);
});
test('base entry is unaffected by the lock', () => {
  const s = kill();
  roll(s, 6);
  assert.deepStrictEqual(s.validMoves, [0, 1, 2, 3]);
});
test('with the rule on, a token finishing needs a prior kill (full lane path after the kill)', () => {
  const s = kill();
  s.kills[0] = 1;
  s.tokens[0][0] = 50;
  roll(s, 3);
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 53);
});
test('legacy saves without kills / magic / the new rule load fine', () => {
  const s = game([0, 2]);
  const old = JSON.parse(JSON.stringify(s));
  delete old.kills; delete old.magic; delete old.rules.killToEnterHome;
  const d = E.deserialize(old);
  assert.deepStrictEqual(d.kills, [0, 0, 0, 0]);
  assert.strictEqual(d.magic, null);
  assert.strictEqual(d.rules.killToEnterHome, false);
});

// ------------------------------------------------------------ skip turn
section('Turn timeout (skipTurn)');
test('skipTurn passes the turn to the next player and resets the sixes counter', () => {
  const s = game([0, 1, 2]);
  s.consecutiveSixes = 2;
  const r = E.skipTurn(s);
  assert.ok(r.ok);
  assert.strictEqual(r.skipped, 0);
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.consecutiveSixes, 0);
  assert.strictEqual(s.status, 'waiting_roll');
});
test('skipTurn is refused while a move is pending, while rolling and after the game', () => {
  const s = game();
  roll(s, 6);
  assert.strictEqual(E.skipTurn(s).error, 'not_waiting_move'.replace('move', 'roll'));
  const s2 = game(); E.rollWithValue(s2, 6);
  assert.strictEqual(E.skipTurn(s2).error, 'dice_rolling');
  const s3 = game(); s3.status = 'finished';
  assert.strictEqual(E.skipTurn(s3).error, 'game_finished');
});

// ------------------------------------------------------------ magic
section('Magic spells');

test('magic is off unless requested; when on every active seat gets one of each spell', () => {
  assert.strictEqual(game().magic, null);
  const s = game([0, 2], { magic: true });
  assert.deepStrictEqual(s.magic.charges[0], { dice: 1, shield: 1, blast: 1 });
  assert.deepStrictEqual(s.magic.charges[2], { dice: 1, shield: 1, blast: 1 });
  assert.deepStrictEqual(s.magic.charges[1], { dice: 0, shield: 0, blast: 0 });
});
test('spells are refused when magic is off', () => {
  assert.strictEqual(E.useMagic(game(), 'dice', { value: 6 }).error, 'no_magic');
});
test('Pick Dice sets the dice number, acts as the roll and uses up the charge', () => {
  const s = game([0, 1], { magic: true });
  const r = E.useMagic(s, 'dice', { value: 6 });
  assert.ok(r.ok && r.magic === 'dice' && r.value === 6);
  E.settleRoll(s);
  assert.strictEqual(s.dice, 6);
  assert.strictEqual(s.status, 'waiting_move');
  assert.strictEqual(s.magic.charges[0].dice, 0);
  E.applyMove(s, 0); E.completeMove(s);                           // six -> extra turn
  assert.strictEqual(s.current, 0);
  assert.strictEqual(E.useMagic(s, 'dice', { value: 6 }).error, 'no_charge');
});
test('Pick Dice still obeys the three-sixes rule and the no-legal-move rule', () => {
  const s = game([0, 1], { magic: true });
  s.consecutiveSixes = 2;
  const r = E.useMagic(s, 'dice', { value: 6 });
  assert.ok(r.forfeited);
  const s2 = game([0, 1], { magic: true });
  const r2 = E.useMagic(s2, 'dice', { value: 3 });                // nothing out of base: no legal move
  assert.ok(r2.noMoves);
  assert.strictEqual(s2.current, 1);
});
test('Pick Dice rejects bad numbers and cannot be cast after rolling or while the dice rolls', () => {
  const s = game([0, 1], { magic: true });
  assert.strictEqual(E.useMagic(s, 'dice', { value: 0 }).error, 'invalid_dice_value');
  assert.strictEqual(E.useMagic(s, 'dice', { value: 7 }).error, 'invalid_dice_value');
  assert.strictEqual(E.useMagic(s, 'dice', { value: 2.5 }).error, 'invalid_dice_value');
  E.rollWithValue(s, 6);
  assert.strictEqual(E.useMagic(s, 'dice', { value: 6 }).error, 'dice_rolling');
  E.settleRoll(s);
  assert.strictEqual(E.useMagic(s, 'dice', { value: 6 }).error, 'not_waiting_roll');
});
test('unknown spells are rejected', () => {
  assert.strictEqual(E.useMagic(game([0, 1], { magic: true }), 'fireball', {}).error, 'unknown_spell');
});
test('Shield: only own tokens on the track qualify', () => {
  const s = game([0, 1], { magic: true });
  s.tokens[0] = [-1, 10, 53, 56];
  assert.deepStrictEqual(E.magicTargets(s, 'shield').map(t => t.token), [1]);
  assert.strictEqual(E.useMagic(s, 'shield', { token: 0 }).error, 'invalid_target');
  assert.strictEqual(E.useMagic(s, 'shield', { token: 2 }).error, 'invalid_target');
  assert.ok(E.useMagic(s, 'shield', { token: 1 }).ok);
  assert.ok(E.isShielded(s, 0, 1));
  assert.strictEqual(s.status, 'waiting_roll', 'casting a spell does not end the turn');
  assert.strictEqual(E.useMagic(s, 'shield', { token: 1 }).error, 'no_charge');
});
test('A shielded token cannot be captured, and the shield ends when its owner\'s turn comes round', () => {
  const s = game([0, 1], { magic: true });
  s.tokens[0][0] = 4;                                              // red abs 4
  E.useMagic(s, 'shield', { token: 0 });
  roll(s, 2);                                                      // red has no other legal move? token 0 only -> must move
  E.applyMove(s, 0); E.completeMove(s);                            // red now abs 6, shield still on
  assert.ok(E.isShielded(s, 0, 0));
  assert.strictEqual(s.current, 1);
  s.tokens[1][0] = 39;                                             // green rel 39 -> abs 52%52 = 0 ... place right behind red
  s.tokens[1][0] = 41;                                             // green abs (13+41)%52 = 2
  roll(s, 4);                                                      // 2 + 4 = abs 6 where the shielded red token stands
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 0, 'shielded token is not captured');
  assert.strictEqual(s.tokens[0][0], 6);
  E.completeMove(s);                                               // turn passes back to red -> shield expires
  assert.strictEqual(s.current, 0);
  assert.ok(!E.isShielded(s, 0, 0));
});
test('Blast: sends an unprotected opponent token home and counts as a kill', () => {
  const s = kill({ magic: true });
  s.tokens[1][0] = 30;                                             // green abs 43: normal cell
  assert.deepStrictEqual(E.magicTargets(s, 'blast').map(t => [t.seat, t.token]), [[1, 0]]);
  const r = E.useMagic(s, 'blast', { seat: 1, token: 0 });
  assert.ok(r.ok && r.unlockedHome);
  assert.strictEqual(s.tokens[1][0], -1);
  assert.strictEqual(s.kills[0], 1);
  assert.strictEqual(s.stats.captures[0], 1);
  assert.strictEqual(s.status, 'waiting_roll');
  assert.strictEqual(E.useMagic(s, 'blast', { seat: 1, token: 0 }).error, 'no_charge');
});
test('Blast cannot hit safe cells, shielded tokens, tokens in base / lane, or own tokens', () => {
  const s = game([0, 1], { magic: true });
  s.tokens[1] = [0, 8, 52, -1];                                    // start cell, star cell, lane, base
  s.tokens[0][0] = 20;
  assert.deepStrictEqual(E.magicTargets(s, 'blast'), []);
  assert.strictEqual(E.useMagic(s, 'blast', { seat: 1, token: 0 }).error, 'invalid_target');
  assert.strictEqual(E.useMagic(s, 'blast', { seat: 0, token: 0 }).error, 'invalid_target');
  s.tokens[1][3] = 5;
  s.magic.shields[1][3] = true;
  assert.deepStrictEqual(E.magicTargets(s, 'blast'), []);
});
test('finishing a token earns one extra spell charge', () => {
  const s = game([0, 1], { magic: true });
  s.tokens[0] = [53, 56, 56, 56];
  const before = Object.values(s.magic.charges[0]).reduce((a, b) => a + b, 0);
  roll(s, 3);
  const m = E.applyMove(s, 0);
  assert.ok(E.SPELLS.includes(m.earnedSpell));
  const after = Object.values(s.magic.charges[0]).reduce((a, b) => a + b, 0);
  assert.strictEqual(after, before + 1);
});
test('magic state survives save / load', () => {
  const s = game([0, 1, 3], { magic: true });
  E.useMagic(s, 'dice', { value: 6 }); E.settleRoll(s);
  s.tokens[0][1] = 9;
  const d = E.deserialize(E.serialize(s));
  assert.deepStrictEqual(d.magic, s.magic);
  assert.strictEqual(d.status, 'waiting_move');
});

// ------------------------------------------------------------ AI + magic
section('AI with spells and the kill rule');

test('chooseMagic is null without magic and otherwise always returns a castable spell', () => {
  assert.strictEqual(AI.chooseMagic(game(), 'hard', Math.random), null);
  let casts = 0;
  for (const level of ['easy', 'medium', 'hard']) {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = E.mulberry32(seed);
      const s = game([0, 1, 2, 3], { magic: true, rules: { killToEnterHome: seed % 2 === 0 } });
      for (let seat = 0; seat < 4; seat++) for (let t = 0; t < 4; t++) {
        const r = rng();
        s.tokens[seat][t] = r < 0.25 ? -1 : (r < 0.9 ? Math.floor(rng() * 51) : 53);
      }
      s.current = seed % 4;
      const m = AI.chooseMagic(s, level, rng);
      if (!m) continue;
      casts++;
      const copy = E.clone(s);
      const res = E.useMagic(copy, m.kind, m.args);
      assert.ok(res.ok, level + ' chose an illegal spell: ' + JSON.stringify(m) + ' -> ' + res.error);
    }
  }
  assert.ok(casts > 100, 'AI should cast spells (' + casts + ')');
});
test('AI blasts an advanced opponent token and shields a threatened one', () => {
  const s = game([0, 1], { magic: true });
  s.tokens[0] = [30, -1, -1, -1];
  s.tokens[1] = [40, -1, -1, -1];                                  // green abs 1 ... advanced token on a normal cell
  const m = AI.chooseMagic(s, 'hard', () => 0);
  assert.ok(m && m.kind === 'blast', JSON.stringify(m));
  const s2 = game([0, 1], { magic: true });
  s2.magic.charges[0].blast = 0;
  s2.tokens[0] = [20, -1, -1, -1];
  s2.tokens[1] = [3, -1, -1, -1];                                  // green abs 16, four cells behind red abs 20
  const m2 = AI.chooseMagic(s2, 'hard', () => 0);
  assert.ok(m2 && m2.kind === 'shield' && m2.args.token === 0, JSON.stringify(m2));
});
test('AI asks for a six when it has nothing on the board', () => {
  const s = game([0, 1], { magic: true });
  s.magic.charges[0].blast = 0; s.magic.charges[0].shield = 0;
  const m = AI.chooseMagic(s, 'medium', () => 0);
  assert.deepStrictEqual(m, { kind: 'dice', args: { value: 6 } });
});

function playFull(seats, levels, seed, opts) {
  const types = {}, difficulty = {};
  seats.forEach((s, i) => { types[s] = 'cpu'; difficulty[s] = levels[i % levels.length]; });
  const s = E.createGame(Object.assign({ seats, types, difficulty }, opts));
  const rng = E.mulberry32(seed);
  let steps = 0, spells = 0;
  while (!E.isGameOver(s)) {
    if (++steps > 60000) throw new Error('game did not finish (seed ' + seed + ')');
    let r = null;
    if (s.magic) {
      const m = AI.chooseMagic(s, difficulty[s.current], rng);
      if (m) {
        const res = E.useMagic(s, m.kind, m.args);
        assert.ok(res.ok, 'AI spell rejected: ' + res.error);
        spells++;
        if (m.kind === 'dice') r = res;
      }
    }
    if (!r) r = E.rollDice(s, rng);
    assert.ok(r.ok, 'roll rejected: ' + r.error);
    E.settleRoll(s);
    if (r.validMoves.length) {
      const idx = AI.chooseMove(s, difficulty[s.current], rng);
      assert.ok(s.validMoves.includes(idx));
      assert.ok(E.applyMove(s, idx).ok);
      E.completeMove(s);
    }
    for (let seat = 0; seat < 4; seat++) for (let t = 0; t < 4; t++) {
      const p = s.tokens[seat][t];
      assert.ok(p >= -1 && p <= 56);
      if (E.isInHomeLane(p) || p === 56) assert.ok(!E.isGateLocked(s, seat), 'token entered the lane while the gate was closed');
    }
  }
  return { state: s, spells };
}

test('full AI games finish with the kill rule on (2, 3 and 4 players)', () => {
  for (const seats of [[0, 2], [0, 1, 2], [0, 1, 2, 3]]) {
    for (let seed = 1; seed <= 25; seed++) {
      const { state } = playFull(seats, ['easy', 'medium', 'hard'], 300 + seed, { rules: { killToEnterHome: true } });
      assert.ok(state.kills[state.winner] > 0, 'winner must have made a kill');
      assert.ok(state.tokens[state.winner].every(p => p === 56));
    }
  }
});
test('full AI games finish with magic + kill rule, and spells really get cast', () => {
  let totalSpells = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { state, spells } = playFull([0, 1, 2, 3], ['hard', 'medium', 'easy', 'hard'], 900 + seed, { magic: true, rules: { killToEnterHome: true } });
    totalSpells += spells;
    assert.ok(state.winner !== null);
  }
  assert.ok(totalSpells > 80, 'spells cast: ' + totalSpells);
});


// ------------------------------------------------------------ variants
section('Game variants');
test('unknown variants fall back to classic', () => {
  assert.strictEqual(game([0, 1], { variant: 'nonsense' }).variant, 'classic');
  assert.deepStrictEqual(E.VARIANTS, ['classic', 'power', 'quick', 'deathmatch', 'timed']);
});
test('Quick: one capture alone does not win, a capture plus one token home does', () => {
  const s = game([0, 1], { variant: 'quick' });
  s.kills[0] = 1;
  assert.ok(!E.variantWon(s, 0));
  s.tokens[0] = [53, -1, -1, -1];
  roll(s, 3);
  const m = E.applyMove(s, 0);
  assert.ok(m.won && s.winner === 0);
  assert.strictEqual(E.completeMove(s).finished, true);
});
test('Quick: bringing a token home without a capture does not win', () => {
  const s = game([0, 1], { variant: 'quick' });
  s.tokens[0] = [53, -1, -1, -1];
  roll(s, 3);
  assert.ok(!E.applyMove(s, 0).won);
});
test('Deathmatch: the fourth capture wins (move capture)', () => {
  const s = game([0, 1], { variant: 'deathmatch' });
  s.kills[0] = E.DEATHMATCH_KILLS - 1;
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;
  roll(s, 1);
  const m = E.applyMove(s, 0);
  assert.ok(m.won && s.winner === 0);
});
test('Deathmatch: a Blast can deliver the winning capture', () => {
  const s = game([0, 1], { variant: 'deathmatch', magic: true });
  s.kills[0] = E.DEATHMATCH_KILLS - 1;
  s.tokens[1][0] = 30;
  const r = E.useMagic(s, 'blast', { seat: 1, token: 0 });
  assert.ok(r.ok && r.won);
  assert.strictEqual(E.completeMove(s).finished, true);
  assert.strictEqual(s.winner, 0);
});
test('Deathmatch / Quick rankings favour captures', () => {
  const s = game([0, 1, 2], { variant: 'deathmatch' });
  s.kills = [4, 0, 2, 0]; s.winner = 0;
  assert.deepStrictEqual(E.finalRankings(s), [0, 2, 1]);
});
test('5 Minutes: endByTime crowns the best score and ranks everyone', () => {
  const s = game([0, 1, 2], { variant: 'timed' });
  assert.strictEqual(s.timeLimitMs, 300000);
  s.tokens[1] = [20, 10, -1, -1]; s.kills[2] = 1; s.tokens[2][0] = 30;
  const before = [0, 1, 2].map(x => E.variantScore(s, x));
  assert.ok(before[2] > before[1] && before[1] > before[0], JSON.stringify(before));
  assert.ok(E.endByTime(s).ok);
  assert.strictEqual(s.status, 'finished');
  assert.deepStrictEqual(s.rankings, [2, 1, 0]);
  assert.strictEqual(E.endByTime(s).error, 'game_finished');
});
test('variant, clock and saves round-trip', () => {
  const s = game([0, 1], { variant: 'timed', timeLimitMs: 1000 });
  s.timeUsedMs = 400;
  const d = E.deserialize(E.serialize(s));
  assert.strictEqual(d.variant, 'timed'); assert.strictEqual(d.timeLimitMs, 1000); assert.strictEqual(d.timeUsedMs, 400);
  const old = JSON.parse(JSON.stringify(s)); delete old.variant; delete old.timeLimitMs; delete old.timeUsedMs;
  const o = E.deserialize(old);
  assert.strictEqual(o.variant, 'classic'); assert.strictEqual(o.timeUsedMs, 0);
});
test('full AI games finish in every variant', () => {
  for (const variant of ['classic', 'power', 'quick', 'deathmatch']) {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playFull([0, 1, 2, 3], ['hard', 'medium', 'easy', 'hard'], 5000 + seed,
        { variant, magic: variant === 'power', rules: { killToEnterHome: true } });
      assert.ok(state.winner !== null && state.status === 'finished', variant);
      if (variant === 'quick') assert.ok(state.kills[state.winner] >= 1);
      if (variant === 'deathmatch') assert.ok(state.kills[state.winner] >= E.DEATHMATCH_KILLS || state.tokens[state.winner].every(p => p === 56));
    }
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
