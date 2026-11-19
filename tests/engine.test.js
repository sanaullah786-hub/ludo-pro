/*
 * Ludo Pro - automated tests for the rules engine, AI and board geometry.
 * Run with:  node tests/engine.test.js     (or: npm test)
 * Developer: Sanaullah Khoso
 */
'use strict';
const assert = require('assert');
const E = require('../www/js/ludo-engine.js');
const AI = require('../www/js/ludo-ai.js');
const B = require('../www/js/ludo-board.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function section(name) { console.log('\n' + name); }

// Helpers ---------------------------------------------------------------
function game(seats, extra) {
  return E.createGame(Object.assign({ seats: seats || [0, 1, 2, 3] }, extra || {}));
}
/** roll a chosen value and settle the dice animation */
function roll(state, v) {
  const r = E.rollWithValue(state, v);
  E.settleRoll(state);
  return r;
}
/** roll, move a token, complete the move */
function play(state, v, tokenIdx) {
  const r = roll(state, v);
  assert.ok(r.ok, 'roll failed: ' + r.error);
  const m = E.applyMove(state, tokenIdx);
  assert.ok(m.ok, 'move failed: ' + m.error);
  const c = E.completeMove(state);
  return { roll: r, move: m, done: c };
}

// ---------------------------------------------------------------- DICE
section('Dice generation');
test('rollValue always returns an integer from 1 to 6', () => {
  const rng = E.mulberry32(42);
  const seen = {};
  for (let i = 0; i < 6000; i++) {
    const v = E.rollValue(rng);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, 'bad value ' + v);
    seen[v] = (seen[v] || 0) + 1;
  }
  for (let v = 1; v <= 6; v++) assert.ok(seen[v] > 800, 'value ' + v + ' too rare: ' + seen[v]);
});
test('rollValue handles boundary random numbers', () => {
  assert.strictEqual(E.rollValue(() => 0), 1);
  assert.strictEqual(E.rollValue(() => 0.9999999), 6);
  assert.strictEqual(E.rollValue(() => 1), 6);
});
test('rollDice sets the dice value and the rolling flag', () => {
  const s = game([0, 1]);
  const r = E.rollDice(s, E.mulberry32(1));
  assert.ok(r.ok);
  assert.ok(s.dice >= 1 && s.dice <= 6);
  assert.strictEqual(s.rolling, true);
});
test('cannot roll twice in one turn', () => {
  const s = game([0, 1]);
  E.rollWithValue(s, 6);
  E.settleRoll(s);
  assert.strictEqual(s.status, 'waiting_move');
  assert.strictEqual(E.rollWithValue(s, 3).error, 'not_waiting_roll');
});
test('dice is locked while the roll animation is running', () => {
  const s = game([0, 1]);
  E.rollWithValue(s, 1);            // no legal move: turn passes, rolling stays true
  assert.strictEqual(s.rolling, true);
  assert.strictEqual(E.rollWithValue(s, 4).error, 'dice_rolling');
  E.settleRoll(s);
  assert.ok(E.rollWithValue(s, 4).ok);
});
test('invalid forced dice values are rejected', () => {
  const s = game([0, 1]);
  assert.strictEqual(E.rollWithValue(s, 0).error, 'invalid_dice_value');
  assert.strictEqual(E.rollWithValue(s, 7).error, 'invalid_dice_value');
  assert.strictEqual(E.rollWithValue(s, 2.5).error, 'invalid_dice_value');
});

