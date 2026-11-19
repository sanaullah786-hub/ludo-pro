/*!
 * Ludo Pro - player data: settings, profile, statistics, game history, saved game
 * Developer: Sanaullah Khoso
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./storage.js'));
  else root.LudoData = factory(root.LudoStorage);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var HISTORY_LIMIT = 60;

  var DEFAULT_SETTINGS = {
    sound: true,
    music: true,
    vibration: true,
    autoMove: true,       // play automatically when only one move is possible
    speed: 'normal',      // normal | fast
    rules: {              // classic Ludo rules, all configurable
      sixToStart: true,
      extraTurnOnSix: true,
      extraTurnOnCapture: true,
      extraTurnOnFinish: true,
      threeSixesForfeit: true,
      safeSquares: true,
      exactFinish: true
    }
  };

  function defaultProfile() {
    return {
      name: 'Player',
      avatar: '😎',
      createdAt: Date.now(),
      stats: { games: 0, wins: 0, losses: 0, captures: 0, sixes: 0, tokensHome: 0, streak: 0, bestStreak: 0 }
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function merge(base, over) {
    var out = clone(base);
    if (!over || typeof over !== 'object') return out;
    Object.keys(out).forEach(function (k) {
      if (over[k] === undefined) return;
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], over[k]);
      else if (typeof over[k] === typeof out[k]) out[k] = over[k];
    });
    return out;
  }

  // ------------------------------------------------------------- settings
  function getSettings() { return merge(DEFAULT_SETTINGS, S.get('settings', null)); }
  function setSettings(patch) {
    var cur = getSettings();
    var next = merge(cur, patch);
    S.set('settings', next);
    return next;
  }

  // -------------------------------------------------------------- profile
  function getProfile() { return merge(defaultProfile(), S.get('profile', null)); }
  function saveProfile(p) { S.set('profile', p); return p; }
  function updateProfile(patch) {
    var p = getProfile();
    if (patch.name !== undefined) p.name = String(patch.name).replace(/[<>]/g, '').trim().slice(0, 14) || 'Player';
    if (patch.avatar !== undefined) p.avatar = String(patch.avatar).slice(0, 8);
    return saveProfile(p);
  }

  /**
   * Record a finished game for the profile owner.
   * result: { won, captures, sixes, tokensHome }
   */
  function recordGame(result) {
    var p = getProfile();
    var st = p.stats;
    st.games += 1;
    if (result.won) {
      st.wins += 1;
      st.streak += 1;
      if (st.streak > st.bestStreak) st.bestStreak = st.streak;
    } else {
      st.losses += 1;
      st.streak = 0;
    }
    st.captures += result.captures || 0;
    st.sixes += result.sixes || 0;
    st.tokensHome += result.tokensHome || 0;
    saveProfile(p);
    return p;
  }

  // -------------------------------------------------------------- history
  function getHistory() {
    var h = S.get('history', []);
    return Array.isArray(h) ? h : [];
  }
  function addHistory(entry) {
    var h = getHistory();
    h.unshift(entry);
    if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT;
    S.set('history', h);
    return h;
  }
  function clearHistory() { S.set('history', []); }

  // ------------------------------------------------------------ saved game
  function getSavedGame() {
    var g = S.get('savedGame', null);
    return g && g.state && g.meta ? g : null;
  }
  function saveGame(snapshot) { return S.set('savedGame', snapshot); }
  function clearSavedGame() { S.remove('savedGame'); }

  function resetAll() { S.clearAll(); }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, HISTORY_LIMIT: HISTORY_LIMIT,
    getSettings: getSettings, setSettings: setSettings,
    getProfile: getProfile, saveProfile: saveProfile, updateProfile: updateProfile,
    recordGame: recordGame,
    getHistory: getHistory, addHistory: addHistory, clearHistory: clearHistory,
    getSavedGame: getSavedGame, saveGame: saveGame, clearSavedGame: clearSavedGame,
    resetAll: resetAll
  };
});
