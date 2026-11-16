'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
process.env.UPSTASH_REDIS_REST_URL='https://example.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='test-only';
let active=0,max=0,writes=[],fail=false,raw=JSON.stringify({shluchim:{test:{id:'test'}},requests:{},counters:{by_month:{}},settings:{}});
global.fetch=async(url,opt)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,20));active--;if(fail)throw Error('simulated offline');if(opt.method==='POST'){writes.push(opt.body);return {ok:true,json:async()=>({result:'OK'})}}return {ok:true,json:async()=>({result:raw})}};
const remote=require('../server/remote'),{Store}=require('../server/store');
(async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'durability-')),s=new Store(dir);await s.restore();assert(s.db.shluchim.test);
fail=true;await assert.rejects(()=>s.restore());assert(s.db.shluchim.test);assert.equal(writes.length,0);fail=false;
raw=null;await assert.rejects(()=>s.restore());assert.equal(writes.length,0);
remote.saveDb('first');const p=remote.flush();remote.saveDb('second');await p;await remote.flush();assert.equal(max,1);assert.equal(writes.at(-1),'second');
const n=writes.length;remote.saveDb('second');await remote.flush();assert.equal(writes.length,n);
fail=true;remote.saveDb('retry-me');await remote.flush();assert(remote.health.pending);fail=false;await remote.flush();assert.equal(writes.at(-1),'retry-me');assert(!remote.health.pending);
console.log('PASS: failed/missing restore preserves data and never writes empty backup; serialized writes, newest snapshot, identical-write suppression, offline retry and flush.');process.exit(0)
})().catch(e=>{console.error(e);process.exit(1)});