// -------------------------------------------------------- TOKEN ENTRY
section('Token entry');
test('all tokens start in the base', () => {
  const s = game();
  s.tokens.forEach(t => assert.deepStrictEqual(t, [-1, -1, -1, -1]));
});
test('no token can leave the base without a six', () => {
  for (let v = 1; v <= 5; v++) {
    const s = game([0, 1]);
    assert.deepStrictEqual(E.getValidMoves(s, 0, v), [], 'value ' + v);
  }
});
test('a six lets every base token enter (all four are legal)', () => {
  const s = game([0, 1]);
  assert.deepStrictEqual(E.getValidMoves(s, 0, 6), [0, 1, 2, 3]);
});
test('entering puts the token on its own start cell', () => {
  E.COLORS.forEach((c, seat) => {
    const s = game([0, 1, 2, 3], { firstSeat: seat });
    play(s, 6, 0);
    assert.strictEqual(s.tokens[seat][0], 0);
    assert.strictEqual(E.trackCell(seat, 0), E.START_INDEX[seat]);
  });
});
test('distinctMoves collapses identical base tokens', () => {
  const s = game([0, 1]);
  roll(s, 6);
  assert.deepStrictEqual(E.distinctMoves(s), [0]);
});
test('a non-six with all tokens in base passes the turn (no legal move)', () => {
  const s = game([0, 1]);
  const r = roll(s, 4);
  assert.ok(r.noMoves);
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.status, 'waiting_roll');
});

// -------------------------------------------------------- MOVEMENT
section('Movement calculations');
test('track cell mapping for all four colours', () => {
  assert.strictEqual(E.trackCell(0, 0), 0);
  assert.strictEqual(E.trackCell(1, 0), 13);
  assert.strictEqual(E.trackCell(2, 0), 26);
  assert.strictEqual(E.trackCell(3, 0), 39);
  assert.strictEqual(E.trackCell(3, 20), (39 + 20) % 52);   // wraps past cell 51
  assert.strictEqual(E.trackCell(1, 45), (13 + 45) % 52);
});
test('token moves exactly the dice value', () => {
  const s = game([0, 1]);
  s.tokens[0][2] = 10;
  roll(s, 4);
  const m = E.applyMove(s, 2);
  assert.strictEqual(s.tokens[0][2], 14);
  assert.deepStrictEqual(m.path, [11, 12, 13, 14]);
});
test('entering from base produces a single-cell path', () => {
  const s = game([0, 1]);
  roll(s, 6);
  const m = E.applyMove(s, 0);
  assert.deepStrictEqual(m.path, [0]);
});
test('only legal tokens are offered; illegal token is rejected', () => {
  const s = game([0, 1]);
  s.tokens[0][1] = 20;
  roll(s, 3);
  assert.deepStrictEqual(s.validMoves, [1]);
  assert.strictEqual(E.applyMove(s, 0).error, 'illegal_move');
  assert.ok(E.applyMove(s, 1).ok);
});
test('cannot move when it is not the waiting_move phase', () => {
  const s = game([0, 1]);
  assert.strictEqual(E.applyMove(s, 0).error, 'not_waiting_move');
});
test('cannot move while the dice is still rolling', () => {
  const s = game([0, 1]);
  E.rollWithValue(s, 6);
  assert.strictEqual(E.applyMove(s, 0).error, 'dice_rolling');
  E.settleRoll(s);
  assert.ok(E.applyMove(s, 0).ok);
});
test('status is animating after a move until completeMove is called', () => {
  const s = game([0, 1]);
  roll(s, 6);
  E.applyMove(s, 0);
  assert.strictEqual(s.status, 'animating');
  assert.strictEqual(E.rollWithValue(s, 3).error, 'not_waiting_roll');
  E.completeMove(s);
  assert.notStrictEqual(s.status, 'animating');
});

