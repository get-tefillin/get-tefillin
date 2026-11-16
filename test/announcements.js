'use strict';
const assert=require('assert'),a=require('../server/announcements');
function sub(n){return {endpoint:'https://fcm.googleapis.com/fcm/send/test'+n,keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}}}
assert(a.validSub(sub(1)));assert(!a.validSub({...sub(1),endpoint:'http://127.0.0.1/'}));
assert(!a.normalize({audience:'all',text:'',link:'javascript:alert(1)'}));assert(!a.normalize({audience:'other',text:'hello'}));
const db={shluchim:{one:{push:[sub(1),sub(2)]}},announcement_devices:{x:{sub:sub(1)},y:{sub:sub(3)}}};
assert.equal(a.targets(db,'shluchim').length,2);assert.equal(a.targets(db,'all').length,3);
let running=0,max=0,calls=0;
const r={id:'test',text:'בדיקה',link:'https://example.com',accepted:0,failed:0};
a.deliver(r,Array.from({length:12},(_,i)=>sub(i)),async(s,p)=>{running++;max=Math.max(max,running);calls++;assert.equal(p.type,'announcement');assert.equal(p.url,'https://example.com');await new Promise(res=>setTimeout(res,5));running--;return {ok:calls%4!==0}},()=>{}).then(()=>{assert(max<=3);assert.equal(r.accepted+r.failed,12);assert.equal(r.state,'finished');console.log('PASS: safe links/subscriptions, audience isolation, deduplication, 3-worker delivery and outcome accounting. Mock transport only.');});
