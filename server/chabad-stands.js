'use strict';
// Public directory snapshot. No requests to the source are made at app startup.
const crypto=require('crypto');
const SOURCE='https://chabadisrael.co.il/tefillin/';
const ENDPOINT='https://sm-dashboard-production.up.railway.app/api/pub/events';
function text(x){return String(x||'').replace(/<[^>]*>/g,'').replace(/\bundefined\b/g,'').replace(/\s+/g,' ').trim()}
function build(raw,syncedAt){
 if(!Array.isArray(raw)||raw.length<100)throw Error('Unexpected or incomplete source response');
 const records=[],excluded=[],seen=new Set();let duplicates=0,cleanedAddresses=0,missingPhones=0;
 for(const r of raw){
  const p=r.marker&&r.marker.position||{},lat=p.lat,lng=p.lng;
  // This import is for Israel. Out-of-region coordinates must be reviewed, never guessed.
  if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<29||lat>34||lng<34||lng>36.5){excluded.push({name:text(r.title),address:text(r.address),lat,lng,reason:'coordinates_outside_israel_review_required'});continue}
  const name=text(r.title),address=text(r.address);if(name.length<2||address.length<3){excluded.push({name,address,reason:'missing_name_or_address'});continue}
  if(address!==String(r.address||'').trim())cleanedAddresses++;
  const key=[name,address,lat,lng].join('|');if(seen.has(key)){duplicates++;const existing=records.find(s=>[s.name,s.address,s.lat,s.lng].join('|')===key);const alternate=String(r.phone||'').replace(/[^\d+]/g,'');if(existing&&/^\+?\d{7,15}$/.test(alternate)&&alternate!==existing.phone&&!existing.note.includes(alternate))existing.note=(existing.note?existing.note+' · ':'')+'טלפון נוסף במקור: '+alternate;continue}seen.add(key);
  const phone=String(r.phone||'').replace(/[^\d+]/g,'');const validPhone=/^\+?\d{7,15}$/.test(phone)?phone:'';if(!validPhone)missingPhones++;
  const id=crypto.createHash('sha256').update('chabad-israel|'+key).digest('hex').slice(0,24);
  records.push({id,name,address,lat,lng,note:text(r.description).replace(/^\.$/,''),phone:validPhone,tz:'Asia/Jerusalem',days:Array(7).fill(null),always:false,hours_unknown:true,active:true,source:'chabad-israel',source_url:SOURCE,source_synced_at:syncedAt});
 }
 return {source_url:SOURCE,source_endpoint:ENDPOINT,synced_at:syncedAt,raw_count:raw.length,imported_count:records.length,duplicate_count:duplicates,cleaned_addresses:cleanedAddresses,missing_phones:missingPhones,excluded,records};
}
function expand(snapshot){if(!snapshot.record_fields||!Array.isArray(snapshot.records[0]))return snapshot;return Object.assign({},snapshot,{records:snapshot.records.map(row=>Object.fromEntries(snapshot.record_fields.map((k,i)=>[k,row[i]])))})}
function apply(db,snapshot,at){
 snapshot=expand(snapshot);
 db.stands=db.stands||{};db.stand_source_suppressed=db.stand_source_suppressed||{};
 const stats={added:0,updated:0,preserved:0,retired:0};const ids=new Set(snapshot.records.map(s=>s.id));
 for(const record of snapshot.records){
  const old=db.stands[record.id];if(db.stand_source_suppressed[record.id]||(old&&(old.source!=='chabad-israel'||old.source_customized))){stats.preserved++;continue}
  if(old&&old.source_synced_at===record.source_synced_at){stats.preserved++;continue}
  db.stands[record.id]=Object.assign({},record,{created_at:old?old.created_at:at,updated_at:at});stats[old?'updated':'added']++;
 }
 for(const s of Object.values(db.stands))if(s.source==='chabad-israel'&&!s.source_customized&&!ids.has(s.id)&&s.active){s.active=false;s.updated_at=at;stats.retired++}
 db.stand_source_sync={source_url:snapshot.source_url,synced_at:snapshot.synced_at,imported_count:snapshot.imported_count,excluded_count:snapshot.excluded.length,duplicate_count:snapshot.duplicate_count};
 return stats;
}
module.exports={build,apply,expand,SOURCE,ENDPOINT};