// -------------------------------------------------------- SAFE ZONES
section('Safe positions');
test('there are exactly 8 safe cells: 4 starts and 4 stars', () => {
  assert.deepStrictEqual(E.SAFE_CELLS, [0, 8, 13, 21, 26, 34, 39, 47]);
  let n = 0;
  for (let c = 0; c < 52; c++) if (E.isSafeCell(c)) n++;
  assert.strictEqual(n, 8);
});
test('safe cells are correct for every colour', () => {
  E.COLORS.forEach((c, seat) => {
    assert.ok(E.isSafeCell(E.trackCell(seat, 0)), c + ' start');
    assert.ok(E.isSafeCell(E.trackCell(seat, 8)), c + ' star');
    assert.ok(!E.isSafeCell(E.trackCell(seat, 1)), c + ' cell 1');
    assert.ok(!E.isSafeCell(E.trackCell(seat, 20)), c + ' cell 20');
  });
});
test('safeSquares rule can be switched off', () => {
  assert.ok(!E.isSafeCell(8, { safeSquares: false }));
});
test('geometry: star cells in the board match the engine safe cells', () => {
  const stars = Object.values(B.CELL_INFO).filter(c => c.type === 'track' && c.safe).map(c => c.index).sort((a, b) => a - b);
  assert.deepStrictEqual(stars, E.SAFE_CELLS);
});

// -------------------------------------------------------- CAPTURING
section('Capturing');
test('landing on an opponent token on a normal cell captures it', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 3;                       // red at abs 3
  s.tokens[1][0] = 43;                      // green rel 43 -> abs (13+43)%52 = 4
  roll(s, 1);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 1);
  assert.strictEqual(s.tokens[1][0], -1);
  assert.strictEqual(s.tokens[0][0], 4);
  assert.strictEqual(s.stats.captures[0], 1);
});
test('captured token returns to base and can re-enter only with a six', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;
  roll(s, 1); E.applyMove(s, 0); E.completeMove(s);
  s.current = 1; s.status = 'waiting_roll';
  assert.deepStrictEqual(E.getValidMoves(s, 1, 3), []);
  assert.ok(E.getValidMoves(s, 1, 6).includes(0));
});
test('tokens are never captured on safe cells (star)', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 5;                       // red -> abs 8 (star) with a 3
  s.tokens[1][0] = 47;                      // green rel 47 -> abs (13+47)%52 = 8
  roll(s, 3);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 0);
  assert.strictEqual(s.tokens[1][0], 47);
});
test('tokens are never captured on a start cell', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 10;                      // red abs 10 -> abs 13 (green start) with 3
  s.tokens[1][0] = 0;                       // green sitting on its own start
  roll(s, 3);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 0);
  assert.strictEqual(s.tokens[1][0], 0);
});
test('a token entering on its start cell never captures (start is safe)', () => {
  const s = game([0, 1]);
  s.tokens[1][0] = 39;                      // green rel 39 -> abs 0 = red start
  roll(s, 6);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 0);
  assert.strictEqual(s.tokens[1][0], 39);
});
test('own tokens are never captured', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 3; s.tokens[0][1] = 4;
  roll(s, 1);
  const m = E.applyMove(s, 0);
  assert.strictEqual(m.captures.length, 0);
  assert.strictEqual(s.tokens[0][1], 4);
});
test('tokens in a home lane cannot be captured', () => {
  const s = game([0, 2]);
  s.tokens[2][0] = 52;                      // yellow in its lane
  s.tokens[0][0] = 48;
  roll(s, 2);
  assert.strictEqual(E.applyMove(s, 0).captures.length, 0);
});
test('capture works for all four colours as the attacker', () => {
  [0, 1, 2, 3].forEach(att => {
    const vic = (att + 1) % 4;
    const s = game([0, 1, 2, 3], { firstSeat: att });
    s.tokens[att][0] = 5;                                   // attacker at rel 5
    const cell = E.trackCell(att, 7);                       // will land here with a 2
    // place victim on that absolute cell, with rel = (cell - start) mod 52
    const rel = ((cell - E.START_INDEX[vic]) % 52 + 52) % 52;
    assert.ok(rel <= 50 && !E.isSafeCell(cell));
    s.tokens[vic][2] = rel;
    roll(s, 2);
    const m = E.applyMove(s, 0);
    assert.strictEqual(m.captures.length, 1, 'colour ' + att);
    assert.strictEqual(s.tokens[vic][2], -1);
  });
});
test('capture gives an extra turn', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;
  roll(s, 1); E.applyMove(s, 0);
  const c = E.completeMove(s);
  assert.ok(c.extraTurn);
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.status, 'waiting_roll');
});
test('capture extra turn can be switched off', () => {
  const s = game([0, 1], { rules: { extraTurnOnCapture: false } });
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;
  roll(s, 1); E.applyMove(s, 0);
  const c = E.completeMove(s);
  assert.ok(!c.extraTurn);
  assert.strictEqual(s.current, 1);
});

