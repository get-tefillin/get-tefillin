'use strict';
function normalize(b){
 const name=String(b.name||'').trim(),address=String(b.address||'').trim(),note=String(b.note||'').trim(),tz=String(b.tz||'');
 const lat=Number(b.lat),lng=Number(b.lng);
 if(name.length<2||name.length>100||address.length<3||address.length>300||note.length>500||b.lat==null||b.lng==null||b.lat===''||b.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>85||Math.abs(lng)>180)return null;
 try{new Intl.DateTimeFormat('en',{timeZone:tz}).format()}catch(e){return null}
 const days=Array.isArray(b.days)?b.days:[];if(days.length!==7)return null;
 if(days.some(d=>d!==null&&(!Array.isArray(d)||d.length!==2||!Number.isInteger(d[0])||!Number.isInteger(d[1])||d[0]<0||d[1]>1440||d[0]>=d[1])))return null;
 return {name,address,note,lat,lng,tz,days,always:b.always===true,active:b.active===true};
}
function openNow(s,at){if(!s.active)return false;if(s.always)return true;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:s.tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at===undefined?Date.now():at));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),d=s.days[day],m=Number(p.hour)*60+Number(p.minute);return !!d&&m>=d[0]&&m<d[1];
}
function publicView(s,at){return {id:s.id,name:s.name,address:s.address,note:s.note,lat:s.lat,lng:s.lng,tz:s.tz,days:s.days,always:s.always,open_now:openNow(s,at)}}
module.exports={normalize,openNow,publicView};
