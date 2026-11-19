/*!
 * Ludo Pro - virtual coins, daily bonus, missions and player level
 * Developer: Sanaullah Khoso
 *
 * IMPORTANT: coins are a purely virtual score for fun. They cannot be
 * bought, sold, wagered, deposited or withdrawn and have no monetary value.
 * There is deliberately no function that spends coins on chance or betting.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./storage.js'));
  else root.LudoEconomy = factory(root.LudoStorage);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var KEY = 'economy';
  var START_COINS = 200;
  var FREE_COINS = 25;
  var FREE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
  var HISTORY_LIMIT = 120;
  var MAX_STREAK_BONUS_DAY = 7;

  var MISSION_POOL = [
    { id: 'play2', title: 'Play 2 games', ev: 'game_played', target: 2, reward: 30 },
    { id: 'play4', title: 'Play 4 games', ev: 'game_played', target: 4, reward: 60 },
    { id: 'win1', title: 'Win a game', ev: 'game_won', target: 1, reward: 50 },
    { id: 'cap3', title: 'Capture 3 tokens', ev: 'capture', target: 3, reward: 40 },
    { id: 'cap6', title: 'Capture 6 tokens', ev: 'capture', target: 6, reward: 70 },
    { id: 'six8', title: 'Roll 8 sixes', ev: 'six', target: 8, reward: 35 },
    { id: 'home3', title: 'Bring 3 tokens home', ev: 'token_home', target: 3, reward: 45 },
    { id: 'cpu1', title: 'Play a game vs Computer', ev: 'vs_cpu_played', target: 1, reward: 25 },
    { id: 'cpuwin', title: 'Beat the Computer', ev: 'vs_cpu_won', target: 1, reward: 60 }
  ];

  var clock = function () { return new Date(); };
  var state = null;

  function setClock(fn) { clock = fn; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dateKey(clock()); }
  function yesterday() {
    var d = clock();
    var y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
    return dateKey(y);
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fresh() {
    return {
      coins: START_COINS, totalEarned: START_COINS,
      level: 1, xp: 0,
      lastDaily: null, streak: 0, lastFree: 0,
      missions: { date: null, list: [] },
      history: [{ t: Date.now(), amount: START_COINS, reason: 'Welcome gift', balance: START_COINS }]
    };
  }

  function generateMissions(dateStr) {
    var rnd = seeded(hash('ludopro-' + dateStr));
    var pool = MISSION_POOL.slice();
    var out = [];
    while (out.length < 3 && pool.length) {
      var i = Math.floor(rnd() * pool.length);
      var m = pool.splice(i, 1)[0];
      // never two missions of the same type in one day
      if (out.some(function (o) { return o.ev === m.ev; })) continue;
      out.push({ id: m.id, progress: 0, claimed: false });
    }
    return out;
  }

  function ensureToday() {
    var t = today();
    if (state.missions.date !== t) state.missions = { date: t, list: generateMissions(t) };
  }

  function save() { S.set(KEY, state); }

  function init() {
    var saved = S.get(KEY, null);
    state = saved && typeof saved.coins === 'number' ? saved : fresh();
    if (!state.history) state.history = [];
    if (!state.missions) state.missions = { date: null, list: [] };
    ensureToday();
    save();
    return state;
  }

  function need() { if (!state) init(); ensureToday(); return state; }

  // ------------------------------------------------------------------ coins
  function addCoins(amount, reason) {
    need();
    amount = Math.floor(amount);
    if (!(amount > 0)) return state.coins;
    state.coins += amount;
    state.totalEarned += amount;
    state.history.unshift({ t: Date.now(), amount: amount, reason: reason, balance: state.coins });
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    save();
    return state.coins;
  }

  function coins() { return need().coins; }
  function coinHistory(limit) { return need().history.slice(0, limit || 40); }

  // ------------------------------------------------------------------ level
  function xpNeeded(level) { return 100 + 50 * (level - 1); }

  function levelInfo() {
    need();
    var n = xpNeeded(state.level);
    return { level: state.level, xp: state.xp, need: n, pct: Math.min(100, Math.floor(state.xp / n * 100)) };
  }

  /** Add experience; returns {from, to, bonus} when levels were gained. */
  function addXp(amount) {
    need();
    var from = state.level, bonus = 0;
    state.xp += Math.max(0, Math.floor(amount));
    while (state.xp >= xpNeeded(state.level)) {
      state.xp -= xpNeeded(state.level);
      state.level += 1;
      bonus += 25 + 5 * state.level;
    }
    save();
    if (state.level > from) {
      addCoins(bonus, 'Level up! Reached level ' + state.level);
      return { from: from, to: state.level, bonus: bonus };
    }
    return null;
  }

  // ------------------------------------------------------------ daily bonus
  function dailyAmount(streak) { return 50 + 25 * (Math.min(streak, MAX_STREAK_BONUS_DAY) - 1); }

  function dailyBonus() {
    need();
    var available = state.lastDaily !== today();
    var nextStreak = state.lastDaily === yesterday() ? state.streak + 1 : (available ? 1 : state.streak);
    return {
      available: available,
      streak: available ? nextStreak : state.streak,
      amount: dailyAmount(nextStreak),
      nextAmount: dailyAmount(nextStreak + 1)
    };
  }

  function claimDaily() {
    need();
    if (state.lastDaily === today()) return null;
    state.streak = state.lastDaily === yesterday() ? state.streak + 1 : 1;
    state.lastDaily = today();
    var amount = dailyAmount(state.streak);
    save();
    addCoins(amount, 'Daily login bonus (day ' + state.streak + ')');
    return { amount: amount, streak: state.streak };
  }

  // -------------------------------------------------------------- free coins
  function freeCoins() {
    need();
    var left = Math.max(0, state.lastFree + FREE_COOLDOWN_MS - clock().getTime());
    return { available: left === 0, msLeft: left, amount: FREE_COINS };
  }
  function claimFree() {
    var f = freeCoins();
    if (!f.available) return null;
    state.lastFree = clock().getTime();
    save();
    addCoins(FREE_COINS, 'Free coins gift');
    return { amount: FREE_COINS };
  }

  // ---------------------------------------------------------------- missions
  function poolEntry(id) {
    for (var i = 0; i < MISSION_POOL.length; i++) if (MISSION_POOL[i].id === id) return MISSION_POOL[i];
    return null;
  }

  function missions() {
    need();
    return state.missions.list.map(function (m) {
      var def = poolEntry(m.id);
      return {
        id: m.id, title: def.title, target: def.target, reward: def.reward, ev: def.ev,
        progress: Math.min(m.progress, def.target), claimed: m.claimed,
        done: m.progress >= def.target
      };
    });
  }

  function track(ev, n) {
    need();
    n = n === undefined ? 1 : n;
    var changed = false;
    state.missions.list.forEach(function (m) {
      var def = poolEntry(m.id);
      if (def.ev === ev && m.progress < def.target) {
        m.progress = Math.min(def.target, m.progress + n);
        changed = true;
      }
    });
    if (changed) save();
  }

  function claimMission(id) {
    need();
    for (var i = 0; i < state.missions.list.length; i++) {
      var m = state.missions.list[i];
      if (m.id !== id) continue;
      var def = poolEntry(id);
      if (m.claimed || m.progress < def.target) return null;
      m.claimed = true;
      save();
      addCoins(def.reward, 'Mission: ' + def.title);
      addXp(15);
      return { amount: def.reward };
    }
    return null;
  }

  function claimableCount() {
    var n = missions().filter(function (m) { return m.done && !m.claimed; }).length;
    if (dailyBonus().available) n++;
    if (freeCoins().available) n++;
    return n;
  }

  // -------------------------------------------------------------- game reward
  /**
   * Rewards for the profile owner after a finished game.
   * info: { won, captures, vsCpu, difficulty }
   */
  function awardGame(info) {
    need();
    var breakdown = [];
    var coinsTotal = 0, xp = 20;

    breakdown.push({ label: 'Match completed', coins: 10 });
    coinsTotal += 10;

    if (info.won) {
      var win = 40;
      if (info.vsCpu) win = info.difficulty === 'hard' ? 80 : (info.difficulty === 'medium' ? 50 : 30);
      breakdown.push({ label: 'Victory', coins: win });
      coinsTotal += win;
      xp += 40;
    }
    var cap = Math.min((info.captures || 0) * 2, 20);
    if (cap > 0) { breakdown.push({ label: 'Captures', coins: cap }); coinsTotal += cap; }
    xp += Math.min((info.captures || 0) * 3, 30);

    addCoins(coinsTotal, info.won ? 'Won a game' : 'Played a game');
    var levelUp = addXp(xp);

    track('game_played', 1);
    if (info.won) track('game_won', 1);
    if (info.vsCpu) {
      track('vs_cpu_played', 1);
      if (info.won) track('vs_cpu_won', 1);
    }
    return { coins: coinsTotal, xp: xp, breakdown: breakdown, levelUp: levelUp };
  }

  function reset() { S.remove(KEY); state = null; init(); }

  return {
    init: init, setClock: setClock, coins: coins, addCoins: addCoins, coinHistory: coinHistory,
    levelInfo: levelInfo, addXp: addXp, xpNeeded: xpNeeded,
    dailyBonus: dailyBonus, claimDaily: claimDaily, freeCoins: freeCoins, claimFree: claimFree,
    missions: missions, track: track, claimMission: claimMission, claimableCount: claimableCount,
    awardGame: awardGame, reset: reset,
    START_COINS: START_COINS, FREE_COOLDOWN_MS: FREE_COOLDOWN_MS, MISSION_POOL: MISSION_POOL
  };
});