// -------------------------------------------------------- HOME LANE
section('Home lane');
test('a token turns into its home lane after rel 50, never walking cell rel 51', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 50;
  roll(s, 1);
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 51);
  assert.ok(E.isInHomeLane(51) && !E.isOnTrack(51));
});
test('passing the last track cell goes into the lane, not around the board', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 48;
  roll(s, 5);
  const m = E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 53);
  assert.deepStrictEqual(m.path, [49, 50, 51, 52, 53]);
  assert.ok(m.entersHomeLane);
});
test('each colour has its own lane of five cells in its own arm', () => {
  assert.strictEqual(B.HOME_LANES.length, 4);
  B.HOME_LANES.forEach(l => assert.strictEqual(l.length, 5));
  assert.deepStrictEqual(B.HOME_LANES[0][0], [7, 1]);
  assert.deepStrictEqual(B.HOME_LANES[1][0], [1, 7]);
  assert.deepStrictEqual(B.HOME_LANES[2][0], [7, 13]);
  assert.deepStrictEqual(B.HOME_LANES[3][0], [13, 7]);
});

// ---------------------------------------------------- EXACT FINISH
section('Exact finishing');
test('exact roll finishes the token', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 53;
  roll(s, 3);
  const m = E.applyMove(s, 0);
  assert.ok(m.finishes);
  assert.strictEqual(s.tokens[0][0], 56);
  assert.strictEqual(s.stats.homeTokens[0], 1);
});
test('overshooting the finish is illegal', () => {
  const s = game([0, 1]);
  s.tokens[0] = [53, 56, 56, 56];           // other tokens already home, so only token 0 matters
  assert.deepStrictEqual(E.getValidMoves(s, 0, 4), []);
  assert.deepStrictEqual(E.getValidMoves(s, 0, 5), []);
  assert.deepStrictEqual(E.getValidMoves(s, 0, 6), []);
  assert.deepStrictEqual(E.getValidMoves(s, 0, 3), [0]);
  assert.deepStrictEqual(E.getValidMoves(s, 0, 2), [0]);
});
test('a finished token cannot move again', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 56;
  for (let v = 1; v <= 6; v++) assert.ok(!E.getValidMoves(s, 0, v).includes(0));
});
test('overshoot passes the turn when nothing else can move', () => {
  const s = game([0, 1]);
  s.tokens[0] = [55, 56, 56, 56];
  const r = roll(s, 2);
  assert.ok(r.noMoves);
  assert.strictEqual(s.current, 1);
});
test('exactFinish can be disabled by the rules', () => {
  const s = game([0, 1], { rules: { exactFinish: false } });
  s.tokens[0][0] = 54;
  roll(s, 6);
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 56);
});
test('finishing a token gives an extra turn', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 53;
  roll(s, 3); E.applyMove(s, 0);
  const c = E.completeMove(s);
  assert.ok(c.extraTurn);
  assert.strictEqual(s.current, 0);
});

