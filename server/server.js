"use strict";
/* =====================================================================
   Get Tefillin — replica server (Node.js standard library only, v18+)
   Rebuilt against the public frontend contracts of get-tefillin.
   Run:  node server/server.js     (PORT env, default 8080)
   Data: server/../data/ (DATA_DIR env to override)
   Admin code + VAPID keys are generated on first run into config.json
   and printed to the console once. Keep config.json private.
   ===================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { Store } = require("./store");
const remote = require("./remote");
const push = require("./push");
const announcements = require("./announcements");
const stands = require("./stands");
const announcementDrafts = new Map();

const PORT = parseInt(process.env.PORT || "8080", 10);
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const CONFIG_FILE = path.join(ROOT, "config.json");
const ADMIN_HTML = fs.readFileSync(path.join(__dirname, "admin.html"), "utf8");

const RING_SECONDS = 60;        // how long a request rings
const RING_RADIUS_KM = 25;      // how far we look for shluchim
const RING_MAX = 5;             // how many shluchim ring at once
const NEARBY_RADIUS_KM = 25;    // requester "near you" list
const LOC_FRESH_MS = 30 * 60000;// shaliach location is usable for 30 min
const DONE_GRACE_MS = 24 * 3600000; // done/cancelled requests are purged after this
const PHOTO_LATE_MS = 6 * 3600000;  // photos are accepted within 6h of completion
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_MAX_PER_REQ = 3;
const SESSION_MS = 12 * 3600000;

/* ---------------- config (admin code, donation url, vapid) ---------------- */
function loadConfig() {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) {}
  if (!cfg) cfg = {};
  let changed = false;
  // ADMIN_CODE env wins (hosting dashboards set it without writing it into logs)
  if (process.env.ADMIN_CODE) { if (cfg.admin_code !== process.env.ADMIN_CODE) { cfg.admin_code = process.env.ADMIN_CODE; changed = true; } }
  else if (!cfg.admin_code) { cfg.admin_code = crypto.randomBytes(5).toString("hex"); changed = true; }
  if (!cfg.session_secret) { cfg.session_secret = crypto.randomBytes(24).toString("hex"); changed = true; }
  if (process.env.DONATION_URL && /^https:\/\//.test(process.env.DONATION_URL)) { cfg.donation_url = process.env.DONATION_URL; }
  if (!cfg.donation_url) {
    // Donation destination supplied by the site owner (matches the live admin and the
    // updated config.js fallback). Change it here or in the admin page after login.
    cfg.donation_url = "https://pub.chabadisrael.co.il/campaign-donation/Tefillin-Now";
    changed = true;
  }
  if (!cfg.vapid) { cfg.vapid = push.generateVapid(); changed = true; }
  if (!cfg.contact) { cfg.contact = "mailto:admin@example.com"; changed = true; }
  if (changed) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log("=== Get Tefillin replica: new config.json created ===");
    console.log("=== Admin credentials stored privately ===");
  }
  return cfg;
}
const CFG = loadConfig();
const store = new Store(DATA_DIR);
const db = store.db;

/* ---------------- helpers ---------------- */
function rid(n) { return crypto.randomBytes(n || 12).toString("hex"); }
function now() { return Date.now(); }
function monthKey(ms, tz) {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(new Date(ms == null ? now() : ms));
    return p; // en-CA gives YYYY-MM
  } catch (e) { return new Date(ms == null ? now() : ms).toISOString().slice(0, 7); }
}
function partsInTz(tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "Asia/Jerusalem", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const out = { day: 0, min: 0 };
  f.formatToParts(new Date()).forEach(function (p) {
    if (p.type === "weekday") out.day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.value];
    if (p.type === "hour") out.h = parseInt(p.value, 10) % 24;
    if (p.type === "minute") out.min = parseInt(p.value, 10);
  });
  out.minutes = (out.h || 0) * 60 + out.min;
  return out;
}
/* Approximate Shabbat gate for the Jerusalem area: Friday 15:30 until Saturday 20:00.
   The original site gated alerts on Shabbat; exact candle-lighting times are a
   deliberate simplification, documented in the README. */
function isShabbat(tz) {
  const p = partsInTz(tz);
  if (p.day === 5 && p.minutes >= 15 * 60 + 30) return true;
  if (p.day === 6 && p.minutes < 20 * 60) return true;
  return false;
}
function withinHours(sh) {
  const h = sh.hours;
  if (!h || !h.on) return true;
  const p = partsInTz(sh.tz);
  const d = h.days && h.days[p.day];
  if (!d) return false;
  return p.minutes >= d[0] && p.minutes < d[1];
}
function alertState(sh) {
  if (sh.override_until && sh.override_until > now()) return { alerts: true, alerts_why: "override" };
  if (isShabbat(sh.tz)) return { alerts: false, alerts_why: "shabbat" };
  if (!withinHours(sh)) return { alerts: false, alerts_why: "outside" };
  return { alerts: true };
}
function km(a, b) {
  const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
  const s = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}
