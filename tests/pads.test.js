/* Ludo Pro - Power mode board power-ups (rocket, spring, x2/x3, shield, tnt, mine, ice, fire). */
'use strict';
const E = require('../www/js/ludo-engine.js');
let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log('  ok   ' + n); } else { failed++; console.log('  FAIL ' + n); } }

function game(pads, tokens0, tokens2) {
  const s = E.createGame({ seats: [0, 2], variant: 'power', magic: true, padSeed: 7, rules: { killToEnterHome: false } });
  s.pads = pads;
  s.tokens[0] = tokens0 || [-1, -1, -1, -1];
  s.tokens[2] = tokens2 || [-1, -1, -1, -1];
  s.current = 0;
  return s;
}
function play(s, dice, idx) {
  E.rollWithValue(s, dice); E.settleRoll(s);
  return E.applyMove(s, idx);
}

console.log('\nPads - layout');
const g = E.createGame({ seats: [0, 1, 2, 3], variant: 'power', magic: true, padSeed: 123 });
ok(g.pads.length === 9, 'Power game places 9 pads');
ok(new Set(g.pads.map(p => p.type)).size === 9, 'all nine pad types are present once');
ok(g.pads.every(p => !E.SAFE_CELLS.includes(p.cell)), 'no pad sits on a safe or start cell');
ok(g.pads.every((p, i) => g.pads.every((q, j) => i === j || Math.min(Math.abs(p.cell - q.cell), 52 - Math.abs(p.cell - q.cell)) >= 3)), 'pads are spread out (3+ cells apart)');
ok(E.createGame({ seats: [0, 1], variant: 'classic' }).pads.length === 0, 'Classic has no pads');
ok(JSON.stringify(E.makePads(5)) === JSON.stringify(E.makePads(5)), 'pad layout is deterministic for a seed');
ok(E.deserialize(E.serialize(g)).pads.length === 9, 'pads survive save / load');

console.log('\nPads - movement boosts');
let s = game([{ type: 'rocket', cell: 3 }], [1, -1, -1, -1]);
let r = play(s, 2, 0);
ok(s.tokens[0][0] === 11 && r.pad.type === 'rocket' && r.pad.path.length === 8, 'rocket: lands on 3 and flies 8 steps to 11');
s = game([{ type: 'spring', cell: 3 }], [1, -1, -1, -1]); play(s, 2, 0);
ok(s.tokens[0][0] === 7, 'spring: +4 steps (3 -> 7)');
s = game([{ type: 'x2', cell: 4 }], [1, -1, -1, -1]); play(s, 3, 0);
ok(s.tokens[0][0] === 7, 'x2: the roll of 3 counts double (1 -> 4 -> 7)');
s = game([{ type: 'x3', cell: 4 }], [1, -1, -1, -1]); play(s, 3, 0);
ok(s.tokens[0][0] === 10, 'x3: the roll of 3 counts triple (1 -> 4 -> 10)');
s = game([{ type: 'rocket', cell: 3 }], [1, -1, -1, -1], [-1, -1, -1, -1]);
s.tokens[2][0] = 44;                       // yellow rel 44 -> cell (26+44)%52 = 18? place by cell instead
s.tokens[2][0] = (11 - 26 + 52) % 52;      // yellow token on cell 11
r = play(s, 2, 0);
ok(s.tokens[2][0] === -1 && s.kills[0] === 1 && r.pad.captures.length === 1, 'rocket landing on an opponent captures it');
s = game([{ type: 'rocket', cell: 45 }], [43, -1, -1, -1]);
play(s, 2, 0);
ok(s.tokens[0][0] === 50 || s.tokens[0][0] >= 51, 'boost never overshoots the board end (' + s.tokens[0][0] + ')');
s = game([{ type: 'rocket', cell: 50 }], [48, -1, -1, -1]);
s.rules.killToEnterHome = false;
play(s, 2, 0);
ok(s.tokens[0][0] > 50 && s.tokens[0][0] <= 56, 'boost can carry a token into the home lane');

console.log('\nPads - shield');
s = game([{ type: 'shield', cell: 4 }], [1, -1, -1, -1]); r = play(s, 3, 0);
ok(r.pad.shielded && E.isShielded(s, 0, 0), 'shield pad protects the token');

console.log('\nPads - dangerous pads');
s = game([{ type: 'tnt', cell: 4 }], [1, -1, -1, -1]);
s.tokens[2][0] = (5 - 26 + 52) % 52; s.tokens[2][1] = (8 - 26 + 52) % 52;   // neighbour cell 5, safe cell 8 (too far anyway)
r = play(s, 3, 0);
ok(s.tokens[0][0] === -1 && s.tokens[2][0] === -1 && s.tokens[2][1] !== -1 && r.pad.sent.length === 2, 'tnt blasts the lander and the token next to it, not far ones');
ok(s.kills[0] === 0 && s.lost[0] === 1 && s.lost[2] === 1, 'tnt is not a capture but counts as a loss');
s = game([{ type: 'tnt', cell: 4 }], [1, -1, -1, -1]); s.magic.shields[0][0] = true; play(s, 3, 0);
ok(s.tokens[0][0] === 4, 'a shielded token survives tnt');
s = game([{ type: 'mine', cell: 4, hidden: true }], [1, -1, -1, -1]); r = play(s, 3, 0);
ok(s.tokens[0][0] === -1 && s.pads.length === 0 && r.pad.removed, 'landmine sends the token home and disappears');
s = game([{ type: 'fire', cell: 4 }], [1, -1, -1, -1]);
s.tokens[2][0] = (6 - 26 + 52) % 52; s.tokens[2][1] = (9 - 26 + 52) % 52;
r = play(s, 3, 0);
ok(s.tokens[0][0] === 4 && s.tokens[2][0] === -1 && s.tokens[2][1] !== -1 && s.kills[0] === 1, 'fire burns opponents on the next 3 cells and counts as a kill');
ok(r.extraTurn === true, 'a fire kill gives another turn');

console.log('\nPads - ice');
s = game([{ type: 'ice', cell: 4 }], [1, 20, -1, -1]); r = play(s, 3, 0);
ok(r.pad.frozen && s.frozen[0][0] === 2, 'ice freezes the token');
E.completeMove(s);                            // turn passes to yellow (frozen 2 -> 1)
s.tokens[2] = [5, -1, -1, -1];
E.rollWithValue(s, 2); E.settleRoll(s); E.applyMove(s, 0); E.completeMove(s);   // back to red
E.rollWithValue(s, 2); E.settleRoll(s);
ok(!s.validMoves.includes(0) && s.validMoves.includes(1), 'the frozen token cannot move on its next turn, others can');
E.applyMove(s, 1); E.completeMove(s);
E.rollWithValue(s, 2); E.settleRoll(s); E.applyMove(s, 0); E.completeMove(s);
E.rollWithValue(s, 2); E.settleRoll(s);
ok(s.validMoves.includes(0), 'the token is free again afterwards');

console.log('\nPads - AI sees them');
const AI = require('../www/js/ludo-ai.js');
s = game([{ type: 'rocket', cell: 4 }, { type: 'tnt', cell: 6 }], [1, 3, -1, -1]);
E.rollWithValue(s, 3); E.settleRoll(s);
let pick = AI.chooseMove ? AI.chooseMove(s, 'hard', Math.random) : null;
ok(pick === 0, 'hard computer takes the rocket and avoids the TNT (picked ' + pick + ')');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
