/* Tiny IndexedDB wrapper. Stores: pins (keyPath id), routes (keyPath id), kv (settings). */
(function (root) {
  'use strict';
  var DB_NAME = 'huntmap', VERSION = 1, dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('pins')) db.createObjectStore('pins', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), result;
        var r = fn(s); if (r && 'onsuccess' in r) r.onsuccess = function () { result = r.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }
  var DB = {
    all: function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); },
    get: function (store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); },
    put: function (store, val, key) { return tx(store, 'readwrite', function (s) { return key === undefined ? s.put(val) : s.put(val, key); }); },
    putMany: function (store, vals) { return tx(store, 'readwrite', function (s) { vals.forEach(function (v) { s.put(v); }); }); },
    del: function (store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); },
    delMany: function (store, keys) { return tx(store, 'readwrite', function (s) { keys.forEach(function (k) { s.delete(k); }); }); },
    clear: function (store) { return tx(store, 'readwrite', function (s) { return s.clear(); }); },
    getSetting: function (k, dflt) { return DB.get('kv', k).then(function (v) { return v === undefined ? dflt : v; }); },
    setSetting: function (k, v) { return DB.put('kv', v, k); }
  };
  root.DB = DB;
})(this);