const SPEED_KMH = { foot: 5, bike: 15, car: 30 };
function etaMin(kmVal, transport) {
  const v = SPEED_KMH[transport] || SPEED_KMH.foot;
  return Math.max(1, Math.round((kmVal * 1.3 / v) * 60)); // x1.3 straight-line to road
}
function json(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers || {}));
  res.end(body);
}
function fail(res, code, status) { json(res, status || 200, { ok: false, code: code }); }
function readBody(req, limit, raw) {
  return new Promise(function (resolve, reject) {
    const chunks = []; let n = 0;
    req.on("data", function (c) { n += c.length; if (n > (limit || 1024 * 1024)) { reject(new Error("too_big")); req.destroy(); return } chunks.push(c); });
    req.on("end", function () {
      const buf = Buffer.concat(chunks);
      if (raw) { resolve(buf); return }
      try { resolve(chunks.length ? JSON.parse(buf.toString("utf8")) : {}); } catch (e) { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}
function token(req) { return String(req.headers["x-token"] || ""); }
function digits(s) { return String(s || "").replace(/\D/g, ""); }
function validPhone(p) { return digits(p).length >= 9; }
function monthCountFor(shId) {
  const mk = monthKey();
  let n = 0;
  Object.values(db.requests).forEach(function (r) { if (r.shaliach_id === shId && r.status === "done" && monthKey(r.done_at) === mk) n++; });
  return n;
}
function shMonth(sh) { return monthCountFor(sh.id); }

/* shaliach public cards */
function nearbyCard(sh, pos) {
  const k = km(pos, [sh.lat, sh.lng]);
  return { name: sh.name, lat: sh.lat, lng: sh.lng, km: Math.round(k * 100) / 100, eta_min: etaMin(k, sh.transport), transport: sh.transport, langs: sh.langs || [], photo: sh.photo || null };
}
function shaliachFresh(sh) {
  return Number.isFinite(sh.lat) && Number.isFinite(sh.lng) && (now() - (sh.loc_at || 0)) < LOC_FRESH_MS;
}
/* A coverage area is an explicit private opt-in, never a live-map location. */
function validGroupInvite(u) { try { const x=new URL(u);return x.protocol==="https:" && x.hostname==="chat.whatsapp.com" && !x.username && !x.password && !x.port && /^\/[a-zA-Z0-9]{10,80}\/?$/.test(x.pathname) && u.length<=500; } catch(e){return false} }
function coverageValid(c) {
  return !!(c && c.enabled === true && Number.isFinite(c.lat) && Math.abs(c.lat) <= 90 && Number.isFinite(c.lng) && Math.abs(c.lng) <= 180 && Number.isFinite(c.radius_km) && c.radius_km >= 1 && c.radius_km <= 100 && typeof c.label === "string" && c.label.trim());
}
function dispatchDistance(sh, r) {
  if (sh.mode === "off" || activeJob(sh.id) || !alertState(sh).alerts) return null;
  const pos = [r.lat, r.lng], c = sh.coverage;
  const live = shaliachFresh(sh) ? km(pos, [sh.lat, sh.lng]) : Infinity;
  const fixed = coverageValid(c) ? km(pos, [c.lat, c.lng]) : Infinity;
  if (live <= RING_RADIUS_KM) return live;
  if (coverageValid(c) && fixed <= c.radius_km) return fixed;
  return null;
}
function liveShluchim(pos, radiusKm) {
  return Object.values(db.shluchim)
    .filter(function (sh) { return sh.mode !== "off" && shaliachFresh(sh) && alertState(sh).alerts && !activeJob(sh.id); })
    .map(function (sh) { return { sh: sh, km: km(pos, [sh.lat, sh.lng]) }; })
    .filter(function (x) { return x.km <= radiusKm; })
    .sort(function (a, b) { return a.km - b.km; });
}
function findShByToken(tok) {
  return Object.values(db.shluchim).find(function (s) { return s.token === tok; }) || null;
}
function findReq(id) { return db.requests[id] || null; }
function activeJob(shId) {
  return Object.values(db.requests).find(function (r) { return r.shaliach_id === shId && (r.status === "accepted" || r.status === "arrived"); }) || null;
}

/* ring / notify */
function ringCandidates(req) {
  return Object.values(db.shluchim).map(sh => ({sh:sh,km:dispatchDistance(sh,req)}))
    .filter(x => x.km !== null && !(req.declined && req.declined[x.sh.id]))
    .sort((a,b) => a.km-b.km)
    .slice(0, RING_MAX)
    .map(function (x) { return x.sh.id; });
}
function startRing(req) {
  req.ring_started = now();
  req.candidates = ringCandidates(req);
  req.notified = req.candidates.length;
  req.screen_seen={};req.push_accepted=0;req.push_failed=0;
  // background alerts (web push) for candidates with subscriptions
  req.candidates.forEach(function (sid) {
    const sh = db.shluchim[sid];
    if (!sh || !(sh.push || []).length) return;
    if (!alertState(sh).alerts) return;
    push.sendToShaliach(CFG.vapid, sh, { type: "req", id: req.id, title: "Get Tefillin", body: "בקשת תפילין חדשה באזור הפעילות שלך", url: "/?r=" + req.id + "#vol" }, CFG.contact, function (gone) {
      sh.push = (sh.push || []).filter(function (s) { return s.endpoint !== gone.endpoint; }); store.save();
    }).then(function(accepted){req.push_accepted=(req.push_accepted||0)+accepted;req.push_failed=(req.push_failed||0)+Math.max(0,(sh.push||[]).length-accepted);store.save()}).catch(function(){req.push_failed=(req.push_failed||0)+1;store.save()});
  });
}
function ringLeft(req) {
  if (req.status !== "open" || !req.ring_started) return 0;
  return Math.max(0, RING_SECONDS - Math.floor((now() - req.ring_started) / 1000));
}

/* request views */
function reqViewForRequester(r) {
  const out = { ok: true, status: r.status, lat: r.lat, lng: r.lng, notified: r.notified || 0, screen_seen: Object.keys(r.screen_seen||{}).length, push_accepted:r.push_accepted||0, push_failed:r.push_failed||0, ring_left_s: ringLeft(r) };
  if (r.shaliach_id && db.shluchim[r.shaliach_id]) {
    const sh = db.shluchim[r.shaliach_id];
    const k = shaliachFresh(sh) ? km([r.lat, r.lng], [sh.lat, sh.lng]) : null;
    out.shaliach = {
      name: sh.name, phone: sh.phone, lat: sh.lat, lng: sh.lng,
      km: k == null ? null : Math.round(k * 100) / 100,
      eta_min: k == null ? null : etaMin(k, sh.transport),
      loc_age_s: sh.loc_at ? Math.round((now() - sh.loc_at) / 1000) : null,
      transport: sh.transport, done_count: sh.done_count || 0, langs: sh.langs || [], photo: sh.photo || null
    };
  }
  return out;
}
function ringItem(r, sh) {
  const k = shaliachFresh(sh) ? km([sh.lat, sh.lng], [r.lat, r.lng]) : null;
  return { id: r.id, first_name: r.first_name, km: k == null ? null : Math.round(k * 100) / 100, eta_min: k == null ? null : etaMin(k, sh.transport), ring_left_s: ringLeft(r), lang: r.lang || null };
}
function jobView(r, sh) {
  const k = shaliachFresh(sh) ? km([sh.lat, sh.lng], [r.lat, r.lng]) : null;
  return { id: r.id, first_name: r.first_name, phone: r.phone, lat: r.lat, lng: r.lng, km: k == null ? null : Math.round(k * 100) / 100, eta_min: k == null ? null : etaMin(k, sh.transport), lang: r.lang || null, status: r.status };
}
function meView(sh) {
  const a = alertState(sh);
  return {
    name: sh.name, phone: sh.phone, city: sh.city || "", transport: sh.transport, langs: sh.langs || [],
    updates_group_url: db.settings.updates_group_url || null,
    mode: sh.mode, hours: sh.hours || { on: false, days: [null, null, null, null, null, null, null] }, tz: sh.tz || "Asia/Jerusalem",
    alerts: a.alerts, alerts_why: a.alerts ? undefined : a.alerts_why, override_until: sh.override_until || undefined,
    coverage: coverageValid(sh.coverage) ? sh.coverage : null, location_ready: shaliachFresh(sh),location_age_s:sh.loc_at?Math.round((now()-sh.loc_at)/1000):null,push_devices: (sh.push || []).length, done_count: sh.done_count || 0, month_count: shMonth(sh), photo: sh.photo || null
  };
}

/* chat */
function chatView(r, viewerRole, after, lang) {
  const msgs = (r.chat || []).filter(function (m) { return m.id > after; }).map(function (m) {
    const out = { id: m.id, me: m.from === viewerRole, kind: m.kind, at: m.at };
    if (m.kind === "phrase") out.phrase = m.phrase;
    else { out.text = m.text; out.lang = m.lang; if (m.lang && lang && m.lang !== lang) out.need_tr = true; }
    return out;
  });
  return { ok: true, msgs: msgs };
}
function chatSay(r, fromRole, body) {
  const lang = String(body.lang || "he");
  if (!r.chat) { r.chat = []; r.chat_seq = 0; }
  const rateKey = fromRole + ":" + r.id;
  chatRate[rateKey] = (chatRate[rateKey] || []).filter(function (t) { return now() - t < 60000; });
  if (chatRate[rateKey].length >= 20) return { code: "rate" };
  chatRate[rateKey].push(now());
  if (body.phrase) {
    r.chat.push({ id: ++r.chat_seq, from: fromRole, kind: "phrase", phrase: String(body.phrase).slice(0, 24), at: now() });
  } else {
    const text = String(body.text || "").trim();
    if (!text || text.length > 500) return { code: "text" };
    r.chat.push({ id: ++r.chat_seq, from: fromRole, kind: "text", text: text, lang: lang, at: now() });
  }
  store.save();
  return { ok: true };
}
const chatRate = {};

/* simple per-IP rate limit for new requests */
const ipRate = {};
function ipLimited(ip) {
  ipRate[ip] = (ipRate[ip] || []).filter(function (t) { return now() - t < 600000; });
  if(Object.keys(ipRate).length>10000)delete ipRate[Object.keys(ipRate)[0]];
  if (ipRate[ip].length >= 8) return true;
  ipRate[ip].push(now());
  return false;
}

/* admin session (HMAC-signed cookie) */
function signSession(exp) {
  const payload = "adm." + exp;
  const mac = crypto.createHmac("sha256", CFG.session_secret).update(payload).digest("hex");
  return payload + "." + mac;
}
function sessionOk(req) {
  const m = /(?:^|;\s*)tn_adm=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const p = m[1].split(".");
  if (p.length !== 3 || p[0] !== "adm") return false;
  const exp = parseInt(p[1], 10);
  if (!exp || exp < now()) return false;
  const mac = crypto.createHmac("sha256", CFG.session_secret).update("adm." + p[1]).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(p[2])); } catch (e) { return false; }
}

/* periodic purge of finished requests */
function purge() {
  let changed = false;
  Object.values(db.requests).forEach(function (r) {
    const end = r.done_at || r.cancelled_at;
    if (end && now() - end > DONE_GRACE_MS) { delete db.requests[r.id]; changed = true; }
  });
  if (changed) store.save();
}
setInterval(purge, 10 * 60000);

/* ---------------- API ---------------- */
async function api(req, res, pathname, query) {
  const seg = pathname.split("/").filter(Boolean); // ["api", ...]
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  /* GET /api/config */
  if (pathname === "/api/config" && req.method === "GET") return json(res, 200, { ok: true, donation_url: CFG.donation_url });

  /* GET /api/bulletin — public announcement + optional stats strip for the app home screen */
  if (pathname === "/api/bulletin" && req.method === "GET") {
    const st = db.settings || {};
    const mk = monthKey();
    return json(res, 200, {
      ok: true,
      announcement: st.announcement || null,
      stats: st.stats_visible ? { month: mk, month_count: (db.counters.by_month || {})[mk] || 0, total_done: db.counters.total_done || 0 } : null
    });
  }

  /* Announcement inbox and opt-in devices. No phone numbers exposed. */
  if (pathname === "/api/announcements" && req.method === "GET") {
    const sh = findShByToken(token(req));
    const rq=db.requests[String(req.headers["x-request-id"]||"")];
    const validRequester=rq && rq.token===String(req.headers["x-request-token"]||"");
    const dev=String(req.headers["x-announcement-device"]||"");
    const subscribedDevice=/^[a-f0-9]{24,64}$/.test(dev) && (db.announcement_devices||{})[crypto.createHash("sha256").update(dev).digest("hex")];
    const items = (db.settings.announcements || []).filter(a => sh || (a.audience === "all" && (validRequester || subscribedDevice))).slice(-10)
      .map(a => ({id:a.id,text:a.text,link:a.link,at:a.at}));
    return json(res,200,{ok:true,items:items});
  }
  if (pathname === "/api/announcements/subscribe" && req.method === "POST") {
    const b = await readBody(req), device=String(b.device||"");
    if (!/^[a-f0-9]{24,64}$/.test(device)) return fail(res,"state",400);
    const key = crypto.createHash("sha256").update(device).digest("hex");
    db.announcement_devices = db.announcement_devices || {};
    if (b.remove === true) { delete db.announcement_devices[key]; store.save(); return json(res,200,{ok:true}); }
    if (!announcements.validSub(b.sub)) return fail(res,"subscription",400);
    if (ipLimited(ip)) return fail(res,"rate",429);
    if (!db.announcement_devices[key] && Object.keys(db.announcement_devices).length>=10000) return fail(res,"capacity",429);
    db.announcement_devices[key]={sub:b.sub,at:now()};store.save();return json(res,200,{ok:true});
  }

  if(pathname==="/api/stands" && req.method==="GET"){
    let list=Object.values(db.stands||{}).filter(s=>s.active).map(s=>stands.publicView(s));
    if(query.lat!==undefined&&query.lng!==undefined){const pos=[Number(query.lat),Number(query.lng)];if(!Number.isFinite(pos[0])||!Number.isFinite(pos[1])||Math.abs(pos[0])>90||Math.abs(pos[1])>180)return fail(res,"location",400);list=list.map(s=>Object.assign(s,{km:Math.round(km(pos,[s.lat,s.lng])*10)/10})).filter(s=>s.km<=100).sort((a,b)=>a.km-b.km);}
    if(query.bounds){const b=query.bounds.split(',').map(Number);if(b.length!==4||b.some(x=>!Number.isFinite(x)))return fail(res,"bounds",400);list=list.filter(s=>s.lat>=b[1]&&s.lat<=b[3]&&(b[0]<=b[2]?(s.lng>=b[0]&&s.lng<=b[2]):(s.lng>=b[0]||s.lng<=b[2])));}
    if(query.open==="1")list=list.filter(s=>s.open_now);
    const total=list.length;return json(res,200,{ok:true,source_sync:db.stand_source_sync||null,stands:list.slice(0,1000),total,limited:total>1000},{"cache-control":"public, max-age=30"});
  }

  /* GET /api/push/key */
  if (pathname === "/api/push/key" && req.method === "GET") return json(res, 200, { key: CFG.vapid.pub });

  /* GET /api/world-map: public availability, no identity/contact/precise location. */
  if (pathname === "/api/world-map" && req.method === "GET") {
    const b = String(query.bounds || "-180,-85,180,85").split(",").map(Number);
    const z = Math.max(1, Math.min(18, Math.floor(Number(query.zoom) || 2)));
    if (b.length !== 4 || b.some(x => !Number.isFinite(x)) || b[0] < -180 || b[0] > 180 || b[2] < -180 || b[2] > 180 || b[1] < -90 || b[3] > 90 || b[1] > b[3]) return fail(res, "bounds", 400);
    if (!worldSnapshot || now() - worldSnapshot.at > 5000) {
      const busy = new Set(Object.values(db.requests).filter(r => r.status === "accepted" || r.status === "arrived").map(r => r.shaliach_id));
      const points = Object.values(db.shluchim).filter(sh => sh.mode === "available" && shaliachFresh(sh) && now() - (sh.loc_at || 0) < 120000 && alertState(sh).alerts && !busy.has(sh.id) && Number.isFinite(sh.lat) && Number.isFinite(sh.lng))
        .map(sh => ({lat: +sh.lat.toFixed(2), lng: +sh.lng.toFixed(2)}));
      const extent=points.length?points.reduce((b,p)=>[Math.min(b[0],p.lat),Math.min(b[1],p.lng),Math.max(b[2],p.lat),Math.max(b[3],p.lng)],[85,180,-85,-180]):null;
      worldSnapshot = {at: now(), points: points,extent};worldResponses.clear();
    }
    const cacheKey=z+":"+b.join(",");let result=worldResponses.get(cacheKey);
    if(!result){const clusters=require("./world-map").view(worldSnapshot.points,b,z);
      result={ok:true,at:worldSnapshot.at,total:worldSnapshot.points.length,clusters:clusters.slice(0,1000),limited:clusters.length>1000,refresh_seconds:15,extent:worldSnapshot.extent};
      if(worldResponses.size>=128)worldResponses.delete(worldResponses.keys().next().value);worldResponses.set(cacheKey,result);
    }
    return json(res,200,result,{"cache-control":"public, max-age=5, s-maxage=10"});
  }

  /* GET /api/nearby */
  if (pathname === "/api/nearby" && req.method === "GET") {
    const lat = parseFloat(query.lat), lng = parseFloat(query.lng);
    if (!isFinite(lat) || !isFinite(lng)) return fail(res, "location", 400);
    const list = liveShluchim([lat, lng], NEARBY_RADIUS_KM).slice(0, 10).map(function (x) { return nearbyCard(x.sh, [lat, lng]); });
    return json(res, 200, { ok: true, shluchim: list, total_done: db.counters.total_done || 0 });
  }

  /* POST /api/request — new tefillin request */
  if (pathname === "/api/request" && req.method === "POST") {
    const b = await readBody(req);
    const name = String(b.first_name || "").trim();
    if (name.length < 2) return fail(res, "first_name");
    if (!validPhone(b.phone)) return fail(res, "phone");
    const lat = +b.lat, lng = +b.lng;
    if (!isFinite(lat) || !isFinite(lng)) return fail(res, "location");
    if (ipLimited(ip)) return fail(res, "rate");
    // one open request per device at a time
    const existing = Object.values(db.requests).find(function (r) { return r.device === b.device && ["open", "waiting", "accepted", "arrived"].indexOf(r.status) >= 0; });
    if (existing) return json(res, 200, { ok: true, id: existing.id, token: existing.token, notified: existing.notified || 0 });
    const r = {
      id: rid(12), token: rid(16), first_name: name, phone: String(b.phone).trim(),
      lat: lat, lng: lng, address: String(b.address || ""), device: String(b.device || ""), loc_source: String(b.loc_source || ""), lang: String(b.lang || "he"),
      status: "open", created_at: now(), declined: {}, chat: [], chat_seq: 0
    };
    startRing(r);
    db.requests[r.id] = r;
    // permanent orderer registry (admin backup); survives the 24h request purge
    const ph = digits(r.phone);
    const o = db.orderers[ph] || { name: name, phone: r.phone, first_at: now(), count: 0 };
    o.name = name; o.phone = r.phone; o.last_at = now(); o.count = (o.count || 0) + 1;
    db.orderers[ph] = o;
    store.save();
    return json(res, 200, { ok: true, id: r.id, token: r.token, notified: r.notified });
  }

  /* /api/request/:id[...] */
  if (seg[1] === "request" && seg[2]) {
    const r = findReq(seg[2]);
    if (!r) return fail(res, "not_found", 404);
    if (token(req) !== r.token) return fail(res, "auth", 401);
    const sub = seg[3] || "";
    if (req.method === "GET" && !sub) return json(res, 200, reqViewForRequester(r));
    if (sub === "loc" && req.method === "POST") {
      const b = await readBody(req);
      if (isFinite(+b.lat) && isFinite(+b.lng)) { r.lat = +b.lat; r.lng = +b.lng; store.save(); }
      return json(res, 200, { ok: true });
    }
    if (sub === "cancel" && req.method === "POST") {
      if (["done", "cancelled"].indexOf(r.status) < 0) { r.status = "cancelled"; r.cancelled_at = now(); store.save(); }
      return json(res, 200, { ok: true });
    }
    if (sub === "retry" && req.method === "POST") {
      if (r.status !== "open" && r.status !== "waiting") return fail(res, "state");
      r.status = "open"; startRing(r); store.save();
      return json(res, 200, { ok: true, notified: r.notified });
    }
    if (sub === "wait" && req.method === "POST") {
      if (r.status !== "open") return fail(res, "state");
      r.status = "waiting"; store.save();
      return json(res, 200, { ok: true });
    }
    if (sub === "chat" && req.method === "GET") return json(res, 200, chatView(r, "r", parseInt(query.after || "0", 10) || 0, query.lang));
    if (sub === "say" && req.method === "POST") {
      if (["accepted", "arrived"].indexOf(r.status) < 0) return fail(res, "state");
      const b = await readBody(req);
      const out = chatSay(r, "r", b);
      return out.ok ? json(res, 200, { ok: true }) : fail(res, out.code);
    }
    return fail(res, "not_found", 404);
  }

  /* POST /api/photo — consented wall photo upload (jpeg body) */
  if (pathname === "/api/photo" && req.method === "POST") {
    const r = findReq(String(query.req || ""));
    if (!r) return fail(res, "not_found", 404);
    const role = query.role === "s" ? "s" : "r";
    const tok = token(req);
    const allowed = role === "r" ? tok === r.token : (r.shaliach_id && db.shluchim[r.shaliach_id] && db.shluchim[r.shaliach_id].token === tok);
    if (!allowed) return fail(res, "auth", 401);
    if (query.consent !== "1") return fail(res, "consent");
    if (String(req.headers["content-type"] || "").indexOf("image/jpeg") !== 0) return fail(res, "photo_type");
    if (r.status !== "done" || !r.done_at || now() - r.done_at > PHOTO_LATE_MS) return fail(res, "photo_late");
    const existing = Object.values(db.photos).filter(function (p) { return p.req_id === r.id; });
    if (existing.length >= PHOTO_MAX_PER_REQ) return fail(res, "photo_many");
    const body = await readBody(req, PHOTO_MAX_BYTES + 1, true);
    if (body.length > PHOTO_MAX_BYTES) return fail(res, "photo_big");
    if (body.length < 100 || body[0] !== 0xff || body[1] !== 0xd8) return fail(res, "photo_type");
    const p = { id: rid(12), req_id: r.id, role: role, w: parseInt(query.w || "0", 10) || 0, h: parseInt(query.h || "0", 10) || 0, approved: false, at: now(), file: "" };
    p.file = p.id + ".jpg";
    fs.writeFileSync(path.join(store.photoDir, p.file), body);
    await remote.putPhoto(p.file, body);
    db.photos[p.id] = p; store.save();
    return json(res, 200, { ok: true, id: p.id });
  }

  /* GET /api/photo/:id — approved photos are public; pending need the admin session */
  if (seg[1] === "photo" && seg[2] && req.method === "GET") {
    const p = db.photos[seg[2]];
    if (!p) return fail(res, "not_found", 404);
    if (!p.approved && !sessionOk(req)) return fail(res, "not_found", 404);
    const fp = path.join(store.photoDir, p.file);
    if (!fs.existsSync(fp)) {
      const buf = await remote.getPhoto(p.file);
      if (!buf) return fail(res, "not_found", 404);
      try { fs.writeFileSync(fp, buf); } catch (e) {}
    }
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" });
    return fs.createReadStream(fp).pipe(res);
  }

  /* GET /api/wall[/latest] — public tefillin wall */
  if (pathname === "/api/wall/latest" && req.method === "GET") {
    const photos = Object.values(db.photos).filter(function (p) { return p.approved; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 10)
      .map(function (p) { return { id: p.id, w: p.w, h: p.h }; });
    return json(res, 200, { ok: true, photos: photos, month_count: db.counters.by_month[monthKey()] || 0 });
  }
  if (pathname === "/api/wall" && req.method === "GET") {
    const cur = monthKey();
    const m = /^20\d\d-(0[1-9]|1[0-2])$/.test(query.m || "") ? query.m : cur;
    const byMonth = db.counters.by_month || {};
    const photosAll = Object.values(db.photos).filter(function (p) { return p.approved; });
    const photos = photosAll.filter(function (p) { return monthKey(p.at) === m; }).sort(function (a, b) { return b.at - a.at; })
      .map(function (p) { return { id: p.id, w: p.w, h: p.h }; });
    // series: last 12 months ending at m
    const series = [];
    (function () { let y = +m.slice(0, 4), mo = +m.slice(5, 7);
      for (let i = 11; i >= 0; i--) { let yy = y, mm = mo - i; while (mm < 1) { mm += 12; yy--; } const key = yy + "-" + (mm < 10 ? "0" : "") + mm; series.push({ m: key, n: byMonth[key] || 0 }); }
    })();
    const prevK = series.length >= 2 ? series[series.length - 2].m : cur;
    const prevCount = byMonth[prevK] || 0;
    const count = byMonth[m] || 0;
    const pct = prevCount > 0 ? Math.round((count - prevCount) / prevCount * 100) : 0;
    const archive = Object.keys(byMonth).sort().reverse().map(function (k) {
      return { m: k, n: byMonth[k], photos: photosAll.filter(function (p) { return monthKey(p.at) === k; }).length };
    });
    return json(res, 200, { ok: true, month: m, is_current: m === cur, current: cur, count: count, prev_month: prevK, prev_count: prevCount, pct: pct, series: series, photos: photos, archive: archive });
  }

  /* POST /api/deletion-request — public data-deletion form */
  if (pathname === "/api/deletion-request" && req.method === "POST") {
    const b = await readBody(req);
    if (digits(b.phone).length < 7) return json(res, 200, { ok: false, error: "invalid phone" });
    db.deletions.push({ id: rid(8), phone: String(b.phone).trim(), name: String(b.name || "").trim(), role: String(b.role || "").trim(), note: String(b.note || "").trim().slice(0, 500), at: now(), done: false });
    store.save();
    return json(res, 200, { ok: true });
  }

  /* ---------------- shaliach ---------------- */
  if (seg[1] === "shaliach") {
    const sub = seg[2] || "";

    if (sub === "register" && req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim();
      if (name.length < 2) return fail(res, "name");
      if (!validPhone(b.phone)) return fail(res, "phone");
      if (["foot", "bike", "car"].indexOf(b.transport) < 0) return fail(res, "transport");
      if (b.has_tefillin !== true) return fail(res, "has_tefillin");
      const dup = Object.values(db.shluchim).find(function (s) { return digits(s.phone) === digits(b.phone); });
      if (dup) {
        // A returning shaliach reconnects to his existing record — no "already registered" error.
        return json(res, 200, { ok: true, token: dup.token, shaliach: meView(dup) });
      }
      const sh = {
        id: rid(12), token: rid(16), name: name, phone: String(b.phone).trim(), city: String(b.city || "").trim(),
        transport: b.transport, has_tefillin: true, langs: Array.isArray(b.langs) && b.langs.length ? b.langs.slice(0, 8) : [String(b.lang || "he")],
        lang: String(b.lang || "he"), tz: String(b.tz || "Asia/Jerusalem"),
        mode: "off", hours: { on: false, days: [null, null, null, null, null, null, null] },
        lat: null, lng: null, loc_at: 0, created_at: now(), done_count: 0, photo: null, push: []
      };
      db.shluchim[sh.id] = sh; store.save();
      return json(res, 200, { ok: true, token: sh.token, shaliach: meView(sh) });
    }

    /* GET /api/shaliach/photo/:photoId — public shaliach photo */
    if (sub === "photo" && seg[3] && req.method === "GET") {
      const owner = Object.values(db.shluchim).find(function (s) { return s.photo === seg[3]; });
      const f = owner ? path.join(store.photoDir, "sh-" + owner.photo + ".jpg") : null;
      if (!f) return fail(res,"not_found",404);
      if(!fs.existsSync(f)){const buf=await remote.getPhoto("sh-"+owner.photo+".jpg");if(buf)fs.writeFileSync(f,buf);}
      if(!fs.existsSync(f))return fail(res,"not_found",404);
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=300" });
      return fs.createReadStream(f).pipe(res);
    }

    // everything below needs a registered shaliach token
    const sh = findShByToken(token(req));
    if (!sh) return fail(res, "auth", 401);

    /* POST /api/shaliach/photo — the shaliach sets/replaces his own photo (jpeg body)
       DELETE /api/shaliach/photo — removes it */
    if (sub === "photo" && req.method === "POST") {
      if (String(req.headers["content-type"] || "").indexOf("image/jpeg") !== 0) return fail(res, "photo_type");
      const body = await readBody(req, PHOTO_MAX_BYTES + 1, true);
      if (body.length > PHOTO_MAX_BYTES) return fail(res, "photo_big");
      if (body.length < 100 || body[0] !== 0xff || body[1] !== 0xd8) return fail(res, "photo_type");
      const newPhoto=rid(12);await remote.putPhoto("sh-"+newPhoto+".jpg",body);
      if (sh.photo) { try { fs.unlinkSync(path.join(store.photoDir, "sh-" + sh.photo + ".jpg")); } catch (e) {} remote.delPhoto("sh-" + sh.photo + ".jpg"); }
      sh.photo = newPhoto;
      fs.writeFileSync(path.join(store.photoDir, "sh-" + sh.photo + ".jpg"), body);

      store.save();
      return json(res, 200, { ok: true, photo: sh.photo });
    }
    if (sub === "photo" && req.method === "DELETE") {
      if (sh.photo) { try { fs.unlinkSync(path.join(store.photoDir, "sh-" + sh.photo + ".jpg")); } catch (e) {} sh.photo = null; store.save(); }
      return json(res, 200, { ok: true });
    }

    if (sub === "update" && req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim();
      if (name.length < 2) return fail(res, "name");
      if (!validPhone(b.phone)) return fail(res, "phone");
      if (["foot", "bike", "car"].indexOf(b.transport) < 0) return fail(res, "transport");
      sh.name = name; sh.phone = String(b.phone).trim(); sh.city = String(b.city || "").trim(); sh.transport = b.transport;
      if (Array.isArray(b.langs) && b.langs.length) sh.langs = b.langs.slice(0, 8);
      if (b.tz) sh.tz = String(b.tz);
      store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "delete" && req.method === "POST") {
      if (activeJob(sh.id)) return fail(res, "busy");
      delete db.shluchim[sh.id]; store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "mode" && req.method === "POST") {
      const b = await readBody(req);
      const mode = ["off", "standby", "available"].indexOf(b.mode) >= 0 ? b.mode : null;
      if (!mode) return fail(res, "state");
      sh.mode = mode;
      if (b.tz) sh.tz = String(b.tz);
      if (isFinite(+b.lat) && isFinite(+b.lng)) { sh.lat = +b.lat; sh.lng = +b.lng; sh.loc_at = now(); }
      if (mode !== "off" && !alertState(sh).alerts) sh.override_until = now() + 12 * 3600000; // explicit choice wins for 12h
      if (mode === "off") sh.override_until = 0;
      store.save();
      const a = alertState(sh);
      return json(res, 200, { ok: true, mode: sh.mode, hours: sh.hours, tz: sh.tz, alerts: a.alerts, alerts_why: a.alerts ? undefined : a.alerts_why, override_until: sh.override_until || undefined, push_devices: (sh.push || []).length });
    }

    if (sub === "hours" && req.method === "POST") {
      const b = await readBody(req);
      const h = b.hours || {};
      const days = Array.isArray(h.days) ? h.days.slice(0, 7).map(function (d) {
        if (!Array.isArray(d)) return null;
        const a = parseInt(d[0], 10), c = parseInt(d[1], 10);
        return (isFinite(a) && isFinite(c) && a >= 0 && c <= 1440 && a < c) ? [a, c] : null;
      }) : [null, null, null, null, null, null, null];
      while (days.length < 7) days.push(null);
      sh.hours = { on: !!h.on, days: days };
      if (b.tz) sh.tz = String(b.tz);
      store.save();
      const a = alertState(sh);
      return json(res, 200, { ok: true, mode: sh.mode, hours: sh.hours, tz: sh.tz, alerts: a.alerts, alerts_why: a.alerts ? undefined : a.alerts_why, override_until: sh.override_until || undefined, push_devices: (sh.push || []).length });
    }

    if (sub === "coverage" && req.method === "POST") {
      const b = await readBody(req);
      if (b.enabled === false) sh.coverage = null;
      else {
        const c = {enabled:b.enabled, label:typeof b.label === "string" ? b.label.trim().slice(0,200) : "",lat:b.lat,lng:b.lng,radius_km:b.radius_km};
        if (!coverageValid(c)) return fail(res, "coverage", 400);
        sh.coverage = c;
      }
      store.save(); return json(res, 200, {ok:true,coverage:sh.coverage});
    }

    if (sub === "poll" && req.method === "POST") {
      const b = await readBody(req);
      const checkpointPresence=!sh.last_seen || now()-sh.last_seen>=60000;
      if(checkpointPresence)sh.last_seen=now();
      if (isFinite(+b.lat) && isFinite(+b.lng)) { sh.lat = +b.lat; sh.lng = +b.lng; sh.loc_at = now(); }
      // screen open again after an offline downgrade
      if (b.available === true && sh.mode === "standby") { /* stays standby until the shaliach taps */ }
      const job = activeJob(sh.id);
      let dispatchChanged=false;
      if(!job&&sh.mode!=="off"&&alertState(sh).alerts){
        Object.values(db.requests).filter(r=>r.status==="open"&&ringLeft(r)>0&&!(r.declined||{})[sh.id]&&dispatchDistance(sh,r)!==null).forEach(r=>{
          r.candidates=r.candidates||[];
          if(!r.candidates.includes(sh.id)&&r.candidates.length<RING_MAX){r.candidates.push(sh.id);r.notified=r.candidates.length;dispatchChanged=true;}
        });
      }
      const ringing = Object.values(db.requests)
        .filter(function (r) { return r.status === "open" && ringLeft(r) > 0 && (r.candidates || []).indexOf(sh.id) >= 0 && !(r.declined && r.declined[sh.id]) && sh.mode !== "off" && !job && dispatchDistance(sh,r)!==null; })
        .map(function (r) { if(!(r.screen_seen||{})[sh.id]){r.screen_seen=r.screen_seen||{};r.screen_seen[sh.id]=now();dispatchChanged=true;}return ringItem(r, sh); });
      const waiting = Object.values(db.requests)
        .filter(function (r) { return (r.status === "waiting" || (r.status==="open"&&ringLeft(r)===0)) && now()-r.created_at<24*3600000 && !job && sh.mode!=="off" && dispatchDistance(sh,r)!==null && !(r.declined && r.declined[sh.id]); })
        .sort(function (a, b2) { return a.created_at - b2.created_at; }).slice(0, 20)
        .map(function (r) {
          const k = shaliachFresh(sh) ? km([sh.lat, sh.lng], [r.lat, r.lng]) : null;
          return { id: r.id, first_name: r.first_name, km: k == null ? null : Math.round(k * 100) / 100, age_s: Math.round((now() - r.created_at) / 1000), lang: r.lang || null };
        });
      if(checkpointPresence||dispatchChanged)store.save();
      return json(res, 200, { ok: true, me: meView(sh), waiting: sh.mode === "off" ? [] : waiting, ringing: ringing, job: job ? jobView(job, sh) : null });
    }

    if (sub === "peek" && req.method === "POST") {
      const b = await readBody(req);
      const r = findReq(String(b.id || ""));
      if (isFinite(+b.lat) && isFinite(+b.lng)) { sh.lat = +b.lat; sh.lng = +b.lng; sh.loc_at = now(); store.save(); }
      if (!r || ["done", "cancelled"].indexOf(r.status) >= 0) return json(res, 200, { ok: true, state: "gone" });
      if (r.shaliach_id === sh.id) return json(res, 200, { ok: true, state: "mine" });
      if (r.shaliach_id) return json(res, 200, { ok: true, state: "taken" });
      if (r.status === "open" || r.status === "waiting") {
        const item = ringItem(r, sh);
        if (r.status === "open" && (r.candidates || []).indexOf(sh.id) < 0) { r.candidates = (r.candidates || []).concat(sh.id); store.save(); }
        return json(res, 200, { ok: true, state: "open", item: item });
      }
      return json(res, 200, { ok: true, state: "gone" });
    }

    if (sub === "accept" && req.method === "POST") {
      const b = await readBody(req);
      const r = findReq(String(b.id || ""));
      if (!r) return fail(res, "state");
      if (r.shaliach_id && r.shaliach_id !== sh.id) return fail(res, "taken");
      if (r.status !== "open" && r.status !== "waiting") return fail(res, "state");
      if (activeJob(sh.id)) return fail(res, "busy");
      r.shaliach_id = sh.id; r.status = "accepted"; r.accepted_at = now();
      store.save();
      // notify the other candidates' phones to stand down
      (r.candidates || []).forEach(function (sid) {
        if (sid === sh.id) return;
        const other = db.shluchim[sid];
        if (other && (other.push || []).length) push.sendToShaliach(CFG.vapid, other, { type: "taken", id: r.id, title: "Get Tefillin", body: "הבקשה נתפסה על ידי שליח אחר", url: "/#vol" }, CFG.contact, null);
      });
      return json(res, 200, { ok: true });
    }

    if ((sub === "arrived" || sub === "done" || sub === "release") && req.method === "POST") {
      const b = await readBody(req);
      const r = findReq(String(b.id || ""));
      if (!r || r.shaliach_id !== sh.id) return fail(res, "state");
      if (sub === "arrived") {
        if (r.status !== "accepted") return fail(res, "state");
        r.status = "arrived"; r.arrived_at = now(); store.save();
        return json(res, 200, { ok: true });
      }
      if (sub === "done") {
        if (r.status !== "accepted" && r.status !== "arrived") return fail(res, "state");
        r.status = "done"; r.done_at = now();
        sh.done_count = (sh.done_count || 0) + 1;
        const mk = monthKey();
        db.counters.total_done = (db.counters.total_done || 0) + 1;
        db.counters.by_month[mk] = (db.counters.by_month[mk] || 0) + 1;
        /* monthly participants for the admin report (sets survive the 24h request purge) */
        db.counters.shluchim_by_month = db.counters.shluchim_by_month || {};
        db.counters.shluchim_by_month[mk] = db.counters.shluchim_by_month[mk] || {};
        db.counters.shluchim_by_month[mk][sh.id] = true;
        db.counters.requesters_by_month = db.counters.requesters_by_month || {};
        db.counters.requesters_by_month[mk] = db.counters.requesters_by_month[mk] || {};
        db.counters.requesters_by_month[mk][crypto.createHash("sha1").update(digits(r.phone)).digest("hex").slice(0, 16)] = true;
        store.save();
        return json(res, 200, { ok: true });
      }
      // release: hand the request back to the ring
      if (r.status !== "accepted" && r.status !== "arrived") return fail(res, "state");
      r.declined = r.declined || {}; r.declined[sh.id] = 1;
      r.shaliach_id = null; r.status = "open";
      startRing(r); store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "offline" && req.method === "POST") {
      // sendBeacon from a closing screen: available -> standby
      if (sh.mode === "available" && !activeJob(sh.id)) { sh.mode = "standby"; store.save(); }
      return json(res, 200, { ok: true });
    }

    if (sub === "push" && req.method === "POST") {
      const b = await readBody(req);
      const s = b.sub || {};
      if (!announcements.validSub(s)) return fail(res, "state");
      sh.push = (sh.push || []).filter(function (x) { return x.endpoint !== s.endpoint; });
      sh.push.push({ endpoint: String(s.endpoint), keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } });
      store.save();
      return json(res, 200, { ok: true, push_devices: sh.push.length });
    }

    if (sub === "unpush" && req.method === "POST") {
      const b = await readBody(req).catch(function () { return {}; });
      if (b && b.sub && b.sub.endpoint) sh.push = (sh.push || []).filter(function (x) { return x.endpoint !== b.sub.endpoint; });
      else sh.push = [];
      store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "pushtest" && req.method === "POST") {
      const sent = await push.sendToShaliach(CFG.vapid, sh, { type: "test", title: "Get Tefillin", body: "בדיקת התראות - הכל עובד", url: "/#vol" }, CFG.contact, function (gone) {
        sh.push = (sh.push || []).filter(function (s) { return s.endpoint !== gone.endpoint; }); store.save();
      });
      return json(res, 200, { ok: true, sent: sent > 0 });
    }

    if (sub === "chat" && req.method === "POST") {
      const b = await readBody(req);
      const r = findReq(String(b.id || ""));
      if (!r || r.shaliach_id !== sh.id) return fail(res, "auth", 401);
      return json(res, 200, chatView(r, "s", parseInt(b.after || "0", 10) || 0, b.lang));
    }

    if (sub === "say" && req.method === "POST") {
      const b = await readBody(req);
      const r = findReq(String(b.id || ""));
      if (!r || r.shaliach_id !== sh.id) return fail(res, "auth", 401);
      if (["accepted", "arrived"].indexOf(r.status) < 0) return fail(res, "state");
      const out = chatSay(r, "s", b);
      return out.ok ? json(res, 200, { ok: true }) : fail(res, out.code);
    }

    return fail(res, "not_found", 404);
  }

  /* ---------------- admin ---------------- */
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const b = await readBody(req);
    const okCode = typeof b.code === "string" && b.code.length === CFG.admin_code.length &&
      crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(CFG.admin_code));
    if (!okCode) return fail(res, "auth", 401);
    const exp = now() + SESSION_MS;
    return json(res, 200, { ok: true }, { "set-cookie": "tn_adm=" + signSession(exp) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + Math.floor(SESSION_MS / 1000) });
  }

  if (seg[1] === "admin") {
    if (!sessionOk(req)) return fail(res, "auth", 401);
    const sub = seg[2] || "";

    /* GET /api/admin/stats — monthly report: layings, unique people, participating shluchim, photos,
       current vs previous month, and all-time totals */
    if (sub === "stats" && req.method === "GET") {
      const lay = db.counters.by_month || {};
      const shm = db.counters.shluchim_by_month || {};
      const rqm = db.counters.requesters_by_month || {};
      const phm = db.counters.photos_by_month || {};
      const keys = {};
      [lay, shm, rqm, phm].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = true; }); });
      const months = Object.keys(keys).sort().reverse().map(function (m) {
        return {
          month: m,
          layings: lay[m] || 0,
          people: Object.keys(rqm[m] || {}).length,
          shluchim: Object.keys(shm[m] || {}).length,
          photos: phm[m] || 0
        };
      });
      const cur = monthKey(), prevK = monthKey(now() - 25 * 86400000);
      const curN = lay[cur] || 0, prevN = lay[prevK] || 0;
      return json(res, 200, {
        ok: true,
        current: cur, current_layings: curN,
        prev_month: prevK, prev_layings: prevN,
        pct: prevN ? Math.round(((curN - prevN) / prevN) * 100) : (curN ? 100 : 0),
        total_layings: db.counters.total_done || 0,
        total_shluchim: Object.keys(db.shluchim).length,
        months: months
      });
    }

    /* Admin: get/set the public announcement + stats visibility */
    if (sub === "bulletin" && req.method === "GET") {
      const st = db.settings || {};
      return json(res, 200, { ok: true, announcement: st.announcement || null, stats_visible: !!st.stats_visible, report_email: st.report_email || null, report_paused: st.report_paused !== false, updates_group_url:st.updates_group_url || null });
    }
    if (sub === "bulletin" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b.updates_group_url === "string") {
        const u=b.updates_group_url.trim();
        if(u && !validGroupInvite(u))return fail(res,"group_url",400);
        db.settings.updates_group_url=u||null;
      }
      if (typeof b.announcement === "string") {
        const text = b.announcement.trim().slice(0, 500);
        db.settings.announcement = text || null;
      }
      if (typeof b.stats_visible === "boolean") db.settings.stats_visible = b.stats_visible;
      if (typeof b.report_email === "string") {
        const em = b.report_email.trim().toLowerCase().slice(0, 200);
        if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return fail(res, "bad_email", 400);
        db.settings.report_email = em || null;
      }
      if (typeof b.report_paused === "boolean") db.settings.report_paused=b.report_paused;
      store.save();
      return json(res, 200, { ok: true, announcement: db.settings.announcement, stats_visible: db.settings.stats_visible, report_email: db.settings.report_email,report_paused:db.settings.report_paused!==false,updates_group_url:db.settings.updates_group_url||null });
    }

    if (sub === "overview" && req.method === "GET") {
      const requests = Object.values(db.requests).sort(function (a, b) { return b.created_at - a.created_at; }).slice(0, 100).map(function (r) {
        return { id: r.id, first_name: r.first_name, phone: r.phone, address: r.address, status: r.status, created_at: r.created_at, shaliach_name: r.shaliach_id && db.shluchim[r.shaliach_id] ? db.shluchim[r.shaliach_id].name : "" };
      });
      const shluchim = Object.values(db.shluchim).sort(function (a, b) { return a.created_at - b.created_at; }).map(function (s) {
        return { id: s.id, name: s.name, phone: s.phone, city: s.city, transport: s.transport, mode: s.mode, done_count: s.done_count || 0, month_count: shMonth(s) };
      });
      const pending = Object.values(db.photos).filter(function (p) { return !p.approved; }).sort(function (a, b) { return b.at - a.at; })
        .map(function (p) { return { id: p.id, req_id: p.req_id, role: p.role, w: p.w, h: p.h, at: p.at } });
      const deletions = db.deletions.filter(function (d) { return !d.done; }).sort(function (a, b) { return b.at - a.at; });
      const orderers = Object.values(db.orderers || {}).sort(function (a, b) { return (b.last_at || 0) - (a.last_at || 0); })
        .map(function (o) { return { name: o.name, phone: o.phone, count: o.count || 1, first_at: o.first_at || 0, last_at: o.last_at || 0 }; });
      return json(res, 200, {
        ok: true, donation_url: CFG.donation_url,
        stats: {
          shluchim: shluchim.length,
          requests_open: Object.values(db.requests).filter(function (r) { return ["open", "waiting", "accepted", "arrived"].indexOf(r.status) >= 0; }).length,
          month_done: db.counters.by_month[monthKey()] || 0,
          total_done: db.counters.total_done || 0,
          photos_pending: pending.length,
          deletions_open: deletions.length,
          orderers: orderers.length
        },
        shluchim: shluchim, orderers: orderers, requests: requests, photos_pending: pending, deletions: deletions
      });
    }

    /* POST /api/admin/report/test — send last month's report now (admin only).
       Test sends bypass the monthly guard and never touch last_sent_month,
       so testing can never block the real 1st-of-month send. */
    if (sub === "report" && seg[3] === "test" && req.method === "POST") {
      try {
        const r = await maybeSendMonthlyReport(true, false);
        return json(res, 200, r);
      } catch (e) {
        console.error("report test failed:", e.message);
        return json(res, 200, { ok: false, error: "send_failed" });
      }
    }

    /* POST /api/admin/report/reset-guard — clear last_sent_month (e.g. after a manual send consumed the slot) */
    if (sub === "report" && seg[3] === "reset-guard" && req.method === "POST") {
      const was = db.settings.last_sent_month || null;
      db.settings.last_sent_month = null;
      store.save();
      return json(res, 200, { ok: true, was: was });
    }

    if (sub === "donation" && req.method === "POST") {
      const b = await readBody(req);
      if (!/^https:\/\/.+\..+/.test(String(b.url || ""))) return fail(res, "url");
      CFG.donation_url = String(b.url).trim();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(CFG, null, 2));
      return json(res, 200, { ok: true });
    }

    if (sub === "photo" && req.method === "POST") {
      const b = await readBody(req);
      const p = db.photos[String(b.id || "")];
      if (!p) return fail(res, "not_found", 404);
      if (b.action === "approve") {
        p.approved = true;
        const mk = monthKey(p.at);
        db.counters.photos_by_month[mk] = (db.counters.photos_by_month[mk] || 0) + 1;
        store.save();
        return json(res, 200, { ok: true });
      }
      // reject: delete the file and record
      try { fs.unlinkSync(path.join(store.photoDir, p.file)); } catch (e) {} remote.delPhoto(p.file);
      delete db.photos[p.id]; store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "shaliach" && seg[3] === "delete" && req.method === "POST") {
      const b = await readBody(req);
      const s = db.shluchim[String(b.id || "")];
      if (!s) return fail(res, "not_found", 404);
      if (activeJob(s.id)) return fail(res, "busy");
      delete db.shluchim[s.id]; store.save();
      return json(res, 200, { ok: true });
    }

    if(sub==="stands" && req.method==="GET")return json(res,200,{ok:true,stands:Object.values(db.stands||{}).map(s=>Object.assign({},s,{open_now:stands.openNow(s)}))});
    if(sub==="stands" && seg[3]==="save" && req.method==="POST"){
      const b=await readBody(req),normalized=stands.normalize(b);
      if(!normalized)return fail(res,"stand_fields",400);
      if(b.confirm!=="PUBLISH STAND")return fail(res,"confirmation",400);
      db.stands=db.stands||{};
      if(b.id&&(typeof b.id!=="string"||!/^([a-f0-9]{24})$/.test(b.id)||!Object.prototype.hasOwnProperty.call(db.stands,b.id)))return fail(res,"not_found",404);
      if(!b.id&&Object.keys(db.stands).length>=5000)return fail(res,"capacity",429);
      const id=b.id||rid(12);db.stands[id]=Object.assign({},db.stands[id]||{},{id,created_at:db.stands[id]?db.stands[id].created_at:now()},normalized,{updated_at:now()},db.stands[id]&&db.stands[id].source?{source_customized:true}:{});store.save();
      return json(res,200,{ok:true,stand:db.stands[id]});
    }
    if(sub==="stands" && seg[3]==="delete" && req.method==="POST"){
      const b=await readBody(req);if(b.confirm!=="DELETE STAND "+b.id)return fail(res,"confirmation",400);
      if(typeof b.id!=="string"||!Object.prototype.hasOwnProperty.call(db.stands||{},b.id))return fail(res,"not_found",404);if(db.stands[b.id].source){db.stand_source_suppressed=db.stand_source_suppressed||{};db.stand_source_suppressed[b.id]=true;}delete db.stands[b.id];store.save();return json(res,200,{ok:true});
    }
    if(sub==="dispatch"&&req.method==="GET")return json(res,200,{ok:true,radius_km:RING_RADIUS_KM,shluchim:Object.values(db.shluchim).map(sh=>({id:sh.id,name:sh.name,mode:sh.mode,location_ready:shaliachFresh(sh),coverage_ready:coverageValid(sh.coverage),push_devices:(sh.push||[]).length,alerts:alertState(sh).alerts,busy:!!activeJob(sh.id)})),requests:Object.values(db.requests).filter(r=>r.status==="open"||r.status==="waiting").map(r=>({id:r.id,status:r.status,candidates:(r.candidates||[]).length,screen_seen:Object.keys(r.screen_seen||{}).length,push_accepted:r.push_accepted||0,push_failed:r.push_failed||0,created_at:r.created_at}))});
    if(sub==="health" && req.method==="GET")return json(res,200,{ok:true,uptime_seconds:Math.floor(process.uptime()),inflight:inflight,memory_mb:Math.round(process.memoryUsage().rss/1048576),backup:{enabled:remote.ENABLED,pending:remote.health.pending,last_ok:remote.health.last_ok,last_error:remote.health.last_error}});
    if (sub === "announcements" && req.method === "GET") {
      return json(res,200,{ok:true,shluchim_devices:announcements.targets(db,"shluchim").length,all_devices:announcements.targets(db,"all").length,
        history:(db.settings.announcements||[]).slice(-20).map(a=>({id:a.id,audience:a.audience,text:a.text,link:a.link,at:a.at,state:a.state,total:a.total,accepted:a.accepted,failed:a.failed}))});
    }
    if (sub === "announcements" && seg[3] === "preview" && req.method === "POST") {
      const b=await readBody(req), item=announcements.normalize(b);
      if(!item)return fail(res,"content",400);
      for(const [k,v] of announcementDrafts)if(now()-v.at>300000)announcementDrafts.delete(k);
      if(announcementDrafts.size>=50)return fail(res,"rate",429);
      const id=rid(16);announcementDrafts.set(id,{item:item,at:now()});
      return json(res,200,{ok:true,id:id,item:item,devices:announcements.targets(db,item.audience).length});
    }
    if (sub === "announcements" && seg[3] === "send" && req.method === "POST") {
      const b=await readBody(req), history=db.settings.announcements||[];
      const existing=history.find(a=>a.id===b.id);
      if(existing)return json(res,200,{ok:true,id:existing.id,state:existing.state,duplicate:true});
      const draft=announcementDrafts.get(b.id);
      if(!draft || now()-draft.at>300000 || b.confirm!=="SEND "+b.id)return fail(res,"confirmation",400);
      if(history.some(a=>a.state==="queued"||a.state==="sending"))return fail(res,"busy",409);
      const subs=announcements.targets(db,draft.item.audience);
      const record=Object.assign({id:b.id,at:now(),state:"queued",total:subs.length,accepted:0,failed:0},draft.item);
      db.settings.announcements=history.concat([record]).slice(-20);announcementDrafts.delete(b.id);store.save();
      setImmediate(()=>announcements.deliver(record,subs,(s,p)=>push.sendOne(CFG.vapid,s,p,CFG.contact),()=>store.save()).catch(()=>{record.state="interrupted";store.save()}));
      return json(res,200,{ok:true,id:record.id,state:record.state,devices:subs.length});
    }

    /* Test-data tools: distinct record removal and aggregate statistics reset. */
    if (sub === "orderer" && seg[3] === "delete" && req.method === "POST") {
      const b = await readBody(req);
      const phone = digits(b.phone);
      if (!phone || b.confirm !== "DELETE " + phone) return fail(res, "confirmation", 400);
      if (!db.orderers[phone]) return fail(res, "not_found", 404);
      const linked = Object.values(db.requests).filter(r => digits(r.phone) === phone);
      if (linked.some(r => r.status === "accepted" || r.status === "arrived")) return fail(res, "busy", 409);
      const ids = new Set(linked.map(r => r.id));
      let photos = 0;
      Object.values(db.photos).forEach(function(p) {
        if (!ids.has(p.req_id)) return;
        try { fs.unlinkSync(path.join(store.photoDir, p.file)); } catch(e) {}
        remote.delPhoto(p.file); delete db.photos[p.id]; photos++;
      });
      linked.forEach(r => { delete db.requests[r.id]; });
      delete db.orderers[phone]; store.save();
      return json(res, 200, {ok:true, requests_deleted:linked.length, photos_deleted:photos, counters_unchanged:true});
    }
    if (sub === "stats" && seg[3] === "reset-month" && req.method === "POST") {
      const b = await readBody(req), mk = monthKey();
      if (b.month !== mk || b.confirm !== "RESET " + mk) return fail(res, "confirmation", 400);
      const removed = db.counters.by_month[mk] || 0;
      db.counters.by_month[mk] = 0;
      db.counters.total_done = Math.max(0, (db.counters.total_done || 0) - removed);
      if (db.counters.shluchim_by_month) db.counters.shluchim_by_month[mk] = {};
      if (db.counters.requesters_by_month) db.counters.requesters_by_month[mk] = {};
      // Preserve records, photos, volunteers' personal lifetime totals and email guard.
      db.settings.stats_resets = (db.settings.stats_resets || []).concat([{month:mk, at:now(), removed:removed}]).slice(-50);
      store.save();
      return json(res, 200, {ok:true, month:mk, removed:removed, total_done:db.counters.total_done});
    }

    if (sub === "request" && seg[3] === "delete" && req.method === "POST") {
      const b = await readBody(req);
      const r = db.requests[String(b.id || "")];
      if (!r) return fail(res, "not_found", 404);
      Object.values(db.photos).forEach(function (p) {
        if (p.req_id === r.id) { try { fs.unlinkSync(path.join(store.photoDir, p.file)); } catch (e) {} delete db.photos[p.id]; }
      });
      delete db.requests[r.id]; store.save();
      return json(res, 200, { ok: true });
    }

    if (sub === "deletion" && seg[3] === "done" && req.method === "POST") {
      const b = await readBody(req);
      const d = db.deletions.find(function (x) { return x.id === String(b.id || ""); });
      if (!d) return fail(res, "not_found", 404);
      // delete everything linked to that phone number
      let deleted = 0;
      const want = digits(d.phone);
      Object.values(db.shluchim).forEach(function (s) {
        if (digits(s.phone) === want && !activeJob(s.id)) { delete db.shluchim[s.id]; deleted++; }
      });
      Object.values(db.requests).forEach(function (r) {
        if (digits(r.phone) === want) {
          Object.values(db.photos).forEach(function (p) {
            if (p.req_id === r.id) { try { fs.unlinkSync(path.join(store.photoDir, p.file)); } catch (e) {} delete db.photos[p.id]; }
          });
          delete db.requests[r.id]; deleted++;
        }
      });
      if (db.orderers && db.orderers[want]) { delete db.orderers[want]; deleted++; }
      d.done = true; store.save();
      return json(res, 200, { ok: true, deleted: deleted });
    }

    if (sub === "export" && req.method === "GET") {
      // full data export (db.json) so the owner can back up or migrate everything
      const clone = JSON.parse(JSON.stringify(db));
      if(clone.settings)delete clone.settings.push_signing;
      Object.values(clone.shluchim).forEach(s=>{delete s.push;});
      delete clone.announcement_devices;
      Object.values(clone.shluchim).forEach(function (s) { delete s.token; });
      Object.values(clone.requests).forEach(function (r) { delete r.token; });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=\"get-tefillin-backup.json\"",
        "cache-control": "no-store"
      });
      return res.end(JSON.stringify(clone, null, 2));
    }

    if (sub === "logout" && req.method === "POST") {
      return json(res, 200, { ok: true }, { "set-cookie": "tn_adm=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    }

    return fail(res, "not_found", 404);
  }

  return fail(res, "not_found", 404);
}

let worldSnapshot = null;
const worldResponses=new Map();

/* ---------------- static files ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};
function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      // unknown non-file paths fall back to the app shell only for navigations
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    const etag='"'+st.size.toString(16)+'-'+Math.floor(st.mtimeMs).toString(16)+'"';
    const headers = { "content-type": MIME[ext] || "application/octet-stream", "content-length": st.size, "etag":etag, "vary":"Accept-Encoding" };
    if(req.headers["if-none-match"]===etag){res.writeHead(304,{etag:etag});return res.end()}
    const gzip=/gzip/.test(req.headers["accept-encoding"]||"") && st.size>1024 && [".html",".js",".css",".json",".svg",".webmanifest"].includes(ext);
    if(gzip){delete headers["content-length"];headers["content-encoding"]="gzip"}
    // sw.js must always revalidate; versioned assets can be cached hard
    headers["cache-control"] = (path.basename(file) === "sw.js" || ext === ".html") ? "no-cache" : "public, max-age=86400";
    res.writeHead(200, headers);
    if(req.method==="HEAD")return res.end();
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());
    if(gzip)stream.pipe(zlib.createGzip()).pipe(res);else stream.pipe(res);
  });
}

let inflight=0;
const requestBuckets=new Map();
function limited(key,max,windowMs){const t=now();let b=requestBuckets.get(key);if(!b||t-b.at>windowMs){if(requestBuckets.size>=10000)requestBuckets.delete(requestBuckets.keys().next().value);b={at:t,n:0};requestBuckets.set(key,b)}return ++b.n>max}
setInterval(()=>{const t=now();for(const [k,v] of requestBuckets)if(t-v.at>600000)requestBuckets.delete(k);for(const k in ipRate)if(!ipRate[k].length||t-ipRate[k][ipRate[k].length-1]>600000)delete ipRate[k];for(const k in chatRate)if(!chatRate[k].length||t-chatRate[k][chatRate[k].length-1]>60000)delete chatRate[k]},60000).unref();
const server = http.createServer(async function (req, res) {
  res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  if(inflight>=64){res.writeHead(503,{"Retry-After":"5"});return res.end('Busy, retry shortly')}
  inflight++;let released=false;const release=()=>{if(!released){released=true;inflight--}};res.once('finish',release);res.once('close',release);
  if(req.url.length>4096){res.writeHead(414);return res.end()}

  const u = new URL(req.url, "http://x");
  const pathname = u.pathname;
  const query = {};
  u.searchParams.forEach(function (v, k) { query[k] = v; });
  try {
    if(pathname==="/healthz")return json(res,200,{ok:true});
    if (pathname.indexOf("/api/") === 0) {
      const addr=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim();
      const key=(pathname==='/api/admin/login'?addr:(token(req)?crypto.createHash('sha256').update(token(req)).digest('hex'):addr))+':'+(pathname==='/api/admin/login'?'login':'api');
      if(limited(key,pathname==='/api/admin/login'?20:1200,pathname==='/api/admin/login'?600000:60000)){res.setHeader('Retry-After','60');return fail(res,'rate',429)}
      return await api(req, res, pathname, query);
    }
    if (pathname === "/admin" || pathname === "/admin/") {
      if (!sessionOk(req)) { res.writeHead(302, { location: "/" }); return res.end(); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(ADMIN_HTML);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    /* extensionless paths that name a directory with an index.html redirect to the
       trailing-slash form (/wall -> /wall/) so links work like the original site */
    if (!path.extname(pathname) && !pathname.endsWith("/")) {
      const dirIndex = path.normalize(path.join(PUBLIC, pathname, "index.html"));
      if (dirIndex.indexOf(PUBLIC) === 0 && fs.existsSync(dirIndex)) {
        res.writeHead(302, { location: pathname + "/" });
        return res.end();
      }
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (e && e.message === "too_big") return fail(res, "too_big", 413);
    if (e && e.message === "bad_json") return fail(res, "bad_json", 400);
    console.error(e);
    return fail(res, "server", 500);
  }
});


