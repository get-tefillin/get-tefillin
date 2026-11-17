"use strict";
const crypto = require('crypto');
function validSub(s) {
  try {
    const u = new URL(s.endpoint);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(u.hostname) && u.href.length < 2048 && /^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh) && /^[A-Za-z0-9_-]{22}$/.test(s.keys.auth);
  } catch(e) { return false; }
}
function normalize(b) {
  const audience = b.audience;
  const text = String(b.text || '').trim(), link = String(b.link || '').trim();
  if (!['shluchim','all'].includes(audience) || text.length > 800 || (!text && !link) || link.length > 500) return null;
  if (link) { try { const u = new URL(link); if (u.protocol !== 'https:' || u.username || u.password) return null; } catch(e) { return null; } }
  return {audience, text, link};
}
function targets(db, audience) {
  const seen = new Set(), list = [];
  function add(s) { if (validSub(s) && !seen.has(s.endpoint)) { seen.add(s.endpoint); list.push(s); } }
  Object.values(db.shluchim).forEach(sh => (sh.push || []).forEach(add));
  if (audience === 'all') Object.values(db.announcement_devices || {}).forEach(d => add(d.sub));
  return list;
}
async function deliver(record, subs, send, checkpoint) {
  let next = 0;
  record.state = 'sending'; checkpoint();
  await Promise.all(Array.from({length:Math.min(3,subs.length)}, async () => {
    while(next < subs.length) {
      const s=subs[next++]; let r;
      try { r=await send(s, {type:'announcement',title:'תפילין נאו',body:record.text || 'עדכון חדש',url:record.link || '/',tag:'announcement-'+record.id}); } catch(e) { r={ok:false,status:0}; }
      if(r.ok)record.accepted++; else record.failed++;
      if((record.accepted+record.failed)%10===0)checkpoint();
    }
  }));
  record.state='finished';record.finished_at=Date.now();checkpoint();
}
module.exports={validSub,normalize,targets,deliver};
