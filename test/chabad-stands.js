'use strict';
const assert=require('assert'),{build,apply,expand}=require('../server/chabad-stands'),snapshot=expand(require('../server/chabad-stands-data.json')),stands=require('../server/stands');
assert.equal(snapshot.raw_count,769);assert.equal(snapshot.records.length,763);assert.equal(snapshot.excluded.length,5);assert.equal(snapshot.duplicate_count,1);
assert.equal(snapshot.records.filter(s=>s.phone).length,703);
const db={stands:{manual:{id:'manual',name:'Existing manual stand',active:true}},requests:{real:{status:'waiting'}},counters:{total_done:22}};
const before=JSON.stringify({requests:db.requests,counters:db.counters});let stats=apply(db,snapshot,10);assert.equal(stats.added,763);assert.equal(Object.keys(db.stands).length,764);
for(const s of snapshot.records){assert(stands.normalize(s));assert.strictEqual(stands.openNow(s),null);assert(s.lat>=29&&s.lat<=34);assert(!s.address.includes('undefined'));assert.equal(stands.publicView(s).source_url,snapshot.source_url)}
assert.equal(apply(db,snapshot,20).added,0);assert.equal(Object.keys(db.stands).length,764);
const custom=snapshot.records[0].id,deleted=snapshot.records[1].id;db.stands[custom].source_customized=true;db.stands[custom].note='Admin correction';db.stand_source_suppressed[deleted]=true;delete db.stands[deleted];
const next={...snapshot,records:snapshot.records.map(s=>({...s,source_synced_at:'next'})),synced_at:'next'};
assert.equal(apply(db,next,30).updated,761);assert.equal(db.stands[custom].note,'Admin correction');assert(!db.stands[deleted]);assert(db.stands.manual.active);
assert.equal(before,JSON.stringify({requests:db.requests,counters:db.counters}));
assert.throws(()=>build([],Date.now()));
const unknown={...snapshot.records[0],always:false};assert.strictEqual(stands.openNow(unknown),null);assert.strictEqual(stands.openNow({...unknown,active:false}),false);assert.strictEqual(stands.openNow({...unknown,always:true,hours_unknown:false}),true);
console.log('PASS 763 source records; 5 coordinate outliers; dedupe; unknown hours; safe repeat sync; admin edits/deletes and unrelated data preserved');