// ---------------------------------------------------- TURN MANAGEMENT
section('Turn switching and extra turns');
test('turn passes to the next seat after a plain move', () => {
  const s = game([0, 1, 2, 3]);
  s.tokens[0][0] = 10;
  const r = play(s, 3, 0);
  assert.ok(!r.done.extraTurn);
  assert.strictEqual(s.current, 1);
});
test('turn order is clockwise and wraps around', () => {
  const s = game([0, 1, 2, 3]);
  const order = [];
  for (let i = 0; i < 8; i++) { order.push(s.current); roll(s, 2); }
  assert.deepStrictEqual(order, [0, 1, 2, 3, 0, 1, 2, 3]);
});
test('two players sit opposite each other (seats 0 and 2)', () => {
  const s = game([0, 2]);
  roll(s, 2);
  assert.strictEqual(s.current, 2);
  roll(s, 2);
  assert.strictEqual(s.current, 0);
});
test('inactive seats are skipped (3 players: 0,1,2)', () => {
  const s = game([0, 1, 2]);
  const order = [];
  for (let i = 0; i < 6; i++) { order.push(s.current); roll(s, 2); }
  assert.deepStrictEqual(order, [0, 1, 2, 0, 1, 2]);
});
test('rolling a six gives an extra turn to the same player', () => {
  const s = game([0, 1]);
  const r = play(s, 6, 0);
  assert.ok(r.done.extraTurn);
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.status, 'waiting_roll');
});
test('extra turn on six can be switched off', () => {
  const s = game([0, 1], { rules: { extraTurnOnSix: false } });
  const r = play(s, 6, 0);
  assert.ok(!r.done.extraTurn);
  assert.strictEqual(s.current, 1);
});
test('three sixes in a row forfeit the turn and the third six is not played', () => {
  const s = game([0, 1]);
  play(s, 6, 0);
  play(s, 6, 1);
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.consecutiveSixes, 2);
  const r = roll(s, 6);
  assert.ok(r.forfeited);
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.consecutiveSixes, 0);
  assert.strictEqual(s.tokens[0].filter(p => p === 0).length, 2);   // two tokens entered, third six not played
});
test('three-sixes penalty can be switched off', () => {
  const s = game([0, 1], { rules: { threeSixesForfeit: false } });
  play(s, 6, 0); play(s, 6, 1);
  const r = roll(s, 6);
  assert.ok(!r.forfeited);
  assert.strictEqual(s.status, 'waiting_move');
});
test('a non-six resets the six counter', () => {
  const s = game([0, 1]);
  play(s, 6, 0);
  assert.strictEqual(s.consecutiveSixes, 1);
  play(s, 2, 0);
  assert.strictEqual(s.consecutiveSixes, 0);
});
test('capture extra turn after a non-six keeps the six counter at zero', () => {
  const s = game([0, 1]);
  s.tokens[0][0] = 3; s.tokens[1][0] = 43;
  play(s, 1, 0);
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.consecutiveSixes, 0);
});
test('players with no legal move are skipped without stalling', () => {
  const s = game([0, 1, 2]);
  const r = roll(s, 3);
  assert.ok(r.noMoves);
  assert.strictEqual(r.nextSeat, 1);
  assert.strictEqual(s.status, 'waiting_roll');
});
test('invalid actions are rejected after the game has finished', () => {
  const s = game([0, 1]);
  s.tokens[0] = [56, 56, 56, 55];
  roll(s, 1); E.applyMove(s, 3); E.completeMove(s);
  assert.strictEqual(s.status, 'finished');
  assert.strictEqual(E.rollWithValue(s, 3).error, 'game_finished');
  assert.strictEqual(E.applyMove(s, 0).error, 'game_finished');
});

