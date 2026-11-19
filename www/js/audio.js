/*!
 * Ludo Pro - sound system (effects + background music)
 * Developer: Sanaullah Khoso
 */
(function (root, factory) {
  root.LudoAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'assets/sounds/';
  var FILES = {
    dice: 'dice.mp3', move: 'move.mp3', capture: 'capture.mp3', home: 'home.mp3',
    win: 'win.mp3', click: 'click.mp3', coin: 'coin.mp3', magic: 'magic.mp3'
  };
  var VOLUME = { dice: 0.9, move: 0.7, capture: 0.9, home: 0.9, win: 1, click: 0.5, coin: 0.8, magic: 0.8 };
  var POOL_SIZE = 3;

  var pools = {};
  var cursor = {};
  var music = null;
  var soundOn = true;
  var musicOn = true;
  var musicWanted = false;
  var unlocked = false;

  function make(file, vol, loop) {
    var a = new Audio(BASE + file);
    a.preload = 'auto';
    a.volume = vol;
    a.loop = !!loop;
    return a;
  }

  function init(settings) {
    if (typeof Audio === 'undefined') return;
    soundOn = settings.sound !== false;
    musicOn = settings.music !== false;
    Object.keys(FILES).forEach(function (name) {
      pools[name] = [];
      cursor[name] = 0;
      for (var i = 0; i < POOL_SIZE; i++) pools[name].push(make(FILES[name], VOLUME[name], false));
    });
    music = make('music.mp3', 0.28, true);

    // Browsers/WebViews may block audio until the first touch.
    function unlock() {
      if (unlocked) return;
      unlocked = true;
      if (musicWanted && musicOn) tryPlay(music);
      document.removeEventListener('pointerdown', unlock, true);
    }
    document.addEventListener('pointerdown', unlock, true);

    document.addEventListener('visibilitychange', function () {
      if (!music) return;
      if (document.hidden) music.pause();
      else if (musicWanted && musicOn) tryPlay(music);
    });
  }

  function tryPlay(a) {
    try {
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* blocked until user gesture */ });
    } catch (e) { /* ignore */ }
  }

  function play(name) {
    if (!soundOn || !pools[name]) return;
    var pool = pools[name];
    var a = pool[cursor[name]];
    cursor[name] = (cursor[name] + 1) % pool.length;
    try { a.currentTime = 0; } catch (e) { /* not ready yet */ }
    tryPlay(a);
  }

  function startMusic() {
    musicWanted = true;
    if (music && musicOn) tryPlay(music);
  }
  function stopMusic() {
    musicWanted = false;
    if (music) { music.pause(); try { music.currentTime = 0; } catch (e) { /* ignore */ } }
  }
  function pauseMusic() { if (music) music.pause(); }
  function resumeMusic() { if (music && musicOn && musicWanted) tryPlay(music); }

  function setSound(on) { soundOn = !!on; }
  function setMusic(on) {
    musicOn = !!on;
    if (!music) return;
    if (!musicOn) music.pause();
    else if (musicWanted) tryPlay(music);
  }

  return {
    init: init, play: play,
    startMusic: startMusic, stopMusic: stopMusic, pauseMusic: pauseMusic, resumeMusic: resumeMusic,
    setSound: setSound, setMusic: setMusic,
    isSoundOn: function () { return soundOn; }, isMusicOn: function () { return musicOn; }
  };
});
