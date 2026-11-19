/*!
 * Ludo Pro - board geometry and board view
 * Developer: Sanaullah Khoso
 *
 * Part 1 (pure, testable in Node): maps engine positions to grid coordinates
 *   of a standard 15x15 Ludo board.
 * Part 2 (browser only): BoardView draws the board and animates tokens. It
 *   contains no game rules; it only renders what the engine says.
 *
 * Coordinates are "cell units": (x, y) is the CENTRE of a point on the
 * 15x15 grid, so the centre of cell (row, col) is (col + 0.5, row + 0.5).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ludo-engine.js'));
  else root.LudoBoard = factory(root.LudoEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var GRID = 15;

  // The 52 shared track cells as [row, col], clockwise, starting at red's start.
  var TRACK = [];
  function run(r0, c0, dr, dc, n) {
    for (var i = 0; i < n; i++) TRACK.push([r0 + dr * i, c0 + dc * i]);
  }
  run(6, 1, 0, 1, 5);    // red arm, top row, towards the centre        idx 0..4
  run(5, 6, -1, 0, 6);   // up the left side of the top arm             idx 5..10
  run(0, 7, 0, 1, 2);    // across the top                              idx 11..12
  run(1, 8, 1, 0, 5);    // down the right side of the top arm          idx 13..17 (green start 13)
  run(6, 9, 0, 1, 6);    // right arm, top row                          idx 18..23
  run(7, 14, 1, 0, 2);   // down the right edge                         idx 24..25
  run(8, 13, 0, -1, 5);  // right arm, bottom row, towards the centre   idx 26..30 (yellow start 26)
  run(9, 8, 1, 0, 6);    // down the right side of the bottom arm       idx 31..36
  run(14, 7, 0, -1, 2);  // across the bottom                           idx 37..38
  run(13, 6, -1, 0, 5);  // up the left side of the bottom arm          idx 39..43 (blue start 39)
  run(8, 5, 0, -1, 6);   // left arm, bottom row                        idx 44..49
  run(7, 0, -1, 0, 2);   // up the left edge                            idx 50..51

  // Private home lanes (5 cells each), ordered from the track towards home.
  var HOME_LANES = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],        // red
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],        // green
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],    // yellow
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]     // blue
  ];

  // Token resting spots in each home base, [x, y] centres.
  var BASE_SPOTS = [
    [[2, 2], [4, 2], [2, 4], [4, 4]],
    [[11, 2], [13, 2], [11, 4], [13, 4]],
    [[11, 11], [13, 11], [11, 13], [13, 13]],
    [[2, 11], [4, 11], [2, 13], [4, 13]]
  ];

  // Centre of each 6x6 home base (the dice sits here while it is that player's turn).
  var BASE_CENTRES = [[3, 3], [12, 3], [12, 12], [3, 12]];

  // Where finished tokens rest: centre triangle of their own colour.
  var FINISH_ANCHOR = [[6.55, 7.5, 'v'], [7.5, 6.55, 'h'], [8.45, 7.5, 'v'], [7.5, 8.45, 'h']];

  function cellCentre(rc) { return { x: rc[1] + 0.5, y: rc[0] + 0.5 }; }

  /** Grid coordinates of a token for its engine position. */
  function coordFor(seat, tokenIdx, pos) {
    if (pos === E.BASE) {
      var b = BASE_SPOTS[seat][tokenIdx];
      return { x: b[0], y: b[1], kind: 'base' };
    }
    if (pos >= 0 && pos <= E.LAST_TRACK_REL) {
      var c = cellCentre(TRACK[E.trackCell(seat, pos)]);
      c.kind = 'track';
      return c;
    }
    if (pos >= E.HOME_LANE_FIRST && pos <= E.HOME_LANE_LAST) {
      var l = cellCentre(HOME_LANES[seat][pos - E.HOME_LANE_FIRST]);
      l.kind = 'lane';
      return l;
    }
    var a = FINISH_ANCHOR[seat];
    var off = (tokenIdx - 1.5) * 0.3;
    return {
      x: a[2] === 'v' ? a[0] : a[0] + off,
      y: a[2] === 'v' ? a[1] + off : a[1],
      kind: 'finish'
    };
  }

  /** Lookup tables used for drawing and for tests. */
  function buildLookups() {
    var cellInfo = {};
    TRACK.forEach(function (rc, idx) {
      var info = { type: 'track', index: idx, safe: E.SAFE_CELLS.indexOf(idx) !== -1, startOf: -1 };
      E.START_INDEX.forEach(function (s, seat) { if (s === idx) info.startOf = seat; });
      cellInfo[rc[0] + ',' + rc[1]] = info;
    });
    HOME_LANES.forEach(function (lane, seat) {
      lane.forEach(function (rc, i) {
        cellInfo[rc[0] + ',' + rc[1]] = { type: 'lane', seat: seat, index: i };
      });
    });
    return cellInfo;
  }
  var CELL_INFO = buildLookups();

  var api = {
    GRID: GRID, TRACK: TRACK, HOME_LANES: HOME_LANES, BASE_SPOTS: BASE_SPOTS,
    FINISH_ANCHOR: FINISH_ANCHOR, BASE_CENTRES: BASE_CENTRES, CELL_INFO: CELL_INFO, coordFor: coordFor
  };

  // =========================================================== BoardView ===
  if (typeof document === 'undefined') return api;

  var SEAT_NAMES = E.COLORS;
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function pct(v) { return (v / GRID * 100).toFixed(4) + '%'; }

  var gradientsInstalled = false;
  var PALETTE = {
    red:    ['#ff8a8a', '#e11d1d', '#7a0a0a'],
    green:  ['#8dfc8d', '#14a51f', '#075c0e'],
    yellow: ['#fff39a', '#f5b800', '#8a6200'],
    blue:   ['#8ec5ff', '#1769e0', '#0a2f78']
  };

  function installGradients() {
    if (gradientsInstalled) return;
    gradientsInstalled = true;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    var defs = document.createElementNS(NS, 'defs');
    SEAT_NAMES.forEach(function (name) {
      var p = PALETTE[name];
      var g = document.createElementNS(NS, 'radialGradient');
      g.setAttribute('id', 'tok-' + name);
      g.setAttribute('cx', '35%'); g.setAttribute('cy', '30%'); g.setAttribute('r', '80%');
      [[0, p[0]], [0.5, p[1]], [1, p[2]]].forEach(function (s) {
        var st = document.createElementNS(NS, 'stop');
        st.setAttribute('offset', String(s[0]));
        st.setAttribute('stop-color', s[1]);
        g.appendChild(st);
      });
      defs.appendChild(g);
    });
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  function pawnSvg(name) {
    var stroke = PALETTE[name][2];
    return '<svg viewBox="0 0 40 52" xmlns="' + NS + '">' +
      '<ellipse cx="20" cy="48" rx="15" ry="4" fill="rgba(0,0,0,.35)"/>' +
      '<path d="M6 46 C6 38 13 34 16.5 30 C12.5 28 11.5 24 14 21 L26 21 C28.5 24 27.5 28 23.5 30 C27 34 34 38 34 46 Z" ' +
      'fill="url(#tok-' + name + ')" stroke="' + stroke + '" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<circle cx="20" cy="13.5" r="9" fill="url(#tok-' + name + ')" stroke="' + stroke + '" stroke-width="1.4"/>' +
      '<ellipse cx="16.8" cy="10.2" rx="3.6" ry="2.4" fill="#fff" opacity=".55"/>' +
      '<ellipse cx="13" cy="39" rx="2.2" ry="4.5" fill="#fff" opacity=".28" transform="rotate(18 13 39)"/>' +
      '</svg>';
  }

  /**
   * BoardView(container)
   *   .build(state)              draw board for the active seats
   *   .layout(state)             place every token according to the state
   *   .moveStep(seat, idx, pos)  move a token to one position (animation step)
   *   .sendToBase(seat, idx)     return a captured token to its base
   *   .setMovable(seat, idxs)    highlight tokens that may be moved
   *   .setTargets(list)          show landing markers [{x,y}]
   *   .onTokenTap = function(seat, idx)
   */
  function BoardView(container) {
    this.container = container;
    this.onTokenTap = null;
    this.tokens = {};
    this.board = null;
    this.stepMs = 170;
  }

  BoardView.prototype.build = function (state) {
    var self = this;
    installGradients();
    // remove everything except elements marked data-keep (the dice that floats over the board)
    Array.prototype.slice.call(this.container.children).forEach(function (n) {
      if (!n.hasAttribute('data-keep')) self.container.removeChild(n);
    });
    this.tokens = {};
    var board = el('div', 'ludo-board', this.container);
    this.board = board;
    var active = {};
    state.seats.forEach(function (s) { active[s] = true; });

    // Bases
    var baseOrigins = [[0, 0], [9, 0], [9, 9], [0, 9]]; // [col,row] top-left of 6x6 area
    for (var seat = 0; seat < 4; seat++) {
      var o = baseOrigins[seat];
      var base = el('div', 'base base-' + SEAT_NAMES[seat] + (active[seat] ? '' : ' inactive'), board);
      base.style.left = pct(o[0]); base.style.top = pct(o[1]);
      base.style.width = pct(6); base.style.height = pct(6);
      var inner = el('div', 'base-inner', base);
      BASE_SPOTS[seat].forEach(function (sp) {
        var spot = el('div', 'spot spot-' + SEAT_NAMES[seat], board);
        spot.style.left = pct(sp[0] - 0.46); spot.style.top = pct(sp[1] - 0.46);
        spot.style.width = pct(0.92); spot.style.height = pct(0.92);
      });
    }

    // Cross cells
    Object.keys(CELL_INFO).forEach(function (key) {
      var rc = key.split(',').map(Number);
      var info = CELL_INFO[key];
      var cls = 'cell';
      if (info.type === 'lane') cls += ' lane lane-' + SEAT_NAMES[info.seat];
      else {
        if (info.startOf !== -1) cls += ' start start-' + SEAT_NAMES[info.startOf];
        else if (info.safe) cls += ' safe';
      }
      var cell = el('div', cls, board);
      cell.style.left = pct(rc[1]); cell.style.top = pct(rc[0]);
      cell.style.width = pct(1); cell.style.height = pct(1);
      if (info.type === 'track' && (info.safe || info.startOf !== -1)) cell.setAttribute('data-star', '1');
    });

    // Centre
    var centre = el('div', 'centre', board);
    centre.style.left = pct(6); centre.style.top = pct(6);
    centre.style.width = pct(3); centre.style.height = pct(3);
    centre.innerHTML =
      '<svg viewBox="0 0 3 3" preserveAspectRatio="none">' +
      '<polygon points="0,0 0,3 1.5,1.5" class="tri-red"/>' +
      '<polygon points="0,0 3,0 1.5,1.5" class="tri-green"/>' +
      '<polygon points="3,0 3,3 1.5,1.5" class="tri-yellow"/>' +
      '<polygon points="0,3 3,3 1.5,1.5" class="tri-blue"/>' +
      '<circle cx="1.5" cy="1.5" r="0.2" fill="#ffd54a" stroke="#8a5a00" stroke-width="0.04"/>' +
      '</svg>';

    this.targetLayer = el('div', 'target-layer', board);
    this.tokenLayer = el('div', 'token-layer', board);

    // Tokens
    state.seats.forEach(function (s) {
      for (var i = 0; i < 4; i++) {
        var t = el('div', 'token token-' + SEAT_NAMES[s], self.tokenLayer);
        t.innerHTML = pawnSvg(SEAT_NAMES[s]);
        t.setAttribute('data-seat', s);
        t.setAttribute('data-idx', i);
        t.addEventListener('click', function (ev) {
          var seat2 = Number(this.getAttribute('data-seat'));
          var idx = Number(this.getAttribute('data-idx'));
          ev.stopPropagation();
          if (self.onTokenTap) self.onTokenTap(seat2, idx);
        });
        self.tokens[s + '-' + i] = t;
      }
    });
    this.setStepMs(this.stepMs);
    this.layout(state);
    this.setShields(state);
  };

  BoardView.prototype.setStepMs = function (ms) {
    this.stepMs = ms;
    if (this.board) this.board.style.setProperty('--step', ms + 'ms');
  };

  function place(t, x, y, scale, dx, dy) {
    t.style.left = pct(x - 0.5 + (dx || 0));
    t.style.top = pct(y - 0.85 + (dy || 0));
    t.style.transform = 'scale(' + (scale || 1) + ')';
    t.style.zIndex = String(10 + Math.round((y + (dy || 0)) * 10));
  }

  /** Place all tokens; tokens sharing a cell are spread out and scaled down. */
  BoardView.prototype.layout = function (state) {
    var groups = {};
    var self = this;
    state.seats.forEach(function (s) {
      for (var i = 0; i < 4; i++) {
        var pos = state.tokens[s][i];
        var c = coordFor(s, i, pos);
        var key = c.kind === 'base' || c.kind === 'finish' ? 'solo-' + s + '-' + i : c.x + ',' + c.y;
        (groups[key] = groups[key] || []).push({ seat: s, idx: i, c: c });
      }
    });
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var n = list.length;
      var scale = n === 1 ? 1 : (n === 2 ? 0.78 : 0.66);
      var offs = n === 1 ? [[0, 0]] :
        n === 2 ? [[-0.2, 0.05], [0.2, -0.05]] :
        n === 3 ? [[-0.24, 0.12], [0.24, 0.12], [0, -0.2]] :
        [[-0.24, 0.16], [0.24, 0.16], [-0.24, -0.2], [0.24, -0.2]];
      list.forEach(function (g, k) {
        var t = self.tokens[g.seat + '-' + g.idx];
        var s2 = g.c.kind === 'finish' ? 0.5 : scale;
        var o = offs[k % offs.length];
        place(t, g.c.x, g.c.y, s2, o[0], o[1]);
      });
    });
  };

  /** Move a single token to one position (used for cell-by-cell animation). */
  BoardView.prototype.moveStep = function (seat, idx, pos) {
    var t = this.tokens[seat + '-' + idx];
    if (!t) return;
    var c = coordFor(seat, idx, pos);
    t.classList.add('hop');
    place(t, c.x, c.y, c.kind === 'finish' ? 0.5 : 1, 0, 0);
  };

  BoardView.prototype.sendToBase = function (seat, idx) {
    var t = this.tokens[seat + '-' + idx];
    if (!t) return;
    var c = coordFor(seat, idx, E.BASE);
    t.classList.remove('hop');
    t.classList.add('captured');
    place(t, c.x, c.y, 1, 0, 0);
    setTimeout(function () { t.classList.remove('captured'); }, 600);
  };

  BoardView.prototype.setMovable = function (seat, idxs) {
    var self = this;
    Object.keys(this.tokens).forEach(function (k) {
      self.tokens[k].classList.remove('movable');
    });
    (idxs || []).forEach(function (i) {
      var t = self.tokens[seat + '-' + i];
      if (t) t.classList.add('movable');
    });
  };

  BoardView.prototype.setTargets = function (list) {
    var layer = this.targetLayer;
    if (!layer) return;
    layer.innerHTML = '';
    (list || []).forEach(function (c) {
      var d = el('div', 'target', layer);
      d.style.left = pct(c.x - 0.42); d.style.top = pct(c.y - 0.42);
      d.style.width = pct(0.84); d.style.height = pct(0.84);
    });
  };

  /** Glow the tokens a spell can be aimed at: list of {seat, token}. */
  BoardView.prototype.setHighlights = function (list) {
    var self = this;
    Object.keys(this.tokens).forEach(function (k) { self.tokens[k].classList.remove('pickable'); });
    (list || []).forEach(function (c) {
      var t = self.tokens[c.seat + '-' + c.token];
      if (t) t.classList.add('pickable');
    });
  };

  /** Show the magic shield bubble on protected tokens. */
  BoardView.prototype.setShields = function (state) {
    var self = this;
    var sh = state && state.magic ? state.magic.shields : null;
    Object.keys(this.tokens).forEach(function (k) {
      var parts = k.split('-');
      self.tokens[k].classList.toggle('shielded', !!(sh && sh[parts[0]] && sh[parts[0]][parts[1]]));
    });
  };

  BoardView.prototype.clearHop = function () {
    var self = this;
    Object.keys(this.tokens).forEach(function (k) { self.tokens[k].classList.remove('hop'); });
  };

  api.BoardView = BoardView;
  return api;
});