server.requestTimeout=20000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;

/* ---------------- monthly report email (Brevo) ----------------
   On the 1st of each month around 09:00 (Asia/Jerusalem), email last month's
   stats to settings.report_email. Active only with BREVO_API_KEY set.
   settings.last_sent_month guards against duplicate sends. */
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const REPORT_SENDER = process.env.REPORT_SENDER_EMAIL || "bbb770bbbb@gmail.com";

function ilParts(ms) {
  const o = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(new Date(ms == null ? now() : ms)).forEach(function (x) { o[x.type] = x.value; });
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour };
}

function reportTextFor(mk) {
  const lay = (db.counters.by_month || {})[mk] || 0;
  const shm = Object.keys((db.counters.shluchim_by_month || {})[mk] || {}).length;
  const ppl = Object.keys((db.counters.requesters_by_month || {})[mk] || {}).length;
  const pho = (db.counters.photos_by_month || {})[mk] || 0;
  const il = { y: +mk.slice(0, 4), m: +mk.slice(5, 7) };
  return [
    "דוח חודשי — Get Tefillin",
    "חודש: " + il.m + "/" + il.y,
    "",
    "הנחות תפילין החודש: " + lay,
    "מניחים ייחודיים: " + ppl,
    "שלוחים פעילים החודש: " + shm,
    "תמונות חדשות לקיר: " + pho,
    "",
    "סך הכל הנחות מאז ההתחלה: " + (db.counters.total_done || 0),
    "שלוחים רשומים: " + Object.keys(db.shluchim).length,
    "מניחים רשומים (גיבוי): " + Object.keys(db.orderers || {}).length,
    "",
    "נשלח אוטומטית מהמערכת ב־1 לחודש."
  ].join("\n");
}

