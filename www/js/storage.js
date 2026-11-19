/*!
 * Ludo Pro - local storage wrapper
 * Developer: Sanaullah Khoso
 *
 * Wraps localStorage (persistent in the Android WebView) with:
 *  - a namespaced key prefix
 *  - a backup copy of every value, used if the main copy is corrupted
 *  - an in-memory fallback when storage is unavailable (private mode, quota)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoStorage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'ludopro.v1.';
  var memory = {};
  var backend = null;

  function getBackend() {
    if (backend !== null) return backend;
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : null;
      if (ls) {
        ls.setItem(PREFIX + '__probe', '1');
        ls.removeItem(PREFIX + '__probe');
        backend = ls;
        return backend;
      }
    } catch (e) { /* fall through */ }
    backend = false;
    return backend;
  }

  function rawGet(k) {
    var b = getBackend();
    if (b) { try { return b.getItem(k); } catch (e) { return null; } }
    return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
  }
  function rawSet(k, v) {
    var b = getBackend();
    if (b) { try { b.setItem(k, v); return true; } catch (e) { /* quota */ } }
    memory[k] = v;
    return !b;
  }
  function rawRemove(k) {
    var b = getBackend();
    if (b) { try { b.removeItem(k); } catch (e) { /* ignore */ } }
    delete memory[k];
  }

  function get(key, fallback) {
    var main = rawGet(PREFIX + key);
    if (main !== null) {
      try { return JSON.parse(main); } catch (e) { /* try backup */ }
    }
    var bak = rawGet(PREFIX + key + '.bak');
    if (bak !== null) {
      try { return JSON.parse(bak); } catch (e) { /* give up */ }
    }
    return fallback;
  }

  function set(key, value) {
    var json;
    try { json = JSON.stringify(value); } catch (e) { return false; }
    var ok = rawSet(PREFIX + key, json);
    rawSet(PREFIX + key + '.bak', json);
    return ok;
  }

  function remove(key) {
    rawRemove(PREFIX + key);
    rawRemove(PREFIX + key + '.bak');
  }

  function clearAll() {
    var b = getBackend();
    if (b) {
      var keys = [];
      try {
        for (var i = 0; i < b.length; i++) {
          var k = b.key(i);
          if (k && k.indexOf(PREFIX) === 0) keys.push(k);
        }
        keys.forEach(function (k2) { b.removeItem(k2); });
      } catch (e) { /* ignore */ }
    }
    memory = {};
  }

  return { get: get, set: set, remove: remove, clearAll: clearAll, PREFIX: PREFIX };
});
