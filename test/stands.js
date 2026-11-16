const assert=require('assert'),s=require('../server/stands');
let stand={name:'Test',address:'Test address',lat:0,lng:0,note:'',tz:'Asia/Jerusalem',days:[null,[540,1020],null,null,null,null,null],active:true,always:false};
assert(s.normalize(stand));assert(!s.normalize({...stand,lat:null}));assert(!s.normalize({...stand,days:[]}));
assert(s.openNow(stand,Date.parse('2026-11-16T09:00:00+02:00')));assert(s.openNow(stand,Date.parse('2026-11-16T16:59:00+02:00')));assert(!s.openNow(stand,Date.parse('2026-11-16T17:00:00+02:00')));assert(!s.openNow(stand,Date.parse('2026-11-17T10:00:00+02:00')));assert(!s.openNow({...stand,active:false,always:true}));assert(s.openNow({...stand,always:true}));
assert(s.openNow({...stand,tz:'America/New_York'},Date.parse('2026-11-16T15:00:00Z')));
console.log('PASS stands normalization and timezone/open boundaries');