// ---------------------------------------------------- WINNING
section('Winning conditions');
test('game is won when all four tokens are home', () => {
  const s = game([0, 1]);
  s.tokens[0] = [56, 56, 56, 55];
  roll(s, 1);
  const m = E.applyMove(s, 3);
  assert.ok(m.won);
  const c = E.completeMove(s);
  assert.ok(c.finished);
  assert.strictEqual(s.winner, 0);
  assert.strictEqual(s.status, 'finished');
  assert.ok(E.isGameOver(s));
});
test('winning does not grant an extra turn', () => {
  const s = game([0, 1]);
  s.tokens[0] = [56, 56, 56, 55];
  roll(s, 1);
  assert.ok(!E.applyMove(s, 3).extraTurn);
});
test('three tokens home is not a win', () => {
  const s = game([0, 1]);
  s.tokens[0] = [56, 56, 55, 50];
  roll(s, 1);
  E.applyMove(s, 2); E.completeMove(s);
  assert.strictEqual(s.winner, null);
});
test('every colour can win', () => {
  [0, 1, 2, 3].forEach(seat => {
    const s = game([0, 1, 2, 3], { firstSeat: seat });
    s.tokens[seat] = [56, 56, 56, 52];
    roll(s, 4); E.applyMove(s, 3); E.completeMove(s);
    assert.strictEqual(s.winner, seat);
  });
});
test('final rankings put the winner first', () => {
  const s = game([0, 1, 2]);
  s.tokens[0] = [56, 56, 56, 55];
  s.tokens[1] = [56, 10, -1, -1];
  s.tokens[2] = [30, 30, 30, 30];
  roll(s, 1); E.applyMove(s, 3); E.completeMove(s);
  assert.deepStrictEqual(E.finalRankings(s), [0, 1, 2]);
});

// ---------------------------------------------------- STATE / SAVE
section('State and save/load');
test('createGame validates seats', () => {
  assert.throws(() => E.createGame({ seats: [0] }));
  assert.throws(() => E.createGame({ seats: [0, 0] }));
  assert.throws(() => E.createGame({ seats: [0, 5] }));
});
test('state serializes and restores without loss', () => {
  const s = game([0, 1, 3], { types: { 1: 'cpu' }, difficulty: { 1: 'hard' } });
  s.tokens[0][0] = 17; s.tokens[1][2] = 55;
  const d = E.deserialize(E.serialize(s));
  assert.deepStrictEqual(d.tokens, s.tokens);
  assert.strictEqual(d.players[1].difficulty, 'hard');
  assert.strictEqual(d.current, s.current);
});
test('corrupt saves are rejected', () => {
  assert.strictEqual(E.deserialize('not json'), null);
  assert.strictEqual(E.deserialize('{"version":1}'), null);
  const s = game([0, 1]); s.tokens[0][0] = 99;
  assert.strictEqual(E.deserialize(E.serialize(s)), null);
});
test('a save taken mid-animation restores to a rollable state', () => {
  const s = game([0, 1]);
  roll(s, 6); E.applyMove(s, 0);               // status: animating
  const d = E.deserialize(E.serialize(s));
  assert.strictEqual(d.status, 'waiting_roll');
  assert.ok(E.rollWithValue(d, 2).ok);
});
test('a save taken while waiting for a move restores its legal moves', () => {
  const s = game([0, 1]);
  s.tokens[0][1] = 12;
  roll(s, 4);
  const d = E.deserialize(E.serialize(s));
  assert.strictEqual(d.status, 'waiting_move');
  assert.deepStrictEqual(d.validMoves, [1]);
});

