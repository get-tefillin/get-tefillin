"use strict";
/* Approximate city coordinates for the public availability map and admin
   diagnostics. A shaliach's live GPS (lat/lng/loc_at) is never touched here;
   these city fields only give an approximate fallback point so an available
   shaliach is not invisible on the map just because he is not online.
   Resolution order: built-in Israeli locality table (Hebrew/English aliases),
   then one OpenStreetMap Nominatim lookup per distinct value, cached in
   db.geo_cache (Nominatim policy: serialized, ~1 request/second). */

const CITIES = [
  ["ירושלים", 31.7683, 35.2137, ["jerusalem", "yerushalayim"]],
  ["תל אביב", 32.0853, 34.7818, ["tel aviv", "tel aviv yafo", "תל אביב יפו"]],
  ["חיפה", 32.7940, 34.9896, ["haifa", "heifa"]],
  ["באר שבע", 31.2518, 34.7913, ["beersheba", "beer sheva", "be er sheva", "beer sheva"]],
  ["אשדוד", 31.8044, 34.6553, ["ashdod"]],
  ["אשקלון", 31.6688, 34.5742, ["ashkelon", "ashqelon"]],
  ["נתניה", 32.3215, 34.8532, ["netanya", "natanya", "netania"]],
  ["רחובות", 31.8928, 34.8113, ["rehovot", "rechovot"]],
  ["כפר יונה", 32.3176, 34.9354, ["kfar yona", "kfar yonah"]],
  ["חדרה", 32.4340, 34.9196, ["hadera", "hedera"]],
  ["גבעת שמואל", 32.0781, 34.8477, ["givat shmuel", "giv at shmuel", "givat shmuel"]],
  ["גבעתיים", 32.0714, 34.8100, ["givatayim", "giv atayim"]],
  ["רמת גן", 32.0684, 34.8248, ["ramat gan"]],
  ["בני ברק", 32.0839, 34.8338, ["bnei brak", "bnei berak", "bene berak", "bnei brak"]],
  ["פתח תקווה", 32.0840, 34.8878, ["petah tikva", "petach tikva", "petah tiqva", "petach tiqwa"]],
  ["ראשון לציון", 31.9730, 34.7925, ["rishon lezion", "rishon leziyon", "rishon le tsiyon", "rishon"]],
  ["חולון", 32.0103, 34.7792, ["holon"]],
  ["בת ים", 32.0171, 34.7457, ["bat yam"]],
  ["הרצליה", 32.1624, 34.8447, ["herzliya", "herzliyya", "hertzelia", "hertzliya"]],
  ["רעננה", 32.1848, 34.8708, ["raanana", "ra anana", "ra'anana"]],
  ["כפר סבא", 32.1747, 34.9077, ["kfar saba", "kfar sava", "kefar saba"]],
  ["הוד השרון", 32.1503, 34.8889, ["hod hasharon", "hod hasharon"]],
  ["רמת השרון", 32.1467, 34.8419, ["ramat hasharon"]],
  ["רמלה", 31.9296, 34.8666, ["ramla", "ramle", "ramleh"]],
  ["לוד", 31.9516, 34.8951, ["lod", "lydda"]],
  ["מודיעין", 31.8969, 35.0104, ["modiin", "modi in", "modi'in", "modiin maccabim reut", "מודיעין מכבים רעות"]],
  ["ראש העין", 32.0958, 34.9566, ["rosh haayin", "rosh ha ayin"]],
  ["אלעד", 32.0522, 34.9511, ["elad", "el ad", "el'ad"]],
  ["שוהם", 31.9988, 34.9450, ["shoham"]],
  ["קריית אונו", 32.0547, 34.8594, ["kiryat ono", "kiryat ono", "qiryat ono"]],
  ["אור יהודה", 32.0297, 34.8567, ["or yehuda"]],
  ["יהוד", 32.0344, 34.8792, ["yehud", "yehud monoson", "יהוד מונוסון"]],
  ["נס ציונה", 31.9285, 34.8025, ["nes ziona", "nes tziona", "nes tziyona"]],
  ["יבנה", 31.8808, 34.7384, ["yavne", "yavneh"]],
  ["גדרה", 31.8144, 34.7772, ["gedera"]],
  ["מזכרת בתיה", 31.8506, 34.8447, ["mazkeret batya", "mazkeret batya"]],
  ["גן יבנה", 31.7869, 34.7067, ["gan yavne", "gan yavneh"]],
  ["קריית גת", 31.6100, 34.7642, ["kiryat gat", "qiryat gat", "kiryat gat"]],
  ["קריית מלאכי", 31.7339, 34.7458, ["kiryat malakhi", "kiryat malachi", "qiryat mal akhi"]],
  ["שדרות", 31.5227, 34.5966, ["sderot"]],
  ["נתיבות", 31.4255, 34.5955, ["netivot"]],
  ["אופקים", 31.3153, 34.6203, ["ofakim"]],
  ["דימונה", 31.0694, 35.0331, ["dimona"]],
  ["ערד", 31.2589, 35.2128, ["arad"]],
  ["ירוחם", 30.9883, 34.9297, ["yeruham", "yeroham"]],
  ["מצפה רמון", 30.6094, 34.8014, ["mitzpe ramon", "mizpe ramon", "mitzpeh ramon"]],
  ["אילת", 29.5577, 34.9519, ["eilat", "elat"]],
  ["רהט", 31.3928, 34.7544, ["rahat"]],
  ["להבים", 31.3719, 34.8153, ["lehavim"]],
  ["עומר", 31.2650, 34.8472, ["omer"]],
  ["מיתר", 31.3264, 34.9378, ["meitar"]],
  ["עפולה", 32.6104, 35.2897, ["afula"]],
  ["טבריה", 32.7959, 35.5308, ["tiberias", "tveria", "tverya"]],
  ["צפת", 32.9646, 35.4960, ["safed", "tzfat", "zefat", "sfat"]],
  ["נצרת", 32.6996, 35.3035, ["nazareth", "nazerat", "natzrat"]],
  ["נוף הגליל", 32.7111, 35.3267, ["nof hagalil", "nazareth illit", "נצרת עילית"]],
  ["עכו", 32.9231, 35.0713, ["acre", "akko", "akka", "acco"]],
  ["נהריה", 33.0058, 35.0942, ["nahariya", "nahariyya", "naharia"]],
  ["כרמיאל", 32.9139, 35.2964, ["karmiel", "carmiel", "karmi el"]],
  ["קריית שמונה", 33.2073, 35.5697, ["kiryat shmona", "qiryat shemona", "kiryat shemona"]],
  ["מטולה", 33.2803, 35.5689, ["metula", "metulla"]],
  ["קריית אתא", 32.8015, 35.1075, ["kiryat ata", "qiryat atta"]],
  ["קריית ביאליק", 32.8333, 35.0833, ["kiryat bialik", "qiryat bialik"]],
  ["קריית מוצקין", 32.8380, 35.0772, ["kiryat motzkin", "qiryat motzkin"]],
  ["קריית ים", 32.8500, 35.0701, ["kiryat yam", "qiryat yam"]],
  ["טירת כרמל", 32.7603, 34.9731, ["tirat carmel", "tirat karmel", "tirat hacarmel"]],
  ["נשר", 32.7700, 35.0478, ["nesher"]],
  ["יקנעם", 32.6597, 35.1097, ["yokneam", "yokne am", "yokneam illit", "yokneam ilit", "יקנעם עילית"]],
  ["מגדל העמק", 32.6781, 35.2400, ["migdal haemek", "migdal ha emek"]],
  ["שפרעם", 32.8056, 35.1694, ["shefa amr", "shefaram", "shefa'amr"]],
  ["סכנין", 32.8647, 35.2972, ["sakhnin"]],
  ["טמרה", 32.8517, 35.2075, ["tamra"]],
  ["מעלות תרשיחא", 33.0178, 35.2719, ["maalot tarshiha", "maalot", "ma alot tarshiha"]],
  ["חצור הגלילית", 32.9819, 35.5439, ["hatzor hagalilit", "hazor hagalilit"]],
  ["ראש פינה", 32.9703, 35.5422, ["rosh pina", "rosh pinna"]],
  ["זכרון יעקב", 32.5736, 34.9508, ["zikhron yaakov", "zichron yaakov", "zichron ya akov"]],
  ["בנימינה", 32.5219, 34.9458, ["binyamina", "binyamina giv at ada", "בנימינה גבעת עדה"]],
  ["פרדס חנה", 32.4722, 34.9889, ["pardes hana", "pardes hanna", "pardes hanna karkur", "pardes hana karkur", "פרדס חנה כרכור"]],
  ["אור עקיבא", 32.5089, 34.9178, ["or akiva", "or aqiva"]],
  ["קיסריה", 32.5194, 34.9044, ["caesarea", "caesarea", "kesarya"]],
  ["חריש", 32.4583, 35.0483, ["harish"]],
  ["אבן יהודה", 32.2697, 34.8875, ["even yehuda"]],
  ["קדימה צורן", 32.2814, 34.9131, ["kadima zoran", "kadima", "kadima tzoran", "קדימה"]],
  ["תל מונד", 32.2503, 34.9189, ["tel mond"]],
  ["בית שאן", 32.4986, 35.5031, ["beit she an", "bet shean", "beit shean", "beth shean"]],
  ["בית שמש", 31.7456, 34.9867, ["beit shemesh", "bet shemesh", "beth shemesh"]],
  ["מבשרת ציון", 31.8039, 35.1517, ["mevaseret zion", "mevasseret zion", "mevaseret tzion"]],
  ["צור הדסה", 31.7178, 35.0961, ["tzur hadassa", "tzur hadasa", "zur hadassa"]],
  ["אפרת", 31.6536, 35.1506, ["efrat", "efrata"]],
  ["ביתר עילית", 31.6967, 35.1139, ["beitar illit", "betar illit", "beitar ilit"]],
  ["מעלה אדומים", 31.7767, 35.2975, ["maale adumim", "ma ale adumim", "maaleh adumim"]],
  ["אריאל", 32.1056, 35.1706, ["ariel", "ari el"]],
  ["קרני שומרון", 32.1717, 35.0978, ["karnei shomron", "karne shomron"]],
  ["אלקנה", 32.1097, 35.0336, ["elkana", "elqana"]],
  ["עמנואל", 32.1617, 35.1356, ["immanuel", "emmanuel", "emanuel"]],
  ["קדומים", 32.2117, 35.1581, ["kedumim", "kdumim"]],
  ["בית אל", 31.9417, 35.2208, ["beit el", "bet el"]],
  ["גבעת זאב", 31.8608, 35.1697, ["givat ze ev", "givat zeev", "givat zeev"]],
  ["קריית ארבע", 31.5333, 35.1181, ["kiryat arba", "qiryat arba", "kiryat arba"]],
  ["חברון", 31.5326, 35.0998, ["hebron", "hevron"]],
  ["בית לחם", 31.7054, 35.2024, ["bethlehem", "beit lehem", "bet lehem"]],
  ["כפר חב\"ד", 31.9903, 34.8522, ["kfar chabad", "kfar habad", "kefar chabad", "כפר חבד"]],
  ["טירה", 32.2344, 34.9503, ["tira", "tire"]],
  ["טייבה", 32.2658, 35.0047, ["tayibe", "taibe", "tayiba"]],
  ["אום אל פחם", 32.5158, 35.1522, ["umm al fahm", "um el fahem", "umm el fahm"]],
  ["כפר קאסם", 32.1144, 34.9761, ["kafr qasim", "kfar kassem", "kafr qassem", "kfar qasim"]],
  ["כפר קרע", 32.5047, 35.0550, ["kafr qara", "kfar kara", "kafr kara"]],
  ["כפר כנא", 32.7472, 35.3386, ["kafr kanna", "kfar kana", "kafr kana"]],
  ["בקעת אונו", 32.0617, 34.8642, ["kiryat ono", "בקעת אונו"]],
  ["גני תקווה", 32.0592, 34.8739, ["ganei tikva", "ganei tikvah"]],
  ["סביון", 32.0494, 34.8736, ["savyon", "savion"]],
  ["כפר שמריהו", 32.1847, 34.8197, ["kfar shmaryahu", "kfar shemaryahu"]],
  ["אזור", 32.0244, 34.8058, ["azor"]],
  ["בית דגן", 32.0022, 34.8297, ["beit dagan", "bet dagan"]],
  ["בני עי\"ש", 31.7844, 34.7597, ["bene ayish", "bnei ayish", "בני עיש"]],
  ["אבו גוש", 31.8078, 35.1094, ["abu ghosh", "abu gosh"]]
];

