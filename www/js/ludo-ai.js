/*!
 * Ludo Pro - computer players
 * Developer: Sanaullah Khoso
 *
 * The AI never changes the game. It only looks at the engine state and
 * returns the index of one of the legal moves (state.validMoves), so it
 * follows exactly the same rules as a human player.
 *
 *  easy   - random legal move
 *  medium - captures first, then finishing / entering, then progress
 *  hard   - scores every legal move (win, capture, safety, danger, tempo)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ludo-engine.js'));
  else root.LudoAI = factory(root.LudoEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function pickRandom(list, rng) {
    var r = (typeof rng === 'function' ? rng : Math.random)();
    return list[Math.min(list.length - 1, Math.floor(r * list.length))];
  }

  function noise(rng, amount) {
    return ((typeof rng === 'function' ? rng : Math.random)() - 0.5) * amount;
  }

  function tokensOnBoard(state, seat) {
    return state.tokens[seat].filter(function (p) { return p >= 0 && p < E.FINISH; }).length;
  }

  // ----------------------------------------------------------------- medium

  function scoreMedium(state, idx, rng) {
    var p = E.previewMove(state, idx);
    var score = 0;
    score += p.captures.length * 1000;
    if (p.captures.length && E.isGateLocked(state, state.current)) score += 400; // a kill opens the home lane
    if (p.finishes) score += 600;
    if (p.entersHomeLane) score += 150;
    if (p.entersFromBase) score += 300;
    score += p.to * 3;              // prefer the token closest to home
    score += noise(rng, 4);
    return score;
  }

  // ------------------------------------------------------------------- hard

  function scoreHard(state, idx, rng) {
    var seat = state.current;
    var p = E.previewMove(state, idx);
    var sim = E.simulateMove(state, idx);
    var after = sim.state;
    var score = 0;

    // Winning the game beats everything else.
    var allHome = after.tokens[seat].every(function (x) { return x === E.FINISH; });
    if (allHome) return 1e6;

    if (p.finishes) score += 800;

    // Captures: more valuable the further the victim had travelled.
    p.captures.forEach(function (c) {
      score += 600 + E.progressOf(c.from) * 9;
    });
    if (p.captures.length && E.isGateLocked(state, seat)) score += 500; // first kill opens the home lane

    // Getting tokens out of the base.
    if (p.entersFromBase) {
      score += 260;
      if (tokensOnBoard(state, seat) === 0) score += 220;
    }

    // Safety of the destination.
    if (p.entersHomeLane) score += 160;
    else if (E.isInHomeLane(p.to)) score += 40;
    else if (p.landsSafe && E.isOnTrack(p.to)) score += 110;

    var progress = E.progressOf(p.to);
    var value = 150 + progress * 4; // how much we would lose if hit

    // Danger at the destination.
    if (E.isOnTrack(p.to) && !p.landsSafe) {
      var cellTo = E.trackCell(seat, p.to);
      score -= E.threatLevel(after, seat, cellTo) * value;
    }

    // Escaping from a threatened cell.
    if (E.isOnTrack(p.from)) {
      var cellFrom = E.trackCell(seat, p.from);
      var threatBefore = E.threatLevel(state, seat, cellFrom);
      if (threatBefore > 0) {
        var threatAfter = (E.isOnTrack(p.to) && !p.landsSafe)
          ? E.threatLevel(after, seat, E.trackCell(seat, p.to)) : 0;
        score += (threatBefore - threatAfter) * (120 + E.progressOf(p.from) * 3);
      } else if (p.fromSafe && !p.landsSafe) {
        score -= 35; // leaving a safe cell without a reason
      }
    }

    // Chasing: opponents 1..6 cells ahead of the landing cell can be hit next turn.
    if (E.isOnTrack(p.to)) {
      var cell = E.trackCell(seat, p.to);
      state.seats.forEach(function (s) {
        if (s === seat) return;
        for (var t = 0; t < 4; t++) {
          var q = after.tokens[s][t];
          if (!E.isOnTrack(q)) continue;
          var oc = E.trackCell(s, q);
          var dist = (oc - cell + E.TRACK_LENGTH) % E.TRACK_LENGTH;
          if (dist >= 1 && dist <= 6 && !E.isSafeCell(oc, state.rules)) score += 25;
        }
      });
    }

    score += p.value * 6;   // tempo
    score += p.to * 1.5;    // prefer advancing leaders
    score += noise(rng, 6);
    return score;
  }

  // ---------------------------------------------------------------- public

  /**
   * Choose a token for the current player.
   * Returns a token index taken from state.validMoves, or null if none.
   */
  function chooseMove(state, level, rng) {
    var moves = state.validMoves;
    if (!moves || !moves.length) return null;
    var options = E.distinctMoves(state, moves);
    if (options.length === 1) return options[0];

    if (level === 'easy') return pickRandom(options, rng);

    var scorer = level === 'hard' ? scoreHard : scoreMedium;
    var best = options[0];
    var bestScore = -Infinity;
    options.forEach(function (idx) {
      var s = scorer(state, idx, rng);
      if (s > bestScore) { bestScore = s; best = idx; }
    });
    return best;
  }

  // ------------------------------------------------------------------ magic

  var MAGIC_CHANCE = { easy: 0.3, medium: 0.65, hard: 0.95 };

  function tokensOnTrack(state, seat) {
    return state.tokens[seat].filter(function (p) { return E.isOnTrack(p); }).length;
  }

  /**
   * Decide whether the computer casts a spell before rolling.
   * Returns null or {kind, args} that E.useMagic accepts for the current player.
   */
  function chooseMagic(state, level, rng) {
    if (!state.magic || state.status !== 'waiting_roll') return null;
    var rnd = typeof rng === 'function' ? rng : Math.random;
    var seat = state.current, ch = state.magic.charges[seat];
    if (!(ch.dice > 0 || ch.shield > 0 || ch.blast > 0)) return null;
    if (rnd() > (MAGIC_CHANCE[level] || MAGIC_CHANCE.medium)) return null;

    var targets, best, i;

    // Blast: remove the most advanced unprotected opponent token.
    if (ch.blast > 0) {
      targets = E.magicTargets(state, 'blast');
      if (targets.length) {
        if (level === 'easy') {
          best = targets[Math.floor(rnd() * targets.length) % targets.length];
        } else {
          best = targets.reduce(function (a, b) { return b.progress > a.progress ? b : a; });
          if (best.progress < (level === 'hard' ? 18 : 28) && !E.isGateLocked(state, seat)) best = null;
        }
        if (best) return { kind: 'blast', args: { seat: best.seat, token: best.token } };
      }
    }

    // Shield: protect the most advanced token that an opponent could hit next turn.
    if (ch.shield > 0) {
      targets = E.magicTargets(state, 'shield');
      var threatened = targets.filter(function (c) {
        var pos = state.tokens[seat][c.token];
        return E.threatLevel(state, seat, E.trackCell(seat, pos)) > 0 && pos >= 12;
      });
      if (level === 'easy' && targets.length) {
        return { kind: 'shield', args: { token: targets[Math.floor(rnd() * targets.length) % targets.length].token } };
      }
      if (threatened.length) {
        best = threatened.reduce(function (a, b) { return state.tokens[seat][b.token] > state.tokens[seat][a.token] ? b : a; });
        return { kind: 'shield', args: { token: best.token } };
      }
    }

    // Pick dice: a six when nothing is on the board, or a winning / capturing number.
    if (ch.dice > 0) {
      if (level === 'easy') return { kind: 'dice', args: { value: 1 + Math.floor(rnd() * 6) % 6 } };
      var inBase = state.tokens[seat].some(function (p) { return p === E.BASE; });
      if (inBase && tokensOnTrack(state, seat) === 0 &&
          !state.tokens[seat].some(function (p) { return E.isInHomeLane(p); })) {
        return { kind: 'dice', args: { value: 6 } };
      }
      if (level === 'hard') {
        var bestV = 0, bestScore = 0;
        for (var v = 1; v <= 6; v++) {
          E.getValidMoves(state, seat, v).forEach(function (idx) {
            var pv = E.previewMove(state, idx, v, seat);
            var sc = pv.finishes ? 3 : (pv.captures.length ? 2 : 0);
            if (sc > bestScore) { bestScore = sc; bestV = v; }
          });
        }
        if (bestV) return { kind: 'dice', args: { value: bestV } };
      }
    }
    return null;
  }

  return { chooseMove: chooseMove, chooseMagic: chooseMagic, scoreMedium: scoreMedium, scoreHard: scoreHard };
});