// ---------------------------------------------------- GEOMETRY
section('Board geometry');
test('track has 52 unique cells inside the 15x15 grid', () => {
  assert.strictEqual(B.TRACK.length, 52);
  const set = new Set(B.TRACK.map(c => c.join(',')));
  assert.strictEqual(set.size, 52);
  B.TRACK.forEach(([r, c]) => assert.ok(r >= 0 && r < 15 && c >= 0 && c < 15));
});
test('consecutive track cells are neighbours: straight steps plus 4 diagonal corner steps', () => {
  let diagonals = 0;
  for (let i = 0; i < 52; i++) {
    const a = B.TRACK[i], b = B.TRACK[(i + 1) % 52];
    const dr = Math.abs(a[0] - b[0]), dc = Math.abs(a[1] - b[1]);
    assert.ok(Math.max(dr, dc) === 1, 'gap after ' + i);
    if (dr === 1 && dc === 1) diagonals++;
  }
  // a Ludo track turns each inner corner of the cross with one diagonal step
  assert.strictEqual(diagonals, 4);
});
test('start cells sit at the expected places', () => {
  assert.deepStrictEqual(B.TRACK[0], [6, 1]);
  assert.deepStrictEqual(B.TRACK[13], [1, 8]);
  assert.deepStrictEqual(B.TRACK[26], [8, 13]);
  assert.deepStrictEqual(B.TRACK[39], [13, 6]);
});
test('home lanes do not overlap the track and connect to it', () => {
  const trackSet = new Set(B.TRACK.map(c => c.join(',')));
  B.HOME_LANES.forEach((lane, seat) => {
    lane.forEach(c => assert.ok(!trackSet.has(c.join(','))));
    // the last track cell of this colour (rel 50) is next to lane cell 0
    const last = B.TRACK[E.trackCell(seat, 50)];
    const first = lane[0];
    assert.strictEqual(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1, 'colour ' + seat);
  });
});
test('coordFor returns the correct cell for every engine position', () => {
  for (let seat = 0; seat < 4; seat++) {
    for (let pos = -1; pos <= 56; pos++) {
      const c = B.coordFor(seat, 0, pos);
      assert.ok(c.x > 0 && c.x < 15 && c.y > 0 && c.y < 15, 'seat ' + seat + ' pos ' + pos);
    }
  }
  const c = B.coordFor(0, 0, 0);
  assert.deepStrictEqual([c.x, c.y], [1.5, 6.5]);
});

// ---------------------------------------------------- AI
section('AI');
function stateWithMoves() {
  const s = game([0, 1], { types: { 0: 'cpu', 1: 'cpu' } });
  s.tokens[0] = [3, 20, -1, 53];
  s.tokens[1] = [43, 5, -1, -1];
  return s;
}
test('AI always returns a legal move at every difficulty', () => {
  ['easy', 'medium', 'hard'].forEach(level => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = E.mulberry32(seed);
      const s = stateWithMoves();
      const v = E.rollValue(rng);
      const r = roll(s, v);
      if (!r.validMoves.length) continue;
      const pick = AI.chooseMove(s, level, rng);
      assert.ok(s.validMoves.includes(pick), level + ' picked an illegal token');
    }
  });
});
test('AI returns null when there are no legal moves', () => {
  const s = game([0, 1]);
  assert.strictEqual(AI.chooseMove(s, 'hard', Math.random), null);
});
test('medium and hard AI take a capture when one is available', () => {
  ['medium', 'hard'].forEach(level => {
    const s = stateWithMoves();
    roll(s, 1);                       // token 0 (rel 3) can capture green at abs 4
    assert.ok(s.validMoves.includes(0));
    assert.strictEqual(AI.chooseMove(s, level, E.mulberry32(3)), 0, level);
  });
});
test('hard AI finishes a token when it can win', () => {
  const s = game([0, 1], { types: { 0: 'cpu' } });
  s.tokens[0] = [56, 56, 56, 55];
  s.tokens[1] = [5, -1, -1, -1];
  roll(s, 1);
  assert.strictEqual(AI.chooseMove(s, 'hard', E.mulberry32(9)), 3);
});
test('hard AI prefers escaping a threatened token', () => {
  const s = game([0, 1]);
  s.tokens[0] = [20, 30, -1, -1];            // red abs 20 and 30
  s.tokens[1] = [3, -1, -1, -1];             // green rel 3 -> abs 16, 4 behind red abs 20
  roll(s, 3);
  // token 0 is threatened (green 4 cells behind) and a 3 takes it out of reach (7 cells ahead)
  assert.ok(E.threatLevel(s, 0, 20) > 0);
  const pick = AI.chooseMove(s, 'hard', E.mulberry32(5));
  assert.strictEqual(pick, 0);
});
test('hard AI enters a token on a six when nothing is on the board', () => {
  const s = game([0, 1], { types: { 0: 'cpu' } });
  roll(s, 6);
  assert.ok(AI.chooseMove(s, 'hard', E.mulberry32(1)) !== null);
});

