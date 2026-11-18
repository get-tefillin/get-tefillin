'use strict';
const assert = require('assert');
const g = require('../server/city-geo');

// Normalization and table lookups: Hebrew, English, aliases, address suffixes.
assert.deepStrictEqual(g.lookupSync('רחובות'), [31.8928, 34.8113]);
assert.deepStrictEqual(g.lookupSync('Kfar yona'), [32.3176, 34.9354]);
assert.deepStrictEqual(g.lookupSync('כפר יונה'), [32.3176, 34.9354]);
assert.deepStrictEqual(g.lookupSync('נתניה בני בנימין 33'), [32.3215, 34.8532], 'city + street address resolves to the city');
assert.deepStrictEqual(g.lookupSync('  NETANYA '), [32.3215, 34.8532]);
assert.deepStrictEqual(g.lookupSync('Hadera'), [32.4340, 34.9196]);
assert.strictEqual(g.lookupSync(''), null);
assert.strictEqual(g.lookupSync('אטלנטיס המובאעת'), null, 'unknown value needs the online fallback');

// Record lifecycle: resolve once, do not rewrite, clear when city removed.
const sh = { city: 'Hadera' };
assert(g.syncResolve(sh));
assert.equal(sh.city_geo_src, 'table');
assert.equal(sh.city_geo_key, 'hadera');
const at = sh.city_geo_at;
assert(!g.syncResolve(sh), 'already resolved');
assert.equal(sh.city_geo_at, at);
sh.city = '';
assert(g.syncResolve(sh), 'city removal clears the point');
assert.strictEqual(sh.city_lat, null);
const sh2 = { city: '' };
assert(!g.syncResolve(sh2), 'empty city stays empty');

console.log('PASS city-geo: HE/EN/alias/address-suffix lookups, unknown/empty handling, record lifecycle');
