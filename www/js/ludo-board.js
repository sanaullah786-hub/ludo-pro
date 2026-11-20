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

  // ---------------------------------------------------------------- token styles
  // Every style is drawn in a 40x52 box that rests on y=48, in the colour of its seat.
  var TOKEN_STYLES = [
    { id: 'pointy', label: 'Pointy' }, { id: 'chess', label: 'Chess' }, { id: 'coin', label: 'Coin' },
    { id: 'cone', label: 'Cone' }, { id: 'gem', label: 'Gem' }, { id: 'mushroom', label: 'Mushroom' },
    { id: 'ghost', label: 'Ghost' }, { id: 'bulb', label: 'Bulb' }, { id: 'crown', label: 'Crown' },
    { id: 'star', label: 'Star' }, { id: 'heart', label: 'Heart' }, { id: 'rocket', label: 'Rocket' }
  ];
  var DEFAULT_TOKEN_STYLE = 'pointy';

  function starPoints(cx, cy, ro, ri) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro;
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function tokenSvg(style, name) {
    var f = 'url(#tok-' + name + ')', k = PALETTE[name][2];
    var st = 'fill="' + f + '" stroke="' + k + '" stroke-width="1.4" stroke-linejoin="round"';
    var shadow = '<ellipse cx="20" cy="48" rx="14" ry="3.6" fill="rgba(0,0,0,.35)"/>';
    var gloss = function (x, y, rx, ry, rot) {
      return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="#fff" opacity=".5"' + (rot ? ' transform="rotate(' + rot + ' ' + x + ' ' + y + ')"' : '') + '/>';
    };
    var body;
    switch (style) {
      case 'chess':
        body = '<path d="M6 46 C6 38 13 34 16.5 30 C12.5 28 11.5 24 14 21 L26 21 C28.5 24 27.5 28 23.5 30 C27 34 34 38 34 46 Z" ' + st + '/>' +
               '<circle cx="20" cy="13.5" r="9" ' + st + '/>' + gloss(16.8, 10.2, 3.6, 2.4) + gloss(13, 39, 2.2, 4.5, 18);
        break;
      case 'coin':
        body = '<ellipse cx="20" cy="45" rx="15" ry="4" fill="' + k + '"/><circle cx="20" cy="29" r="16" ' + st + '/>' +
               '<circle cx="20" cy="29" r="10.5" fill="#fff" opacity=".92"/><circle cx="20" cy="29" r="6" ' + st + '/>' + gloss(13, 20, 5, 2.6, -30);
        break;
      case 'cone':
        body = '<path d="M20 5 L34 46 L6 46 Z" ' + st + '/><path d="M15.5 18 L24.5 18 L26.4 25 L13.6 25 Z" fill="#fff" opacity=".9"/>' +
               '<path d="M11.4 33 L28.6 33 L30.5 40 L9.5 40 Z" fill="#fff" opacity=".9"/>' + gloss(16, 28, 1.6, 8, 12);
        break;
      case 'gem':
        body = '<path d="M20 5 L35 20 L20 47 L5 20 Z" ' + st + '/><path d="M5 20 L35 20 M13 20 L20 5 L27 20 L20 47 Z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.1"/>' +
               '<path d="M13 20 L20 5 L27 20 Z" fill="#fff" opacity=".28"/>';
        break;
      case 'mushroom':
        body = '<path d="M14 30 H26 L27 46 H13 Z" fill="#fff3d6" stroke="' + k + '" stroke-width="1.4" stroke-linejoin="round"/>' +
               '<path d="M3 31 C3 15 11 7 20 7 C29 7 37 15 37 31 Z" ' + st + '/><circle cx="13" cy="20" r="3.4" fill="#fff" opacity=".9"/>' +
               '<circle cx="26" cy="15" r="3" fill="#fff" opacity=".9"/><circle cx="29" cy="26" r="2.4" fill="#fff" opacity=".9"/>';
        break;
      case 'ghost':
        body = '<path d="M6 46 V23 C6 12 12 6 20 6 C28 6 34 12 34 23 V46 L29 41.5 L24.5 46 L20 41.5 L15.5 46 L11 41.5 Z" ' + st + '/>' +
               '<circle cx="14.5" cy="22" r="4" fill="#fff"/><circle cx="25.5" cy="22" r="4" fill="#fff"/>' +
               '<circle cx="15.5" cy="23" r="2" fill="#16203a"/><circle cx="26.5" cy="23" r="2" fill="#16203a"/>' + gloss(13, 12, 3.4, 2, -20);
        break;
      case 'bulb':
        body = '<rect x="14" y="34" width="12" height="11" rx="3" fill="#c9d1e6" stroke="' + k + '" stroke-width="1.3"/>' +
               '<path d="M14 36 H26 M14 40 H26" stroke="' + k + '" stroke-width="1" opacity=".6"/>' +
               '<path d="M20 5 C11 5 6 12 6 19.5 C6 26 10 29 13 34 H27 C30 29 34 26 34 19.5 C34 12 29 5 20 5 Z" ' + st + '/>' + gloss(14, 14, 3.8, 2.6, -25);
        break;
      case 'crown':
        body = '<path d="M5 44 L7 17 L15 27 L20 10 L25 27 L33 17 L35 44 Z" ' + st + '/><rect x="5" y="40" width="30" height="6" rx="2" fill="' + k + '" opacity=".55"/>' +
               '<circle cx="7" cy="15" r="2.6" fill="#fff"/><circle cx="20" cy="8" r="2.6" fill="#fff"/><circle cx="33" cy="15" r="2.6" fill="#fff"/>';
        break;
      case 'star':
        body = '<polygon points="' + starPoints(20, 28, 19, 8.6) + '" ' + st + '/>' + gloss(15, 21, 3.4, 2, -30);
        break;
      case 'heart':
        body = '<path d="M20 46 C3 34 3 15 13 12.5 C17.5 11.4 20 15 20 17.5 C20 15 22.5 11.4 27 12.5 C37 15 37 34 20 46 Z" ' + st + '/>' + gloss(12.5, 19, 3.6, 2.2, -35);
        break;
      case 'rocket':
        body = '<path d="M20 4 C29 12 29 30 27 41 H13 C11 30 11 12 20 4 Z" ' + st + '/>' +
               '<path d="M13 30 L5 41 L13 39 Z M27 30 L35 41 L27 39 Z" ' + st + '/>' +
               '<circle cx="20" cy="19" r="4.6" fill="#fff" opacity=".95" stroke="' + k + '" stroke-width="1"/>' +
               '<path d="M16 41 L20 49 L24 41 Z" fill="#ffd23c" stroke="#e06b00" stroke-width="1"/>';
        break;
      default: // pointy: a map pin
        body = '<path d="M20 49 C20 49 6.5 33 6.5 21 A13.5 13.5 0 1 1 33.5 21 C33.5 33 20 49 20 49 Z" ' + st + '/>' +
               '<circle cx="20" cy="21" r="6.4" fill="#fff" opacity=".95" stroke="' + k + '" stroke-width="1"/>' + gloss(14.5, 14, 3.4, 2.2, -30);
    }
    return '<svg viewBox="0 0 40 52" xmlns="' + NS + '">' + (style === 'pointy' ? '' : shadow) + body + '</svg>';
  }

  function pawnSvg(name, style) { return tokenSvg(style || DEFAULT_TOKEN_STYLE, name); }

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
    this.tokenStyle = DEFAULT_TOKEN_STYLE;
  }

  BoardView.prototype.build = function (state) {
    var self = this;
    installGradients();
    // remove everything except elements marked data-keep (the dice that floats over the board)
    Array.prototype.slice.call(this.container.children).forEach(function (n) {
      if (!n.hasAttribute('data-keep')) self.container.removeChild(n);
    });
    this.tokens = {};
    this.labels = {};
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
      if (active[seat]) {
        var lab = el('div', 'base-label ' + (seat === 0 || seat === 1 ? 'top' : 'bot'), base);
        lab.innerHTML = '<b></b><em>0%</em>';
        lab.firstChild.textContent = state.players[seat].name;
        this.labels[seat] = lab;
      }
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
        t.innerHTML = pawnSvg(SEAT_NAMES[s], self.tokenStyle);
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
    this.updateLabels(state);
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
    if (self.updateLabels) self.updateLabels(state);
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

  /** Progress percentage (0-100) of a seat's tokens towards home. */
  BoardView.prototype.updateLabels = function (state) {
    var self = this;
    state.seats.forEach(function (seat) {
      var lab = self.labels && self.labels[seat];
      if (!lab) return;
      var prog = state.tokens[seat].reduce(function (a, p) { return a + Math.max(0, p + 1); }, 0);
      var pct100 = Math.round(prog / (4 * 57) * 100);
      lab.lastChild.textContent = pct100 + '%' + (state.rules.killToEnterHome && !(state.kills[seat] > 0) ? ' \uD83D\uDD12' : '');
    });
  };

  /** Re-draw every token in another style (live preview / settings). */
  BoardView.prototype.setTokenStyle = function (style) {
    var self = this;
    this.tokenStyle = style || DEFAULT_TOKEN_STYLE;
    Object.keys(this.tokens).forEach(function (k) {
      self.tokens[k].innerHTML = pawnSvg(SEAT_NAMES[Number(k.split('-')[0])], self.tokenStyle);
    });
  };

  BoardView.prototype.clearHop = function () {
    var self = this;
    Object.keys(this.tokens).forEach(function (k) { self.tokens[k].classList.remove('hop'); });
  };

  api.BoardView = BoardView;
  api.TOKEN_STYLES = TOKEN_STYLES;
  api.DEFAULT_TOKEN_STYLE = DEFAULT_TOKEN_STYLE;
  api.tokenSvg = function (style, seat) { installGradients(); return tokenSvg(style, SEAT_NAMES[seat]); };
  return api;
});
