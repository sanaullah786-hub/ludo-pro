/*!
 * Ludo Pro - application shell: screens, navigation, wiring.
 * Developer: Sanaullah Khoso
 *
 * No game rules live here. Rules: ludo-engine.js. Turn flow: game-controller.js.
 */
(function () {
  'use strict';

  var E = LudoEngine, D = LudoData, Eco = LudoEconomy, A = LudoAudio, B = LudoBoard;

  var COLOR_HEX = ['#e11d1d', '#14a51f', '#f5b800', '#1769e0'];
  var COLOR_NAME = ['Red', 'Green', 'Yellow', 'Blue'];
  var CPU_NAMES = ['Bolt', 'Nova', 'Zed', 'Rex'];
  var AVATARS = ['😎', '🤠', '🦊', '🐼', '🦁', '🐯', '🐸', '🐵', '🦄', '🐲', '👑', '🚀', '⚡', '🔥', '🎲', '🏆', '🌟', '🎯'];
  var MODE_LABEL = { cpu: 'vs Computer', local2: '2 Players', local3: '3 Players', local4: '4 Players', passplay: 'Pass & Play', magic: '\uD83E\uDE84 Magic Play' };
  var KIND_LABEL = { cpu: 'Solo', local2: 'Local', local3: 'Local', local4: 'Local', passplay: 'Pass & Play', magic: 'Solo' };
  var VARIANTS = {
    classic:    { label: 'Classic',    icon: '\uD83C\uDFB2', goal: 'Home all 4 pawns', info: 'Bring all four of your pawns home first. Roll a six to leave the base; capture opponents to open your home lane.' },
    timed:      { label: '5 Minutes',  icon: '\u23F1',   goal: 'Top score wins',   info: 'You have 5 minutes. Score = board progress + 60 per capture + 40 per pawn at home. The highest score when the clock ends wins (all four pawns home also wins).' },
    quick:      { label: 'Quick',      icon: '\uD83D\uDC07', goal: '1 kill + 1 home', info: 'Capture one opponent pawn and bring one of your own pawns home - the first player to do both wins.' },
    deathmatch: { label: 'Deathmatch', icon: '\uD83D\uDC80', goal: 'First to 4 kills', info: 'Capture four opponent pawns first to win. Spells and normal captures both count.' },
    power:      { label: 'Power',      icon: '\u270A',   goal: 'Spells enabled',   info: 'Classic rules plus spells: Pick Dice (choose your number), Shield (protect a pawn) and Blast (send an opponent pawn home). Bringing a pawn home earns another spell.' }
  };
  var SEAT_AVATARS = ['\uD83D\uDE0E', '\uD83E\uDD20', '\uD83E\uDD8A', '\uD83D\uDC3C'];
  var SCREENS = ['splash', 'home', 'modes', 'setup', 'tokens', 'game', 'result', 'settings', 'history', 'profile', 'rewards'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60);
    return m + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
  }
  function fmtDate(t) {
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- state
  var settings = D.getSettings();
  var current = 'splash';
  var stack = [];
  var setup = null;
  var ctrl = null;
  var lastConfig = null;
  var timers = { rewards: null, toast: null };
  var dailyShown = false;

  // ------------------------------------------------------------ navigation
  function show(name) {
    if (timers.rewards) { clearInterval(timers.rewards); timers.rewards = null; }
    SCREENS.forEach(function (s) { $('screen-' + s).classList.toggle('active', s === name); });
    current = name;
    var render = { home: renderHome, modes: renderModes, setup: renderSetup, tokens: renderTokens, settings: renderSettings, history: renderHistory,
                   profile: renderProfile, rewards: renderRewards }[name];
    if (render) render();
  }
  function go(name) { stack.push(current); show(name); }
  function goRoot(name) { stack = []; show(name); }
  function back() {
    if (current === 'game') { openPause(); return; }
    if (current === 'result') { goRoot('home'); return; }
    if (current === 'home' || current === 'splash') return;
    show(stack.length ? stack.pop() : 'home');
  }

  // --------------------------------------------------------------- overlays
  function openModal(html) {
    $('modal').innerHTML = html;
    $('overlay').hidden = false;
    return $('modal');
  }
  function closeModal() { $('overlay').hidden = true; $('modal').innerHTML = ''; }
  function modalOpen() { return !$('overlay').hidden; }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var m = openModal('<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
        '<button class="btn ' + (danger ? 'btn-red' : 'btn-gold') + ' btn-lg" data-r="1">' + esc(okLabel || 'OK') + '</button>' +
        '<button class="btn btn-ghost" data-r="0">Cancel</button>');
      m.onclick = function (e) {
        var b = e.target.closest('[data-r]');
        if (!b) return;
        closeModal();
        resolve(b.getAttribute('data-r') === '1');
      };
    });
  }

  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(timers.toast);
    timers.toast = setTimeout(function () { t.hidden = true; }, ms || 1900);
  }

  function refreshCoins() {
    $('home-coins').textContent = Eco.coins();
    var n = Eco.claimableCount();
    $('home-dot').hidden = n === 0;
    $('tile-dot').hidden = n === 0;
  }

  // ------------------------------------------------------------------ home
  function renderHome() {
    var p = D.getProfile(), st = p.stats;
    $('home-avatar').textContent = p.avatar;
    $('home-name').textContent = p.name;
    $('home-games').textContent = st.games;
    $('home-wins').textContent = st.wins;
    $('home-rate').textContent = st.games ? Math.round(st.wins / st.games * 100) : 0;
    $('home-token-art').innerHTML = B.tokenSvg(settings.tokenStyle || 'pointy', 0);
    refreshCoins();
    var saved = D.getSavedGame();
    $('btn-continue').hidden = !saved;
    if (saved) {
      var sv = saved.state, vr = VARIANTS[sv.variant] ? VARIANTS[sv.variant].label : 'Classic';
      $('continue-info').textContent = (KIND_LABEL[saved.meta.mode] || 'Game') + ' \u00B7 ' + vr + ' \u00B7 ' + sv.seats.length + ' players';
    }
    if (!dailyShown && Eco.dailyBonus().available) {
      dailyShown = true;
      setTimeout(showDailyPopup, 450);
    }
  }

  function showDailyPopup() {
    if (current !== 'home' || modalOpen()) return;
    var d = Eco.dailyBonus();
    var m = openModal('<h3>🎁 Daily Bonus</h3><p>Day ' + d.streak + ' of your login streak.<br>Come back every day for bigger gifts!</p>' +
      '<div class="big-coins"><img src="assets/icons/coin.png" alt="">+' + d.amount + '</div>' +
      '<p class="note">Virtual coins · no real-money value</p>' +
      '<button class="btn btn-gold btn-lg" data-c="1">CLAIM</button><button class="btn btn-ghost" data-c="0">Later</button>');
    m.onclick = function (e) {
      var b = e.target.closest('[data-c]');
      if (!b) return;
      if (b.getAttribute('data-c') === '1') {
        var r = Eco.claimDaily();
        if (r) { A.play('coin'); toast('+' + r.amount + ' coins'); }
      }
      closeModal();
      refreshCoins();
    };
  }

  // ------------------------------------------- mode, players and colour selection
  var KIND_TITLE = { cpu: 'Computer', power: 'Computer', local: 'Local', passplay: 'Pass & Play' };
  var CARD_ORDER = [0, 1, 3, 2];            // board corners: top-left, top-right, bottom-left, bottom-right
  var tokenPreview = null;

  function openKind(kind) {
    var p = D.getProfile();
    setup = { kind: kind, variant: kind === 'power' ? 'power' : 'classic', n: 2, diff: 'medium', name: p.name, roles: ['none', 'none', 'none', 'none'] };
    autoAssign(2);
    go('modes');
  }

  function isCpuKind() { return setup.kind === 'cpu' || setup.kind === 'power'; }
  function activeSeats() { return [0, 1, 2, 3].filter(function (s) { return setup.roles[s] !== 'none'; }); }
  function humanSeatOf() { for (var s = 0; s < 4; s++) if (setup.roles[s] === 'human') return s; return 0; }
  function oppSeats(h, n) { return [(h + 2) % 4, (h + 1) % 4, (h + 3) % 4].slice(0, n); }

  /** Pick a sensible set of colours for n players. */
  function autoAssign(n) {
    setup.n = n;
    var roles = ['none', 'none', 'none', 'none'];
    if (isCpuKind()) {
      var h = setup.roles.indexOf('human'); if (h < 0) h = 0;
      roles[h] = 'human';
      oppSeats(h, n - 1).forEach(function (s) { roles[s] = 'cpu'; });
    } else {
      ({ 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] })[n].forEach(function (s) { roles[s] = 'human'; });
    }
    setup.roles = roles;
  }

  function setupValid() {
    var act = activeSeats();
    if (act.length < 2) return false;
    if (isCpuKind()) {
      var hs = act.filter(function (s) { return setup.roles[s] === 'human'; }).length;
      return hs === 1;
    }
    return true;
  }

  function renderModes() {
    if (!setup) { goRoot('home'); return; }
    Array.prototype.forEach.call(document.querySelectorAll('#variant-list .variant'), function (b) {
      b.classList.toggle('sel', b.getAttribute('data-variant') === setup.variant);
    });
  }

  function renderSetup() {
    if (!setup) { show('home'); return; }
    var body = $('setup-body'), style = settings.tokenStyle || 'pointy', html = '';
    $('setup-title').textContent = KIND_TITLE[setup.kind];
    $('setup-chip').textContent = 'Normal · ' + VARIANTS[setup.variant].label;
    html += '<div class="ribbon">SELECT PLAYERS</div><div class="count-row">';
    [2, 3, 4].forEach(function (n) {
      var seats = ({ 2: [3, 1], 3: [3, 1, 0], 4: [3, 1, 0, 2] })[n];
      html += '<button class="count-card' + (activeSeats().length === n ? ' sel' : '') + '" data-n="' + n + '"><span class="mini">' +
        seats.map(function (s) { return '<span class="mt">' + B.tokenSvg(style, s) + '</span>'; }).join('') + '</span><b>' + n + 'P</b></button>';
    });
    html += '</div><div class="ribbon">SELECT COLOR</div><div class="color-grid">';
    CARD_ORDER.forEach(function (seat) {
      var role = setup.roles[seat];
      html += '<button class="color-card' + (role !== 'none' ? ' on' : '') + '" data-seat="' + seat + '" style="--c:' + COLOR_HEX[seat] + '">' +
        '<span class="cc-token">' + B.tokenSvg(style, seat) + '</span>' +
        '<span class="role role-' + role + '">' + ({ none: 'Nobody', cpu: 'Computer', human: 'Human' })[role] + '</span></button>';
    });
    html += '</div>';
    if (isCpuKind()) {
      html += '<div class="ribbon small">DIFFICULTY</div><div class="seg">';
      [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].forEach(function (d) {
        html += '<button class="' + (setup.diff === d[0] ? 'sel' : '') + '" data-diff="' + d[0] + '">' + d[1] + '</button>';
      });
      html += '</div>';
    }
    html += '<div class="name-row"><label for="cpu-name">Your name</label><input class="name-input" id="cpu-name" maxlength="14" value="' + esc(setup.name) + '"></div>';
    html += '<p class="hint' + (setupValid() ? '' : ' bad') + '" id="setup-hint">' + setupHint() + '</p>';
    body.innerHTML = html;
    $('btn-start-game').disabled = !setupValid();
  }

  function setupHint() {
    var k = activeSeats().length;
    if (k < 2) return 'Choose at least 2 players. Tap a colour to change it.';
    if (isCpuKind()) return setupValid() ? k + ' players: tap a colour to switch Nobody → Computer → Human.' : 'Exactly one colour must be Human.';
    return k + ' players on this device. Tap a colour to add or remove a player.';
  }

  function cycleRole(seat) {
    var r = setup.roles[seat];
    if (isCpuKind()) {
      if (r === 'none') setup.roles[seat] = 'cpu';
      else if (r === 'cpu') {
        for (var q = 0; q < 4; q++) if (setup.roles[q] === 'human') setup.roles[q] = 'cpu';   // only one human
        setup.roles[seat] = 'human';
      } else {
        // human -> nobody; the first computer takes over as the human so a game is always possible
        setup.roles[seat] = 'none';
        var nxt = [0, 1, 2, 3].filter(function (q) { return setup.roles[q] === 'cpu'; })[0];
        if (nxt !== undefined) setup.roles[nxt] = 'human';
      }
    } else {
      setup.roles[seat] = r === 'none' ? 'human' : 'none';
    }
    setup.n = activeSeats().length;
  }

  function startFromSetup() {
    if (!setupValid()) return;
    var rules = D.getSettings().rules, act = activeSeats(), variant = setup.variant;
    var types = {}, names = {}, difficulty = {}, firstHuman = true, nm = (setup.name || '').trim() || 'Player';
    act.forEach(function (s) {
      if (setup.roles[s] === 'cpu') { types[s] = 'cpu'; names[s] = CPU_NAMES[s]; difficulty[s] = setup.diff; }
      else { types[s] = 'human'; names[s] = firstHuman ? nm : 'Player ' + (s + 1); firstHuman = false; }
    });
    var mode = isCpuKind() ? 'cpu' : (setup.kind === 'passplay' ? 'passplay' : 'local' + act.length);
    var first = isCpuKind() ? humanSeatOf() : act[0];
    var config = { mode: mode, variant: variant, seats: act, types: types, names: names, difficulty: difficulty,
                   rules: rules, firstSeat: first, magic: variant === 'power' };
    D.updateProfile({ name: nm });
    launch(config, null);
  }

  // ------------------------------------------------------------ token styles
  function renderTokens() {
    var cur = settings.tokenStyle || 'pointy';
    if (!tokenPreview) tokenPreview = cur;
    var stage = [2, 1, 0, 3].map(function (s) { return '<span class="ts-tok">' + B.tokenSvg(tokenPreview, s) + '</span>'; }).join('');
    $('tok-stage').innerHTML = '<div class="ts-plat"></div><div class="ts-row">' + stage + '</div>';
    var label = B.TOKEN_STYLES.filter(function (t) { return t.id === tokenPreview; })[0];
    $('tok-name').textContent = label ? label.label : tokenPreview;
    $('tok-grid').innerHTML = B.TOKEN_STYLES.map(function (t) {
      return '<button class="tok-card' + (t.id === tokenPreview ? ' sel' : '') + '" data-tok="' + t.id + '">' +
        (t.id === cur ? '<i class="tick">✓</i>' : '') +
        '<span class="tc-grid">' + [2, 1, 0, 3].map(function (s) { return '<span>' + B.tokenSvg(t.id, s) + '</span>'; }).join('') + '</span>' +
        '<b>' + t.label + '</b></button>';
    }).join('');
    var eq = $('btn-equip');
    eq.disabled = tokenPreview === cur;
    eq.textContent = tokenPreview === cur ? 'Equipped ✓' : 'Equip';
  }

  // -------------------------------------------------------------------- game
  function ensureController() {
    if (ctrl) return;
    var view = new B.BoardView($('board'));
    ctrl = new LudoController({
      view: view, audio: A,
      getSettings: function () { return settings; },
      ui: {
        onGameStart: onGameStart, onTurn: onTurn, setRollEnabled: setRollEnabled, onTimer: onTimer, onClock: onClock,
        animateDice: animateDice, showDice: showDice, message: message, onStateChanged: onStateChanged,
        confirmHandOff: confirmHandOff, save: function (snap) { D.saveGame(snap); },
        onEvent: onEvent, onGameOver: onGameOver,
        onError: function (e) { toast('Error: ' + (e && e.message ? e.message : e), 4000); if (window.console) console.error(e); }
      }
    });
    window.LudoApp = { controller: ctrl, applySetting: applySetting };
  }

  function launch(config, snapshot) {
    ensureController();
    closeModal();
    lastConfig = config || (snapshot && snapshot.meta && snapshot.meta.config) || null;
    stack = ['home'];
    show('game');
    A.startMusic();
    if (snapshot) {
      if (!ctrl.resume(snapshot)) { toast('Saved game could not be restored'); D.clearSavedGame(); goRoot('home'); }
    } else {
      D.clearSavedGame();
      ctrl.start(config);
    }
  }

  // ---- holders: every player has a dice box beside the board
  var BG_COLORS = ['#8a1f2e', '#1f7a3c', '#b3720c', '#1b4fa8'];
  var diceFlying = false;

  function avatarFor(seat, s) {
    var p = s.players[seat];
    if (p.type === 'cpu') return '🤖';
    return seat === (ctrl && ctrl.meta ? ctrl.meta.ownerSeat : 0) ? D.getProfile().avatar : SEAT_AVATARS[seat];
  }
  function holderEl(seat) { return document.querySelector('#screen-game .holder[data-seat="' + seat + '"]'); }
  function boxEl(seat) { var h = holderEl(seat); return h && h.querySelector('.hold-box'); }
  function pipsHtml(v) { return '<span class="pips p' + v + '"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>'; }

  function buildHolders(s) {
    [0, 1, 2, 3].forEach(function (seat) {
      var h = holderEl(seat), left = seat === 0 || seat === 3;
      var on = s.seats.indexOf(seat) !== -1;
      h.classList.toggle('off', !on);
      h.style.setProperty('--c', COLOR_HEX[seat]);
      if (!on) { h.innerHTML = ''; return; }
      var stats = '<span class="hold-stats"><span class="hs" title="Captures">⚔ <b class="k">0</b></span><span class="hs" title="Pawns lost">💀 <b class="l">0</b></span></span>';
      var box = '<span class="hold-ring"><button class="hold-box" data-seat="' + seat + '" aria-label="' + esc(s.players[seat].name) + ' dice">' +
        '<span class="hb-face">' + avatarFor(seat, s) + '</span><span class="hb-pips"></span>' +
        '<span class="hb-timer" hidden><b>10</b></span></button></span><span class="hold-hand">👆</span>';
      h.innerHTML = left ? stats + box : box + stats;
    });
  }

  function resetHolders(s) {
    s.seats.forEach(function (seat) {
      var b = boxEl(seat);
      if (!b) return;
      b.classList.remove('ready', 'cur');
      holderEl(seat).classList.remove('cur', 'ready');
      if (seat === s.current) {            // a new turn starts: show the avatar again
        b.classList.remove('rolled');
        b.querySelector('.hb-pips').innerHTML = '';
      }
    });
  }

  function onGameStart(info) {
    var s = info.state, v = VARIANTS[s.variant] || VARIANTS.classic;
    $('game-mode').textContent = KIND_LABEL[info.meta.mode] || 'Ludo';
    $('game-variant').textContent = v.label;
    buildHolders(s);
    pickKind = null;
    sizeDice();
    $('spell-bar').hidden = !s.magic;
    $('dice-spot').hidden = true;
    message('Get ready!', s.current);
    onTurn({ seat: s.current, state: s });
    updateStrip(s);
    onClock(s.variant === 'timed' ? { left: Math.max(0, s.timeLimitMs - s.timeUsedMs), total: s.timeLimitMs } : null);
  }

  function updateStrip(s) {
    s.seats.forEach(function (seat) {
      var h = holderEl(seat);
      if (!h) return;
      var k = h.querySelector('.k'), l = h.querySelector('.l');
      if (k) k.textContent = s.kills[seat];
      if (l) l.textContent = s.lost ? s.lost[seat] : 0;
    });
    updateSpells(s);
    var v = VARIANTS[s.variant] || VARIANTS.classic;
    if (s.variant !== 'timed') {
      $('goal-main').textContent = v.icon + ' ' + v.label;
      $('goal-sub').textContent = v.goal + ' · Turn ' + s.turn;
    } else {
      $('goal-sub').textContent = 'Top score wins · Turn ' + s.turn;
    }
  }

  function onClock(c) {
    if (!c) return;
    var sec = Math.ceil(c.left / 1000);
    $('goal-main').textContent = '⏱ ' + Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
    $('goal-main').classList.toggle('warn', sec <= 30);
  }

  function onTurn(info) {
    var seat = info.seat, s = info.state || ctrl.state;
    $('game-bg').style.background = BG_COLORS[seat];
    $('dice').style.setProperty('--dc', COLOR_HEX[seat]);
    if (pickKind) pickKind = null;
    resetHolders(s);
    var h = holderEl(seat);
    if (h) h.classList.add('cur');
    var b = boxEl(seat);
    if (b) b.classList.add('cur');
    updateStrip(s);
  }
  function onStateChanged(s) { updateStrip(s); }
  function setRollEnabled(on) {
    var s = ctrl && ctrl.state;
    if (s) {
      var h = holderEl(s.current), b = boxEl(s.current);
      if (b) b.classList.toggle('ready', !!on);
      if (h) h.classList.toggle('ready', !!on);
    }
    if (!on && pickKind) pickKind = null;
    if (ctrl && ctrl.state) updateSpells(ctrl.state);
  }

  // ---- the 3D dice leaves the holder, tumbles over the middle of the board and flies back
  var diceAngle = { x: 0, y: 0 };
  var DICE_FACE = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, 180] };
  function sizeDice() { /* the cube is sized when it is launched */ }
  function setDiceFace(v, spins) {
    var d = $('dice'), f = DICE_FACE[v] || DICE_FACE[1];
    var x = f[0], y = f[1];
    if (spins) {
      x += 360 * (Math.ceil((diceAngle.x + 360 * spins - f[0]) / 360));
      y += 360 * (Math.ceil((diceAngle.y + 360 * (spins + 1) - f[1]) / 360));
    } else {
      x += 360 * Math.round((diceAngle.x - f[0]) / 360);
      y += 360 * Math.round((diceAngle.y - f[1]) / 360);
    }
    diceAngle = { x: x, y: y };
    d.style.transform = 'rotateX(' + x + 'deg) rotateY(' + y + 'deg)';
    d.setAttribute('data-v', String(v));
  }
  function showDice(v) {
    var d = $('dice');
    d.classList.add('instant');
    setDiceFace(v, 0);
    void d.offsetWidth;
    d.classList.remove('instant');
  }

  function onTimer(t) {
    var s = ctrl && ctrl.state;
    [0, 1, 2, 3].forEach(function (seat) {
      var b = boxEl(seat);
      if (!b) return;
      var tm = b.querySelector('.hb-timer');
      var ring = b.parentNode;
      if (!t || t.seat !== seat) { tm.hidden = true; ring.style.removeProperty('--p'); return; }
      tm.hidden = false;
      tm.querySelector('b').textContent = String(Math.max(0, Math.ceil(t.left - 0.0001)));
      ring.style.setProperty('--p', String(Math.max(0, t.left / t.total) * 360) + 'deg');
      tm.classList.toggle('warn', t.left <= 3);
    });
  }

  // ---- magic spells
  var pickKind = null;
  function updateSpells(s) {
    var bar = $('spell-bar');
    if (!s || !s.magic) { bar.hidden = true; return; }
    bar.hidden = false;
    var seat = s.players[s.current].type === 'human' ? s.current : (ctrl.meta ? ctrl.meta.ownerSeat : s.current);
    var ch = s.magic.charges[seat];
    ['dice', 'shield', 'blast'].forEach(function (k) {
      var b = bar.querySelector('[data-spell="' + k + '"]');
      b.querySelector('em').textContent = String(ch[k]);
      b.disabled = !(ctrl && ctrl.canCast(k));
      b.classList.toggle('on', ctrl && ctrl.pickMode() === k);
    });
  }

  function openDicePick() {
    ctrl.pause();
    var html = '<h3>🎯 Pick Dice</h3><p>Choose the number you want to roll.</p><div class="dice-pick">';
    for (var i = 1; i <= 6; i++) html += '<button class="btn btn-gold" data-n="' + i + '">' + i + '</button>';
    html += '</div><button class="btn btn-ghost" data-n="0">Cancel</button>';
    var m = openModal(html);
    m.onclick = function (e) {
      var b = e.target.closest('[data-n]');
      if (!b) return;
      var n = Number(b.getAttribute('data-n'));
      closeModal();
      ctrl.unpause();
      if (n) ctrl.requestMagicDice(n);
    };
  }

  function onSpellButton(kind) {
    if (!ctrl) return;
    if (kind === 'dice') { if (ctrl.canCast('dice')) openDicePick(); return; }
    if (ctrl.pickMode() === kind) { ctrl.cancelPick(); message('Spell cancelled', ctrl.state.current); updateSpells(ctrl.state); return; }
    ctrl.cancelPick();
    if (ctrl.beginPick(kind)) {
      message(kind === 'shield' ? '🛡️ Tap one of your tokens to shield it' : '💥 Tap an opponent token to blast it', ctrl.state.current);
      updateSpells(ctrl.state);
    } else {
      toast(kind === 'shield' ? 'No token on the track to shield' : 'No unprotected opponent token to blast', 1500);
    }
  }
  function message(text, seat) {
    var el = $('status-line');
    el.textContent = text;
    el.style.color = seat !== undefined && seat !== null ? ['#ffd0d0', '#d0ffd0', '#fff6c0', '#d0e4ff'][seat] : '';
  }

  function relRect(el, root) {
    var r = el.getBoundingClientRect(), g = root.getBoundingClientRect();
    return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2, w: r.width, h: r.height };
  }

  function animateDice(seat, value) {
    return new Promise(function (resolve) {
      var spot = $('dice-spot'), game = $('screen-game'), box = boxEl(seat);
      if (!box) { setDiceFace(value, 2); setTimeout(resolve, 600); return; }
      var from = relRect(box, game), to = relRect($('board'), game);
      var size = Math.round(Math.min(from.w, from.h) * 0.8), big = Math.min(to.w * 0.2, 96) / size;
      var sx = from.x - size / 2, sy = from.y - size / 2, ex = to.x - size / 2, ey = to.y - size / 2;
      diceFlying = true;
      spot.hidden = false;
      spot.className = 'dice-fly';
      spot.style.width = spot.style.height = size + 'px';
      spot.style.setProperty('--half', (size / 2) + 'px');
      spot.style.setProperty('--dc', COLOR_HEX[seat]);
      spot.style.transition = 'none';
      spot.style.transform = 'translate(' + sx + 'px,' + sy + 'px) scale(1)';
      box.classList.add('away');
      box.classList.remove('ready');
      void spot.offsetWidth;
      spot.style.transition = 'transform .42s cubic-bezier(.2,.8,.25,1.15)';
      spot.style.transform = 'translate(' + ex + 'px,' + ey + 'px) scale(' + big.toFixed(2) + ')';
      setDiceFace(value, 3);                                   // tumbles on the way and over the board
      setTimeout(function () {
        spot.classList.add('landed');
        if (value === 6) spot.classList.add('six');
      }, 900);
      setTimeout(function () { resolve(); }, 1180);
      setTimeout(function () {                                  // fly back and show the number in the holder
        spot.style.transition = 'transform .34s cubic-bezier(.5,0,.7,.4)';
        spot.style.transform = 'translate(' + sx + 'px,' + sy + 'px) scale(1)';
      }, 1200);
      setTimeout(function () {
        spot.hidden = true;
        spot.className = 'dice-fly';
        box.classList.remove('away');
        box.classList.add('rolled');
        box.querySelector('.hb-pips').innerHTML = pipsHtml(value);
        diceFlying = false;
      }, 1560);
    });
  }

  function confirmHandOff(info) {
    return new Promise(function (resolve) {
      var m = openModal('<div class="handoff-dot" style="--c:' + COLOR_HEX[info.seat] + '"></div><h3>' + esc(info.name) + '\'s turn</h3>' +
        '<p>Pass the phone to <b>' + esc(info.name) + '</b> (' + COLOR_NAME[info.seat] + ').</p>' +
        '<button class="btn btn-gold btn-lg" data-ok="1">I\'m ready</button>');
      m.onclick = function (e) {
        if (!e.target.closest('[data-ok]')) return;
        closeModal();
        resolve();
      };
    });
  }

  function onEvent(evt) {
    var owner = ctrl && ctrl.meta ? ctrl.meta.ownerSeat : 0;
    if (evt.type === 'capture') {
      toast('💥 Captured ' + evt.count + (evt.count > 1 ? ' tokens!' : ' token!'), 1400);
      if (evt.seat === owner) Eco.track('capture', evt.count);
    } else if (evt.type === 'six') {
      if (evt.seat === owner) Eco.track('six', 1);
    } else if (evt.type === 'homeUnlocked') {
      toast(evt.human ? '🔓 Home lane opened - your tokens can go home!' : '🔓 Home lane opened', 1800);
    } else if (evt.type === 'timeout') {
      toast('⏱ Time up!', 1200);
    } else if (evt.type === 'magic') {
      if (evt.kind === 'earned') toast('✨ New spell earned', 1400);
      else toast('🪄 ' + ({ dice: 'Pick Dice', shield: 'Shield', blast: 'Blast' })[evt.kind], 1100);
    } else if (evt.type === 'tokenHome') {
      toast('🏠 Token reached home!', 1400);
      if (evt.seat === owner) Eco.track('token_home', 1);
    }
  }

  // --------------------------------------------------------------- pause menu
  function openPause() {
    if (!ctrl || current !== 'game') return;
    if (modalOpen()) { return; }
    ctrl.pause();
    var m = openModal('<h3>Game Paused</h3>' +
      '<button class="btn btn-gold btn-lg" data-a="resume">▶ Resume</button>' +
      '<button class="btn btn-blue" data-a="restart">↻ Restart game</button>' +
      '<button class="btn btn-ghost" data-a="sound">' + (settings.sound ? '🔊 Sound: On' : '🔇 Sound: Off') + '</button>' +
      '<button class="btn btn-ghost" data-a="music">' + (settings.music ? '🎵 Music: On' : '🔇 Music: Off') + '</button>' +
      '<button class="btn btn-ghost" data-a="save">💾 Save &amp; exit</button>' +
      '<button class="btn btn-red" data-a="quit">✖ Quit without saving</button>');
    m.onclick = function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'resume') { closeModal(); ctrl.unpause(); }
      else if (a === 'sound') { applySetting({ sound: !settings.sound }); closeModal(); ctrl.unpause(); openPause(); }
      else if (a === 'music') { applySetting({ music: !settings.music }); closeModal(); ctrl.unpause(); openPause(); }
      else if (a === 'restart') {
        closeModal();
        confirmBox('Restart game?', 'The current game will be lost and a new one starts.', 'Restart', true).then(function (ok) {
          if (ok) { D.clearSavedGame(); ctrl.unpause(); ctrl.restart(); } else { openPause(); }
        });
      } else if (a === 'save') {
        var snap = ctrl.snapshotNow();
        if (snap) D.saveGame(snap);
        closeModal(); ctrl.destroy(); A.stopMusic(); toast('Game saved');
        goRoot('home');
      } else if (a === 'quit') {
        closeModal();
        confirmBox('Quit game?', 'Your progress in this game will be lost.', 'Quit', true).then(function (ok) {
          if (ok) { ctrl.destroy(); D.clearSavedGame(); A.stopMusic(); goRoot('home'); } else { openPause(); }
        });
      }
    };
  }

  // ------------------------------------------------------------------ results
  function onGameOver(sum) {
    var owner = sum.ownerSeat;
    var won = sum.winnerSeat === owner;
    var st = sum.stats;
    var cpuSeats = sum.players.filter(function (p) { return p.type === 'cpu'; });
    var vsCpu = sum.mode === 'cpu' || sum.mode === 'magic';
    var diff = cpuSeats.length ? cpuSeats[0].difficulty : null;
    D.recordGame({ won: won, captures: st.captures[owner], sixes: st.sixes[owner], tokensHome: st.homeTokens[owner] });
    var reward = Eco.awardGame({ won: won, captures: st.captures[owner], vsCpu: vsCpu, difficulty: diff });
    var winner = sum.players.filter(function (p) { return p.seat === sum.winnerSeat; })[0];
    D.addHistory({
      t: Date.now(), mode: sum.mode, variant: sum.variant || 'classic', winnerSeat: sum.winnerSeat, winnerName: winner.name, ownerWon: won,
      ownerName: sum.players.filter(function (p) { return p.seat === owner; })[0].name,
      players: sum.players.map(function (p) { return { name: p.name, seat: p.seat, finished: p.finished, cpu: p.type === 'cpu' }; }),
      durationMs: sum.durationMs, turns: sum.turns, coins: reward.coins
    });
    D.clearSavedGame();

    $('res-title').textContent = (vsCpu ? (won ? 'Victory!' : 'Defeat') : winner.name + ' wins!');
    var vr = VARIANTS[sum.variant] || VARIANTS.classic;
    var how = ({ classic: 'completed all four tokens', power: 'completed all four tokens', timed: 'had the top score', quick: 'captured and got home first', deathmatch: 'won the Deathmatch' })[sum.variant || 'classic'];
    $('res-sub').textContent = vr.label + ' \u00B7 ' + (vsCpu ? winner.name + ' (' + COLOR_NAME[winner.seat] + ') won this match' : COLOR_NAME[winner.seat] + ' ' + how) +
      ' \u00B7 ' + fmtDur(sum.durationMs) + ' \u00B7 ' + sum.turns + ' turns';
    var medals = ['🥇', '🥈', '🥉', '4️⃣'];
    $('res-ranks').innerHTML = '<h3 style="margin:0 0 6px;color:var(--gold-2)">Final ranking</h3>' + sum.rankings.map(function (seat, i) {
      var p = sum.players.filter(function (x) { return x.seat === seat; })[0];
      return '<div class="rank-row" style="--c:' + COLOR_HEX[seat] + '"><span class="rank-no">' + medals[i] + '</span><span class="rank-dot"></span>' +
        '<b style="flex:1">' + (p.type === 'cpu' ? '🤖 ' : '') + esc(p.name) + '</b><small>🏠 ' + p.finished + '/4 · ⚔ ' + st.captures[seat] + (sum.variant === 'timed' ? ' · ' + sum.scores[seat] + ' pts' : '') + '</small></div>';
    }).join('');
    $('res-reward').innerHTML = '<h3 style="margin:0 0 6px;color:var(--gold-2)">Rewards for ' + esc(sum.players.filter(function (p) { return p.seat === owner; })[0].name) + '</h3>' +
      reward.breakdown.map(function (b) { return '<div class="row"><span class="grow">' + esc(b.label) + '</span><b class="tx-amount">+' + b.coins + ' 🪙</b></div>'; }).join('') +
      '<div class="row"><span class="grow">Experience</span><b class="tx-amount">+' + reward.xp + ' XP</b></div>' +
      (reward.levelUp ? '<div class="row"><span class="grow">⬆ Level ' + reward.levelUp.to + ' reached!</span><b class="tx-amount">+' + reward.levelUp.bonus + ' 🪙</b></div>' : '') +
      '<p class="note" style="margin:8px 0 0">Coins are virtual and have no monetary value.</p>';
    ctrl.destroy();
    A.stopMusic();
    $('toast').hidden = true;
    stack = ['home'];
    show('result');
    confetti(won || !vsCpu);
    if (reward.coins) setTimeout(function () { A.play('coin'); }, 700);
  }

  function confetti(on) {
    var c = $('confetti');
    c.innerHTML = '';
    if (!on) return;
    var cols = COLOR_HEX.concat(['#ffd23c', '#ffffff']);
    for (var i = 0; i < 60; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = 2.2 + Math.random() * 2.4 + 's';
      p.style.animationDelay = Math.random() * 1.2 + 's';
      p.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      c.appendChild(p);
    }
  }

  // ----------------------------------------------------------------- settings
  function applySetting(patch) {
    settings = D.setSettings(patch);
    A.setSound(settings.sound);
    A.setMusic(settings.music);
  }

  function renderSettings() {
    var s = settings, r = s.rules;
    function sw(key, on, label, sub) {
      return '<div class="row"><div class="grow"><span class="setting-title">' + label + '</span>' + (sub ? '<br><small>' + sub + '</small>' : '') + '</div>' +
        '<button class="switch ' + (on ? 'on' : '') + '" data-set="' + key + '" aria-label="' + label + '"></button></div>';
    }
    $('settings-body').innerHTML =
      '<div class="card"><h3>Audio &amp; feel</h3>' +
      sw('sound', s.sound, 'Sound effects', 'Dice, moves, captures, buttons') +
      sw('music', s.music, 'Background music') +
      sw('vibration', s.vibration, 'Vibration', 'On captures and wins') +
      sw('autoMove', s.autoMove, 'Auto-move', 'Play automatically when only one move is possible') +
      '<div class="row"><div class="grow"><span class="setting-title">Game speed</span></div><div class="pick-row" style="flex:none">' +
      ['normal', 'fast'].map(function (v) { return '<button class="pick' + (s.speed === v ? ' sel' : '') + '" data-speed="' + v + '">' + v[0].toUpperCase() + v.slice(1) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="row"><div class="grow"><span class="setting-title">Turn timer</span><br><small>Seconds to roll or move before the turn passes</small></div><div class="pick-row" style="flex:none">' +
      [[0, 'Off'], [10, '10s'], [15, '15s'], [20, '20s']].map(function (v) { return '<button class="pick' + (s.turnTimer === v[0] ? ' sel' : '') + '" data-timer="' + v[0] + '">' + v[1] + '</button>'; }).join('') +
      '</div></div></div>' +
      '<div class="card"><h3>Classic rules <small style="color:var(--muted)">(apply to new games)</small></h3>' +
      sw('r.sixToStart', r.sixToStart, 'Six to leave base') +
      sw('r.extraTurnOnSix', r.extraTurnOnSix, 'Extra turn on a six') +
      sw('r.extraTurnOnCapture', r.extraTurnOnCapture, 'Extra turn on capture') +
      sw('r.extraTurnOnFinish', r.extraTurnOnFinish, 'Extra turn when a token reaches home') +
      sw('r.threeSixesForfeit', r.threeSixesForfeit, 'Three sixes lose the turn') +
      sw('r.safeSquares', r.safeSquares, 'Safe squares', 'Star and start cells cannot be captured on') +
      sw('r.exactFinish', r.exactFinish, 'Exact roll to finish') +
      sw('r.killToEnterHome', r.killToEnterHome, 'Capture to open home', 'Tokens keep circling the board until you have captured an opponent') +
      '<div class="row"><button class="btn btn-ghost mini-btn" id="rules-default">Restore classic defaults</button></div></div>' +
      '<div class="card"><h3>Data</h3><button class="btn btn-red mini-btn" id="reset-all">Reset all progress</button>' +
      '<p class="note" style="margin-top:8px">Deletes coins, statistics, history and saved game from this device.</p></div>' +
      '<div class="card"><h3>About</h3><div class="row"><div class="grow"><b>Ludo Pro</b><small>Version 1.0.0</small></div></div>' +
      '<p class="note">Developed by <b style="color:var(--gold-2)">Sanaullah Khoso</b>.<br>Ludo Pro is a free game. Coins are virtual rewards with no monetary value. There is no gambling, betting, real-money purchase, deposit or withdrawal.</p></div>';
  }

  // ------------------------------------------------------------------ history
  function renderHistory() {
    var h = D.getHistory();
    if (!h.length) {
      $('history-body').innerHTML = '<div class="card" style="text-align:center"><div style="font-size:48px">📜</div><p class="note">No games played yet.<br>Finished games appear here.</p></div>';
      return;
    }
    $('history-body').innerHTML = h.map(function (g) {
      return '<div class="card"><div class="row" style="padding-top:0"><div class="grow"><b>' + esc(MODE_LABEL[g.mode] || g.mode) + (g.variant && VARIANTS[g.variant] && g.variant !== 'classic' ? ' \u00B7 ' + VARIANTS[g.variant].label : '') + '</b><small>' + fmtDate(g.t) + ' · ' + fmtDur(g.durationMs) + ' · ' + g.turns + ' turns</small></div>' +
        '<span class="badge ' + (g.ownerWon ? 'win' : 'loss') + '">' + (g.ownerWon ? 'WIN' : 'LOSS') + '</span></div>' +
        '<div class="note">🏆 ' + esc(g.winnerName) + ' &nbsp;·&nbsp; ' + g.players.map(function (p) { return '<span style="color:' + COLOR_HEX[p.seat] + '">●</span> ' + esc(p.name) + ' ' + p.finished + '/4'; }).join(' &nbsp; ') +
        '</div><div class="note">+' + (g.coins || 0) + ' 🪙</div></div>';
    }).join('');
  }

  // ------------------------------------------------------------------ profile
  function renderProfile() {
    var p = D.getProfile(), st = p.stats, lv = Eco.levelInfo();
    var rate = st.games ? Math.round(st.wins / st.games * 100) : 0;
    $('profile-body').innerHTML =
      '<div class="card" style="text-align:center"><div class="avatar" style="width:84px;height:84px;font-size:46px;margin:0 auto 10px" id="prof-av">' + p.avatar + '</div>' +
      '<input class="name-input" id="prof-name" maxlength="14" value="' + esc(p.name) + '" aria-label="Player name">' +
      '<div class="avatar-grid">' + AVATARS.map(function (a) { return '<button data-av="' + a + '" class="' + (a === p.avatar ? 'sel' : '') + '">' + a + '</button>'; }).join('') + '</div></div>' +
      '<div class="card"><h3>Level ' + lv.level + '</h3><div class="bar"><span style="width:' + lv.pct + '%"></span></div>' +
      '<p class="note" style="margin:6px 0 0">' + lv.xp + ' / ' + lv.need + ' XP to next level</p></div>' +
      '<div class="card"><h3>Statistics</h3><div class="stats-grid">' +
      [['Games', st.games], ['Wins', st.wins], ['Losses', st.losses], ['Win rate', rate + '%'], ['Best streak', st.bestStreak], ['Captures', st.captures],
       ['Sixes', st.sixes], ['Tokens home', st.tokensHome], ['Coins', Eco.coins()]].map(function (x) {
        return '<div class="stat"><b>' + x[1] + '</b><small>' + x[0] + '</small></div>'; }).join('') + '</div></div>';
  }

  // ------------------------------------------------------------------ rewards
  function fmtLeft(ms) {
    var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + 'h ' : '') + m + 'm ' + (sec < 10 ? '0' : '') + sec + 's';
  }

  function renderRewards() {
    var d = Eco.dailyBonus(), f = Eco.freeCoins(), lv = Eco.levelInfo(), ms = Eco.missions(), hist = Eco.coinHistory(30);
    var html =
      '<div class="card" style="text-align:center"><div class="big-coins"><img src="assets/icons/coin.png" alt=""><span>' + Eco.coins() + '</span></div>' +
      '<p class="note" style="margin:4px 0 10px">Level ' + lv.level + ' · ' + lv.xp + '/' + lv.need + ' XP</p><div class="bar"><span style="width:' + lv.pct + '%"></span></div></div>' +
      '<div class="card"><h3>🎁 Daily login bonus</h3><div class="row" style="border:0"><div class="grow"><b>' + (d.available ? '+' + d.amount + ' coins' : 'Claimed today') + '</b>' +
      '<small>Streak: ' + d.streak + ' day' + (d.streak === 1 ? '' : 's') + (d.available ? '' : ' · tomorrow +' + d.nextAmount) + '</small></div>' +
      '<button class="btn btn-gold mini-btn" id="claim-daily"' + (d.available ? '' : ' disabled') + '>' + (d.available ? 'CLAIM' : '✓') + '</button></div></div>' +
      '<div class="card"><h3>🪙 Free coins</h3><div class="row" style="border:0"><div class="grow"><b>+' + f.amount + ' coins</b><small id="free-left">' + (f.available ? 'Ready to collect' : 'Next in ' + fmtLeft(f.msLeft)) + '</small></div>' +
      '<button class="btn btn-gold mini-btn" id="claim-free"' + (f.available ? '' : ' disabled') + '>COLLECT</button></div></div>' +
      '<div class="card"><h3>🎯 Daily missions</h3>' + ms.map(function (m) {
        return '<div class="row"><div class="grow"><b>' + esc(m.title) + '</b><small>' + m.progress + ' / ' + m.target + ' · reward ' + m.reward + ' 🪙</small>' +
          '<div class="bar mission-bar"><span style="width:' + Math.round(m.progress / m.target * 100) + '%"></span></div></div>' +
          '<button class="btn btn-gold mini-btn" data-claim="' + m.id + '"' + (m.done && !m.claimed ? '' : ' disabled') + '>' + (m.claimed ? '✓' : 'CLAIM') + '</button></div>';
      }).join('') + '<p class="note" style="margin:8px 0 0">New missions every day.</p></div>' +
      '<div class="card"><h3>Coin history</h3>' + hist.map(function (t) {
        return '<div class="row"><div class="grow"><b>' + esc(t.reason) + '</b><small>' + fmtDate(t.t) + '</small></div><span class="tx-amount">+' + t.amount + '</span></div>';
      }).join('') + '</div>' +
      '<p class="disclaimer">Coins are virtual game points with no monetary value. They cannot be bought, sold, wagered, deposited or withdrawn. Ludo Pro contains no gambling or betting.</p>';
    $('rewards-body').innerHTML = html;
    if (!f.available) {
      timers.rewards = setInterval(function () {
        var ff = Eco.freeCoins();
        if (current !== 'rewards') return;
        if (ff.available) { renderRewards(); return; }
        var el = $('free-left');
        if (el) el.textContent = 'Next in ' + fmtLeft(ff.msLeft);
      }, 1000);
    }
  }

  // ------------------------------------------------------------ event wiring
  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('button, .pick, .switch, .swatch, .variant, .big-tile, .small-tile, .count-card, .color-card, .tok-card, .bottom-nav button') && !t.closest('.hold-box') && !t.closest('.token')) A.play('click');
    }, true);

    document.addEventListener('click', function (e) {
      var go_ = e.target.closest('[data-go]');
      if (go_) { go(go_.getAttribute('data-go')); return; }
      if (e.target.closest('[data-back]')) { back(); return; }
      var mode = e.target.closest('[data-mode]');
      if (mode) { openSetup(mode.getAttribute('data-mode')); }
    });

    $('btn-continue').onclick = function () {
      var g = D.getSavedGame();
      if (g) launch(null, g);
    };
    $('btn-start-game').onclick = startFromSetup;
    $('btn-pause').onclick = openPause;
    $('btn-snd').onclick = function () {
      applySetting({ sound: !settings.sound, music: !settings.sound });
      $('btn-snd').textContent = settings.sound ? '🔊' : '🔇';
    };
    $('btn-back').onclick = openPause;
    $('btn-quit').onclick = function () {
      if (!ctrl || current !== 'game') return;
      ctrl.pause();
      confirmBox('Quit game?', 'Your progress in this game will be lost.', 'Quit', true).then(function (ok) {
        if (ok) { ctrl.destroy(); D.clearSavedGame(); A.stopMusic(); goRoot('home'); } else { ctrl.unpause(); }
      });
    };
    document.addEventListener('click', function (e) {
      var kind = e.target.closest('[data-kind]');
      if (kind) { openKind(kind.getAttribute('data-kind')); return; }
      var hb = e.target.closest('#screen-game .hold-box');
      if (hb && ctrl && Number(hb.getAttribute('data-seat')) === ctrl.state.current) ctrl.requestRoll();
    });
    $('variant-list').addEventListener('click', function (e) {
      var info = e.target.closest('[data-info]');
      if (info) {
        var v = VARIANTS[info.getAttribute('data-info')];
        var m = openModal('<h3>' + v.icon + ' ' + esc(v.label) + '</h3><p>' + esc(v.info) + '</p><button class="btn btn-gold btn-lg" data-x="1">OK</button>');
        m.onclick = function (ev) { if (ev.target.closest('[data-x]')) closeModal(); };
        return;
      }
      var b = e.target.closest('[data-variant]');
      if (b && setup) { setup.variant = b.getAttribute('data-variant'); renderModes(); }
    });
    $('btn-variant-play').onclick = function () { if (setup) go('setup'); };
    $('tok-grid').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tok]');
      if (t) { tokenPreview = t.getAttribute('data-tok'); renderTokens(); }
    });
    $('btn-equip').onclick = function () {
      applySetting({ tokenStyle: tokenPreview });
      renderTokens();
      toast('Token style equipped', 1300);
    };
    $('spell-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-spell]');
      if (b && !b.disabled) onSpellButton(b.getAttribute('data-spell'));
    });
    $('res-again').onclick = function () {
      if (!ctrl || !ctrl.config) { goRoot('home'); return; }
      stack = ['home'];
      show('game');
      A.startMusic();
      D.clearSavedGame();
      ctrl.restart();
    };
    $('res-menu').onclick = function () { goRoot('home'); };
    $('btn-clear-history').onclick = function () {
      confirmBox('Clear history?', 'All finished games will be removed from the list.', 'Clear', true).then(function (ok) {
        if (ok) { D.clearHistory(); renderHistory(); }
      });
    };

    // setup interactions
    $('setup-body').addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-n]'))) { autoAssign(Number(t.getAttribute('data-n'))); renderSetup(); }
      else if ((t = e.target.closest('[data-seat]'))) { cycleRole(Number(t.getAttribute('data-seat'))); renderSetup(); }
      else if ((t = e.target.closest('[data-diff]'))) { setup.diff = t.getAttribute('data-diff'); renderSetup(); }
    });
    $('setup-body').addEventListener('input', function (e) {
      if (e.target.id === 'cpu-name') setup.name = e.target.value;
    });

    // settings interactions
    $('settings-body').addEventListener('click', function (e) {
      var t = e.target.closest('[data-set]');
      if (t) {
        var key = t.getAttribute('data-set');
        if (key.indexOf('r.') === 0) {
          var rules = {}; rules[key.slice(2)] = !settings.rules[key.slice(2)];
          applySetting({ rules: rules });
        } else {
          var patch = {}; patch[key] = !settings[key];
          applySetting(patch);
        }
        renderSettings();
        return;
      }
      if ((t = e.target.closest('[data-timer]'))) { applySetting({ turnTimer: Number(t.getAttribute('data-timer')) }); renderSettings(); return; }
      if ((t = e.target.closest('[data-speed]'))) { applySetting({ speed: t.getAttribute('data-speed') }); renderSettings(); return; }
      if (e.target.id === 'rules-default') { applySetting({ rules: D.DEFAULT_SETTINGS.rules }); renderSettings(); toast('Classic rules restored'); return; }
      if (e.target.id === 'reset-all') {
        confirmBox('Reset all progress?', 'Coins, level, statistics, history and any saved game will be deleted.', 'Reset', true).then(function (ok) {
          if (!ok) return;
          D.resetAll(); Eco.reset(); settings = D.getSettings(); dailyShown = false;
          applySetting({});
          toast('Progress reset'); goRoot('home');
        });
      }
    });

    // profile interactions
    $('profile-body').addEventListener('click', function (e) {
      var t = e.target.closest('[data-av]');
      if (!t) return;
      D.updateProfile({ avatar: t.getAttribute('data-av') });
      renderProfile();
    });
    $('profile-body').addEventListener('change', function (e) {
      if (e.target.id === 'prof-name') { D.updateProfile({ name: e.target.value }); renderProfile(); toast('Name saved'); }
    });

    // rewards interactions
    $('rewards-body').addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'claim-daily') { var r = Eco.claimDaily(); if (r) { A.play('coin'); toast('+' + r.amount + ' coins'); } renderRewards(); }
      else if (t.id === 'claim-free') { var f = Eco.claimFree(); if (f) { A.play('coin'); toast('+' + f.amount + ' coins'); } renderRewards(); }
      else if (t.hasAttribute('data-claim')) {
        var c = Eco.claimMission(t.getAttribute('data-claim'));
        if (c) { A.play('coin'); toast('+' + c.amount + ' coins'); }
        renderRewards();
      }
    });
  }

  // --------------------------------------------------- lifecycle / android
  function saveIfPlaying() {
    if (current === 'game' && ctrl) {
      var snap = ctrl.snapshotNow();
      if (snap) D.saveGame(snap);
    }
  }

  function wireLifecycle() {
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveIfPlaying(); });
    window.addEventListener('pagehide', saveIfPlaying);
    var cap = window.Capacitor, App = cap && cap.Plugins && cap.Plugins.App;
    if (App) {
      App.addListener('backButton', function () {
        if (modalOpen()) {
          if (current === 'game') { closeModal(); if (ctrl) ctrl.unpause(); }
          else closeModal();
          return;
        }
        if (current === 'home' || current === 'splash') {
          confirmBox('Exit Ludo Pro?', 'Your current progress is saved automatically.', 'Exit', false).then(function (ok) { if (ok) App.exitApp(); });
          return;
        }
        back();
      });
      App.addListener('appStateChange', function (st) {
        if (!st.isActive) { saveIfPlaying(); A.pauseMusic(); if (ctrl && current === 'game') ctrl.pause(); }
        else { A.resumeMusic(); if (ctrl && current === 'game' && !modalOpen()) ctrl.unpause(); }
      });
    } else {
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (modalOpen()) { closeModal(); if (ctrl && current === 'game') ctrl.unpause(); } else back(); } });
    }
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    Eco.init();
    settings = D.getSettings();
    A.init(settings);
    $('btn-snd').textContent = settings.sound ? '🔊' : '🔇';
    wire();
    wireLifecycle();
    window.addEventListener('error', function (e) { if (window.console) console.error('Ludo Pro error:', e.message); });
    setTimeout(function () { if (current === 'splash') goRoot('home'); }, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
