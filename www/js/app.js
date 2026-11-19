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
  var MODE_LABEL = { cpu: 'vs Computer', local2: '2 Players', local3: '3 Players', local4: '4 Players', passplay: 'Pass & Play', magic: '🪄 Magic Play' };
  var SCREENS = ['splash', 'home', 'modes', 'setup', 'game', 'result', 'settings', 'history', 'profile', 'rewards'];

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
    var render = { home: renderHome, setup: renderSetup, settings: renderSettings, history: renderHistory,
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
    var p = D.getProfile(), lv = Eco.levelInfo();
    $('home-avatar').textContent = p.avatar;
    $('home-name').textContent = p.name;
    $('home-level').textContent = 'Level ' + lv.level;
    refreshCoins();
    var saved = D.getSavedGame();
    $('btn-continue').hidden = !saved;
    if (saved) {
      var st = saved.state;
      $('continue-info').textContent = (MODE_LABEL[saved.meta.mode] || 'Game') + ' · ' + st.seats.length + ' players · ' + fmtDate(saved.savedAt);
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

  // -------------------------------------------------------- player selection
  function openSetup(mode) {
    var p = D.getProfile();
    setup = {
      mode: mode, humanSeat: 0, opp: 1, diff: 'medium', magic: mode === 'magic',
      seats: [0, 1, 2, 3].map(function (s) { return { on: false, name: s === 0 ? p.name : 'Player ' + (s + 1) }; })
    };
    var defaults = { local2: [0, 2], local3: [0, 1, 2], local4: [0, 1, 2, 3], passplay: [0, 1, 2] }[mode] || [];
    defaults.forEach(function (s) { setup.seats[s].on = true; });
    go('setup');
  }

  function isCpuMode() { return setup && (setup.mode === 'cpu' || setup.mode === 'magic'); }
  function needCount() { return { local2: 2, local3: 3, local4: 4 }[setup.mode] || 0; }
  function activeSeats() { return [0, 1, 2, 3].filter(function (s) { return setup.seats[s].on; }); }
  function oppSeats(h, n) { return [(h + 2) % 4, (h + 1) % 4, (h + 3) % 4].slice(0, n); }

  function setupValid() {
    if (isCpuMode()) return true;
    var k = activeSeats().length, n = needCount();
    return n ? k === n : k >= 2;
  }

  function renderSetup() {
    if (!setup) { show('modes'); return; }
    var body = $('setup-body'), html = '';
    $('setup-title').textContent = MODE_LABEL[setup.mode];
    if (isCpuMode()) {
      html += '<div class="card"><h3>Your colour</h3><div class="swatches">';
      for (var s = 0; s < 4; s++) html += '<button class="swatch' + (setup.humanSeat === s ? ' sel' : '') + '" data-hs="' + s + '" style="--c:' + COLOR_HEX[s] + '" aria-label="' + COLOR_NAME[s] + '"></button>';
      html += '</div></div><div class="card"><h3>Opponents</h3><div class="pick-row">';
      [1, 2, 3].forEach(function (n) { html += '<button class="pick' + (setup.opp === n ? ' sel' : '') + '" data-opp="' + n + '">' + n + (n === 1 ? ' Computer' : ' Computers') + '</button>'; });
      html += '</div><div class="opp-list">';
      oppSeats(setup.humanSeat, setup.opp).forEach(function (os) {
        html += '<div class="opp" style="--c:' + COLOR_HEX[os] + '"><i></i>' + CPU_NAMES[os] + '</div>';
      });
      html += '</div></div><div class="card"><h3>Difficulty</h3><div class="pick-row">';
      [['easy', '😊 Easy'], ['medium', '🙂 Medium'], ['hard', '😈 Hard']].forEach(function (d) {
        html += '<button class="pick' + (setup.diff === d[0] ? ' sel' : '') + '" data-diff="' + d[0] + '">' + d[1] + '</button>';
      });
      html += '</div><p class="note" style="margin-top:10px">' + ({
        easy: 'Easy picks a random legal move.',
        medium: 'Medium captures when it can and pushes tokens towards home.',
        hard: 'Hard weighs wins, captures, safe squares and danger on every move.'
      })[setup.diff] + '</p></div>';
      html += '<div class="card"><h3>Your name</h3><input class="name-input" id="cpu-name" maxlength="14" value="' + esc(setup.seats[0].name) + '"></div>';
    } else {
      var n = needCount();
      html += '<p class="note" style="margin:0 4px 10px">' + (n ? 'Choose exactly ' + n + ' colours' : 'Choose 2 to 4 colours') +
        ' and enter each player\'s name. ' + activeSeats().length + ' selected.</p>';
      for (var q = 0; q < 4; q++) {
        var r = setup.seats[q];
        html += '<div class="seat-row ' + (r.on ? 'on' : 'off') + '" style="--c:' + COLOR_HEX[q] + '">' +
          '<span class="seat-token"></span>' +
          '<input type="text" maxlength="14" data-name="' + q + '" value="' + esc(r.name) + '" aria-label="' + COLOR_NAME[q] + ' player name"' + (r.on ? '' : ' disabled') + '>' +
          '<button class="switch ' + (r.on ? 'on' : '') + '" data-tog="' + q + '" aria-label="Toggle ' + COLOR_NAME[q] + '"></button></div>';
      }
      if (setup.mode === 'passplay') html += '<p class="note" style="margin:6px 4px">A hand-over screen appears before each player\'s turn so the phone can be passed around.</p>';
    }
    if (setup.mode === 'magic') {
      html += '<div class="card"><h3>\uD83E\uDE84 Magic spells</h3><p class="note" style="margin:0">Every player starts with one <b>Pick Dice</b> \uD83C\uDFAF, one <b>Shield</b> \uD83D\uDEE1\uFE0F and one <b>Blast</b> \uD83D\uDCA5. Cast a spell before rolling. Bringing a token home earns another spell.</p></div>';
    } else {
      html += '<div class="card"><div class="row" style="padding:0;border:0"><div class="grow"><span class="setting-title">\uD83E\uDE84 Magic spells</span><br><small>Pick Dice, Shield and Blast for everyone</small></div>' +
        '<button class="switch ' + (setup.magic ? 'on' : '') + '" data-magic="1" aria-label="Magic spells"></button></div></div>';
    }
    body.innerHTML = html;
    $('btn-start-game').disabled = !setupValid();
  }

  function startFromSetup() {
    if (!setupValid()) return;
    var config, rules = D.getSettings().rules;
    if (isCpuMode()) {
      var h = setup.humanSeat, opps = oppSeats(h, setup.opp);
      var seats = [h].concat(opps).sort();
      var types = {}, names = {}, difficulty = {};
      var nm = setup.seats[0].name.trim() || 'Player';
      seats.forEach(function (s) {
        if (s === h) { names[s] = nm; types[s] = 'human'; }
        else { names[s] = CPU_NAMES[s]; types[s] = 'cpu'; difficulty[s] = setup.diff; }
      });
      config = { mode: setup.mode, seats: seats, types: types, names: names, difficulty: difficulty, rules: rules, firstSeat: h, magic: !!setup.magic };
    } else {
      var act = activeSeats(), nms = {};
      act.forEach(function (s) { nms[s] = setup.seats[s].name.trim() || 'Player ' + (s + 1); });
      config = { mode: setup.mode === 'passplay' ? 'passplay' : setup.mode, seats: act, names: nms, rules: rules, firstSeat: act[0], magic: !!setup.magic };
    }
    if (config.mode !== 'cpu' && config.mode !== 'passplay') config.mode = config.mode; // local2/3/4 keep their id
    D.updateProfile({ name: config.names[config.seats.filter(function (s) { return !config.types || config.types[s] !== 'cpu'; })[0]] });
    launch(config, null);
  }

  // -------------------------------------------------------------------- game
  function ensureController() {
    if (ctrl) return;
    var view = new B.BoardView($('board'));
    ctrl = new LudoController({
      view: view, audio: A,
      getSettings: function () { return settings; },
      ui: {
        onGameStart: onGameStart, onTurn: onTurn, setRollEnabled: setRollEnabled, onTimer: onTimer,
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

  function onGameStart(info) {
    var s = info.state;
    $('game-mode').textContent = MODE_LABEL[info.meta.mode] || 'Ludo Pro';
    var html = '';
    s.seats.forEach(function (seat) {
      var p = s.players[seat];
      html += '<div class="pchip" data-seat="' + seat + '" style="--c:' + COLOR_HEX[seat] + '"><i></i><span><b>' +
        (p.type === 'cpu' ? '🤖 ' : '') + esc(p.name) + '</b><em>🏠 0/4</em></span></div>';
    });
    $('players-strip').innerHTML = html;
    $('btn-roll').disabled = true;
    $('spell-bar').hidden = !s.magic;
    pickKind = null;
    placeDice(s.current, true);
    message('Get ready!', s.current);
    updateStrip(s);
  }

  function updateStrip(s) {
    var chips = $('players-strip').children;
    for (var i = 0; i < chips.length; i++) {
      var seat = Number(chips[i].getAttribute('data-seat'));
      chips[i].classList.toggle('cur', seat === s.current && s.status !== 'finished');
      var extra = '';
      if (s.rules.killToEnterHome) extra += (s.kills[seat] > 0 ? ' 🔓' : ' 🔒');
      if (s.magic) { var ch = s.magic.charges[seat]; extra += ' ✨' + (ch.dice + ch.shield + ch.blast); }
      chips[i].querySelector('em').textContent = '🏠 ' + E.finishedCount(s, seat) + '/4' + extra;
    }
    updateSpells(s);
    $('game-turn').textContent = 'Turn ' + s.turn;
  }

  function onTurn(info) {
    $('dice').style.setProperty('--dc', COLOR_HEX[info.seat]);
    $('btn-roll').disabled = true;
    if (pickKind) { pickKind = null; }
    placeDice(info.seat, false);
    updateStrip(info.state);
  }
  function onStateChanged(s) { updateStrip(s); }
  function setRollEnabled(on) {
    $('btn-roll').disabled = !on;
    $('dice-spot').classList.toggle('ready', !!on);
    if (!on && pickKind) { pickKind = null; }
    if (ctrl && ctrl.state) updateSpells(ctrl.state);
  }

  // ---- the 3D dice lives over the board and sits on the current player's home
  var diceAngle = { x: 0, y: 0 };
  var DICE_FACE = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, 180] };
  function sizeDice() {
    var b = $('board'), w = b.clientWidth;
    if (w) b.style.setProperty('--half', (w * 0.047).toFixed(2) + 'px');
  }
  function placeDice(seat, instant) {
    sizeDice();
    var h = $('dice-spot'), c = B.BASE_CENTRES[seat];
    if (instant) h.classList.add('no-move');
    h.style.left = (c[0] / 15 * 100) + '%';
    h.style.top = (c[1] / 15 * 100) + '%';
    if (instant) { void h.offsetWidth; h.classList.remove('no-move'); }
  }
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
    var el = $('turn-timer');
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    var left = Math.ceil(t.left - 0.0001);
    el.querySelector('b').textContent = String(Math.max(0, left));
    el.style.setProperty('--p', String(Math.max(0, t.left / t.total) * 360) + 'deg');
    el.classList.toggle('warn', t.left <= 3);
  }

  // ---- magic spells
  var pickKind = null;
  function updateSpells(s) {
    var bar = $('spell-bar');
    if (!s || !s.magic) { bar.hidden = true; return; }
    bar.hidden = false;
    // show the charges of the human who is playing (or the owner while the computer plays)
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
    el.style.color = seat !== undefined && seat !== null ? ['#ff9c9c', '#9dff9d', '#fff0a0', '#a8ceff'][seat] : '';
  }

  function animateDice(seat, value) {
    return new Promise(function (resolve) {
      var h = $('dice-spot');
      h.classList.remove('six', 'hop');
      void h.offsetWidth;
      h.classList.add('hop');
      setDiceFace(value, 2);          // smooth multi-turn tumble that lands on the rolled face
      setTimeout(function () {
        h.classList.remove('hop');
        if (value === 6) { void h.offsetWidth; h.classList.add('six'); }
        resolve();
      }, 820);
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
      t: Date.now(), mode: sum.mode, winnerSeat: sum.winnerSeat, winnerName: winner.name, ownerWon: won,
      ownerName: sum.players.filter(function (p) { return p.seat === owner; })[0].name,
      players: sum.players.map(function (p) { return { name: p.name, seat: p.seat, finished: p.finished, cpu: p.type === 'cpu' }; }),
      durationMs: sum.durationMs, turns: sum.turns, coins: reward.coins
    });
    D.clearSavedGame();

    $('res-title').textContent = (vsCpu ? (won ? 'Victory!' : 'Defeat') : winner.name + ' wins!');
    $('res-sub').textContent = (vsCpu ? winner.name + ' (' + COLOR_NAME[winner.seat] + ') won this match' : COLOR_NAME[winner.seat] + ' completed all four tokens') +
      ' · ' + fmtDur(sum.durationMs) + ' · ' + sum.turns + ' turns';
    var medals = ['🥇', '🥈', '🥉', '4️⃣'];
    $('res-ranks').innerHTML = '<h3 style="margin:0 0 6px;color:var(--gold-2)">Final ranking</h3>' + sum.rankings.map(function (seat, i) {
      var p = sum.players.filter(function (x) { return x.seat === seat; })[0];
      return '<div class="rank-row" style="--c:' + COLOR_HEX[seat] + '"><span class="rank-no">' + medals[i] + '</span><span class="rank-dot"></span>' +
        '<b style="flex:1">' + (p.type === 'cpu' ? '🤖 ' : '') + esc(p.name) + '</b><small>🏠 ' + p.finished + '/4 · ⚔ ' + st.captures[seat] + '</small></div>';
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
      return '<div class="card"><div class="row" style="padding-top:0"><div class="grow"><b>' + esc(MODE_LABEL[g.mode] || g.mode) + '</b><small>' + fmtDate(g.t) + ' · ' + fmtDur(g.durationMs) + ' · ' + g.turns + ' turns</small></div>' +
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
    window.addEventListener('resize', sizeDice);
    if (window.ResizeObserver) new ResizeObserver(sizeDice).observe($('board'));
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('button, .pick, .switch, .swatch, .mode-card, .tile') && !t.closest('#btn-roll') && !t.closest('#dice-spot') && !t.closest('.token')) A.play('click');
    }, true);

    document.addEventListener('click', function (e) {
      var go_ = e.target.closest('[data-go]');
      if (go_) { go(go_.getAttribute('data-go')); return; }
      if (e.target.closest('[data-back]')) { back(); return; }
      var mode = e.target.closest('[data-mode]');
      if (mode) { openSetup(mode.getAttribute('data-mode')); }
    });

    $('btn-play').onclick = function () { go('modes'); };
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
    $('btn-roll').onclick = function () { if (ctrl) ctrl.requestRoll(); };
    $('dice-spot').onclick = function () { if (ctrl) ctrl.requestRoll(); };
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
      if ((t = e.target.closest('[data-hs]'))) { setup.humanSeat = Number(t.getAttribute('data-hs')); renderSetup(); }
      else if ((t = e.target.closest('[data-opp]'))) { setup.opp = Number(t.getAttribute('data-opp')); renderSetup(); }
      else if ((t = e.target.closest('[data-diff]'))) { setup.diff = t.getAttribute('data-diff'); renderSetup(); }
      else if (e.target.closest('[data-magic]')) { setup.magic = !setup.magic; renderSetup(); }
      else if ((t = e.target.closest('[data-tog]'))) {
        var s = Number(t.getAttribute('data-tog'));
        setup.seats[s].on = !setup.seats[s].on;
        renderSetup();
      }
    });
    $('setup-body').addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'cpu-name') setup.seats[0].name = t.value;
      else if (t.hasAttribute('data-name')) setup.seats[Number(t.getAttribute('data-name'))].name = t.value;
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
