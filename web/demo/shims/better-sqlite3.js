// better-sqlite3-compatible wrapper over sql.js (SQLite compiled to JavaScript), for the browser preview.
const norm = (a) => (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export default class Database {
  constructor() {
    const SQL = globalThis.__SQL;
    this._db = globalThis.__DEMO_BYTES ? new SQL.Database(globalThis.__DEMO_BYTES) : new SQL.Database();
    this._cache = new Map();
    this._depth = 0;
    globalThis.__DEMO_DB = this;
  }
  _stmt(sql) {
    let s = this._cache.get(sql);
    if (!s) { s = this._db.prepare(sql); this._cache.set(sql, s); }
    return s;
  }
  prepare(sql) {
    const self = this;
    return {
      get(...a) { const s = self._stmt(sql); try { s.bind(norm(a)); return s.step() ? { ...s.getAsObject() } : undefined; } finally { s.reset(); } },
      all(...a) { const s = self._stmt(sql); const out = []; try { s.bind(norm(a)); while (s.step()) out.push({ ...s.getAsObject() }); } finally { s.reset(); } return out; },
      run(...a) {
        const s = self._stmt(sql);
        try { s.bind(norm(a)); s.step(); } finally { s.reset(); }
        const changes = self._db.getRowsModified();
        const lastInsertRowid = self._db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid };
      },
    };
  }
  exec(sql) { this._db.exec(sql); }
  pragma(p) { if (!/journal_mode|synchronous|busy_timeout/.test(p)) this._db.exec('PRAGMA ' + p); }
  transaction(fn) {
    return (...a) => {
      if (this._depth > 0) return fn(...a);
      this._depth++;
      this._db.exec('BEGIN');
      try { const r = fn(...a); this._db.exec('COMMIT'); return r; }
      catch (e) { try { this._db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
      finally { this._depth--; }
    };
  }
  /** Serialise the whole database (frees cached statements, which sql.js requires). */
  export() { for (const s of this._cache.values()) s.free(); this._cache.clear(); return this._db.export(); }
}