function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/[״"’‘׳'`,.()\-_/\\:;!?\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP = new Map();
CITIES.forEach(function (row) {
  const names = [row[0]].concat(row[3] || []);
  names.forEach(function (n) { const k = norm(n); if (k && !LOOKUP.has(k)) LOOKUP.set(k, [row[1], row[2]]); });
});
// Longest keys first so "כפר יונה" wins over any shorter shared token.
const KEYS = Array.from(LOOKUP.keys()).sort(function (a, b) { return b.length - a.length; });

/* Synchronous table lookup: exact match, then a whole-word contained match
   (handles "נתניה בני בנימין 33" -> נתניה). Returns [lat,lng] or null. */
function lookupSync(city) {
  const n = norm(city);
  if (!n) return null;
  const exact = LOOKUP.get(n);
  if (exact) return exact;
  const padded = " " + n + " ";
  for (const k of KEYS) {
    if (k.length < 3) continue; // avoid matching tiny names inside other words
    if (padded.indexOf(" " + k + " ") >= 0) return LOOKUP.get(k);
  }
  return null;
}

function ensureCache(db) {
  if (!db.geo_cache || typeof db.geo_cache !== "object" || Array.isArray(db.geo_cache)) db.geo_cache = {};
  const keys = Object.keys(db.geo_cache);
  if (keys.length > 5000) { // bound the cache; drop the oldest entries
    keys.sort(function (a, b) { return (db.geo_cache[a].at || 0) - (db.geo_cache[b].at || 0); });
    keys.slice(0, keys.length - 5000).forEach(function (k) { delete db.geo_cache[k]; });
  }
  return db.geo_cache;
}

/* Nominatim queue: one request at a time, >=1.1s between requests. */
const queue = [];
let pumping = false;
function enqueue(task) { queue.push(task); if (!pumping) pump(); }
async function pump() {
  pumping = true;
  while (queue.length) {
    const t = queue.shift();
    try { await t(); } catch (e) { /* resolution failure leaves the record flagged */ }
    await new Promise(function (r) { setTimeout(r, 1100); });
  }
  pumping = false;
}

async function nominatim(q) {
  const u = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
  const r = await fetch(u, {
    headers: { "user-agent": "TefillinNow/1.0 city-geocoding (one request per saved city)", "accept-language": "he,en" },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error("nominatim http " + r.status);
  const j = await r.json();
  if (Array.isArray(j) && j[0] && isFinite(+j[0].lat) && isFinite(+j[0].lon)) {
    const lat = +j[0].lat, lng = +j[0].lon;
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: lat, lng: lng };
  }
  return null;
}

/* Resolve one distinct city value, persistently cached. Never throws. */
function resolveCityAsync(db, city) {
  const key = norm(city);
  if (!key) return Promise.resolve(null);
  const table = lookupSync(city);
  if (table) return Promise.resolve({ lat: table[0], lng: table[1], src: "table" });
  const cache = ensureCache(db);
  const c = cache[key];
  if (c && Date.now() - (c.at || 0) < 180 * 24 * 3600000) {
    return Promise.resolve(c.fail ? null : { lat: c.lat, lng: c.lng, src: "nominatim" });
  }
  return new Promise(function (resolve) {
    enqueue(async function () {
      const toks = key.split(" ");
      const variants = [String(city).trim() + ", Israel", String(city).trim()];
      for (let drop = 1; drop < toks.length && drop <= 3; drop++) variants.push(toks.slice(0, toks.length - drop).join(" ") + ", Israel");
      let out = null;
      for (const v of variants) {
        try { out = await nominatim(v); } catch (e) { out = null; }
        if (out) break;
        await new Promise(function (r) { setTimeout(r, 1100); });
      }
      if (out) { cache[key] = { lat: out.lat, lng: out.lng, at: Date.now() }; resolve({ lat: out.lat, lng: out.lng, src: "nominatim" }); }
      else { cache[key] = { fail: true, at: Date.now() }; resolve(null); }
    });
  });
}

/* Apply a resolution to the record. Only city_* fields are written. */
function applyGeo(sh, key, hit) {
  sh.city_geo_key = key;
  sh.city_geo_at = Date.now();
  if (hit) { sh.city_lat = hit.lat; sh.city_lng = hit.lng; sh.city_geo_src = hit.src; }
  else { sh.city_lat = null; sh.city_lng = null; sh.city_geo_src = "fail"; }
}

/* Synchronous pass: resolve from the built-in table only.
   Returns true when the record changed. */
function syncResolve(sh) {
  const key = norm(sh.city);
  if (!key) {
    if (sh.city_geo_key || Number.isFinite(sh.city_lat)) { sh.city_geo_key = ""; sh.city_lat = null; sh.city_lng = null; sh.city_geo_src = null; sh.city_geo_at = Date.now(); return true; }
    return false;
  }
  if (sh.city_geo_key === key && (Number.isFinite(sh.city_lat) || sh.city_geo_src === "fail")) return false;
  const hit = lookupSync(sh.city);
  if (hit) { applyGeo(sh, key, { lat: hit[0], lng: hit[1], src: "table" }); return true; }
  return false;
}

/* Geocode a record after registration/profile save: instant table hit now,
   queued online lookup for unknown values. Fire-and-forget; failures leave
   the record flagged (city_geo_src "fail") for the admin warning. */
function attachAsync(db, sh, store) {
  if (syncResolve(sh)) { store.save(); return; }
  const key = norm(sh.city);
  if (!key) return;
  resolveCityAsync(db, sh.city).then(function (hit) {
    if (norm(sh.city) !== key) return; // city changed while the lookup ran
    applyGeo(sh, key, hit);
    store.save();
  }).catch(function () { });
}

/* One-time/startup pass over all records. Table hits are saved immediately;
   unknown cities retry online (a previous "fail" is retried after 7 days). */
function backfill(db, store) {
  ensureCache(db);
  let dirty = false;
  const pending = [];
  Object.keys(db.shluchim || {}).forEach(function (id) {
    const sh = db.shluchim[id];
    if (!sh || typeof sh !== "object") return;
    if (syncResolve(sh)) { dirty = true; return; }
    const key = norm(sh.city);
    if (!key) return;
    if (sh.city_geo_key !== key || (sh.city_geo_src === "fail" && Date.now() - (sh.city_geo_at || 0) > 7 * 24 * 3600000)) pending.push(sh);
  });
  if (dirty) store.save();
  pending.forEach(function (sh) { attachAsync(db, sh, store); });
}

module.exports = { norm: norm, lookupSync: lookupSync, resolveCityAsync: resolveCityAsync, syncResolve: syncResolve, attachAsync: attachAsync, backfill: backfill };
