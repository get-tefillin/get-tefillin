"use strict";
/* Tefillin Now replica — JSON file store. No external dependencies.
   All state lives in <dataDir>/db.json; photos live in <dataDir>/photos/.
   Writes are atomic (tmp file + rename) and debounced. */
const fs = require("fs");
const path = require("path");
const remote = require("./remote");

function emptyDb() {
  return {
    shluchim: {},   // id -> shaliach record
    orderers: {},   // normalized phone -> {name, phone, first_at, last_at, count} — permanent registry, admin backup
    requests: {},   // id -> request record
    photos: {},     // id -> photo meta {id, req_id, role, w, h, approved, at, file}
    deletions: [],  // {id, phone, name, role, note, at, done}
    counters: { total_done: 0, by_month: {}, photos_by_month: {} },
    settings: { announcement: null, stats_visible: false, report_email: null, report_paused: true }
  };
}

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, "db.json");
    this.photoDir = path.join(dataDir, "photos");
    fs.mkdirSync(this.photoDir, { recursive: true });
    try {
      this.db = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      this.db = emptyDb();
      this._writeNow(true); // bootstrap file only — never push an empty db over the remote copy
    }
    this._applyDefaults();
    this._timer = null;
    this._dirty = false;
  }
  _applyDefaults() {
    this.db.settings = Object.assign({ announcement: null, stats_visible: false, report_email: null, report_paused: true }, this.db.settings || {});
    if (!this.db.orderers || typeof this.db.orderers !== "object") this.db.orderers = {};
  }
  /* Pull the last remotely-backed-up db (survives redeploys). Remote wins when
     it exists; local file is only a cache. No-op when remote is not configured. */
  async restore() {
    if (!remote.ENABLED) return;
    try {
      const raw = await remote.loadDb();
      if (!raw) throw new Error("remote database missing; refusing empty replacement");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.shluchim && parsed.requests && parsed.counters && !Array.isArray(parsed.shluchim)) {
          Object.keys(this.db).forEach(function (k) { delete this.db[k]; }, this);
          Object.assign(this.db, parsed); // keep the same object: server.js holds `const db = store.db`
          this._applyDefaults();
          this._writeNow(true);
          console.log("Remote db restored (" + raw.length + " bytes)");
        } else { throw new Error("remote database invalid"); }
      }
    } catch (e) {
      console.error("remote db restore failed:", e.message);
      throw e;
    }
  }
  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 250);
  }
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    this._writeNow();
  }
  _writeNow(skipRemote) {
    const json = JSON.stringify(this.db);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, this.file);
    if (!skipRemote) remote.saveDb(json);
  }
}

module.exports = { Store };
