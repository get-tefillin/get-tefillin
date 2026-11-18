'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'city-map-')), root = path.join(__dirname, '..'), at = Date.now();
const base = { mode: 'available', last_seen: at, tz: 'Asia/Jerusalem', override_until: at + 3600000 };
const shluchim = {
  cityhe: { ...base, id: 'cityhe', name: 'A', phone: '0501111111', token: 't1', city: 'רחובות' },
  cityen: { ...base, id: 'cityen', name: 'B', phone: '0502222222', token: 't2', city: 'Kfar yona' },
  addr: { ...base, id: 'addr', name: 'C', phone: '0503333333', token: 't3', city: 'נתניה בני בנימין 33' },
  live: { ...base, id: 'live', name: 'D', phone: '0504444444', token: 't4', city: 'חדרה', lat: 32.1, lng: 34.9, loc_at: at },
  nocity: { ...base, id: 'nocity', name: 'E', phone: '0505555555', token: 't5' },
  offcity: { ...base, id: 'offcity', name: 'F', phone: '0506666666', token: 't6', mode: 'off', city: 'רחובות' },
  busycity: { ...base, id: 'busycity', name: 'G', phone: '0507777777', token: 't7', city: 'רחובות' }
};
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ shluchim, requests: { job: { id: 'job', status: 'accepted', shaliach_id: 'busycity', created_at: at } }, counters: { total_done: 0 }, settings: { report_paused: true } }));
const srv = spawn(process.execPath, [path.join(root, 'server/server.js')], { cwd: root, env: { ...process.env, PORT: '8798', DATA_DIR: dir }, stdio: 'ignore' });
async function api(p, b, t) { const r = await fetch('http://127.0.0.1:8798' + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(t ? { 'x-token': t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  try {
    for (let n = 0; n < 30; n++) { try { const r = await fetch('http://127.0.0.1:8798/healthz'); if (r.ok) break; } catch (e) { } await sleep(100); }
    await sleep(700); // startup backfill: table hits + debounced save
    const d = await fetch('http://127.0.0.1:8798/api/world-map?zoom=16').then(r => r.json());
    assert.equal(d.total, 4, 'city fallback + one live; empty-city, off and busy excluded');
    const pts = d.clusters.map(c => c.lat + ',' + c.lng).sort();
    assert.deepStrictEqual(pts, ['31.89,34.81', '32.1,34.9', '32.32,34.85', '32.32,34.94'].sort(), 'live point wins for the live shaliach; others at their city centers');
    assert(!/0501111111|"A"|"B"|token/.test(JSON.stringify(d)), 'no identity leaks');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(saved.shluchim.cityhe.city_geo_src, 'table');
    assert.deepStrictEqual([saved.shluchim.cityhe.city_lat, saved.shluchim.cityhe.city_lng], [31.8928, 34.8113], 'backfill wrote city coordinates');
    assert.equal(saved.shluchim.nocity.city_lat, undefined, 'empty city untouched');
    const reg = await api('/api/shaliach/register', { name: 'New Guy', phone: '0509999999', transport: 'foot', has_tefillin: true, city: 'יבנה' });
    assert(reg.ok && reg.token);
    await sleep(700);
    const saved2 = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const fresh = Object.values(saved2.shluchim).find(s => s.phone === '0509999999');
    assert.deepStrictEqual([fresh.city_lat, fresh.city_lng], [31.8808, 34.7384], 'registration geocodes the city');
    const upd = await api('/api/shaliach/update', { name: 'New Guy', phone: '0509999999', transport: 'foot', city: 'Netanya' }, reg.token);
    assert(upd.ok);
    await sleep(700);
    const saved3 = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const moved = Object.values(saved3.shluchim).find(s => s.phone === '0509999999');
    assert.deepStrictEqual([moved.city_lat, moved.city_lng], [32.3215, 34.8532], 'profile update re-geocodes a changed city');
    console.log('PASS city-map: backfill, register/update geocoding, world-map city fallback, live precedence, exclusions, anonymity');
  } finally { srv.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
