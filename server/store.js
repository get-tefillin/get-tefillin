"use strict";
/* Get Tefillin replica — JSON file store. No external dependencies.
   All state lives in <dataDir>/db.json; photos live in <dataDir>/photos/.
   Writes are atomic (tmp file + rename) and debounced. */
const fs = require("fs");
const path = require("path");

function emptyDb() {
  return {
    shluchim: {},   // id -> shaliach record
    requests: {},   // id -> request record
    photos: {},     // id -> photo meta {id, req_id, role, w, h, approved, at, file}
    deletions: [],  // {id, phone, name, role, note, at, done}
    counters: { total_done: 0, by_month: {}, photos_by_month: {} }
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
      this._writeNow();
    }
    this._timer = null;
    this._dirty = false;
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
  _writeNow() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
