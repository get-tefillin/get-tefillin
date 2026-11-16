'use strict';
const {spawn}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coverage-')),port=8797,base='http://127.0.0.1:'+port;
const week=Date.now()-7*24*3600000;
const sh={id:'week',token:'week-token',name:'Coverage test',phone:'0500000011',mode:'standby',transport:'foot',lat:32.08,lng:34.85,loc_at:week,last_seen:week,push:[{endpoint:'https://fcm.googleapis.com/fcm/send/test'}],tz:'UTC'};
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({shluchim:{week:sh},orderers:{},requests:{},photos:{},deletions:[],counters:{total_done:0,by_month:{}},settings:{}}));
const mock=path.join(dir,'mock.js');
fs.writeFileSync(mock,`const p=require(${JSON.stringify(path.resolve('server/push.js'))});p.sendToShaliach=async function(){return 1};`);
const srv=spawn(process.execPath,['--require',mock,'server/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:'ignore'});
async function api(p,b,t){const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(t?{'x-token':t}:{})},body:b?JSON.stringify(b):undefined});return r.json()}
let n=0;async function req(lat=32.08,lng=34.85){return api('/api/request',{first_name:'Test request',phone:'050000002'+(++n),lat,lng,device:'coverage-'+n})}
(async()=>{try{for(let i=0;i<30;i++){try{await api('/healthz');break}catch(e){await new Promise(r=>setTimeout(r,100))}}
assert.strictEqual((await req()).notified,0,'stale location alone must not target');
for(const bad of [{enabled:true,label:'',lat:32,lng:34,radius_km:10},{enabled:true,label:'x',lat:null,lng:34,radius_km:10},{enabled:true,label:'x',lat:32,lng:181,radius_km:10},{enabled:true,label:'x',lat:32,lng:34,radius_km:101},{enabled:true,label:'x',lat:32,lng:34,radius_km:0}])assert.strictEqual((await api('/api/shaliach/coverage',bad,sh.token)).ok,false);
const area={enabled:true,label:'Chosen area',lat:32.08,lng:34.85,radius_km:5};assert((await api('/api/shaliach/coverage',area,sh.token)).ok);
const r=await req();assert.strictEqual(r.notified,1,'week-old standby volunteer with fixed coverage should target');await new Promise(r=>setTimeout(r,40));let state=await api('/api/request/'+r.id,null,r.token);assert.strictEqual(state.push_accepted,1,'background push transport called without polling');assert.strictEqual(state.screen_seen,0,'no foreground receipt invented');
let p=await api('/api/shaliach/poll',{},sh.token);assert(!p.me.location_ready);assert.strictEqual(p.me.coverage.label,'Chosen area');assert(p.ringing.some(x=>x.id===r.id&&x.km===null&&x.eta_min===null),'no stale distance or ETA');
const near=await api('/api/nearby?lat=32.08&lng=34.85');assert.strictEqual(near.shluchim.length,0,'fixed coverage must not look like live location');
assert.strictEqual((await req(33.08,34.85)).notified,0,'outside fixed radius');
await api('/api/shaliach/mode',{mode:'off'},sh.token);assert.strictEqual((await req()).notified,0,'off blocks coverage');
await api('/api/shaliach/mode',{mode:'standby'},sh.token);await api('/api/shaliach/hours',{hours:{on:true,days:[null,null,null,null,null,null,null]}},sh.token);assert.strictEqual((await req()).notified,0,'outside hours blocks coverage');
await api('/api/shaliach/hours',{hours:{on:false}},sh.token);await api('/api/shaliach/coverage',{enabled:false},sh.token);assert.strictEqual((await req()).notified,0,'disable stops coverage');
console.log('PASS coverage: explicit opt-in, validation, week-stale background push with mock transport, no fake live map/ETA, radius/off/hours/disable gates');
}finally{srv.kill();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
