/*!
 * Ludo Pro - rules engine
 * Developer: Sanaullah Khoso
 *
 * Pure game logic. No DOM, no timers, no animation, no audio.
 * Every rule of the game lives in this file. The UI only calls these
 * functions and renders the result.
 *
 * Token position model (per token, "relative" position):
 *   -1        token is in its home base
 *    0..50    token is on the shared 52-cell track (0 = own start cell)
 *   51..55    token is in its private home lane (5 cells)
 *   56        token has reached the final home cell (finished)
 *
 * A token travels 51 track cells (rel 0..50), then 5 lane cells, then home.
 * The track cell right before a colour's start cell is never walked by that
 * colour: it is where that colour's home lane branches off.
 *
 * Seats are numbered clockwise: 0 red, 1 green, 2 yellow, 3 blue.
 * Absolute track cell of a token = (START_INDEX[seat] + rel) % 52.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLORS = ['red', 'green', 'yellow', 'blue'];
  var START_INDEX = [0, 13, 26, 39];
  var TRACK_LENGTH = 52;
  var LAST_TRACK_REL = 50;
  var HOME_LANE_FIRST = 51;
  var HOME_LANE_LAST = 55;
  var FINISH = 56;
  var BASE = -1;
  var TOKENS_PER_PLAYER = 4;
  // Start cell of each colour plus the star cell 8 steps after it.
  var SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47];
  var SAFE_SET = {};
  SAFE_CELLS.forEach(function (c) { SAFE_SET[c] = true; });

  var DEFAULT_RULES = {
    sixToStart: true,          // a six is needed to leave the base
    extraTurnOnSix: true,      // rolling a six gives another roll
    extraTurnOnCapture: true,  // capturing gives another roll
    extraTurnOnFinish: true,   // bringing a token home gives another roll
    threeSixesForfeit: true,   // three sixes in a row forfeit the turn
    safeSquares: true,         // star and start cells protect tokens
    exactFinish: true          // the exact number is needed to finish
  };

  // ---------------------------------------------------------------- helpers

  function fail(error) { return { ok: false, error: error }; }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rollValue(rng) {
    var r = (typeof rng === 'function' ? rng : Math.random)();
    var v = Math.floor(r * 6) + 1;
    return v > 6 ? 6 : (v < 1 ? 1 : v);
  }

  function trackCell(seat, rel) {
    return (START_INDEX[seat] + rel) % TRACK_LENGTH;
  }
  function isInBase(pos) { return pos === BASE; }
  function isOnTrack(pos) { return pos >= 0 && pos <= LAST_TRACK_REL; }
  function isInHomeLane(pos) { return pos >= HOME_LANE_FIRST && pos <= HOME_LANE_LAST; }
  function isFinished(pos) { return pos === FINISH; }

  function isSafeCell(cell, rules) {
    var r = rules || DEFAULT_RULES;
    return r.safeSquares !== false && SAFE_SET[cell] === true;
  }

  /** Is this relative position of this seat currently protected from capture? */
  function isProtectedPos(seat, pos, rules) {
    if (pos === BASE || pos === FINISH) return true;
    if (isInHomeLane(pos)) return true;
    return isSafeCell(trackCell(seat, pos), rules);
  }

  function progressOf(pos) { return pos + 1; } // base = 0 ... finished = 57

  // ------------------------------------------------------------- game setup

  /**
   * options: {
   *   seats: [0,2],                       // active seats (2..4)
   *   types: {0:'human', 2:'cpu'},        // default human
   *   names: {0:'You', 2:'CPU'},
   *   difficulty: {2:'hard'},             // per cpu seat
   *   rules: {...}, firstSeat: 0
   * }
   */
  function createGame(options) {
    options = options || {};
    var seats = (options.seats || [0, 1, 2, 3]).slice().sort(function (a, b) { return a - b; });
    var uniq = {};
    seats.forEach(function (s) {
      if (s !== 0 && s !== 1 && s !== 2 && s !== 3) throw new Error('Invalid seat ' + s);
      if (uniq[s]) throw new Error('Duplicate seat ' + s);
      uniq[s] = true;
    });
    if (seats.length < 2 || seats.length > 4) throw new Error('Ludo needs 2 to 4 players');

    var rules = {};
    Object.keys(DEFAULT_RULES).forEach(function (k) {
      rules[k] = options.rules && options.rules[k] !== undefined ? !!options.rules[k] : DEFAULT_RULES[k];
    });

    var players = [null, null, null, null];
    seats.forEach(function (s) {
      var type = (options.types && options.types[s]) || 'human';
      players[s] = {
        seat: s,
        color: COLORS[s],
        type: type === 'cpu' ? 'cpu' : 'human',
        name: (options.names && options.names[s]) || (COLORS[s].charAt(0).toUpperCase() + COLORS[s].slice(1)),
        difficulty: (options.difficulty && options.difficulty[s]) || 'medium'
      };
    });

    var first = options.firstSeat !== undefined && uniq[options.firstSeat] ? options.firstSeat : seats[0];
    var tokens = [];
    for (var s = 0; s < 4; s++) tokens.push([BASE, BASE, BASE, BASE]);

    return {
      version: 1,
      rules: rules,
      seats: seats,
      players: players,
      tokens: tokens,
      current: first,
      dice: null,
      rolling: false,
      consecutiveSixes: 0,
      validMoves: [],
      status: 'waiting_roll', // waiting_roll | waiting_move | animating | finished
      winner: null,
      rankings: [],
      turn: 1,
      pendingExtra: false,
      pendingWin: false,
      lastMove: null,
      stats: {
        captures: [0, 0, 0, 0],
        sixes: [0, 0, 0, 0],
        moves: [0, 0, 0, 0],
        rolls: [0, 0, 0, 0],
        homeTokens: [0, 0, 0, 0]
      }
    };
  }

  function nextSeat(state) {
    var i = state.seats.indexOf(state.current);
    return state.seats[(i + 1) % state.seats.length];
  }

  function passTurn(state) {
    state.consecutiveSixes = 0;
    state.validMoves = [];
    state.pendingExtra = false;
    state.current = nextSeat(state);
    state.status = 'waiting_roll';
    state.turn += 1;
  }

  // --------------------------------------------------------- move generation

  /** Target relative position for a move, or null if the move is illegal. */
  function targetPosition(state, seat, tokenIdx, value) {
    var pos = state.tokens[seat][tokenIdx];
    if (pos === FINISH) return null;
    if (pos === BASE) {
      if (state.rules.sixToStart) return value === 6 ? 0 : null;
      return 0;
    }
    var target = pos + value;
    if (target > FINISH) return state.rules.exactFinish ? null : FINISH;
    return target;
  }

  function canMove(state, seat, tokenIdx, value) {
    return targetPosition(state, seat, tokenIdx, value) !== null;
  }

  function getValidMoves(state, seat, value) {
    var out = [];
    if (!value) return out;
    for (var i = 0; i < TOKENS_PER_PLAYER; i++) {
      if (canMove(state, seat, i, value)) out.push(i);
    }
    return out;
  }

  /**
   * Collapse equivalent moves (several tokens in base, or several tokens on
   * the same cell) so that AIs and auto-move treat them as one choice.
   */
  function distinctMoves(state, moves) {
    var list = moves || state.validMoves;
    var seat = state.current;
    var seen = {};
    var out = [];
    list.forEach(function (i) {
      var key = String(state.tokens[seat][i]);
      if (!seen[key]) { seen[key] = true; out.push(i); }
    });
    return out;
  }

  /** Opponent tokens that would be captured by landing on `rel` as `seat`. */
  function capturesAt(state, seat, rel) {
    var captured = [];
    if (!isOnTrack(rel)) return captured;
    var cell = trackCell(seat, rel);
    if (isSafeCell(cell, state.rules)) return captured;
    state.seats.forEach(function (s) {
      if (s === seat) return;
      for (var t = 0; t < TOKENS_PER_PLAYER; t++) {
        var p = state.tokens[s][t];
        if (isOnTrack(p) && trackCell(s, p) === cell) {
          captured.push({ seat: s, token: t, from: p, cell: cell });
        }
      }
    });
    return captured;
  }

  /** Describe a move without changing the state. */
  function previewMove(state, tokenIdx, value, seat) {
    seat = seat === undefined ? state.current : seat;
    value = value === undefined ? state.dice : value;
    var from = state.tokens[seat][tokenIdx];
    var to = targetPosition(state, seat, tokenIdx, value);
    if (to === null) return null;
    var path = [];
    if (from === BASE) path.push(0);
    else for (var p = from + 1; p <= to; p++) path.push(p);
    var captures = capturesAt(state, seat, to);
    var landsSafe = isProtectedPos(seat, to, state.rules);
    return {
      seat: seat,
      token: tokenIdx,
      value: value,
      from: from,
      to: to,
      path: path,
      captures: captures,
      entersFromBase: from === BASE,
      entersHomeLane: !isInHomeLane(from) && isInHomeLane(to),
      finishes: to === FINISH,
      landsSafe: landsSafe,
      fromSafe: from === BASE ? true : isProtectedPos(seat, from, state.rules)
    };
  }

  /** How many opponent tokens could hit `cell` (absolute) with one roll. */
  function threatLevel(state, seat, cell) {
    if (isSafeCell(cell, state.rules)) return 0;
    var n = 0;
    state.seats.forEach(function (s) {
      if (s === seat) return;
      for (var t = 0; t < TOKENS_PER_PLAYER; t++) {
        var p = state.tokens[s][t];
        if (!isOnTrack(p)) continue;
        for (var d = 1; d <= 6; d++) {
          var q = p + d;
          if (q > LAST_TRACK_REL) break;
          if (trackCell(s, q) === cell) { n++; break; }
        }
      }
    });
    return n;
  }

  // ------------------------------------------------------------------- turns

  function applyRoll(state, value) {
    var seat = state.current;
    state.dice = value;
    state.rolling = true;
    state.validMoves = [];
    state.stats.rolls[seat] += 1;
    if (value === 6) {
      state.consecutiveSixes += 1;
      state.stats.sixes[seat] += 1;
    } else {
      state.consecutiveSixes = 0;
    }

    var result = {
      ok: true, seat: seat, value: value, validMoves: [],
      forfeited: false, noMoves: false, nextSeat: null
    };

    if (value === 6 && state.rules.threeSixesForfeit && state.consecutiveSixes >= 3) {
      result.forfeited = true;
      passTurn(state);
      result.nextSeat = state.current;
      return result;
    }

    var moves = getValidMoves(state, seat, value);
    if (!moves.length) {
      result.noMoves = true;
      passTurn(state);
      result.nextSeat = state.current;
      return result;
    }
    state.validMoves = moves;
    state.status = 'waiting_move';
    result.validMoves = moves.slice();
    return result;
  }

  /** Roll the dice for the current player. */
  function rollDice(state, rng) {
    if (state.status === 'finished') return fail('game_finished');
    if (state.rolling) return fail('dice_rolling');
    if (state.status !== 'waiting_roll') return fail('not_waiting_roll');
    return applyRoll(state, rollValue(rng));
  }

  /** Same as rollDice but with a chosen value (tests, replays). */
  function rollWithValue(state, value) {
    if (value < 1 || value > 6 || value !== Math.floor(value)) return fail('invalid_dice_value');
    if (state.status === 'finished') return fail('game_finished');
    if (state.rolling) return fail('dice_rolling');
    if (state.status !== 'waiting_roll') return fail('not_waiting_roll');
    return applyRoll(state, value);
  }

  /** The dice animation is over. Moves are accepted again. */
  function settleRoll(state) { state.rolling = false; }

  function applyMove(state, tokenIdx) {
    if (state.status === 'finished') return fail('game_finished');
    if (state.rolling) return fail('dice_rolling');
    if (state.status !== 'waiting_move') return fail('not_waiting_move');
    if (state.validMoves.indexOf(tokenIdx) === -1) return fail('illegal_move');

    var seat = state.current;
    var preview = previewMove(state, tokenIdx, state.dice, seat);
    if (!preview) return fail('illegal_move');

    state.tokens[seat][tokenIdx] = preview.to;
    preview.captures.forEach(function (c) { state.tokens[c.seat][c.token] = BASE; });
    state.stats.captures[seat] += preview.captures.length;
    state.stats.moves[seat] += 1;
    if (preview.finishes) state.stats.homeTokens[seat] += 1;

    var extra =
      (state.dice === 6 && state.rules.extraTurnOnSix) ||
      (preview.captures.length > 0 && state.rules.extraTurnOnCapture) ||
      (preview.finishes && state.rules.extraTurnOnFinish);

    var won = state.tokens[seat].every(function (p) { return p === FINISH; });
    if (won) {
      state.winner = seat;
      state.rankings = [seat];
      state.pendingWin = true;
    }

    state.pendingExtra = !!extra;
    state.lastMove = preview;
    state.validMoves = [];
    state.status = 'animating';

    var result = clone(preview);
    result.ok = true;
    result.extraTurn = !!extra && !won;
    result.won = won;
    return result;
  }

  /** Call when the move animation has finished. Decides who plays next. */
  function completeMove(state) {
    if (state.status !== 'animating') return fail('not_animating');
    if (state.pendingWin) {
      state.status = 'finished';
      state.pendingWin = false;
      state.pendingExtra = false;
      return { ok: true, finished: true, extraTurn: false, nextSeat: null, winner: state.winner };
    }
    if (state.pendingExtra) {
      state.pendingExtra = false;
      state.status = 'waiting_roll';
      state.validMoves = [];
      state.turn += 1;
      return { ok: true, finished: false, extraTurn: true, nextSeat: state.current };
    }
    passTurn(state);
    return { ok: true, finished: false, extraTurn: false, nextSeat: state.current };
  }

  // ---------------------------------------------------------------- results

  function totalProgress(state, seat) {
    return state.tokens[seat].reduce(function (a, p) { return a + progressOf(p); }, 0);
  }
  function finishedCount(state, seat) {
    return state.tokens[seat].filter(function (p) { return p === FINISH; }).length;
  }

  /** Winner first, then others by finished tokens and board progress. */
  function finalRankings(state) {
    var others = state.seats.filter(function (s) { return s !== state.winner; });
    others.sort(function (a, b) {
      return (finishedCount(state, b) - finishedCount(state, a)) ||
             (totalProgress(state, b) - totalProgress(state, a)) || (a - b);
    });
    return state.winner === null ? others : [state.winner].concat(others);
  }

  function isGameOver(state) { return state.status === 'finished'; }

  // ---------------------------------------------- simulation (used by the AI)

  /** Apply a move on a copy and return {state, preview}. Never mutates input. */
  function simulateMove(state, tokenIdx, value) {
    var copy = clone(state);
    var seat = copy.current;
    value = value === undefined ? copy.dice : value;
    var preview = previewMove(copy, tokenIdx, value, seat);
    if (!preview) return null;
    copy.tokens[seat][tokenIdx] = preview.to;
    preview.captures.forEach(function (c) { copy.tokens[c.seat][c.token] = BASE; });
    return { state: copy, preview: preview };
  }

  // ----------------------------------------------------------- save / load

  function serialize(state) { return JSON.stringify(state); }

  /** Structural validation, used before restoring a saved game. */
  function isValidState(s) {
    try {
      if (!s || typeof s !== 'object' || s.version !== 1) return false;
      if (!Array.isArray(s.seats) || s.seats.length < 2 || s.seats.length > 4) return false;
      if (!Array.isArray(s.tokens) || s.tokens.length !== 4) return false;
      for (var seat = 0; seat < 4; seat++) {
        if (!Array.isArray(s.tokens[seat]) || s.tokens[seat].length !== 4) return false;
        for (var t = 0; t < 4; t++) {
          var p = s.tokens[seat][t];
          if (typeof p !== 'number' || p < BASE || p > FINISH || p !== Math.floor(p)) return false;
        }
      }
      if (s.seats.indexOf(s.current) === -1) return false;
      if (['waiting_roll', 'waiting_move', 'animating', 'finished'].indexOf(s.status) === -1) return false;
      if (!s.rules || !s.players || !s.stats) return false;
      return true;
    } catch (e) { return false; }
  }

  /**
   * Restore a saved game. A save is only written at a stable point, but if a
   * transient state is found (rolling / animating) it is normalised so the
   * player can simply roll again.
   */
  function deserialize(json) {
    var s;
    try { s = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!isValidState(s)) return null;
    s.rolling = false;
    if (s.status === 'animating') {
      s.status = 'waiting_roll';
      s.pendingWin = false;
      s.pendingExtra = false;
    }
    if (s.status === 'waiting_move') {
      s.validMoves = getValidMoves(s, s.current, s.dice);
      if (!s.validMoves.length) s.status = 'waiting_roll';
    }
    return s;
  }

  return {
    COLORS: COLORS, START_INDEX: START_INDEX, TRACK_LENGTH: TRACK_LENGTH,
    LAST_TRACK_REL: LAST_TRACK_REL, HOME_LANE_FIRST: HOME_LANE_FIRST,
    HOME_LANE_LAST: HOME_LANE_LAST, FINISH: FINISH, BASE: BASE,
    TOKENS_PER_PLAYER: TOKENS_PER_PLAYER, SAFE_CELLS: SAFE_CELLS,
    DEFAULT_RULES: DEFAULT_RULES,
    mulberry32: mulberry32, rollValue: rollValue,
    trackCell: trackCell, isInBase: isInBase, isOnTrack: isOnTrack,
    isInHomeLane: isInHomeLane, isFinished: isFinished,
    isSafeCell: isSafeCell, isProtectedPos: isProtectedPos, progressOf: progressOf,
    createGame: createGame, nextSeat: nextSeat,
    targetPosition: targetPosition, canMove: canMove, getValidMoves: getValidMoves,
    distinctMoves: distinctMoves, capturesAt: capturesAt, previewMove: previewMove,
    threatLevel: threatLevel,
    rollDice: rollDice, rollWithValue: rollWithValue, settleRoll: settleRoll,
    applyMove: applyMove, completeMove: completeMove,
    totalProgress: totalProgress, finishedCount: finishedCount,
    finalRankings: finalRankings, isGameOver: isGameOver,
    simulateMove: simulateMove,
    serialize: serialize, deserialize: deserialize, isValidState: isValidState,
    clone: clone
  };
});
