"use strict";
/* Optional remote backup/restore via Upstash Redis REST.
   Active only when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars
   are set. Local disk stays the fast path; the remote copy is what survives
   redeploys on hosts with ephemeral disks (Render free tier). */
const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = !!(BASE && TOKEN);

async function cmd(parts, body) {
  const res = await fetch(BASE + "/" + parts.map(encodeURIComponent).join("/"), {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "text/plain; charset=utf-8" },
    body: body
  });
  if (!res.ok) throw new Error("upstash http " + res.status);
  return res.json();
}

async function loadDb() {
  if (!ENABLED) return null;
  const r = await cmd(["get", "db"]);
  return r && typeof r.result === "string" ? r.result : null;
}

let saveTimer = null, pendingJson = null;
function saveDb(json) {
  if (!ENABLED) return;
  pendingJson = json;
  if (saveTimer) return;
  saveTimer = setTimeout(async function () {
    saveTimer = null;
    try { await cmd(["set", "db"], pendingJson); }
    catch (e) { console.error("remote db save failed:", e.message); }
  }, 1000);
}

async function putPhoto(name, buf) {
  if (!ENABLED) return;
  try { await cmd(["set", "photo:" + name], buf.toString("base64")); }
  catch (e) { console.error("remote photo save failed:", e.message); }
}

async function getPhoto(name) {
  if (!ENABLED) return null;
  try {
    const r = await cmd(["get", "photo:" + name]);
    return r && r.result ? Buffer.from(r.result, "base64") : null;
  } catch (e) { return null; }
}

async function delPhoto(name) {
  if (!ENABLED) return;
  try { await cmd(["del", "photo:" + name]); } catch (e) {}
}

module.exports = { ENABLED, loadDb, saveDb, putPhoto, getPhoto, delPhoto };
