'use strict';
const {spawn}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-consent-')),port=8794,base='http://127.0.0.1:'+port;
const sd='a'.repeat(24),rd='b'.repeat(24),sd2='c'.repeat(24);
const sh={id:'legacy',token:'legacy-token',name:'PRIVATE VOLUNTEER',phone:'0500000701',transport:'foot',mode:'available',lat:32.081237,lng:34.853741,loc_at:Date.now(),override_until:Date.now()+3600000,photo:'profile-test',langs:['he']};
const seed={shluchim:{legacy:sh},orderers:{},requests:{},photos:{},deletions:[],counters:{total_done:0,by_month:{}},settings:{}};
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify(seed));
let srv;
async function start(){srv=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:'ignore'});for(let i=0;i<50;i++){try{const j=await api('/healthz');if(j.status===200)return}catch(e){}await new Promise(r=>setTimeout(r,60))}throw Error('server did not start')}
async function stop(){const s=srv;await new Promise(r=>{s.once('exit',r);s.kill()})}
async function api(p,b,t){const res=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json',...(t?{'x-token':t}:{})},body:b?JSON.stringify(b):undefined});let j;try{j=await res.json()}catch(e){}return {status:res.status,j}}
async function choice(d,value,t){return api('/api/location-privacy',{device:d,...(value==='read'?{read:true}:{share_exact:value})},t)}
async function near(){return (await api('/api/nearby?lat=32.08&lng=34.85')).j.shluchim[0]}
function coarse(x,nameField='name'){assert.strictEqual(x[nameField],nameField==='name'?'שליח באזור':'מזמין באזור');assert.strictEqual(x.lat,+x.lat.toFixed(2));assert.strictEqual(x.lng,+x.lng.toFixed(2));assert.strictEqual(x.approximate,true)}
(async()=>{try{
 await start();
 assert.strictEqual((await choice(sd,'read',sh.token)).j.share_exact,null,'legacy unchosen, default deny');
 let n=await near();coarse(n);assert.strictEqual(n.photo,null);assert(!JSON.stringify(n).includes('PRIVATE VOLUNTEER'));assert.strictEqual((await api('/api/shaliach/photo/profile-test')).status,404);
 assert.strictEqual((await choice(sd,true,'forged-token')).status,401);assert.strictEqual((await choice('short',true)).status,400);assert.strictEqual((await choice(sd,'yes',sh.token)).status,400);
 // GPS/mode bodies are not consent.
 await api('/api/shaliach/mode',{mode:'available',lat:sh.lat,lng:sh.lng,share_exact:true,privacy_version:1},sh.token);coarse(await near());
 assert.strictEqual((await choice(sd,true,sh.token)).j.share_exact,true);n=await near();assert.strictEqual(n.name,sh.name);assert.strictEqual(n.lat,sh.lat);assert.strictEqual(n.lng,sh.lng);assert.strictEqual(n.approximate,false);
 const world=(await api('/api/world-map?zoom=18')).j;assert(!JSON.stringify(world).includes(sh.name));assert(!JSON.stringify(world).includes(String(sh.lat)),'world remains coarse even with approval');
 assert.strictEqual((await choice(sd2,'read',sh.token)).j.share_exact,true,'volunteer preference follows bearer account on another device');
 await choice(sd,false,sh.token);coarse(await near());assert.strictEqual((await choice(sd2,'read',sh.token)).j.share_exact,false,'revocation follows account');
 // Public distance derives from rounded point, not raw fix. A move within one rounded cell does not change it.
 let before=await near();await api('/api/shaliach/poll',{lat:32.084,lng:34.854},sh.token);let after=await near();assert.strictEqual(after.km,before.km);assert.strictEqual(after.eta_min,before.eta_min);
 // Switching a registered account into requester mode cannot reuse a stale device opt-in.
 const otherDevice='f'.repeat(24);await choice(otherDevice,true);
 const owned=(await api('/api/request',{first_name:'OWNED PRIVATE',phone:'0500000705',lat:32.082349,lng:34.851762,device:otherDevice},sh.token)).j;
 let ownedPoll=(await api('/api/shaliach/poll',{},sh.token)).j;assert.strictEqual(ownedPoll.ringing.find(x=>x.id===owned.id).first_name,'מזמין באזור');
 await choice(sd2,true,sh.token);ownedPoll=(await api('/api/shaliach/poll',{},sh.token)).j;assert.strictEqual(ownedPoll.ringing.find(x=>x.id===owned.id).first_name,'OWNED PRIVATE','account consent follows an already-open requester record across devices');
 await choice(sd2,false,sh.token);ownedPoll=(await api('/api/shaliach/poll',{},sh.token)).j;assert.strictEqual(ownedPoll.ringing.find(x=>x.id===owned.id).first_name,'מזמין באזור');await api('/api/request/'+owned.id+'/cancel',{},owned.token);
 const req=(await api('/api/request',{first_name:'PRIVATE REQUESTER',phone:'0500000702',lat:32.082349,lng:34.851762,device:rd,share_exact:true,privacy_version:1})).j;assert(req.ok);
 let poll=(await api('/api/shaliach/poll',{},sh.token)).j;const ring=poll.ringing.find(x=>x.id===req.id);assert(ring);assert.strictEqual(ring.first_name,'מזמין באזור','untrusted boolean did not bypass consent');
 assert((await api('/api/shaliach/accept',{id:req.id},sh.token)).j.ok);
 let job=(await api('/api/shaliach/poll',{},sh.token)).j.job;coarse(job,'first_name');
 let self=(await api('/api/request/'+req.id,null,req.token)).j;coarse(self.shaliach);assert.strictEqual(self.lat,32.082349,'requester can see own precise fix');assert.strictEqual(self.shaliach.phone,sh.phone,'accepted contact semantics unchanged');
 await choice(rd,true);job=(await api('/api/shaliach/poll',{},sh.token)).j.job;assert.strictEqual(job.first_name,'PRIVATE REQUESTER');assert.strictEqual(job.lat,32.082349);
 await choice(rd,false);job=(await api('/api/shaliach/poll',{},sh.token)).j.job;coarse(job,'first_name');
 await choice(sd,true,sh.token);self=(await api('/api/request/'+req.id,null,req.token)).j;assert.strictEqual(self.shaliach.name,sh.name);assert.strictEqual(self.shaliach.lat,32.084);
 await choice(sd,false,sh.token);self=(await api('/api/request/'+req.id,null,req.token)).j;coarse(self.shaliach);
 await api('/api/shaliach/poll',{},sh.token);await new Promise(r=>setTimeout(r,400));await stop();await start();
 assert.strictEqual((await choice(sd2,'read',sh.token)).j.share_exact,false,'revocation survives restart');assert.strictEqual((await choice(rd,'read')).j.share_exact,false,'requester choice survives restart');coarse((await api('/api/shaliach/poll',{},sh.token)).j.job,'first_name');
 // New registration inherits a saved device choice, never a forged body boolean.
 const fresh='d'.repeat(24);const ns=(await api('/api/shaliach/register',{device:fresh,name:'NEW PRIVATE',phone:'0500000703',transport:'foot',has_tefillin:true,share_exact:true,privacy_version:1})).j;assert.strictEqual(ns.shaliach.location_consent.share_exact,null);
 await choice(fresh,false,ns.token);assert.strictEqual((await choice('e'.repeat(24),'read',ns.token)).j.share_exact,false);
 console.log('PASS consent: default-deny legacy, explicit yes/no, no forged bypass, account/device persistence, cross-device account revocation, names/photos/nearby precision+distance, requester ring/job, accepted peer views, restart, world-map coarse, own/admin semantics preserved.');
}finally{if(srv&&!srv.killed)await stop();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
