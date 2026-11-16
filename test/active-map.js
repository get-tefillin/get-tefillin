'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'active-map-')),root=path.join(__dirname,'..'),at=Date.now();
const base={mode:'available',loc_at:at,last_seen:at,tz:'Asia/Jerusalem',override_until:at+3600000,name:'PRIVATE NAME',phone:'PRIVATE PHONE',token:'PRIVATE TOKEN'};
const shluchim={};for(let i=0;i<14;i++)shluchim['s'+i]={...base,id:'s'+i,lat:31+i*.1,lng:34.8+i*.05};
shluchim.off={...base,id:'off',mode:'off',lat:32,lng:35};shluchim.standby={...base,id:'standby',mode:'standby',lat:32,lng:35};shluchim.stale={...base,id:'stale',loc_at:at-130000,lat:32,lng:35};shluchim.private={...base,id:'private',lat:null,lng:null,coverage:{enabled:true,lat:32,lng:35,radius_km:25}};shluchim.busy={...base,id:'busy',lat:32,lng:35};
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({shluchim,requests:{job:{id:'job',status:'accepted',shaliach_id:'busy',created_at:at}},counters:{total_done:22},settings:{report_paused:true}}));
const srv=spawn(process.execPath,[path.join(root,'server/server.js')],{cwd:root,env:{...process.env,PORT:'8799',DATA_DIR:dir},stdio:'ignore'});
(async()=>{try{let r;for(let n=0;n<30;n++){try{r=await fetch('http://localhost:8799/healthz');if(r.ok)break}catch(e){}await new Promise(r=>setTimeout(r,100))}
const d=await fetch('http://localhost:8799/api/world-map?zoom=16').then(r=>r.json());assert.equal(d.total,14);assert.equal(d.clusters.reduce((a,c)=>a+c.count,0),14);assert.deepEqual(d.extent,[31,34.8,32.3,35.45]);assert(!/PRIVATE|token|phone|name|coverage/.test(JSON.stringify(d)));
const near=await fetch('http://localhost:8799/api/world-map?zoom=16&bounds=34.7,30.9,35,31.4').then(r=>r.json());assert.equal(near.total,14);assert(near.clusters.reduce((a,c)=>a+c.count,0)<14);console.log('PASS all14 eligible volunteers beyond nearby10; approximate global extent; no identity; off/standby/stale/private/busy excluded; viewport and global counts distinct');
}finally{srv.kill('SIGTERM')}})().catch(e=>{console.error(e);process.exitCode=1});
