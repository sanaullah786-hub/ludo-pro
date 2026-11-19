/*!
 * Ludo Pro - game controller
 * Developer: Sanaullah Khoso
 *
 * Connects the rules engine, the AI, the board view, the sounds and the UI.
 * It decides WHEN things happen (turn flow, delays, animation order) but never
 * WHAT the rules are: every rule question is answered by LudoEngine.
 *
 * The UI side is injected through `ui` hooks, so this file has no DOM access
 * and can be tested in Node with fake hooks.
 *
 * ui hooks (all optional):
 *   onGameStart(info)            onTurn(info)               setRollEnabled(bool)
 *   animateDice(seat, value) -> Promise     showDice(value)  message(text, seat)
 *   onStateChanged(state)        onGameOver(summary)        save(snapshot)
 *   confirmHandOff(info) -> Promise          onEvent(evt)   onError(err)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ludo-engine.js'), require('./ludo-ai.js'));
  else root.LudoController = factory(root.LudoEngine, root.LudoAI);
})(typeof self !== 'undefined' ? self : this, function (E, AI) {
  'use strict';

  var CANCELLED = { cancelled: true };

  function realSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function Controller(opts) {
    opts = opts || {};
    this.view = opts.view || null;
    this.audio = opts.audio || null;
    this.ui = opts.ui || {};
    this.getSettings = opts.getSettings || function () { return { speed: 'normal', autoMove: true, vibration: false }; };
    this.rng = opts.rng || Math.random;
    this.sleep = opts.sleep || realSleep;
    this.state = null;
    this.meta = null;
    this.config = null;
    this.sid = 0;
    this.paused = false;
    this.awaitingRoll = false;
    this.awaitingMove = false;
    this._rollResolve = null;
    this._moveResolve = null;
    this._lastHumanSeat = null;
    this._lastSnapshot = null;
    this._resumedAt = 0;
  }

  var P = Controller.prototype;

  // ---------------------------------------------------------------- helpers
  P._chk = function (sid) { if (sid !== this.sid) throw CANCELLED; };
  P._speed = function () { return this.getSettings().speed === 'fast' ? 0.5 : 1; };
  P._stepMs = function () { return this.getSettings().speed === 'fast' ? 90 : 170; };

  P._wait = async function (ms) {
    var sid = this.sid;
    await this.sleep(ms * this._speed());
    while (this.paused && sid === this.sid) await this.sleep(60);
    this._chk(sid);
  };

  P._sfx = function (name) { if (this.audio && this.audio.play) this.audio.play(name); };

  P._vibrate = function (ms) {
    try {
      if (this.getSettings().vibration && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  };

  P._emit = function (type, data) {
    if (this.ui.onEvent) {
      var evt = data || {};
      evt.type = type;
      this.ui.onEvent(evt);
    }
  };

  P._say = function (text, seat) { if (this.ui.message) this.ui.message(text, seat); };

  P._name = function (seat) { return this.state.players[seat].name; };

  // ------------------------------------------------------------ life cycle
  /**
   * config: { mode, seats, types, names, difficulty, rules, firstSeat }
   */
  P.start = function (config) {
    this.destroy();
    this.config = JSON.parse(JSON.stringify(config));
    var state = E.createGame(config);
    var humans = state.seats.filter(function (s) { return state.players[s].type === 'human'; });
    this.state = state;
    this.meta = {
      mode: config.mode || 'local',
      ownerSeat: humans.length ? humans[0] : state.seats[0],
      startedAt: Date.now(),
      elapsedMs: 0,
      config: this.config
    };
    this._begin();
  };

  /** Restore a snapshot made by snapshot(). Returns false if it is invalid. */
  P.resume = function (snap) {
    if (!snap || !snap.state || !snap.meta) return false;
    var state = E.deserialize(snap.state);
    if (!state) return false;
    this.destroy();
    this.state = state;
    this.meta = snap.meta;
    this.config = snap.meta.config || null;
    this._begin();
    return true;
  };

  P._begin = function () {
    this.sid += 1;
    this.paused = false;
    this.awaitingRoll = false;
    this.awaitingMove = false;
    this._lastHumanSeat = null;
    this._resumedAt = Date.now();
    var s = this.state;
    if (this.view) {
      this.view.setStepMs(this._stepMs());
      this.view.onTokenTap = this.tapToken.bind(this);
      this.view.build(s);
    }
    if (this.ui.onGameStart) this.ui.onGameStart({ state: s, meta: this.meta });
    if (this.ui.showDice) this.ui.showDice(s.dice || 1);
    if (this.ui.onStateChanged) this.ui.onStateChanged(s);
    this._save();
    this._loop();
  };

  /** Stop everything that is running (leaving the game screen, restarting). */
  P.destroy = function () {
    this.sid += 1;
    this.awaitingRoll = false;
    this.awaitingMove = false;
    var r = this._rollResolve, m = this._moveResolve;
    this._rollResolve = null; this._moveResolve = null;
    if (r) r(null);
    if (m) m(null);
  };

  P.restart = function () {
    if (!this.config) return;
    this.start(this.config);
  };

  P.pause = function () { this.paused = true; };
  P.unpause = function () { this.paused = false; };

  P.elapsedMs = function () {
    if (!this.meta) return 0;
    return (this.meta.elapsedMs || 0) + (this._resumedAt ? Date.now() - this._resumedAt : 0);
  };

  // --------------------------------------------------------------- saving
  P.snapshot = function () {
    if (!this.state || this.state.status === 'finished') return null;
    var meta = JSON.parse(JSON.stringify(this.meta));
    meta.elapsedMs = this.elapsedMs();
    return { version: 1, savedAt: Date.now(), state: E.clone(this.state), meta: meta };
  };

  P._save = function () {
    var snap = this.snapshot();
    if (!snap) return;
    this._lastSnapshot = snap;
    if (this.ui.save) this.ui.save(snap);
  };

  /** Snapshot for "save and exit" / app going to background. */
  P.snapshotNow = function () {
    if (!this.state || this.state.status === 'finished') return null;
    if (this.state.status === 'animating') return this._lastSnapshot;
    return this.snapshot();
  };

  // ------------------------------------------------------------ user input
  P.canHumanRoll = function () {
    return !!(this.state && this.awaitingRoll && !this.paused && this.state.status === 'waiting_roll');
  };

  /** The ROLL button / dice was tapped. */
  P.requestRoll = function () {
    if (!this.canHumanRoll()) return false;
    this.awaitingRoll = false;
    var r = this._rollResolve;
    this._rollResolve = null;
    if (r) r(true);
    return true;
  };

  /** A token was tapped. */
  P.tapToken = function (seat, idx) {
    if (!this.awaitingMove || this.paused || !this.state) return false;
    if (seat !== this.state.current) return false;
    if (this.state.validMoves.indexOf(idx) === -1) return false;
    this.awaitingMove = false;
    var m = this._moveResolve;
    this._moveResolve = null;
    if (m) m(idx);
    return true;
  };

  // ------------------------------------------------------------- main loop
  P._loop = async function () {
    var sid = this.sid;
    try {
      while (sid === this.sid && this.state.status !== 'finished') {
        await this._turn(sid);
      }
    } catch (e) {
      if (e !== CANCELLED) {
        if (this.ui.onError) this.ui.onError(e);
        else if (typeof console !== 'undefined') console.error(e);
      }
    }
  };

  P._announceTurn = function () {
    var s = this.state, p = s.players[s.current];
    if (this.ui.onTurn) {
      this.ui.onTurn({
        seat: s.current, name: p.name, cpu: p.type === 'cpu', color: p.color,
        phase: s.status, state: s
      });
    }
  };

  P._needsHandOff = function (seat) {
    var s = this.state;
    var humans = s.seats.filter(function (x) { return s.players[x].type === 'human'; });
    return humans.length > 1 && this._lastHumanSeat !== null && this._lastHumanSeat !== seat;
  };

  P._waitForRoll = function () {
    var self = this;
    return new Promise(function (resolve) {
      self._rollResolve = resolve;
      self.awaitingRoll = true;
      if (self.ui.setRollEnabled) self.ui.setRollEnabled(true);
    });
  };

  P._waitForMove = function () {
    var self = this;
    var s = this.state;
    return new Promise(function (resolve) {
      self._moveResolve = resolve;
      self.awaitingMove = true;
      if (self.view) {
        self.view.setMovable(s.current, s.validMoves);
        var targets = E.distinctMoves(s).map(function (i) {
          var pv = E.previewMove(s, i);
          return pv ? self._coord(s.current, i, pv.to) : null;
        }).filter(Boolean);
        self.view.setTargets(targets);
      }
    });
  };

  P._coord = function (seat, idx, pos) {
    var B = (typeof LudoBoard !== 'undefined') ? LudoBoard : (typeof require === 'function' ? require('./ludo-board.js') : null);
    return B ? B.coordFor(seat, idx, pos) : null;
  };

  P._turn = async function (sid) {
    var s = this.state;
    var seat = s.current;
    var p = s.players[seat];
    var cpu = p.type === 'cpu';
    this._announceTurn();

    // ---- roll phase
    if (s.status === 'waiting_roll') {
      if (cpu) {
        this._say(p.name + ' is thinking...', seat);
        await this._wait(650);
      } else {
        if (this.meta.mode === 'passplay' && this._needsHandOff(seat) && this.ui.confirmHandOff) {
          await this.ui.confirmHandOff({ seat: seat, name: p.name, color: p.color });
          this._chk(sid);
        }
        this._lastHumanSeat = seat;
        this._say(p.name + ': tap ROLL', seat);
        await this._waitForRoll();
        this._chk(sid);
      }

      var r = E.rollDice(s, this.rng);
      if (!r.ok) { await this._wait(120); return; }
      if (this.ui.setRollEnabled) this.ui.setRollEnabled(false);
      this._sfx('dice');
      this._emit('roll', { seat: seat, value: r.value, human: !cpu });
      if (this.ui.animateDice) await this.ui.animateDice(seat, r.value);
      else await this._wait(300);
      this._chk(sid);
      E.settleRoll(s);
      if (r.value === 6) this._emit('six', { seat: seat, human: !cpu });

      if (r.forfeited) {
        this._say(p.name + ' rolled three sixes - turn lost!', seat);
        await this._wait(1100);
        this._finishPass();
        return;
      }
      if (r.noMoves) {
        this._say(p.name + ' rolled ' + r.value + ' - no move possible', seat);
        await this._wait(950);
        this._finishPass();
        return;
      }
    }

    // ---- move phase (also entered directly when a saved game is resumed)
    if (s.status !== 'waiting_move') return;
    var idx = null;
    var moves = E.distinctMoves(s);
    if (cpu) {
      this._say(p.name + ' rolled ' + s.dice, seat);
      await this._wait(500);
      idx = AI.chooseMove(s, p.difficulty, this.rng);
    } else if (moves.length === 1 && this.getSettings().autoMove) {
      this._say(p.name + ' rolled ' + s.dice, seat);
      await this._wait(380);
      idx = moves[0];
    } else {
      this._say(p.name + ' rolled ' + s.dice + ' - tap a glowing token', seat);
      idx = await this._waitForMove();
      this._chk(sid);
    }
    if (idx === null || idx === undefined) { await this._wait(100); return; }
    await this._playMove(idx, sid);
  };

  P._finishPass = function () {
    if (this.ui.onStateChanged) this.ui.onStateChanged(this.state);
    this._save();
  };

  P._playMove = async function (idx, sid) {
    var s = this.state;
    var seat = s.current;
    var v = this.view;
    var res = E.applyMove(s, idx);
    if (!res.ok) throw new Error('Move rejected by engine: ' + res.error);

    if (v) { v.setMovable(seat, []); v.setTargets([]); }
    var stepMs = this._stepMs();
    for (var i = 0; i < res.path.length; i++) {
      if (v) v.moveStep(seat, idx, res.path[i]);
      this._sfx('move');
      await this._wait(stepMs);
    }
    if (res.captures.length) {
      this._sfx('capture');
      this._vibrate(90);
      if (v) res.captures.forEach(function (c) { v.sendToBase(c.seat, c.token); });
      this._emit('capture', { seat: seat, count: res.captures.length, victims: res.captures,
                              human: s.players[seat].type === 'human' });
      this._say(s.players[seat].name + ' captured ' +
        res.captures.map(function (c) { return s.players[c.seat].name; }).join(', ') + '!', seat);
      await this._wait(460);
    }
    if (res.finishes) {
      this._sfx('home');
      this._emit('tokenHome', { seat: seat, human: s.players[seat].type === 'human' });
    }
    if (v) { v.clearHop(); v.layout(s); }

    var c = E.completeMove(s);
    if (this.ui.onStateChanged) this.ui.onStateChanged(s);
    if (c.finished) { await this._finish(sid); return; }
    if (c.extraTurn) this._say(s.players[seat].name + ' gets another turn!', seat);
    this._save();
  };

  P._finish = async function (sid) {
    var s = this.state;
    this._sfx('win');
    this._vibrate(200);
    var summary = {
      winnerSeat: s.winner,
      rankings: E.finalRankings(s),
      turns: s.turn,
      durationMs: this.elapsedMs(),
      mode: this.meta.mode,
      ownerSeat: this.meta.ownerSeat,
      players: s.seats.map(function (seat) {
        var pl = s.players[seat];
        return { seat: seat, name: pl.name, type: pl.type, difficulty: pl.difficulty,
                 finished: E.finishedCount(s, seat), color: pl.color };
      }),
      stats: E.clone(s.stats),
      rules: E.clone(s.rules)
    };
    this._emit('gameOver', { summary: summary });
    await this._wait(900);
    if (this.ui.onGameOver) this.ui.onGameOver(summary);
  };

  Controller.CANCELLED = CANCELLED;
  return Controller;
});
