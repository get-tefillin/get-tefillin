"use strict";
/* End-to-end test of the replica server: full requester<->shaliach lifecycle,
   chat, photos + wall, admin, deletion request, release/cancel paths.
   Run: node test/e2e.js  (starts its own server on a test port with a temp data dir) */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 8791;
const BASE = "http://127.0.0.1:" + PORT;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-test-"));
const root = path.join(__dirname, "..");

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS  " + name);
  else { failures++; console.log("FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
async function j(method, p, body, tok, headers) {
  const r = await fetch(BASE + p, {
    method, headers: Object.assign(body ? { "content-type": "application/json" } : {}, tok ? { "x-token": tok } : {}, headers || {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, j: data, headers: r.headers };
}

// TLV-area coordinates ~1.2km apart
const SH_POS = [32.0800, 34.8510];
const RQ_POS = [32.0770, 34.8505];

async function main() {
  const srv = spawn(process.execPath, [path.join(root, "server", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  srv.stdout.on("data", d => { serverLog += d; });
  srv.stderr.on("data", d => { serverLog += d; });
  await new Promise(r => setTimeout(r, 800));

  try {
    /* read the generated admin code */
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    check("config.json created with admin code", typeof cfg.admin_code === "string" && cfg.admin_code.length >= 8);

    const world = await j("GET", "/api/world-map?zoom=2");
    check("world map available without personal data", world.j.ok && Array.isArray(world.j.clusters) && !JSON.stringify(world.j).includes("token"));
    const badWorld = await j("GET", "/api/world-map?bounds=nan,0,1,2");
    check("world map rejects invalid bounds", badWorld.status === 400);

    /* static shell */
    const home = await fetch(BASE + "/");
    check("GET / serves the app", home.status === 200 && (await home.text()).indexOf("Get Tefillin") >= 0 || home.status === 200);
    const appjs = await fetch(BASE + "/app.js");
    check("GET /app.js", appjs.status === 200);
    const wallredir = await fetch(BASE + "/wall", { redirect: "manual" });
    check("GET /wall redirects to /wall/", wallredir.status === 302 && wallredir.headers.get("location") === "/wall/");
    const wallpage = await fetch(BASE + "/wall/");
    check("GET /wall/", wallpage.status === 200);
    const privredir = await fetch(BASE + "/privacy", { redirect: "manual" });
    check("GET /privacy redirects", privredir.status === 302);
    const walljs = await fetch(BASE + "/wall/wall.js");
    check("GET /wall/wall.js", walljs.status === 200);

    /* validation errors */
    let r = await j("POST", "/api/request", { first_name: "A", phone: "0501234567", lat: RQ_POS[0], lng: RQ_POS[1] });
    check("short first_name rejected (e_first_name)", r.j && r.j.ok === false && r.j.code === "first_name", r.j);
    r = await j("POST", "/api/shaliach/register", { name: "שליח בדיקה", phone: "0501112233", transport: "rocket", has_tefillin: true, langs: ["he"], lang: "he", tz: "Asia/Jerusalem" });
    check("bad transport rejected (e_transport)", r.j && r.j.code === "transport", r.j);
    r = await j("POST", "/api/shaliach/register", { name: "שליח בדיקה", phone: "0501112233", transport: "foot", has_tefillin: false, langs: ["he"], lang: "he", tz: "Asia/Jerusalem" });
    check("no tefillin rejected (e_has_tefillin)", r.j && r.j.code === "has_tefillin", r.j);

    /* register shaliach */
    r = await j("POST", "/api/shaliach/register", { name: "שליח בדיקה", phone: "0501112233", city: "גבעת שמואל", transport: "bike", has_tefillin: true, langs: ["he", "en"], lang: "he", tz: "Asia/Jerusalem" });
    check("shaliach register ok", r.j && r.j.ok && typeof r.j.token === "string" && r.j.shaliach.name === "שליח בדיקה", r.j);
    const shTok = r.j.token;

    /* duplicate phone: returning shaliach reconnects to his existing record (no error) */
    r = await j("POST", "/api/shaliach/register", { name: "עוד אחד", phone: "0501112233", transport: "foot", has_tefillin: true, langs: ["he"], lang: "he", tz: "Asia/Jerusalem" });
    check("duplicate phone reconnects existing record", r.j && r.j.ok === true && r.j.token === shTok && r.j.shaliach.name === "שליח בדיקה", r.j);

    /* nearby: nothing while off */
    r = await j("GET", "/api/nearby?lat=" + RQ_POS[0] + "&lng=" + RQ_POS[1] + "&lang=he");
    check("nearby empty while shaliach off", r.j && r.j.ok && r.j.shluchim.length === 0, r.j);

    /* mode available with location */
    r = await j("POST", "/api/shaliach/mode", { mode: "available", tz: "Asia/Jerusalem", live: true, lat: SH_POS[0], lng: SH_POS[1] }, shTok);
    check("mode available ok", r.j && r.j.ok === true, r.j);
    check("mode response carries merge keys", r.j && "hours" in r.j && "push_devices" in r.j, r.j);

    await new Promise(resolve => setTimeout(resolve, 5100));
    const availableWorld = await j("GET", "/api/world-map?zoom=16");
    check("world map shows available shaliach at approximate location", availableWorld.j.total === 1 && availableWorld.j.clusters[0].lat === 32.08 && availableWorld.j.clusters[0].lng === 34.85, availableWorld.j);
    check("world map never exposes contact, name, token or id", !/שליח|token|0501112233/.test(JSON.stringify(availableWorld.j)));

    /* shaliach sets his own photo */
    const shJpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);
    let spr = await fetch(BASE + "/api/shaliach/photo", { method: "POST", headers: { "content-type": "image/jpeg", "x-token": shTok }, body: shJpeg });
    let spj = await spr.json();
    check("shaliach photo upload ok", spr.status === 200 && spj.ok && typeof spj.photo === "string", spj);
    const shPhotoId = spj.photo;
    spr = await fetch(BASE + "/api/shaliach/photo", { method: "POST", headers: { "content-type": "image/png", "x-token": shTok }, body: shJpeg });
    spj = await spr.json();
    check("shaliach photo rejects non-jpeg", spj && spj.ok === false && spj.code === "photo_type", spj);
    spr = await fetch(BASE + "/api/shaliach/photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: shJpeg });
    spj = await spr.json();
    check("shaliach photo requires token", spj && spj.ok === false && spj.code === "auth", spj);
    spr = await fetch(BASE + "/api/shaliach/photo/" + shPhotoId);
    check("shaliach photo is public", spr.status === 200 && (spr.headers.get("content-type") || "").indexOf("image/jpeg") === 0, spr.status);
    r = await j("POST", "/api/shaliach/poll", { tz: "Asia/Jerusalem" }, shTok);
    check("me view carries photo", r.j && r.j.me && r.j.me.photo === shPhotoId, r.j && r.j.me);

    /* nearby now shows the shaliach */
    r = await j("GET", "/api/nearby?lat=" + RQ_POS[0] + "&lng=" + RQ_POS[1] + "&lang=he");
    check("nearby shows available shaliach", r.j && r.j.shluchim.length === 1 && typeof r.j.shluchim[0].km === "number" && r.j.shluchim[0].eta_min > 0, r.j);
    check("nearby card carries photo", r.j && r.j.shluchim[0].photo === shPhotoId, r.j && r.j.shluchim);

    /* create request */
    r = await j("POST", "/api/request", { first_name: "מזמין בדיקה", phone: "0527654321", lat: RQ_POS[0], lng: RQ_POS[1], address: "רמת גן", device: "testdev1", loc_source: "gps", lang: "he" });
    check("request created", r.j && r.j.ok && /^[0-9a-f]{16,40}$/.test(r.j.id) && typeof r.j.token === "string", r.j);
    const reqId = r.j.id, reqTok = r.j.token;
    check("at least one shaliach notified", r.j.notified >= 1, r.j);

    /* requester status: open + ringing */
    r = await j("GET", "/api/request/" + reqId, null, reqTok);
    check("requester sees open + ring_left_s>0", r.j && r.j.ok && r.j.status === "open" && r.j.ring_left_s > 0, r.j);
    r = await j("GET", "/api/request/" + reqId, null, "badtoken");
    check("wrong token rejected (401)", r.status === 401, r.status);

    /* shaliach poll: ringing */
    r = await j("POST", "/api/shaliach/poll", { v: 6, available: true, lang: "he", lat: SH_POS[0], lng: SH_POS[1] }, shTok);
    check("shaliach poll ok with me-view", r.j && r.j.ok && r.j.me && r.j.me.name === "שליח בדיקה", r.j);
    check("request rings the shaliach", r.j && r.j.ringing.length === 1 && r.j.ringing[0].id === reqId && r.j.ringing[0].ring_left_s > 0, r.j && r.j.ringing);

    /* peek */
    r = await j("POST", "/api/shaliach/peek", { id: reqId, lat: SH_POS[0], lng: SH_POS[1] }, shTok);
    check("peek open", r.j && r.j.ok && r.j.state === "open" && r.j.item.id === reqId, r.j);

    /* accept */
    r = await j("POST", "/api/shaliach/accept", { id: reqId }, shTok);
    check("accept ok", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/request/" + reqId, null, reqTok);
    check("requester sees accepted + shaliach card", r.j && r.j.status === "accepted" && r.j.shaliach && r.j.shaliach.name === "שליח בדיקה" && r.j.shaliach.phone === "0501112233", r.j);
    check("requester card carries photo", r.j && r.j.shaliach && r.j.shaliach.photo === shPhotoId, r.j && r.j.shaliach);

    /* chat both directions */
    r = await j("POST", "/api/request/" + reqId + "/say", { text: "איפה אתה?", lang: "he" }, reqTok);
    check("requester say ok", r.j && r.j.ok === true, r.j);
    r = await j("POST", "/api/shaliach/say", { id: reqId, phrase: "omw", lang: "he" }, shTok);
    check("shaliach quick phrase ok", r.j && r.j.ok === true, r.j);
    r = await j("POST", "/api/shaliach/chat", { id: reqId, lang: "he", after: 0 }, shTok);
    check("shaliach chat fetch: requester msg + own phrase", r.j && r.j.msgs.length === 2 && r.j.msgs[0].me === false && r.j.msgs[0].text === "איפה אתה?" && r.j.msgs[1].me === true && r.j.msgs[1].phrase === "omw", r.j && r.j.msgs);
    r = await j("GET", "/api/request/" + reqId + "/chat?lang=en&after=0", null, reqTok);
    check("requester chat fetch, cross-lang need_tr", r.j && r.j.msgs.length === 2 && r.j.msgs[1].me === false, r.j && r.j.msgs);
    r = await j("GET", "/api/request/" + reqId + "/chat?lang=he&after=2", null, reqTok);
    check("chat after-cursor returns nothing", r.j && r.j.msgs.length === 0, r.j);

    /* arrived */
    r = await j("POST", "/api/shaliach/arrived", { id: reqId }, shTok);
    check("arrived ok", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/request/" + reqId, null, reqTok);
    check("requester sees arrived", r.j && r.j.status === "arrived", r.j);

    /* done */
    r = await j("POST", "/api/shaliach/done", { id: reqId }, shTok);
    check("done ok", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/request/" + reqId, null, reqTok);
    check("requester sees done", r.j && r.j.status === "done", r.j);
    r = await j("POST", "/api/shaliach/poll", { v: 6, available: true, lang: "he", lat: SH_POS[0], lng: SH_POS[1] }, shTok);
    check("counters: done_count 1, month_count 1", r.j && r.j.me.done_count === 1 && r.j.me.month_count === 1, r.j && r.j.me);

    /* photo upload (minimal valid JPEG: SOI + EOI) */
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
    let pres = await fetch(BASE + "/api/photo?req=" + reqId + "&role=r&consent=1&w=100&h=80", {
      method: "POST", headers: { "content-type": "image/jpeg", "x-token": reqTok }, body: jpeg
    });
    let pj = await pres.json();
    check("photo upload ok", pj && pj.ok === true && pj.id, pj);
    const photoId = pj.id;
    pres = await fetch(BASE + "/api/photo/" + photoId);
    check("pending photo not public (404)", pres.status === 404, pres.status);

    /* wall before approval */
    r = await j("GET", "/api/wall/latest");
    check("wall/latest ok, no photos yet, month_count 1", r.j && r.j.ok && r.j.photos.length === 0 && r.j.month_count === 1, r.j);
    r = await j("GET", "/api/wall");
    check("wall month contract", r.j && r.j.ok && /^\d{4}-\d{2}$/.test(r.j.month) && r.j.is_current === true && r.j.count === 1 && Array.isArray(r.j.series) && r.j.series.length === 12 && Array.isArray(r.j.archive), r.j);

    /* admin: wrong code, then right code */
    r = await j("POST", "/api/admin/login", { code: "wrong" });
    check("admin wrong code 401", r.status === 401, r.status);
    r = await j("POST", "/api/admin/login", { code: cfg.admin_code });
    check("admin login ok + cookie", r.j && r.j.ok === true && (r.headers.get("set-cookie") || "").indexOf("tn_adm=") === 0, r.j);
    const cookie = (r.headers.get("set-cookie") || "").split(";")[0];

    r = await j("GET", "/api/admin/overview", null, null, { cookie });
    check("admin overview lists shaliach + request + pending photo", r.j && r.j.ok && r.j.shluchim.length === 1 && r.j.requests.length >= 1 && r.j.photos_pending.length === 1 && r.j.stats.total_done === 1, r.j && r.j.stats);

    /* orderer registry (admin backup of everyone who ordered) */
    r = await j("POST", "/api/admin/report/test", {}, null, { cookie });
    check("report test without key is skipped", r.j && r.j.ok === false && r.j.skipped === "no_key", r.j);

    r = await j("GET", "/api/admin/overview", null, null, { cookie });
    check("overview lists registered orderers", r.j && Array.isArray(r.j.orderers) && r.j.orderers.length >= 1 && r.j.orderers.some(function(o){return o.name==="מזמין בדיקה" && o.count===1}) && r.j.stats.orderers >= 1, r.j && r.j.orderers);
    r = await j("POST", "/api/request", { first_name: "מזמין בדיקה", phone: "0527654321", lat: RQ_POS[0], lng: RQ_POS[1], device: "testdev1b" });
    check("repeat order by same phone ok", r.j && r.j.ok === true, r.j);
    if (r.j && r.j.ok) await j("POST", "/api/request/" + r.j.id + "/cancel", {}, r.j.token);
    r = await j("GET", "/api/admin/overview", null, null, { cookie });
    check("orderer count incremented, still one row", r.j && r.j.orderers.filter(function(o){return o.phone.indexOf("0527654321")>=0}).length === 1 && r.j.orderers.find(function(o){return o.phone.indexOf("0527654321")>=0}).count === 2, r.j && r.j.orderers);
    r = await j("GET", "/api/admin/export", null, null, { cookie });
    check("backup export includes orderers", r.j && r.j.orderers && Object.values(r.j.orderers).some(function(o){return o.name==="מזמין בדיקה"}), r.status);

    /* approve the photo */
    r = await j("POST", "/api/admin/photo", { id: photoId, action: "approve" }, null, { cookie });
    check("photo approved", r.j && r.j.ok === true, r.j);
    pres = await fetch(BASE + "/api/photo/" + photoId);
    check("approved photo is public", pres.status === 200 && (pres.headers.get("content-type") || "").indexOf("image/jpeg") === 0, pres.status);
    r = await j("GET", "/api/wall/latest");
    check("wall/latest now shows the photo", r.j && r.j.photos.length === 1 && r.j.photos[0].id === photoId, r.j);

    /* donation setting */
    r = await j("POST", "/api/admin/donation", { url: "not-a-url" }, null, { cookie });
    check("bad donation url rejected", r.j && r.j.ok === false, r.j);
    r = await j("POST", "/api/admin/donation", { url: "https://example.org/campaign" }, null, { cookie });
    check("donation url saved", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/config");
    check("/api/config returns new donation url", r.j && r.j.donation_url === "https://example.org/campaign", r.j);

    /* deletion request flow */
    r = await j("POST", "/api/deletion-request", { phone: "0520001112", name: "מישהו", role: "requester", note: "בדיקה" });
    check("deletion-request accepted", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/admin/overview", null, null, { cookie });
    check("deletion visible in admin", r.j && r.j.deletions.length === 1, r.j && r.j.deletions);
    const delId = r.j.deletions[0].id;
    r = await j("POST", "/api/admin/deletion/done", { id: delId }, null, { cookie });
    check("deletion executed", r.j && r.j.ok === true, r.j);

    /* release flow: new request, accept, release -> open again */
    r = await j("POST", "/api/request", { first_name: "מזמין שני", phone: "0527654322", lat: RQ_POS[0], lng: RQ_POS[1], address: "", device: "testdev2", loc_source: "gps", lang: "he" });
    const req2 = r.j.id, req2Tok = r.j.token;
    r = await j("POST", "/api/shaliach/accept", { id: req2 }, shTok);
    check("second request accepted", r.j && r.j.ok === true, r.j);
    r = await j("POST", "/api/shaliach/release", { id: req2 }, shTok);
    check("release ok", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/request/" + req2, null, req2Tok);
    check("released request is open again", r.j && r.j.status === "open", r.j);

    /* cancel flow */
    r = await j("POST", "/api/request/" + req2 + "/cancel", {}, req2Tok);
    check("cancel ok", r.j && r.j.ok === true, r.j);
    r = await j("GET", "/api/request/" + req2, null, req2Tok);
    check("cancelled status visible", r.j && r.j.status === "cancelled", r.j);

    /* shaliach delete with no active job */
    r = await j("POST", "/api/shaliach/delete", {}, shTok);
    check("shaliach delete ok", r.j && r.j.ok === true, r.j);
    r = await j("POST", "/api/shaliach/poll", { v: 6, available: false, lang: "he" }, shTok);
    check("deleted shaliach token is 401", r.status === 401, r.status);

    /* admin data export (tokens stripped) */
    const exp = await fetch(BASE + "/api/admin/export", { headers: { cookie } });
    const expJ = await exp.json();
    check("export returns db without tokens", exp.status === 200 && expJ.shluchim && Object.values(expJ.shluchim).every(function (s) { return !s.token; }) && Object.values(expJ.requests).every(function (q) { return !q.token; }), exp.status);

    /* admin monthly stats report */
    const st = await fetch(BASE + "/api/admin/stats", { headers: { cookie } });
    const stJ = await st.json();
    const mkNow = new Date().toISOString().slice(0, 7);
    check("stats endpoint ok", st.status === 200 && stJ.ok === true && stJ.current === mkNow, stJ);
    check("stats counts the done request", stJ.total_layings >= 1 && stJ.current_layings >= 1, stJ);
    const stMonth = (stJ.months || []).find(function (m) { return m.month === mkNow; });
    check("stats month row has layings/people/shluchim", !!stMonth && stMonth.layings >= 1 && stMonth.people >= 1 && stMonth.shluchim >= 1, stMonth);
    const stNo = await fetch(BASE + "/api/admin/stats");
    check("stats require admin session", stNo.status === 401, stNo.status);

    /* bulletin: announcement + stats display, off by default, admin-controlled */
    let bl = await fetch(BASE + "/api/bulletin").then(function (r) { return r.json(); });
    check("bulletin empty by default", bl.ok === true && bl.announcement === null && bl.stats === null, bl);
    const blNo = await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("bulletin set requires admin session", blNo.status === 401, blNo.status);
    const blSet = await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ announcement: "מבצע השבוע!", stats_visible: true }) });
    const blSetJ = await blSet.json();
    check("bulletin saved", blSetJ.ok === true && blSetJ.announcement === "מבצע השבוע!" && blSetJ.stats_visible === true, blSetJ);
    bl = await fetch(BASE + "/api/bulletin").then(function (r) { return r.json(); });
    check("bulletin public after enable", bl.announcement === "מבצע השבוע!" && bl.stats && typeof bl.stats.month_count === "number" && bl.stats.month_count >= 1 && bl.stats.total_done >= 1, bl);
    await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ announcement: "", stats_visible: false }) });
    bl = await fetch(BASE + "/api/bulletin").then(function (r) { return r.json(); });
    check("bulletin hidden when cleared", bl.announcement === null && bl.stats === null, bl);
    check("home page has bulletin containers", (await fetch(BASE + "/").then(function (r) { return r.text(); })).indexOf('id="homeBanner"') >= 0, "homeBanner");

    /* monthly report recipient email: admin-set, validated, independent of bulletin fields */
    const rpBad = await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ report_email: "not-an-email" }) });
    check("bad report email rejected", rpBad.status === 400, rpBad.status);
    const rpSet = await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ report_email: "Ohel@Example.COM " }) });
    const rpSetJ = await rpSet.json();
    check("report email saved normalized", rpSetJ.ok === true && rpSetJ.report_email === "ohel@example.com", rpSetJ);
    const blGet = await fetch(BASE + "/api/admin/bulletin", { headers: { cookie } }).then(function (r) { return r.json(); });
    check("bulletin get returns report email", blGet.report_email === "ohel@example.com", blGet);
    await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ announcement: "שוב מבצע", stats_visible: true }) });
    const blGet2 = await fetch(BASE + "/api/admin/bulletin", { headers: { cookie } }).then(function (r) { return r.json(); });
    check("bulletin save keeps report email", blGet2.announcement === "שוב מבצע" && blGet2.report_email === "ohel@example.com", blGet2);
    await fetch(BASE + "/api/admin/bulletin", { method: "POST", headers: { "content-type": "application/json", cookie: cookie }, body: JSON.stringify({ announcement: "", stats_visible: false, report_email: "" }) });

    /* admin page gating */
    const adm = await fetch(BASE + "/admin", { redirect: "manual" });
    check("/admin redirects without session", adm.status === 302, adm.status);
    const adm2 = await fetch(BASE + "/admin", { headers: { cookie } });
    check("/admin serves page with session", adm2.status === 200 && (await adm2.text()).indexOf("ניהול") >= 0, adm2.status);

    /* Admin test-data tools: isolated fixtures only. */
    r = await j("POST", "/api/request", {first_name:"ניקוי בדיקה",phone:"0509998877",lat:RQ_POS[0],lng:RQ_POS[1],device:"cleanup-test"});
    const cleanupId=r.j.id;
    const beforeCleanup=await j("GET","/api/admin/stats",null,null,{cookie});
    r=await j("POST","/api/admin/orderer/delete",{phone:"0509998877"},null,{cookie});
    check("orderer delete requires explicit confirmation",r.status===400);
    r=await j("POST","/api/admin/orderer/delete",{phone:"0509998877",confirm:"DELETE 0509998877"},null,{cookie});
    check("orderer and linked test request removed",r.j.ok&&r.j.requests_deleted===1&&r.j.counters_unchanged);
    r=await j("GET","/api/admin/overview",null,null,{cookie});
    check("cleaned orderer and request absent",!r.j.orderers.some(o=>o.phone==="0509998877")&&!r.j.requests.some(x=>x.id===cleanupId));
    const afterCleanup=await j("GET","/api/admin/stats",null,null,{cookie});
    check("record cleanup preserves durable counters",afterCleanup.j.total_layings===beforeCleanup.j.total_layings);
    r=await j("POST","/api/admin/stats/reset-month",{month:afterCleanup.j.current},null,{cookie});
    check("monthly reset requires confirmation",r.status===400);
    r=await j("POST","/api/admin/stats/reset-month",{month:afterCleanup.j.current,confirm:"RESET "+afterCleanup.j.current});
    check("monthly reset requires admin session",r.status===401);
    const month=afterCleanup.j.current;
    r=await j("POST","/api/admin/stats/reset-month",{month:month,confirm:"RESET "+month},null,{cookie});
    check("monthly reset subtracts only current-month aggregate",r.j.ok&&r.j.removed===afterCleanup.j.current_layings&&r.j.total_done===Math.max(0,afterCleanup.j.total_layings-afterCleanup.j.current_layings));
    const resetStats=await j("GET","/api/admin/stats",null,null,{cookie});
    check("monthly report reset visible",resetStats.j.current_layings===0&&resetStats.j.prev_layings===afterCleanup.j.prev_layings);
    r=await j("POST","/api/admin/stats/reset-month",{month:month,confirm:"RESET "+month},null,{cookie});
    check("repeating reset cannot double subtract",r.j.ok&&r.j.removed===0&&r.j.total_done===resetStats.j.total_layings);

    /* push key endpoint */
    r = await j("GET", "/api/push/key");
    check("push key present", r.j && typeof r.j.key === "string" && r.j.key.length > 20, r.j);
  } catch (e) {
    failures++;
    console.log("FAIL  unexpected exception: " + (e && e.stack || e));
  } finally {
    srv.kill("SIGTERM");
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL TESTS PASSED");
  process.exit(failures ? 1 : 0);
}
main();
