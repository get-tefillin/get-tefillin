'use strict';const {spawn}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-')),port=8798,base='http://127.0.0.1:'+port;
const old={id:'expired',token:'expired-token',status:'open',first_name:'Pending test',phone:'0500000000',lat:32.08,lng:34.85,created_at:Date.now()-120000,ring_started:Date.now()-120000,candidates:[],declined:{}};
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({shluchim:{},orderers:{},requests:{expired:old},photos:{},deletions:[],counters:{total_done:0,by_month:{}},settings:{}}));
const srv=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:'ignore'});
async function api(p,b,t){const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(t?{'x-token':t}:{})},body:b?JSON.stringify(b):undefined});return r.json()}
(async()=>{try{for(let i=0;i<30;i++){try{await api('/healthz');break}catch(e){await new Promise(r=>setTimeout(r,100))}}
 let s=await api('/api/shaliach/register',{name:'Late volunteer',phone:'0500000001',has_tefillin:true,transport:'foot',langs:['he']});const tok=s.token;
 await api('/api/shaliach/mode',{mode:'available'},tok);let p=await api('/api/shaliach/poll',{},tok);assert(!p.me.location_ready);assert(!p.waiting.length);assert(!p.ringing.length);
 let r=await api('/api/request',{first_name:'Dispatch test',phone:'0500000002',lat:32.08,lng:34.85,device:'dispatch-regression'});assert.strictEqual(r.notified,0);const id=r.id,rt=r.token;
 p=await api('/api/shaliach/poll',{lat:32.081,lng:34.851},tok);assert(p.me.location_ready);assert(p.ringing.some(r=>r.id===id));assert(p.waiting.some(r=>r.id==='expired'));
 let state=await api('/api/request/'+id,null,rt);assert.strictEqual(state.notified,1);assert.strictEqual(state.screen_seen,1);assert.strictEqual(state.push_accepted,0);
 await api('/api/shaliach/poll',{lat:32.081,lng:34.851},tok);state=await api('/api/request/'+id,null,rt);assert.strictEqual(state.screen_seen,1);
 p=await api('/api/shaliach/poll',{lat:0,lng:0},tok);assert(!p.ringing.length&&!p.waiting.length);
 await api('/api/shaliach/mode',{mode:'off'},tok);p=await api('/api/shaliach/poll',{lat:32.081,lng:34.851},tok);assert(!p.ringing.length&&!p.waiting.length);
 console.log('PASS dispatch: missing location yields0; late GPS volunteer rings; expired open remains discoverable; screen receipts dedupe; no push claimed; distance/off exclusions');
 }finally{srv.kill();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
