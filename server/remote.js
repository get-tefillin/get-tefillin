"use strict";
const BASE=process.env.UPSTASH_REDIS_REST_URL,TOKEN=process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED=!!(BASE&&TOKEN);
const health={last_ok:0,last_error:0,pending:false};
async function cmd(parts,body){
 const res=await fetch(BASE+"/"+parts.map(encodeURIComponent).join("/"),{method:body===undefined?"GET":"POST",headers:{authorization:"Bearer "+TOKEN,"content-type":"text/plain; charset=utf-8"},body:body,signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error("remote http "+res.status);
 const result=await res.json();if(result.error)throw Error("remote command rejected");return result;
}
async function loadDb(){if(!ENABLED)return null;const r=await cmd(["get","db"]);return r&&typeof r.result==="string"?r.result:null}
let timer=null,pending=null,active=null,lastSaved=null,retries=0;
function schedule(delay){if(!timer&&!active&&pending!==null)timer=setTimeout(()=>{timer=null;drain()},delay)}
async function drain(){
 if(active)return active;if(pending===null)return;
 const value=pending;pending=null;
 active=(async()=>{await Promise.resolve();try{if(value!==lastSaved){await cmd(["set","db"],value);lastSaved=value}health.last_ok=Date.now();retries=0}catch(e){health.last_error=Date.now();if(pending===null)pending=value;retries++;console.error('remote backup delayed; retry queued')}finally{active=null;health.pending=pending!==null;schedule(Math.min(60000,1000*Math.pow(2,Math.min(retries,6))))}})();
 return active;
}
function saveDb(value){if(!ENABLED)return;if(value===lastSaved&&pending===null)return;pending=value;health.pending=true;schedule(1000)}
async function flush(){if(!ENABLED)return;if(timer){clearTimeout(timer);timer=null}await drain();if(active)await active;if(pending!==null)await drain()}
async function putPhoto(name,buf){if(ENABLED)await cmd(["set","photo:"+name],buf.toString('base64'))}
async function getPhoto(name){if(!ENABLED)return null;try{const r=await cmd(["get","photo:"+name]);return r&&r.result?Buffer.from(r.result,'base64'):null}catch(e){return null}}
async function delPhoto(name){if(!ENABLED)return;try{await cmd(["del","photo:"+name])}catch(e){console.error('remote photo delete delayed')}}
module.exports={ENABLED,loadDb,saveDb,flush,putPhoto,getPhoto,delPhoto,health};