async function sendReportEmail(to, subject, text) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ sender: { email: REPORT_SENDER, name: "Get Tefillin" }, to: [{ email: to }], subject: subject, textContent: text })
  });
  if (!res.ok) throw new Error("brevo http " + res.status + ": " + (await res.text()).slice(0, 200));
  return res.json().catch(function () { return {}; });
}

async function maybeSendMonthlyReport(force, markSent) {
  // Pause applies to scheduled and manual sends. It never clears saved data.
  if (db.settings.report_paused !== false) return {ok:false,skipped:"paused"};
  if (!BREVO_API_KEY) return { ok: false, skipped: "no_key" };
  const to = db.settings && db.settings.report_email;
  if (!to) return { ok: false, skipped: "no_recipient" };
  const ilNow=ilParts(); const prevDate=new Date(Date.UTC(ilNow.y,ilNow.m-2,15));
  const prev=prevDate.toISOString().slice(0,7);
  if (!force && db.settings.last_sent_month === prev) return { ok: false, skipped: "already_sent", month: prev };
  if (!force) {
    const il = ilParts();
    if (il.d !== 1 || il.h < 9) return { ok: false, skipped: "not_time", month: prev };
  }
  await sendReportEmail(to, "Get Tefillin — דוח חודשי " + prev, reportTextFor(prev));
  if (markSent !== false) {
    db.settings.last_sent_month = prev;
    store.save();
  }
  console.log("monthly report emailed to " + to + " for " + prev);
  return { ok: true, month: prev, to: to };
}
setInterval(function () { maybeSendMonthlyReport(false).catch(function (e) { console.error("monthly report failed:", e.message); }); }, 30 * 60000);

async function safeRestore(){for(let i=0;i<3;i++){try{await store.restore();return}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,1000*(i+1)))}}}
safeRestore().then(function () {
  const imported=require("./chabad-stands").apply(db,require("./chabad-stands-data.json"),now());
  if(imported.added||imported.updated||imported.retired)store.save();
  console.log("Chabad Israel stand snapshot: "+JSON.stringify(imported));
  if (db.settings.push_signing) CFG.vapid=db.settings.push_signing;
  else { db.settings.push_signing=CFG.vapid; store.save(); }
  (db.settings.announcements||[]).forEach(a=>{if(a.state==="queued"||a.state==="sending")a.state="interrupted"});
  maybeSendMonthlyReport(false).catch(function (e) { console.error("monthly report failed:", e.message); });
  server.listen(PORT, function () {
    console.log("Get Tefillin replica listening on http://localhost:" + PORT);
    console.log("Admin page: /admin (code in config.json)");
  });
}).catch(()=>{console.error("Startup paused: remote data unavailable; no empty overwrite");process.exit(1)});
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;server.close();store.flush();await Promise.race([remote.flush(),new Promise(r=>setTimeout(r,8000))]);process.exit(0)}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