// ---------------------------------------------------- FULL GAMES
section('Full simulated games (AI vs AI, seeded)');
function playFull(seats, levels, seed, firstSeat) {
  const types = {}, difficulty = {};
  seats.forEach((s, i) => { types[s] = 'cpu'; difficulty[s] = levels[i]; });
  const s = E.createGame({ seats, types, difficulty, firstSeat: firstSeat === undefined ? seats[0] : firstSeat });
  const rng = E.mulberry32(seed);
  let steps = 0;
  while (!E.isGameOver(s)) {
    if (++steps > 40000) throw new Error('game did not finish (seed ' + seed + ')');
    const r = E.rollDice(s, rng);
    assert.ok(r.ok, 'roll rejected: ' + r.error);
    E.settleRoll(s);
    if (r.validMoves.length) {
      const idx = AI.chooseMove(s, difficulty[s.current], rng);
      assert.ok(s.validMoves.includes(idx), 'AI chose illegal move');
      const seatBefore = s.current;
      const m = E.applyMove(s, idx);
      assert.ok(m.ok, 'move rejected: ' + m.error);
      assert.strictEqual(seatBefore, m.seat);
      E.completeMove(s);
    }
    // invariants
    for (let seat = 0; seat < 4; seat++) for (let t = 0; t < 4; t++) {
      const p = s.tokens[seat][t];
      assert.ok(p >= -1 && p <= 56, 'position out of range');
      if (s.seats.indexOf(seat) === -1) assert.strictEqual(p, -1, 'inactive seat moved');
    }
  }
  return s;
}
test('2-player games always finish with a winner holding 4 finished tokens', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = playFull([0, 2], ['easy', 'medium'], seed);
    assert.ok(s.winner === 0 || s.winner === 2);
    assert.ok(s.tokens[s.winner].every(p => p === 56));
  }
});
test('3 and 4 player games finish (all colours take part)', () => {
  const wins = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const s = playFull([0, 1, 2, 3], ['easy', 'medium', 'hard', 'hard'], 1000 + seed);
    wins[s.winner]++;
  }
  for (let seed = 1; seed <= 20; seed++) playFull([0, 1, 2], ['hard', 'hard', 'hard'], 5000 + seed);
  Object.keys(wins).forEach(k => assert.ok(wins[k] > 0, 'colour ' + k + ' never won in 60 games'));
});
test('hard AI beats easy AI clearly over 300 mirrored games', () => {
  let hard = 0, easy = 0;
  for (let seed = 1; seed <= 150; seed++) {
    let s = playFull([0, 2], ['hard', 'easy'], 7000 + seed, 0);
    if (s.winner === 0) hard++; else easy++;
    s = playFull([0, 2], ['easy', 'hard'], 9000 + seed, 0);
    if (s.winner === 2) hard++; else easy++;
  }
  console.log('       hard wins ' + hard + ' / easy wins ' + easy);
  assert.ok(hard > easy * 1.4, 'hard=' + hard + ' easy=' + easy);
});
test('hard AI beats medium AI over 300 mirrored games', () => {
  let hard = 0, med = 0;
  for (let seed = 1; seed <= 150; seed++) {
    let s = playFull([0, 2], ['hard', 'medium'], 11000 + seed, 0);
    if (s.winner === 0) hard++; else med++;
    s = playFull([0, 2], ['medium', 'hard'], 13000 + seed, 0);
    if (s.winner === 2) hard++; else med++;
  }
  console.log('       hard wins ' + hard + ' / medium wins ' + med);
  assert.ok(hard > med, 'hard=' + hard + ' medium=' + med);
});

// ---------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed: ' + failures.join('; ')); process.exit(1); }
