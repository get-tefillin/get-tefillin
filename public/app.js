(function(){
"use strict";
var CFG=window.TN_CONFIG||{};
var $=function(id){return document.getElementById(id)};
var LS={get:function(k){try{return JSON.parse(localStorage.getItem("tn_"+k))}catch(e){return null}},set:function(k,v){try{localStorage.setItem("tn_"+k,JSON.stringify(v))}catch(e){}},del:function(k){try{localStorage.removeItem("tn_"+k)}catch(e){}}};
/* ---------- languages ---------- */
var I=window.TN_I18N;
var RTL={he:1,yi:1};
function pickLang(){
  try{var q=new URLSearchParams(location.search).get("lang");if(q&&I.strings[q]){LS.set("lang",q);return q}}catch(e){}
  var s=LS.get("lang");if(s&&I.strings[s])return s;
  var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||"he"];
  for(var i=0;i<ls.length;i++){var c=String(ls[i]||"").toLowerCase().split("-")[0];if(c==="iw")c="he";if(c==="ji")c="yi";if(I.strings[c])return c}
  return "he";
}
var LANG=pickLang();
function t(k,v){var s=(I.strings[LANG]||{})[k];if(s==null)s=I.strings.he[k];if(s==null)return k;
  if(v)s=s.replace(/\{(\w+)\}/g,function(m,n){return v[n]!=null?v[n]:m});return s}
function langName(c){for(var i=0;i<I.speak.length;i++)if(I.speak[i].code===c)return I.speak[i].name;return c}
function trName(x){return t(x)}
var TR={foot:1,bike:1,car:1};
var PERSON='<svg viewBox="0 0 24 24"><use href="#ico-person"/></svg>';
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function toast(t,ms){var el=$("toast");el.textContent=t;el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(function(){el.classList.remove("show")},ms||2600)}
function fmtKm(km){if(km==null)return"";return km>=1?t("km",{n:km.toFixed(1)}):t("m",{n:Math.max(10,Math.round(km*100)*10)})}
function errMsg(j){if(j&&j.code&&I.strings.he["e_"+j.code])return t("e_"+j.code);if(j&&j._status===0)return t("no_internet");if(j&&j._status>=500)return t("temp_err");return t("err_generic")}
function dispPhone(p){return p&&p.indexOf("+972")===0?"0"+p.slice(4):(p||"")}
function telHref(p){return "tel:"+p}
function waHref(p,txt){return "https://wa.me/"+String(p).replace(/\D/g,"")+(txt?"?text="+encodeURIComponent(txt):"")}
function randHex(n){var a=new Uint8Array(n);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(x){return("0"+x.toString(16)).slice(-2)}).join("")}
var DEVICE=LS.get("device");if(!DEVICE){DEVICE=randHex(12);LS.set("device",DEVICE)}

function api(method,path,body,token){
  var h={"content-type":"application/json"};if(token)h["x-token"]=token;
  return fetch(path,{method:method,headers:h,body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(15000)}).then(function(r){
    return r.json().catch(function(){return{ok:false,code:"server"}}).then(function(j){j._status=r.status;return j})
  }).catch(function(){return{ok:false,code:"offline",_status:0}})
}

/* ---------- map ---------- */
var CENTER=CFG.DEFAULT_CENTER||[32.077,34.8505];
var map=L.map("map",{zoomControl:false,attributionControl:true}).setView(CENTER,15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap",referrerPolicy:"strict-origin-when-cross-origin"}).addTo(map);
function divIcon(html,size){return L.divIcon({className:"",html:html,iconSize:[size,size],iconAnchor:[size/2,size/2]})}
var meIcon=divIcon('<div class="me"></div>',22);
var radarIcon=divIcon('<div class="radar-pin"><i></i><i></i><i></i></div>',24);
function pinIcon(name,sel){return L.divIcon({className:"",html:'<div class="pin'+(sel?' sel':'')+'">'+PERSON+'</div><div class="pin-label">'+esc(name)+'</div>',iconSize:[40,40],iconAnchor:[20,20]})}
function reqIcon(){return L.divIcon({className:"",html:'<div class="rpin">'+PERSON+'</div><div class="pin-label">'+esc(t("requester_pin"))+'</div>',iconSize:[40,40],iconAnchor:[20,20]})}
var layer=L.layerGroup().addTo(map);
var activeMap=window.TN_ACTIVE_MAP(map),mapOnly=false;
function sheetH(){if(mapOnly)return 95;var s=document.querySelector(".sheet:not([hidden])");return s?s.offsetHeight:0}
function topH(){var t=$("topbar");return t.hidden?0:t.offsetHeight}
function fit(points,maxZoom){
  points=points.filter(Boolean);if(!points.length)return;
  setTimeout(function(){map.invalidateSize();
    if(points.length===1){var z=maxZoom||16,dy=(sheetH()-topH())/2,pt=map.project(L.latLng(points[0]),z).add([0,dy]);map.setView(map.unproject(pt,z),z,{animate:false});return}
    map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[40,topH()+40],paddingBottomRight:[40,sheetH()+40],maxZoom:maxZoom||17})},60)}

/* ---------- screens ---------- */
var SCREENS=["s-intro","s-home","s-locpick","s-match","s-none","s-waiting","s-route","s-arrived","s-done","s-vreg","s-vdash","s-vhours","s-vreq","s-vgo","s-vdone","s-vthanks"];
var cur=null;
function show(id){if(mapOnly&&id!==cur)setMapOnly(false);cur=id;SCREENS.forEach(function(s){var el=$(s);el.hidden=(s!==id);el.classList.remove("peek")});$("topbar").hidden=(id==="s-intro");$("locateBtn").hidden=(id==="s-intro"||id==="s-locpick");if(typeof closeDrawer==="function")closeDrawer();if(typeof sheetSync==="function")sheetSync();if(typeof chatSync==="function")chatSync()}
function canMapOnly(){return cur==='s-home'||cur==='s-vdash'}
function setMapOnly(on){on=!!on&&canMapOnly();mapOnly=on;$('app').classList.toggle('map-only',on);$('activeMapControls').hidden=!on;if(on){layer.clearLayers();document.activeElement&&document.activeElement.blur()}activeMap.show(on);sheetSync();setTimeout(function(){map.invalidateSize();if(!on){if(cur==='s-home')drawHome();else if(cur==='s-vdash')drawVolMap(false)}},80)}
$('restoreCard').onclick=function(){setMapOnly(false)};$('allActiveVols').onclick=function(){activeMap.all()};
var mode="user";
$("worldMapBtn").onclick=function(){ $("worldMapOverlay").hidden=false; $("worldMapFrame").src="/map/"; };
function closeWorldMap(){ $("worldMapOverlay").hidden=true; $("worldMapFrame").removeAttribute("src"); }
window.addEventListener("message",function(e){if(e.origin===location.origin&&e.source===$("worldMapFrame").contentWindow&&e.data==="close-world-map")closeWorldMap()});
document.addEventListener("keydown",function(e){if(e.key==="Escape")closeWorldMap()});
function setModeTabs(m){mode=m;$("tabUser").classList.toggle("on",m==="user");$("tabVol").classList.toggle("on",m==="vol");$("tabUser").setAttribute("aria-selected",m==="user");$("tabVol").setAttribute("aria-selected",m==="vol")}

/* =========================================================
   REQUESTER
   ========================================================= */
var U={pos:null,src:null,addr:"",nearby:[],req:LS.get("req"),poll:null,nearT:null,lastStatus:null,pickPos:null,watch:null,shMarker:null,line:null,meMarker:null};

function locLabel(){$("locText").textContent=U.pos?(U.addr||(U.src==="gps"?t("current_loc"):t("marked_point"))):t("locating")}
function reverseGeo(p){
  fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language="+LANG+",he,en&zoom=18&lat="+p[0]+"&lon="+p[1]).then(function(r){return r.json()}).then(function(j){
    if(!j||!j.address)return;var a=j.address;var street=(a.road||a.pedestrian||a.neighbourhood||"")+(a.house_number?" "+a.house_number:"");var city=a.city||a.town||a.village||a.suburb||"";
    U.addr=[street,city].filter(Boolean).join(", ");locLabel()}).catch(function(){})}

function getGps(ok,fail){
  if(!navigator.geolocation){fail&&fail();return}
  navigator.geolocation.getCurrentPosition(function(p){ok([p.coords.latitude,p.coords.longitude],p.coords.accuracy)},function(){fail&&fail()},{enableHighAccuracy:true,timeout:12000,maximumAge:30000})
}
function setUserPos(p,src){U.pos=p;U.src=src;U.addr="";locLabel();reverseGeo(p)}

var FIND_STAND=false,homeStands=[],standLast=0;
function stText(he,en){return LANG==='he'||LANG==='yi'?he:en}
function stHours(s){if(s.hours_unknown)return '';if(s.always)return stText('פתוח 24/7','Open 24/7');return s.days.map(function(d,i){if(!d)return '';function f(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}return (LANG==='he'?['א','ב','ג','ד','ה','ו','שבת']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[i]+': '+f(d[0])+'-'+f(d[1])}).filter(Boolean).join(' · ')+' ('+s.tz+')'}
function renderStands(){var list=$('standNearby');list.textContent='';if(!U.pos){list.textContent=stText('יש לבחור מיקום','Choose your location');return}
 if(!homeStands.length)list.textContent=stText('אין דוכנים מפורסמים בטווח 100 ק״מ. אפשר לחפש במפה העולמית.','No published stands within 100 km. Try the world map.');
 homeStands.slice(0,20).forEach(function(s){var li=document.createElement('li');li.style.cssText='padding:12px 0;border-bottom:1px solid #ddd';var title=document.createElement('b');title.textContent=s.name+' · '+fmtKm(s.km);li.appendChild(title);[s.address,s.open_now===null?stText('שעות הפעילות לא נמסרו - מומלץ להתקשר לפני הגעה','Hours not provided - call before visiting'):s.open_now?stText('פתוח כעת לפי השעות','Open now per schedule'):stText('סגור כעת לפי השעות','Closed now per schedule'),stHours(s),s.note].forEach(function(t){if(t){var p=document.createElement('p');p.textContent=t;p.style.cssText='margin:5px 0;font-size:13px';li.appendChild(p)}});var a=document.createElement('a');a.href='https://www.google.com/maps/dir/?api=1&destination='+s.lat+','+s.lng;a.target='_blank';a.rel='noopener';a.textContent=stText('ניווט לדוכן','Directions to stand');li.appendChild(a);if(s.phone){var call=document.createElement('a');call.href='tel:'+s.phone;call.textContent=stText('התקשרות','Call');call.style.marginInlineStart='18px';li.appendChild(call)}if(s.source_url){var source=document.createElement('p');source.style.cssText='font-size:11px;color:#666';var link=document.createElement('a');link.href=s.source_url;link.target='_blank';link.rel='noopener';link.textContent=stText('מקור: חב״ד ישראל','Source: Chabad Israel');source.appendChild(link);if(s.source_synced_at)source.appendChild(document.createTextNode(' · '+new Date(s.source_synced_at).toLocaleDateString(LANG==='he'?'he-IL':'en-GB')));li.appendChild(source)}list.appendChild(li)});drawHome()}
function loadStands(force){if(!U.pos||(!force&&Date.now()-standLast<60000))return;standLast=Date.now();api('GET','/api/stands?lat='+U.pos[0]+'&lng='+U.pos[1]).then(function(j){if(j.ok){homeStands=j.stands||[];renderStands()}else{$('standNearby').textContent=stText('לא ניתן לעדכן דוכנים כרגע','Cannot update stands right now');standLast=0}})}
function setFindStand(on){FIND_STAND=on;$('findVolunteer').classList.toggle('on',!on);$('findStand').classList.toggle('on',on);$('findVolunteer').setAttribute('aria-pressed',!on);$('findStand').setAttribute('aria-pressed',on);$('standPanel').hidden=!on;$('orderForm').hidden=on;$('availTitle').parentNode.hidden=on;if(on){loadStands(true);renderStands()}drawHome()}
$('findVolunteer').onclick=function(){setFindStand(false)};$('findStand').onclick=function(){setFindStand(true)};
function drawHome(){
  if(mapOnly)return;
  layer.clearLayers();
  if(U.pos)L.marker(U.pos,{icon:meIcon,zIndexOffset:500}).addTo(layer);
  if(FIND_STAND){homeStands.forEach(function(s){L.marker([s.lat,s.lng],{icon:divIcon('<div style="background:#b97a16;color:white;border:3px solid white;border-radius:10px;text-align:center;font-size:22px">▣</div>',32)}).bindTooltip(s.name).addTo(layer)});return}
  U.nearby.forEach(function(s){L.marker([s.lat,s.lng],{icon:pinIcon(s.name,false),keyboard:false}).addTo(layer)});
}
function renderNearby(){
  var n=U.nearby.length,ul=$("volList");ul.innerHTML="";
  $("availTitle").textContent=!U.pos?t("locating_you"):(n?(n===1?t("one_near"):t("n_near",{n:n})):t("none_near"));
  if(U.pos&&!n){var li=document.createElement("li");li.className="empty";li.textContent=t("none_near_hint");ul.appendChild(li)}
  sortedNearby().slice(0,3).forEach(function(s){
    var li=document.createElement("li");
    li.innerHTML=avatarHtml(s.name,null,s.photo)+'<div class="vl-main"><b>'+esc(s.name)+'</b><span>'+fmtKm(s.km)+' · '+esc(t(s.transport))+'</span>'+speaksLine(s.langs)+'</div><div class="vl-eta"><b>'+esc(t("min",{n:s.eta_min}))+'</b><span>'+esc(t("approx"))+'</span></div>';
    ul.appendChild(li)});
  drawHome();
}
function initialOf(n){n=String(n||"").trim();return n?Array.from(n)[0].toUpperCase():""}
function avatarHtml(n,cls,photo){if(photo)return '<div class="avatar'+(cls?" "+cls:"")+' has-photo"><img src="/api/shaliach/photo/'+esc(photo)+'" alt=""></div>';var i=initialOf(n);return i?'<div class="avatar initial'+(cls?" "+cls:"")+'">'+esc(i)+'</div>':'<div class="avatar'+(cls?" "+cls:"")+'">'+PERSON+'</div>'}
function speaksYou(langs){return !!(langs&&(langs.indexOf(LANG)>=0||(LANG==="yi"&&langs.indexOf("yi")>=0)))}
function speaksLine(langs){if(!langs||!langs.length)return"";if(speaksYou(langs))return'<span class="speaks yes">'+esc(t("speaks_yours"))+'</span>';
  return'<span class="speaks">'+esc(t("speaks",{langs:langs.map(langName).join(", ")}))+'</span>'}
function sortedNearby(){return U.nearby.slice().sort(function(a,b){return(speaksYou(b.langs)?1:0)-(speaksYou(a.langs)?1:0)||a.km-b.km})}
function loadBulletin(){
  api("GET","/api/bulletin").then(function(j){
    if(!j||!j.ok)return;
    var bn=$("homeBanner");if(bn){if(j.announcement){bn.textContent=j.announcement;bn.hidden=false}else bn.hidden=true}
    var st=$("blStats");if(st){if(j.stats){st.textContent=t("bl_stats",{m:j.stats.month_count,t:j.stats.total_done});st.hidden=false}else st.hidden=true}
  }).catch(function(){})
}
function loadNearby(fitIt){
  if(FIND_STAND)loadStands(fitIt);
  if(!U.pos){return}
  api("GET","/api/nearby?lat="+U.pos[0].toFixed(5)+"&lng="+U.pos[1].toFixed(5)+"&lang="+LANG).then(function(j){
    if(!j.ok)return;U.nearby=j.shluchim||[];U.totalDone=j.total_done||0;
    $("totalLine").textContent=j.total_done?t("total_line",{n:j.total_done}):"";
    if(cur==="s-home"){renderNearby();if(fitIt)fit([U.pos].concat(U.nearby.slice(0,4).map(function(s){return[s.lat,s.lng]})),16)}
  })
}
function goHome(){
  stopReqPoll();setModeTabs("user");show("s-home");loadBulletin();
  var me=LS.get("me");if(me){if(!$("reqName").value)$("reqName").value=me.name||"";if(!$("reqPhone").value)$("reqPhone").value=me.phone||""}
  $('findVolunteer').textContent=stText('שליח שמגיע אליי','Volunteer comes to me');$('findStand').textContent=stText('דוכן שאגיע אליו','Stand I can visit');$('standDisclaimer').textContent=stText('דוכן הוא מקום קבוע עם תפילין, ללא הבטחה לסיוע של שליח. השעות לפי פרטי המקום; מומלץ לוודא לפני הגעה.','A stand is a fixed location with tefillin, with no promise of volunteer assistance. Hours are as listed; confirm before visiting.');
  whoSync();loadWallCar();
  if(!U.pos){renderNearby();getGps(function(p){setUserPos(p,"gps");renderNearby();loadNearby(true)},function(){openLocPick(t("gps_fail"))})}
  else{locLabel();renderNearby();loadNearby(true)}
  clearInterval(U.nearT);U.nearT=setInterval(function(){if(cur==="s-home"&&!document.hidden)loadNearby(false)},10000);
}

/* location picker */
var pickMarker=null;
function openLocPick(note){
  show("s-locpick");U.pickNote=note||"";$("locPickNote").textContent=note||t("locpick_note");
  $("addrResults").innerHTML="";layer.clearLayers();
  U.pickPos=U.pos;setPick(U.pickPos);
  fit([U.pickPos||CENTER],16);
}
function setPick(p){
  if(pickMarker){layer.removeLayer(pickMarker);pickMarker=null}
  $("confirmLoc").disabled=!p;if(!p)return;
  pickMarker=L.marker(p,{icon:meIcon,draggable:true,zIndexOffset:600}).addTo(layer);
  pickMarker.on("dragend",function(){var ll=pickMarker.getLatLng();U.pickPos=[ll.lat,ll.lng]});
}
map.on("click",function(e){if(cur!=="s-locpick")return;U.pickPos=[e.latlng.lat,e.latlng.lng];U.pickSrc="manual";setPick(U.pickPos)});
$("addrForm").onsubmit=function(e){e.preventDefault();var q=$("addrInput").value.trim();if(q.length<2)return;
  $("addrResults").innerHTML='<li class="muted">'+esc(t("searching"))+'</li>';
  fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language="+LANG+",he,en&countrycodes=il&limit=5&q="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(list){
    var ul=$("addrResults");ul.innerHTML="";
    if(!list.length){ul.innerHTML='<li class="muted">'+esc(t("not_found"))+'</li>';return}
    list.forEach(function(it){var li=document.createElement("li");var b=document.createElement("button");b.type="button";b.textContent=it.display_name.split(",").slice(0,3).join(",");
      b.onclick=function(){U.pickPos=[+it.lat,+it.lon];U.pickSrc="manual";U.pickAddr=b.textContent;setPick(U.pickPos);map.setView(U.pickPos,17);ul.innerHTML=""};li.appendChild(b);ul.appendChild(li)})
  }).catch(function(){$("addrResults").innerHTML='<li class="muted">'+esc(t("search_unavail"))+'</li>'})};
$("useGps").onclick=function(){toast(t("locating"));getGps(function(p){U.pickPos=p;U.pickSrc="gps";U.pickAddr="";setPick(p);map.setView(p,17)},function(){toast(t("no_loc_perm"))})};
$("confirmLoc").onclick=function(){if(!U.pickPos)return;setUserPos(U.pickPos,U.pickSrc||"manual");if(U.pickAddr){U.addr=U.pickAddr;locLabel()}goHome()};
$("changeLoc").onclick=function(){openLocPick()};

/* order */
$("orderForm").onsubmit=function(e){e.preventDefault();
  var name=$("reqName").value.trim(),phone=$("reqPhone").value.trim();$("orderErr").textContent="";
  if(!U.pos){openLocPick(t("need_loc"));return}
  if(name.length<2){whoShow(true);$("orderErr").textContent=t("err_first");$("reqName").focus();return}
  if(phone.replace(/\D/g,"").length<9){whoShow(true);$("orderErr").textContent=t("err_phone");$("reqPhone").focus();return}
  $("orderBtn").disabled=true;
  api("POST","/api/request",{first_name:name,phone:phone,lat:U.pos[0],lng:U.pos[1],address:U.addr,device:DEVICE,loc_source:U.src,lang:LANG}).then(function(j){
    $("orderBtn").disabled=false;
    if(!j.ok){$("orderErr").textContent=errMsg(j);return}
    LS.set("me",{name:name,phone:phone});
    U.req={id:j.id,token:j.token};LS.set("req",U.req);histAdd(j.id);U.lastStatus=null;
    showMatching(j.notified,60);startReqPoll();
  })
};
function showMatching(notified,left){
  show("s-match");layer.clearLayers();if(U.pos){L.marker(U.pos,{icon:radarIcon,interactive:false,keyboard:false}).addTo(layer);L.marker(U.pos,{icon:meIcon}).addTo(layer)}fit([U.pos],15);
  U.notified=notified;dispatchMessage({notified:notified});
  setMatchTimer(left);
}
function dispatchMessage(j){var he=LANG==='he'||LANG==='yi',n=j.notified||0,seen=j.screen_seen||0,push=j.push_accepted||0;$('matchMsg').textContent=seen?(he?'הבקשה הוצגה במסך של '+seen+' שלוחים. ממתינים לאישור.':'Request appeared on '+seen+' volunteer screens. Waiting for acceptance.'):(push?(he?'שירות ההתראות קיבל '+push+' התראות. טרם התקבל אישור משליח.':'Push service accepted '+push+' alerts. No volunteer has accepted yet.'):(n?(he?'נמצאו '+n+' שלוחים מתאימים. עדיין אין אישור שהבקשה הוצגה להם.':n+' eligible volunteers found. No screen receipt yet.'):(he?'הבקשה נשמרה, אך אין כרגע שליח מתאים עם מיקום עדכני או אזור פעילות קבוע כאן. לא נשלחה התראה לטלפון.':'Request saved, but no volunteer with a recent location or fixed coverage area is eligible here. No phone alert was sent.')))}
function setMatchTimer(left){var el=$("matchTimer");el.style.transition="none";el.style.width=Math.max(0,left/60*100)+"%";void el.offsetWidth;el.style.transition="width "+left+"s linear";el.style.width="0%"}
function startReqPoll(){stopReqPoll();clearInterval(U.nearT);pollReq();U.poll=setInterval(pollReq,3000);startReqWatch()}
function stopReqPoll(){clearInterval(U.poll);U.poll=null;if(U.watch!=null&&navigator.geolocation){navigator.geolocation.clearWatch(U.watch);U.watch=null}}
function startReqWatch(){ // keep the requester's exact spot fresh while the page is open (only for GPS users)
  if(U.src!=="gps"||!navigator.geolocation||U.watch!=null)return;var last=0;
  U.watch=navigator.geolocation.watchPosition(function(p){var now=Date.now();U.pos=[p.coords.latitude,p.coords.longitude];if(U.meMarker)U.meMarker.setLatLng(U.pos);
    if(now-last>15000&&U.req){last=now;api("POST","/api/request/"+U.req.id+"/loc",{lat:U.pos[0],lng:U.pos[1]},U.req.token)}},function(){},{enableHighAccuracy:true,maximumAge:10000})}
function endRequest(){U.req=null;LS.del("req");stopReqPoll();chatEnd()}
function pollReq(){
  if(!U.req)return;var rq=U.req;
  api("GET","/api/request/"+rq.id,null,rq.token).then(function(j){
    if(!U.req||U.req.id!==rq.id)return;
    if(!j.ok){if(j._status===404){endRequest();goHome()}return}
    if(!U.pos)U.pos=[j.lat,j.lng];
    var st=j.status,prev=U.lastStatus;U.lastStatus=st;histSet(rq.id,st,j.shaliach?firstOf(j.shaliach):null);
    if(st==="open")dispatchMessage(j);
    if(st==="open"){if(j.ring_left_s>0){if(cur!=="s-match"){showMatching(j.notified,j.ring_left_s)}}else if(cur!=="s-none"){show("s-none");layer.clearLayers();L.marker(U.pos,{icon:meIcon}).addTo(layer);fit([U.pos],15)}}
    else if(st==="waiting"){if(cur!=="s-waiting"){show("s-waiting");layer.clearLayers();L.marker(U.pos,{icon:meIcon}).addTo(layer);fit([U.pos],15)}}
    U.lastJ=j;
    if(st==="accepted"||st==="arrived")chatStart("r",{id:rq.id,token:rq.token,name:firstOf(j.shaliach),phone:j.shaliach&&j.shaliach.phone});
    if(st==="accepted"){if(prev!=="accepted"&&prev!==null){buzz();toast(t("accepted_toast",{name:firstOf(j.shaliach)}),3500)}renderRoute(j)}
    else if(st==="arrived"){if(cur!=="s-arrived"&&!chatOpen()){buzz();renderArrived(j);show("s-arrived");drawRoute(j,true)}else if(chatOpen())U.arrivedPending=true}
    else if(st==="done"){var dr={id:rq.id,token:rq.token};endRequest();closeChat();loadConfig();show("s-done");phShow("r",dr);layer.clearLayers();if(U.pos)L.marker(U.pos,{icon:meIcon}).addTo(layer)}
    else if(st==="cancelled"){endRequest();closeChat();toast(t("cancelled"));goHome()}
  })
}
function firstOf(s){return s&&s.name?s.name.split(" ")[0]:t("the_shaliach")}
function renderArrived(j){$("arrTitle").textContent=t("arrived_name",{name:firstOf(j.shaliach)});$("callSh2").href=telHref(j.shaliach.phone)}
function drawRoute(j,noFit){
  var s=j.shaliach;layer.clearLayers();U.meMarker=L.marker(U.pos,{icon:meIcon,zIndexOffset:500}).addTo(layer);
  if(s&&s.lat!=null){var sp=[s.lat,s.lng];L.marker(sp,{icon:pinIcon(firstOf(s),true),zIndexOffset:800}).addTo(layer);
    L.polyline([sp,U.pos],{color:"#0f1f3d",weight:5,opacity:.8,dashArray:"1 9",lineCap:"round"}).addTo(layer);
    if(!noFit||!U.fitted){fit([sp,U.pos],17);U.fitted=true}}
}
function renderRoute(j){
  var s=j.shaliach;if(!s)return;var first=cur!=="s-route";
  if(first&&chatOpen())return; // the chat is on top; the route screen refreshes when it closes
  if(first||U.relang){U.relang=false;if(first){show("s-route");U.fitted=false}
    $("vcard").innerHTML=avatarHtml(s.name,null,s.photo)+'<div class="vc-main"><b>'+esc(s.name)+'</b><div class="vc-sub" dir="ltr">'+esc(dispPhone(s.phone))+'</div><span class="vc-tag">'+esc(t(s.transport))+' · '+esc(s.done_count?t("n_done",{n:s.done_count}):t("shaliach_word"))+'</span>'+speaksLine(s.langs)+'</div>';
    $("callSh").href=telHref(s.phone);$("waSh").href=waHref(s.phone,t("wa_req_text"));}
  $("etaLabel").textContent=t("name_on_way",{name:firstOf(s)});
  $("etaText").textContent=s.eta_min!=null?t("arrives_in",{n:s.eta_min}):t("waiting_sh_loc");
  $("etaDist").textContent=s.km!=null?fmtKm(s.km):"";
  $("locAge").textContent=s.loc_age_s!=null&&s.loc_age_s>45?t("loc_age",{n:Math.round(s.loc_age_s/60)}):t("eta_note");
  // move pin smoothly
  if(s.lat!=null){var sp=[s.lat,s.lng];
    if(first||!U.shMarker){drawRoute(j);U.shMarker=null;layer.eachLayer(function(l){if(l.options&&l.options.zIndexOffset===800)U.shMarker=l;if(l instanceof L.Polyline)U.line=l})}
    else{animateTo(U.shMarker,sp);if(U.line)U.line.setLatLngs([sp,U.pos])}}
}
function animateTo(m,to){if(!m)return;var from=m.getLatLng(),t0=performance.now(),d=1500;
  (function step(t){var p=Math.min(1,(t-t0)/d);m.setLatLng([from.lat+(to[0]-from.lat)*p,from.lng+(to[1]-from.lng)*p]);if(p<1)requestAnimationFrame(step)})(t0)}
function reqAction(a){if(!U.req)return Promise.resolve({});return api("POST","/api/request/"+U.req.id+"/"+a,{},U.req.token)}
$("cancelMatch").onclick=$("cancelNone").onclick=$("cancelWait").onclick=function(){var cid=U.req&&U.req.id;reqAction("cancel").then(function(){histSet(cid,"cancelled");endRequest();toast(t("cancelled"));goHome()})};
$("cancelRide").onclick=function(){if(!confirm(t("confirm_cancel_ride")))return;var cid=U.req&&U.req.id;reqAction("cancel").then(function(){histSet(cid,"cancelled");endRequest();toast(t("order_cancelled"));goHome()})};
$("retryBtn").onclick=$("retryBtn2").onclick=function(){reqAction("retry").then(function(j){if(j.ok){showMatching(j.notified,60)}else toast(errMsg(j))})};
$("waitBtn").onclick=function(){reqAction("wait").then(function(){show("s-waiting");toast(t("stays_open"))})};

/* donation */
var amt=36;
var DONATION_URL=LS.get("donation_url")||CFG.DONATION_URL||"#";
function setDonate(){$("donateBtn").href=DONATION_URL;Array.prototype.forEach.call(document.querySelectorAll(".tz-link"),function(l){l.href=DONATION_URL});$("donateBtn").textContent=t("donate_btn",{amt:"₪"+amt})}
function loadConfig(){api("GET","/api/config").then(function(j){if(j.ok&&j.donation_url&&/^https:\/\//.test(j.donation_url)){DONATION_URL=j.donation_url;LS.set("donation_url",DONATION_URL);setDonate()}})}
Array.prototype.forEach.call(document.querySelectorAll(".chip"),function(c){c.onclick=function(){Array.prototype.forEach.call(document.querySelectorAll(".chip"),function(x){x.classList.remove("on")});c.classList.add("on");amt=+c.dataset.amt;setDonate()}});
setDonate();
$("donateBtn").addEventListener("click",function(){toast(t("donate_toast"),3000)});
Array.prototype.forEach.call(document.querySelectorAll(".tz-link"),function(l){l.addEventListener("click",function(e){if(!/^https:\/\//.test(l.getAttribute("href")||"")){e.preventDefault();return}toast(t("donate_toast"),3000)})});
$("homeBtn").onclick=goHome;

/* =========================================================
   SHALIACH
   ========================================================= */
var V={me:LS.get("sh"),avail:false,mode:"off",pushState:null,watchId:null,pos:null,acc:null,posAt:0,poll:null,data:null,declined:{},ringing:null,job:null,audio:null,ringT:null,wake:null,myMarker:null,jobMarker:null};
function goVol(){
  setModeTabs("vol");stopReqPoll();clearInterval(U.nearT);
  if(!V.me){openReg(false);return}
  renderDash();
  if(!V.poll)vPoll(); // refresh once (resumes a job if one exists)
}
function openReg(edit){
  show("s-vreg");layer.clearLayers();$("regErr").textContent="";
  V.editing=!!edit;regTexts();$("regCancel").hidden=!edit;
  $("regTef").closest("label").hidden=!!edit;
  var have=(edit&&V.data&&V.data.me&&V.data.me.langs&&V.data.me.langs.length)?V.data.me.langs:(LANG==="yi"?["yi","he"]:[LANG]);
  renderLangChecks(have);
  if(edit&&V.data&&V.data.me){var m=V.data.me;$("regName").value=m.name;$("regPhone").value=dispPhone(m.phone);$("regCity").value=m.city||"";
    Array.prototype.forEach.call(document.querySelectorAll("input[name=tr]"),function(r){r.checked=r.value===m.transport})}
}
function regTexts(){$("regTitle").textContent=V.editing?t("edit_title"):t("reg_title");$("regBtn").textContent=V.editing?t("save"):t("reg_btn")}
function renderLangChecks(have){var box=$("regLangs");box.innerHTML="";
  I.speak.forEach(function(l){var lb=document.createElement("label");var cb=document.createElement("input");cb.type="checkbox";cb.value=l.code;cb.checked=have.indexOf(l.code)>=0;
    var sp=document.createElement("span");sp.textContent=l.name;lb.appendChild(cb);lb.appendChild(sp);box.appendChild(lb)})}
function checkedLangs(){return Array.prototype.map.call(document.querySelectorAll("#regLangs input:checked"),function(x){return x.value})}
$("regCancel").onclick=function(){renderDash()};
$("editMe").onclick=function(){openReg(true)};
function vPhotoPicked(file){
  if(!file)return;
  if(!/^image\//.test(file.type||"image/")){toast(t("ph_err_type"));return}
  phLoadImg(file).then(function(x){return phCompress(x.img).then(function(r){URL.revokeObjectURL(x.url);return r})}).then(function(r){
    if(!r.blob)throw new Error("enc");
    return fetch("/api/shaliach/photo",{method:"POST",headers:{"content-type":"image/jpeg","x-token":V.me.token},body:r.blob,cache:"no-store"}).then(function(resp){return resp.json().catch(function(){return{ok:false}})})
  }).then(function(j){if(j&&j.ok){toast(t("sh_photo_saved"));vPoll().then(renderDash)}else toast(t("ph_err_send"),3500)}).catch(function(){toast(t("ph_err_send"),3500)})
}
if($("vPhotoBtn")){$("vPhotoBtn").onclick=function(){$("vPhotoFile").click()};
  $("vPhotoFile").onchange=function(){vPhotoPicked(this.files&&this.files[0]);this.value=""}}
$("regForm").onsubmit=function(e){e.preventDefault();$("regErr").textContent="";
  var tr=document.querySelector("input[name=tr]:checked");
  var body={name:$("regName").value,phone:$("regPhone").value,city:$("regCity").value,transport:tr?tr.value:null,has_tefillin:V.editing?true:$("regTef").checked,langs:checkedLangs(),lang:LANG,tz:devTz()};
  if(!body.langs.length)body.langs=[LANG];
  if(body.name.trim().length<2){$("regErr").textContent=t("err_name");return}
  if(body.phone.replace(/\D/g,"").length<9){$("regErr").textContent=t("err_phone");return}
  if(!body.has_tefillin){$("regErr").textContent=t("err_tef");return}
  $("regBtn").disabled=true;
  if(V.editing){api("POST","/api/shaliach/update",body,V.me.token).then(function(j){$("regBtn").disabled=false;if(!j.ok){$("regErr").textContent=errMsg(j);return}toast(t("saved"));vPoll().then(renderDash)});return}
  api("POST","/api/shaliach/register",body).then(function(j){$("regBtn").disabled=false;
    if(!j.ok){$("regErr").textContent=errMsg(j);return}
    V.me={token:j.token,name:j.shaliach.name};LS.set("sh",V.me);V.data={me:j.shaliach};
    toast(t("registered"));renderDash()})
};
$("logoutBtn").onclick=function(){if(!confirm(t("confirm_logout")))return;var tok=V.me&&V.me.token;if(tok){api("POST","/api/shaliach/mode",{mode:"off",tz:devTz()},tok);api("POST","/api/shaliach/unpush",{},tok)}applyMode("off");LS.del("sh");V.me=null;V.data=null;openReg(false)};

$("deleteMeBtn").onclick=function(){if(!confirm(t("confirm_delete_me")))return;var tok=V.me&&V.me.token;if(!tok)return;var b=$("deleteMeBtn");b.disabled=true;
  var go=function(){try{if(navigator.serviceWorker&&window.PushManager)navigator.serviceWorker.ready.then(function(r){return r.pushManager.getSubscription()}).then(function(s){if(s)s.unsubscribe()}).catch(function(){})}catch(e){}
    stopVPoll();applyMode("off");LS.del("sh");V.me=null;V.data=null;toast(t("deleted_me"));openReg(false)};
  api("POST","/api/shaliach/delete",{},tok).then(function(j){b.disabled=false;
    if(j.ok||j._status===401){go();return}
    if(j.code==="busy"){toast(t("delete_busy"));return}
    toast(errMsg(j))})};
function renderDash(){
  if(V.job){showJob();return}
  var wasDash=cur==="s-vdash";show("s-vdash");if(!wasDash)V.fittedDash=false;var m=(V.data&&V.data.me)||{};
  $("vName").textContent=m.name||V.me.name||"";(function(){var av=$("vAvatar");if(m.photo){av.className="avatar has-photo";av.innerHTML='<img src="/api/shaliach/photo/'+esc(m.photo)+'?v='+m.photo+'" alt="">'}else{var i=initialOf(m.name||V.me.name);if(i){av.className="avatar initial";av.textContent=i}}})();var pb=$("vPhotoBtn");if(pb)pb.textContent=t(m.photo?"sh_photo_change":"sh_photo_add");$("vLangs").textContent=m.langs&&m.langs.length?"🌐 "+m.langs.map(langName).join(" · "):"";
  $("monthCount").textContent=m.month_count||0;$("totalCount").textContent=m.done_count||0;
  renderModeUI(m);
  var group=$('updatesGroup');if(!group){group=document.createElement('a');group.id='updatesGroup';group.className='btn soft';group.style.cssText='display:block;text-align:center;margin:14px 0;white-space:normal;height:auto;padding:14px;text-decoration:none';group.target='_blank';group.rel='noopener noreferrer';$('hoursBtn').after(group)}
  group.textContent=stText('הצטרף לקבוצת העדכונים בוואטסאפ','Join the WhatsApp updates group');group.hidden=!m.updates_group_url;if(m.updates_group_url)group.href=m.updates_group_url;else group.removeAttribute('href');
  var on=V.mode!=="off";
  $("gpsLine").textContent=!on?"":(V.pos?gpsTxt():t("loc_wait_perm"));
  var w=(V.data&&V.data.waiting)||[];$("waitWrap").hidden=!on||!w.length;$("waitTxt").hidden=!on||!!w.length;
  var ul=$("waitList");ul.innerHTML="";
  w.forEach(function(r){var li=document.createElement("li");
    li.innerHTML=avatarHtml(r.first_name)+'<div class="vl-main"><b>'+esc(r.first_name)+'</b><span>'+fmtKm(r.km)+' · '+esc(t("waiting_ago",{t:ago(r.age_s)}))+'</span>'+(r.lang?'<span class="speaks">🌐 '+esc(langName(r.lang))+'</span>':'')+'</div>';
    var btn=document.createElement("button");btn.className="btn gold sm";btn.textContent=t("accept_short");btn.onclick=function(){accept(r.id)};li.appendChild(btn);ul.appendChild(li)});
  drawVolMap();
}
function ago(s){return s<90?t("ago_1"):s<3600?t("ago_min",{n:Math.round(s/60)}):t("ago_h",{n:Math.round(s/3600)})}
function gpsTxt(){return t("loc_shared")+(V.acc?" "+t("acc",{n:Math.round(V.acc)}):"")}
function drawVolMap(fitJob){
  if(mapOnly)return;
  layer.clearLayers();V.myMarker=null;V.jobMarker=null;
  if(V.pos)V.myMarker=L.marker(V.pos,{icon:pinIcon(t("you"),true),zIndexOffset:800}).addTo(layer);
  if(V.job){V.jobMarker=L.marker([V.job.lat,V.job.lng],{icon:reqIcon(),zIndexOffset:700}).addTo(layer);
    if(V.pos)L.polyline([V.pos,[V.job.lat,V.job.lng]],{color:"#0f1f3d",weight:5,opacity:.8,dashArray:"1 9",lineCap:"round"}).addTo(layer);
    fit([V.pos,[V.job.lat,V.job.lng]],17)}
  else if(V.pos&&!V.fittedDash){fit([V.pos],15);V.fittedDash=true}
}

/* availability */
Array.prototype.forEach.call(document.querySelectorAll("#modeSeg button"),function(b){b.onclick=function(){unlockAudio();setMode(b.getAttribute("data-mode"))}});
function ensureWatch(){
  if(!navigator.geolocation){toast(t("no_geo"));return}
  if(V.watchId!=null)return;
  V.watchId=navigator.geolocation.watchPosition(function(p){V.pos=[p.coords.latitude,p.coords.longitude];V.acc=p.coords.accuracy;V.posAt=Date.now();
      if(V.myMarker)V.myMarker.setLatLng(V.pos);else if(mode==="vol")drawVolMap();
      if(cur==="s-vdash")$("gpsLine").textContent=gpsTxt();vPoll()},
    function(e){if(e.code===1){toast(stText("אין הרשאת מיקום חי. אפשר להגדיר אזור פעילות קבוע.","No live location permission. You can set a fixed coverage area."),3500);$("gpsLine").textContent=stText("ללא מיקום חי. אזור קבוע פועל רק לאחר הגדרה ואישור התראות.","No live location. Fixed coverage requires setup and notification permission.")}},
    {enableHighAccuracy:true,maximumAge:5000,timeout:20000});
}
function stopWatch(){if(V.watchId!=null&&V.mode==="off"&&!V.job){navigator.geolocation.clearWatch(V.watchId);V.watchId=null;V.pos=null}}
/* v6: three levels — off / standby / available. The level is kept on the server, so alerts keep coming when the app is closed. */
function applyMode(m){
  if(["off","standby","available"].indexOf(m)<0)m="off";
  var prev=V.mode;V.mode=m;V.avail=(m==="available");
  if(m==="off"){stopWatch();releaseWake();stopRing();if(!V.job)stopVPoll()}
  else{ensureWatch();if(m==="available")requestWake();else releaseWake();startVPoll()}
  return prev!==m;
}
function setMode(m){
  if(!V.me)return;
  var prev=V.mode;applyMode(m);
  var body={mode:m,tz:devTz(),live:true};if(V.pos&&Date.now()-V.posAt<60000){body.lat=V.pos[0];body.lng=V.pos[1]}
  api("POST","/api/shaliach/mode",body,V.me.token).then(function(j){
    if(!j.ok){toast(errMsg(j));applyMode(prev);if(cur==="s-vdash")renderDash();return}
    mergeMe(j);if(prev!==m)toast(t(m==="off"?"mode_saved_off":m==="standby"?"mode_saved_standby":"mode_saved_avail"));
    vPoll();
  });
  if(m!=="off")pushEnsure(false);
  if(cur==="s-vdash")renderDash();
}
function mergeMe(j){if(!V.data)V.data={};var me=V.data.me||(V.data.me={});["mode","hours","tz","alerts","alerts_why","override_until","push_devices","coverage"].forEach(function(k){if(k in j)me[k]=j[k]})}
function devTz(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Jerusalem"}catch(e){return "Asia/Jerusalem"}}
function minHM(n){n=((n%1440)+1440)%1440;return ("0"+Math.floor(n/60)).slice(-2)+":"+("0"+(n%60)).slice(-2)}
function hoursSummary(h){
  if(!h||!h.on)return t("hours_always");
  var parts=[],i=0,d=h.days;
  while(i<7){if(!d[i]){i++;continue}var j=i;while(j+1<7&&d[j+1]&&d[j+1][0]===d[i][0]&&d[j+1][1]===d[i][1])j++;
    parts.push((j>i?t("dshort_"+i)+"–"+t("dshort_"+j):t("dshort_"+i))+" \u2066"+minHM(d[i][0])+"–"+minHM(d[i][1])+"\u2069");i=j+1}
  return parts.length?parts.join(" · "):t("hours_none");
}
function renderModeUI(m){
  m=m||(V.data&&V.data.me)||{};
  Array.prototype.forEach.call(document.querySelectorAll("#modeSeg button"),function(b){b.setAttribute("aria-checked",b.getAttribute("data-mode")===V.mode?"true":"false")});
  $("modeDesc").textContent=t(V.mode==="off"?"desc_off":V.mode==="standby"?"desc_standby":"desc_avail");$("statusCard").setAttribute("data-mode",V.mode);$("scTitle").textContent=t(V.mode==="off"?"sc_off":V.mode==="standby"?"sc_standby":"sc_avail");
  $("hoursSum").textContent=hoursSummary(m.hours);
  var readiness=$('dispatchReady');if(!readiness){readiness=document.createElement('p');readiness.id='dispatchReady';readiness.style.cssText='font-size:13px;padding:12px;border:1px solid #d5a137;border-radius:10px;white-space:pre-line';$('modeDesc').after(readiness)}
  readiness.textContent=stText('חשבון זה שייך לאתר החדש בלבד. רישום באתר הישן לא מפעיל התראות כאן.','This account belongs to this new site. Registration on the old site does not enable alerts here.')+'\n'+(m.coverage?stText('✓ אזור פעילות קבוע פעיל: '+m.coverage.label+' · '+m.coverage.radius_km+' ק״מ (ללא צורך במיקום עדכני)','✓ Fixed coverage enabled: '+m.coverage.label+' · '+m.coverage.radius_km+' km (no recent location needed)'):m.location_ready?stText('✓ מיקום עדכני קיים','✓ Recent location available'):stText('⚠ אין מיקום עדכני. יש לאשר מיקום או להגדיר אזור פעילות קבוע כדי לקבל קריאות.','⚠ No recent location. Allow location or set a fixed coverage area to receive requests.'))+'\n'+(V.pushState==='on'&&m.push_devices>0?stText('✓ התראות רקע רשומות במכשיר זה (המסירה תלויה במכשיר)','✓ Background notifications registered on this device (delivery depends on the device)'):stText('⚠ ללא אישור התראות במכשיר זה, הקריאה מופיעה רק כשהאתר פתוח ופעיל.','⚠ Without notification permission on this device, requests appear only while the page is open and active.'));

  renderCoverage(m);
  var on=V.mode!=="off",line=$("alertLine"),txt="",cls="",tap=false;
  var pushOn=V.pushState==="on"&&(m.push_devices==null||m.push_devices>0);
  if(on){
    if(m.alerts_why==="shabbat"){txt=t("shabbat_now");cls="warn"}
    else if(m.alerts_why==="outside"){txt=t("hours_now_out");cls="warn"}
    else if(m.alerts_why==="override"){txt=t("hours_override");cls="warn"}
    else if(pushOn)txt=t("push_on");
    else if(V.pushState==="denied"){txt=t("push_blocked");cls="warn"}
    else if(V.pushState==="unsupported"){txt=(isIOS&&!standalone)?"":t("push_unsupported");cls="warn"}
    else if(!V.askPush&&(V.pushState!=null||Notification_perm()==="default")){txt=t("push_off_tap");cls="warn";tap=true}
  }
  line.textContent=txt;line.hidden=!txt;line.className="alert-line"+(cls?" "+cls:"")+(tap?" tap":"");line.onclick=tap?function(){pushEnsure(true)}:null;
  $("pushAsk").hidden=!(on&&V.askPush);
  $("iosHint").hidden=!(on&&isIOS&&!standalone);
  $("pushTest").hidden=!(on&&pushOn);
  var ko=$("keepOpen");ko.classList.toggle("on",V.mode==="available");ko.hidden=V.mode!=="available";ko.textContent=t(pushOn?"keep_open2":"keep_open");
}
function Notification_perm(){try{return ("Notification" in window)?Notification.permission:"unsupported"}catch(e){return "unsupported"}}
/* Coverage is chosen explicitly. City text alone never enables delivery. */
function renderCoverage(m){
  var box=$('coverageBox');
  if(!box){
    box=document.createElement('details');box.id='coverageBox';box.style.cssText='padding:14px;border:1px solid #ddd;border-radius:12px;margin:12px 0';
    var summary=document.createElement('summary');summary.id='coverageSummary';box.appendChild(summary);
    var note=document.createElement('p');note.style.cssText='font-size:13px;line-height:1.6';note.textContent=stText('אפשר לקבל בקשות באזור קבוע גם בלי לפתוח את האתר במשך שבוע. נדרש אישור התראות במכשיר ומצב זמין או כונן; שעות הפעילות והפסקת ההתראות נשמרות. האזור פרטי ואינו מיקום חי במפה. המסירה תלויה במכשיר ובשירות ההתראות.','Receive requests in a fixed area even after a week without opening the site. Requires device notification permission and Available or Standby mode. Hours and paused alerts still apply. Your area is private, not a live map location. Delivery depends on the device and push service.');box.appendChild(note);
    function input(id,label,type){var lb=document.createElement('label');lb.style.cssText='display:block;margin:10px 0';lb.textContent=label;var el=document.createElement('input');el.id=id;el.type=type||'text';if(type==='number')el.step='any';el.style.cssText='display:block;width:100%;box-sizing:border-box';lb.appendChild(el);box.appendChild(lb);return el}
    var city=input('coverageCity',stText('חיפוש עיר או כתובת','Search city or address'));
    var search=document.createElement('button');search.type='button';search.className='btn soft sm';search.textContent=stText('חפש אזור','Search area');box.appendChild(search);
    var results=document.createElement('div');results.id='coverageResults';box.appendChild(results);
    input('coverageLabel',stText('שם אזור הפעילות','Coverage area name'));
    input('coverageLat',stText('קו רוחב של מרכז האזור','Center latitude'),'number');input('coverageLng',stText('קו אורך של מרכז האזור','Center longitude'),'number');
    var gps=document.createElement('button');gps.type='button';gps.className='btn soft sm';gps.textContent=stText('השתמש במיקום שלי כמרכז','Use my location as center');box.appendChild(gps);
    var radius=input('coverageRadius',stText('רדיוס בק״מ (1 עד 100)','Radius in km (1 to 100)'),'number');radius.min='1';radius.max='100';radius.value='10';
    var err=document.createElement('p');err.id='coverageErr';err.setAttribute('role','status');err.style.cssText='font-size:13px;overflow-wrap:anywhere';box.appendChild(err);
    var save=document.createElement('button');save.id='coverageSave';save.type='button';save.className='btn primary sm';save.textContent=stText('שמור והפעל אזור קבוע','Save and enable fixed area');box.appendChild(save);
    var remove=document.createElement('button');remove.id='coverageRemove';remove.type='button';remove.className='btn soft sm';remove.style.marginTop='8px';remove.textContent=stText('בטל אזור קבוע','Disable fixed area');box.appendChild(remove);
    $('hoursBtn').before(box);
    search.onclick=function(){var q=city.value.trim();if(q.length<2)return;search.disabled=true;results.textContent=stText('מחפש...','Searching...');fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language='+LANG+',he,en&limit=5&q='+encodeURIComponent(q)).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(list){results.textContent='';if(!list.length)results.textContent=stText('לא נמצאו תוצאות. אפשר להזין קואורדינטות.','No results. You can enter coordinates.');list.forEach(function(p){var b=document.createElement('button');b.type='button';b.className='btn soft sm';b.style.cssText='margin-top:8px;white-space:normal;height:auto';b.textContent=p.display_name;b.onclick=function(){$('coverageLabel').value=p.display_name.slice(0,200);$('coverageLat').value=p.lat;$('coverageLng').value=p.lon;results.textContent=stText('המרכז נבחר. בדוק את הרדיוס ולחץ שמור.','Center selected. Check the radius and save.');};results.appendChild(b)})}).catch(function(){results.textContent=stText('החיפוש לא זמין כרגע. אפשר להשתמש במיקום שלך או להזין קואורדינטות.','Search unavailable. Use your location or enter coordinates.')} ).then(function(){search.disabled=false})};
    gps.onclick=function(){err.textContent=stText('מאתר מיקום...','Finding location...');getGps(function(p){$('coverageLat').value=p[0];$('coverageLng').value=p[1];if(!$('coverageLabel').value)$('coverageLabel').value=stText('אזור הפעילות שלי','My coverage area');err.textContent=stText('המרכז נבחר. בדוק את הרדיוס ולחץ שמור.','Center selected. Check the radius and save.')},function(){err.textContent=stText('לא התקבל מיקום. חפש כתובת או הזן קואורדינטות.','Location unavailable. Search an address or enter coordinates.')})};
    function submit(b){save.disabled=true;remove.disabled=true;err.textContent='';api('POST','/api/shaliach/coverage',b,V.me.token).then(function(j){save.disabled=false;remove.disabled=false;if(!j.ok){err.textContent=stText('לא נשמר. בדוק שם, קואורדינטות ורדיוס.','Not saved. Check name, coordinates and radius.');return}mergeMe(j);err.textContent=j.coverage?stText('נשמר והופעל. יש לאשר התראות במכשיר.','Saved and enabled. Allow device notifications.'):stText('אזור הפעילות הקבוע בוטל.','Fixed coverage disabled.');renderModeUI()})}
    save.onclick=function(){if(!$('coverageLat').value.trim()||!$('coverageLng').value.trim()){err.textContent=stText('יש לבחור מרכז לאזור הפעילות.','Choose a coverage center.');return}submit({enabled:true,label:$('coverageLabel').value,lat:Number($('coverageLat').value),lng:Number($('coverageLng').value),radius_km:Number(radius.value)})};remove.onclick=function(){submit({enabled:false})};
  }
  $('coverageSummary').textContent=stText('📍 אזור פעילות קבוע','📍 Fixed coverage area')+(m.coverage?' · '+m.coverage.label+' · '+m.coverage.radius_km+stText(' ק״מ',' km'):stText(' · לא מוגדר',' · Not set'));
  $('coverageRemove').hidden=!m.coverage;
  if(!box.open){var c=m.coverage||{};$('coverageLabel').value=c.label||'';$('coverageLat').value=c.lat==null?'':c.lat;$('coverageLng').value=c.lng==null?'':c.lng;$('coverageRadius').value=c.radius_km||10}
}

/* web push */
function pushSupported(){return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
function b64uToU8(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function pushEnsure(ask){
  if(!V.me)return;
  if(!pushSupported()){V.pushState="unsupported";if(cur==="s-vdash")renderModeUI();return}
  var p=Notification.permission;
  if(p==="denied"){V.pushState="denied";V.askPush=false;if(cur==="s-vdash")renderModeUI();return}
  if(p==="default"){
    if(!ask){V.askPush=true;V.pushState="off";if(cur==="s-vdash")renderModeUI();return}
    V.askPush=false;
    Notification.requestPermission().then(function(r){if(r==="granted")pushSubscribe(true);else{V.pushState=r==="denied"?"denied":"off";if(cur==="s-vdash")renderModeUI()}});
    if(cur==="s-vdash")renderModeUI();
    return;
  }
  pushSubscribe(ask);
}
function pushSubscribe(announce){
  if(V.pushBusy)return;V.pushBusy=true;
  var key;
  fetch("/api/push/key",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){key=j.key;return navigator.serviceWorker.register("/sw.js").then(function(){return navigator.serviceWorker.ready})})
  .then(function(reg){return reg.pushManager.getSubscription().then(function(sub){
    if(sub&&LS.get("vapid")!==key)return sub.unsubscribe().then(function(){return null});return sub})
    .then(function(sub){return sub||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64uToU8(key)})})})
  .then(function(sub){LS.set("vapid",key);return api("POST","/api/shaliach/push",{sub:sub.toJSON()},V.me.token)})
  .then(function(j){V.pushBusy=false;if(j&&j.ok){V.pushState="on";mergeMe(j);if(announce)toast(t("push_ok_toast"))}else{V.pushState="off";if(announce)toast(t("push_fail"))}if(cur==="s-vdash")renderModeUI()})
  .catch(function(){V.pushBusy=false;V.pushState="off";if(announce)toast(t("push_fail"));if(cur==="s-vdash")renderModeUI()});
}
$("pushYes").onclick=function(){V.askPush=false;pushEnsure(true)};
$("pushNo").onclick=function(){V.askPush=false;V.pushState="off";renderModeUI()};
$("pushTest").onclick=function(){if(!V.me)return;api("POST","/api/shaliach/pushtest",{},V.me.token).then(function(j){toast(j.ok&&j.sent?t("push_test_sent"):errMsg(j),3500)})};
/* active hours screen */
$("hoursBtn").onclick=function(){openHours()};
function openHours(){show("s-vhours");renderHours()}
function renderHours(){
  var m=(V.data&&V.data.me)||{},h=m.hours&&m.hours.days?m.hours:{on:false,days:[null,null,null,null,null,null,null]};
  var dflt=[[420,600],[420,600],[420,600],[420,600],[420,600],null,null];
  Array.prototype.forEach.call(document.querySelectorAll("input[name=hmode]"),function(r){r.checked=(r.value==="custom")===!!h.on;r.onchange=dimHours});
  var box=$("hoursDays");box.innerHTML="";
  for(var i=0;i<7;i++){(function(i){
    var d=h.on?h.days[i]:(h.days.some(Boolean)?h.days[i]:dflt[i]);
    var row=document.createElement("div");row.className="hday"+(d?"":" off");
    var lb=document.createElement("label"),cb=document.createElement("input");cb.type="checkbox";cb.checked=!!d;
    var sp=document.createElement("span");sp.textContent=t("day_"+i);lb.appendChild(cb);lb.appendChild(sp);
    var tm=document.createElement("div");tm.className="times";
    var a=document.createElement("input");a.type="time";a.value=minHM(d?d[0]:420);a.setAttribute("aria-label",t("day_"+i));
    var dash=document.createElement("span");dash.textContent="–";
    var b=document.createElement("input");b.type="time";b.value=minHM(d?d[1]:600);b.setAttribute("aria-label",t("day_"+i));
    tm.appendChild(a);tm.appendChild(dash);tm.appendChild(b);
    cb.onchange=function(){row.classList.toggle("off",!cb.checked)};
    row.appendChild(lb);row.appendChild(tm);box.appendChild(row);
  })(i)}
  $("hoursTz").textContent=t("hours_tz",{tz:devTz()});$("hoursErr").textContent="";
  dimHours();
}
function dimHours(){var c=document.querySelector("input[name=hmode][value=custom]");$("hoursDays").classList.toggle("dim",!(c&&c.checked))}
function tmin(v){var p=String(v||"").split(":");var n=parseInt(p[0],10)*60+parseInt(p[1]||"0",10);return isFinite(n)?n:null}
$("hoursBack").onclick=function(){renderDash()};
$("hoursSave").onclick=function(){
  var custom=document.querySelector("input[name=hmode][value=custom]").checked,days=[];
  Array.prototype.forEach.call(document.querySelectorAll("#hoursDays .hday"),function(row){
    var cb=row.querySelector("input[type=checkbox]"),ts=row.querySelectorAll("input[type=time]");
    var a=tmin(ts[0].value),b=tmin(ts[1].value);
    days.push(cb.checked&&a!=null&&b!=null&&a!==b?[a,b]:null)});
  if(custom&&!days.some(Boolean)){$("hoursErr").textContent=t("hours_err");return}
  $("hoursSave").disabled=true;
  api("POST","/api/shaliach/hours",{hours:{on:custom,days:days},tz:devTz()},V.me.token).then(function(j){$("hoursSave").disabled=false;
    if(!j.ok){$("hoursErr").textContent=errMsg(j);return}
    mergeMe(j);toast(t("hours_saved"));renderDash()});
};
/* opening a request from a notification */
function openReqFromPush(id){
  if(!V.me||!id||!/^[0-9a-f]{16,40}$/.test(id))return;
  if(V.job){setModeTabs("vol");showJob();return}
  setModeTabs("vol");stopReqPoll();clearInterval(U.nearT);
  var body={id:id};if(V.pos){body.lat=V.pos[0];body.lng=V.pos[1]}
  api("POST","/api/shaliach/peek",body,V.me.token).then(function(j){
    if(!j.ok){toast(errMsg(j));renderDash();return}
    if(j.state==="open"){var it=j.item;it.peek=true;V.declined[it.id]=0;showRing(it)}
    else if(j.state==="mine"){vPoll()}
    else{toast(t(j.state==="taken"?"req_taken":"req_gone"),3500);renderDash()}
  });
}
if("serviceWorker" in navigator){navigator.serviceWorker.addEventListener("message",function(e){var d=e.data||{};if(d.type==="open_req"){if(d.id)openReqFromPush(d.id);else if(V.me)goVol()}})}
document.addEventListener("pointerdown",function(){unlockAudio()},{once:true});
function startVPoll(){if(V.poll)return;vPoll();V.poll=setInterval(vPoll,4000)}
function stopVPoll(){clearInterval(V.poll);V.poll=null}
function vPoll(){
  if(document.hidden&&!V.job)return Promise.resolve();
  if(!V.me)return Promise.resolve();
  var body={v:6,available:V.avail||!!V.job,lang:LANG};
  if((V.mode!=="off"||V.job)&&V.pos&&Date.now()-V.posAt<60000){body.lat=V.pos[0];body.lng=V.pos[1];body.acc=V.acc}
  return api("POST","/api/shaliach/poll",body,V.me.token).then(function(j){
    if(!j.ok){if(j._status===401){LS.del("sh");V.me=null;stopVPoll();if(mode==="vol")openReg(false)}return}
    V.data=j;
    if(j.me&&j.me.mode&&j.me.mode!==V.mode){applyMode(j.me.mode)}
    var hadJob=V.job;V.job=j.job;
    if(V.job){if(!V.poll)startVPoll();ensureWatch();stopRing();if(mode!=="vol")setModeTabs("vol");chatStart("s",{id:V.job.id,token:V.me.token,name:V.job.first_name,phone:V.job.phone});showJob();return}
    if(hadJob&&!V.job){ chatEnd();closeChat(); if(!V.justFinished){toast(t("call_cancelled_by_req"),3500)} V.justFinished=false; if(V.mode==="off"){stopVPoll();stopWatch()} if(cur!=="s-vthanks")renderDash(); return}
    var ring=(j.ringing||[]).filter(function(r){return!V.declined[r.id]})[0];
    if(ring){if(mode!=="vol")setModeTabs("vol");showRing(ring)}
    else{if(cur==="s-vreq"&&!(V.ringing&&V.ringing.peek)){stopRing();renderDash()}else if(cur==="s-vdash")renderDash()}
  })
}
function showRing(r){
  closeWorldMap();
  var isNew=!V.ringing||V.ringing.id!==r.id;V.ringing=r;
  $("rqName").textContent=r.first_name;(function(){var i=initialOf(r.first_name),av=$("rqAvatar");if(i){av.className="avatar initial big-av";av.textContent=i}else{av.className="avatar big-av";av.innerHTML=PERSON}})();$("rqDist").textContent=r.km!=null?fmtKm(r.km):"";$("rqEta").textContent=r.eta_min!=null?t("eta_approx",{n:r.eta_min})+" · "+t(((V.data&&V.data.me)||{}).transport||"foot"):"";
  $("rqLang").textContent=r.lang?t("req_lang",{lang:langName(r.lang)}):"";
  if(isNew||cur!=="s-vreq"){show("s-vreq");drawVolMap();if(V.pos)fit([V.pos],15);var el=$("reqTimer");el.parentNode.hidden=!(r.ring_left_s>0);el.style.transition="none";el.style.width=(r.ring_left_s/60*100)+"%";void el.offsetWidth;el.style.transition="width "+r.ring_left_s+"s linear";el.style.width="0%";if(!r.peek||r.ring_left_s>0)startRing()}
}
$("declineReq").onclick=function(){if(V.ringing)V.declined[V.ringing.id]=1;V.ringing=null;stopRing();renderDash()};
$("acceptReq").onclick=function(){if(V.ringing)accept(V.ringing.id)};
function accept(id){
  stopRing();
  api("POST","/api/shaliach/accept",{id:id},V.me.token).then(function(j){
    if(!j.ok){toast(j.code?errMsg(j):t("accept_fail"),3500);V.declined[id]=1;V.ringing=null;renderDash();return}
    V.ringing=null;toast(t("yours_toast"),3000);vPoll()})
}
function showJob(){
  var jb=V.job;var name=jb.first_name;
  if(chatOpen()&&cur!=="s-vgo"&&cur!=="s-vdone")return;
  $("vReqLang").textContent=jb.lang?t("req_lang",{lang:langName(jb.lang)}):"";
  if(jb.status==="accepted"){
    var first=cur!=="s-vgo";show("s-vgo");
    $("vGoLabel").textContent=t("on_way_to",{name:name});$("vEta").textContent=jb.eta_min!=null?t("eta_approx",{n:jb.eta_min}):t("locating");$("vDist").textContent=jb.km!=null?fmtKm(jb.km):"";
    var ll=jb.lat+","+jb.lng;
    $("wazeBtn").href="https://waze.com/ul?ll="+ll+"&navigate=yes";$("gmapsBtn").href="https://www.google.com/maps/dir/?api=1&destination="+ll;
    $("callRq").href=telHref(jb.phone);$("waRq").href=waHref(jb.phone,t("wa_sh_text",{name:name}));
    if(first)drawVolMap();else{if(V.myMarker&&V.pos)V.myMarker.setLatLng(V.pos);if(V.jobMarker)V.jobMarker.setLatLng([jb.lat,jb.lng])}
  }else if(jb.status==="arrived"){
    if(cur!=="s-vdone"){show("s-vdone");$("vAtTitle").textContent=t("you_arrived_to",{name:name});$("callRq2").href=telHref(jb.phone);drawVolMap()}
  }
}
$("vArrived").onclick=function(){if(!V.job)return;api("POST","/api/shaliach/arrived",{id:V.job.id},V.me.token).then(function(j){if(!j.ok){toast(errMsg(j));}vPoll()})};
$("vFinish").onclick=function(){if(!V.job)return;var id=V.job.id;$("vFinish").disabled=true;
  api("POST","/api/shaliach/done",{id:id},V.me.token).then(function(j){$("vFinish").disabled=false;if(!j.ok){toast(errMsg(j));vPoll();return}
    V.justFinished=true;V.job=null;chatEnd();closeChat();show("s-vthanks");phShow("s",{id:id,token:V.me.token});vPoll().then(thanksTxt)})};
function thanksTxt(){var m=(V.data&&V.data.me)||{};$("vThanksTxt").textContent=t("done_recorded")+" "+(m.month_count===1?t("first_month"):m.month_count?t("n_month",{n:m.month_count}):"")}
$("vRelease").onclick=function(){if(!V.job||!confirm(t("confirm_release")))return;
  api("POST","/api/shaliach/release",{id:V.job.id},V.me.token).then(function(){V.justFinished=true;V.declined[V.job&&V.job.id]=1;V.job=null;chatEnd();closeChat();toast(t("released"));vPoll().then(renderDash)})};
$("vBack").onclick=function(){renderDash()};

/* sound / vibration / wake lock */
function unlockAudio(){try{if(!V.audio){var C=window.AudioContext||window.webkitAudioContext;if(C)V.audio=new C()}if(V.audio&&V.audio.state==="suspended")V.audio.resume()}catch(e){}}
function beep(){try{var a=V.audio;if(!a)return;[0,0.22].forEach(function(dt){var o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.value=880;g.gain.setValueAtTime(0.0001,a.currentTime+dt);g.gain.exponentialRampToValueAtTime(0.35,a.currentTime+dt+0.02);g.gain.exponentialRampToValueAtTime(0.0001,a.currentTime+dt+0.18);o.connect(g);g.connect(a.destination);o.start(a.currentTime+dt);o.stop(a.currentTime+dt+0.2)})}catch(e){}}
function buzz(){try{navigator.vibrate&&navigator.vibrate([300,150,300])}catch(e){}}
function startRing(){stopRing();beep();buzz();V.ringT=setInterval(function(){beep();buzz()},2500)}
function stopRing(){clearInterval(V.ringT);V.ringT=null}
function requestWake(){try{if("wakeLock" in navigator&&!V.wake)navigator.wakeLock.request("screen").then(function(w){V.wake=w;w.addEventListener("release",function(){V.wake=null})}).catch(function(){})}catch(e){}}
function releaseWake(){try{V.wake&&V.wake.release()}catch(e){}V.wake=null}
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"){if(V.avail)requestWake();if(V.mode!=="off"||V.job)vPoll();if(U.req)pollReq()}});
window.addEventListener("pagehide",function(){if(V.me&&V.avail&&!V.job&&navigator.sendBeacon){try{navigator.sendBeacon("/api/shaliach/offline",new Blob([JSON.stringify({token:V.me.token})],{type:"text/plain"}))}catch(e){}}});


/* =========================================================
   CHAT (auto-translated on the server) + quick phrases
   ========================================================= */
var C={role:null,id:null,token:null,name:"",phone:"",after:0,msgs:[],pending:[],seen:0,poll:null,open:false,busy:false};
var QUICK={s:["omw","here","floor","down","late","thanks"],r:["coming","entrance","minute","floor","thanks"]};
function chatOpen(){return C.open}
function chatSync(){if(C.open&&!C.id)closeChat()}
function chatStart(role,o){
  if(C.id===o.id&&C.role===role){C.name=o.name||C.name;C.phone=o.phone||C.phone;return}
  chatEnd();C.role=role;C.id=o.id;C.token=o.token;C.name=o.name||"";C.phone=o.phone||"";C.seen=LS.get("seen_"+o.id)||0;
  chatFetch();C.poll=setInterval(chatFetch,3000);
}
function chatEnd(){clearInterval(C.poll);C.poll=null;C.id=null;C.msgs=[];C.pending=[];C.after=0;updBadge()}
function chatFetch(){
  if(!C.id||C.busy)return;C.busy=true;var id=C.id,role=C.role,lang=LANG;
  var p=role==="r"?api("GET","/api/request/"+id+"/chat?lang="+lang+"&after="+C.after,null,C.token):api("POST","/api/shaliach/chat",{id:id,lang:lang,after:C.after},C.token);
  p.then(function(j){C.busy=false;if(C.id!==id||LANG!==lang)return;if(!j.ok)return;
    var fresh=0;(j.msgs||[]).forEach(function(m){if(m.id<=C.after)return;C.msgs.push(m);C.after=m.id;if(!m.me&&m.id>C.seen)fresh++;if(m.need_tr)clientTranslate(m)});
    if(C.pending.length&&(j.msgs||[]).some(function(m){return m.me}))C.pending=[];
    if(fresh&&!C.open){buzz();toast(t("new_msg",{name:C.name}),4000)}
    if(C.open){markSeen();renderMsgs(fresh>0||(j.msgs||[]).length>0)}
    updBadge();
  },function(){C.busy=false});
}
/* Fallback translation on the reader's own phone: when the server's shared IP is rate-limited,
   the phone asks Google's public no-key endpoint directly (its own quota). No key or secret anywhere. */
var TRC={};
function gcode(l){return l==="he"?"iw":l}
function clientTranslate(m){
  var key=m.id+":"+LANG;if(TRC[key]){applyTr(m,TRC[key]);return}
  if(m.trBusy)return;m.trBusy=true;var lang=LANG;
  fetch("https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl="+gcode(lang)+"&q="+encodeURIComponent(m.text),{referrerPolicy:"no-referrer"})
    .then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(g){
      var out=(g[0]||[]).map(function(x){return(x&&x[0])||""}).join("").trim();var src=typeof g[2]==="string"?g[2]:null;if(src==="iw")src="he";
      if(!out)throw 0;TRC[m.id+":"+lang]={text:out,src:src};if(lang===LANG)applyTr(m,TRC[m.id+":"+lang]);
    }).catch(function(){m.trBusy=false;m.trFail=(m.trFail||0)+1;if(m.trFail>=2){m.orig=m.text;m.tr_failed=true;m.need_tr=false;if(C.open)renderMsgs()}else setTimeout(function(){clientTranslate(m)},2500)});
}
function applyTr(m,tr){m.need_tr=false;m.trBusy=false;if(tr.src!==LANG&&tr.text!==m.text){m.orig=m.text;m.text=tr.text;m.lang=tr.src||m.lang}if(C.open)renderMsgs()}
function markSeen(){var mx=C.seen;C.msgs.forEach(function(m){if(!m.me&&m.id>mx)mx=m.id});if(mx!==C.seen){C.seen=mx;LS.set("seen_"+C.id,mx)}}
function unread(){var n=0;C.msgs.forEach(function(m){if(!m.me&&m.id>C.seen)n++});return n}
function updBadge(){var n=C.id?unread():0;Array.prototype.forEach.call(document.querySelectorAll(".chat-act"),function(b){var bd=b.querySelector(".badge");if(bd){bd.hidden=!n;bd.textContent=n}b.classList.toggle("hl",n>0)})}
function msgText(m){return m.kind==="phrase"?t("q_"+m.phrase):m.text}
function hhmm(ms){var d=new Date(ms);return("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2)}
function renderMsgs(scroll){
  var body=$("chatBody");var all=C.msgs.concat(C.pending);
  if(!all.length){body.innerHTML='<p class="chat-empty">'+esc(t("chat_empty",{name:C.name}))+'</p>';return}
  var atEnd=body.scrollHeight-body.scrollTop-body.clientHeight<60;
  body.innerHTML=all.map(function(m){
    var cls="msg "+(m.me?"mine":"them")+(m.kind==="phrase"?" phrase":"");
    var h='<div class="'+cls+'"><div class="mt" dir="auto">'+esc(msgText(m))+'</div>';
    if(m.kind==="phrase"&&!m.me)h+='<span class="qt">⚡ '+esc(t("translated"))+'</span>';
    if(m.orig)h+='<span class="orig"><i><bdi>'+esc(m.tr_failed?t("tr_unavail"):t("orig")+(m.lang?" ("+langName(m.lang)+")":""))+'</bdi>:</i><bdi class="ot" dir="auto">'+esc(m.orig)+'</bdi></span>';
    h+='<span class="meta">'+(m.temp||m.need_tr?"…":hhmm(m.at))+'</span></div>';return h}).join("");
  if(scroll||atEnd)body.scrollTop=body.scrollHeight;
}
function renderQuick(){var q=$("quick");q.innerHTML="";(QUICK[C.role]||[]).forEach(function(k){var b=document.createElement("button");b.type="button";b.textContent=t("q_"+k);b.onclick=function(){say({phrase:k},{kind:"phrase",phrase:k})};q.appendChild(b)})}
function openChat(){if(!C.id)return;C.open=true;$("chat").hidden=false;$("chatTitle").textContent=t("chat_title",{name:C.name});
  $("chatCall").href=C.phone?telHref(C.phone):"#";$("chatCall").hidden=!C.phone;renderQuick();markSeen();updBadge();renderMsgs(true)}
function closeChat(){if(!C.open)return;C.open=false;$("chat").hidden=true;if(C.role==="r"&&U.req)pollReq();if(C.role==="s"&&V.me)vPoll()}
function say(body,temp){
  if(!C.id)return;body.lang=LANG;var id=C.id;
  temp.me=true;temp.temp=true;temp.at=Date.now();C.pending.push(temp);renderMsgs(true);
  var p=C.role==="r"?api("POST","/api/request/"+id+"/say",body,C.token):api("POST","/api/shaliach/say",Object.assign({id:id},body),C.token);
  p.then(function(j){if(!j.ok){C.pending=C.pending.filter(function(x){return x!==temp});renderMsgs();toast(j.code==="rate"||j.code==="text"?errMsg(j):t("send_fail"),3000);return}chatFetch()})
}
["chatSh","chatSh2","chatRq","chatRq2"].forEach(function(id){$(id).onclick=openChat});
$("chatClose").onclick=closeChat;
$("chatForm").onsubmit=function(e){e.preventDefault();var v=$("chatText").value.trim();if(!v)return;if(v.length>500){toast(t("e_text"));return}
  $("chatText").value="";$("chatText").style.height="";say({text:v},{kind:"text",text:v})};
$("chatText").addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();$("chatForm").requestSubmit?$("chatForm").requestSubmit():$("chatSend").click()}});
$("chatText").addEventListener("input",function(){var el=this;el.style.height="auto";el.style.height=Math.min(110,el.scrollHeight)+"px"});


/* =========================================================
   OPTIONAL PHOTO FOR THE TEFILLIN WALL (never required)
   ========================================================= */
var PH={};
function phEl(role,cls){return $("ph"+role.toUpperCase()).querySelector("."+cls)}
function phState(role,st){var c=$("ph"+role.toUpperCase());
  ["ph-idle","ph-pre","ph-busy","ph-ok-msg"].forEach(function(k){c.querySelector("."+k).hidden=(k!==st)})}
function phShow(role,ref){var c=$("ph"+role.toUpperCase());if(!c)return;
  PH[role]={ref:ref,blob:null,w:0,h:0,url:null};c.hidden=false;phState(role,"ph-idle");
  phEl(role,"ph-ok").checked=false;phEl(role,"ph-send").disabled=true;phEl(role,"ph-file").value=""}
function phHide(role){var c=$("ph"+role.toUpperCase());c.hidden=true;var s=PH[role];if(s&&s.url){URL.revokeObjectURL(s.url)}PH[role]=null}
function phLoadImg(file){return new Promise(function(res,rej){var u=URL.createObjectURL(file),im=new Image();
  im.onload=function(){res({img:im,url:u})};im.onerror=function(){URL.revokeObjectURL(u);rej(new Error("img"))};im.src=u})}
function phEncode(img,max,q){var w=img.naturalWidth,h=img.naturalHeight,s=Math.min(1,max/Math.max(w,h));
  var cw=Math.max(1,Math.round(w*s)),ch=Math.max(1,Math.round(h*s)),cv=document.createElement("canvas");cv.width=cw;cv.height=ch;
  var cx=cv.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,cw,ch);cx.drawImage(img,0,0,cw,ch);
  return new Promise(function(res){cv.toBlob(function(b){res({blob:b,w:cw,h:ch})},"image/jpeg",q)})}
function phCompress(img){
  // ~1280px, JPEG 0.8, stepping down until it is under ~300 KB
  var tries=[[1280,.8],[1280,.7],[1280,.6],[1024,.65],[900,.6]],i=0;
  function next(){return phEncode(img,tries[i][0],tries[i][1]).then(function(r){if(r.blob&&r.blob.size>300000&&i<tries.length-1){i++;return next()}return r})}
  return next()}
function phPicked(role,file){var s=PH[role];if(!s||!file)return;
  if(!/^image\//.test(file.type||"image/")){toast(t("ph_err_type"));return}
  phState(role,"ph-busy");
  phLoadImg(file).then(function(x){return phCompress(x.img).then(function(r){URL.revokeObjectURL(x.url);return r})}).then(function(r){
    if(!r.blob){throw new Error("enc")}
    s.blob=r.blob;s.w=r.w;s.h=r.h;if(s.url)URL.revokeObjectURL(s.url);s.url=URL.createObjectURL(r.blob);
    phEl(role,"ph-img").src=s.url;phEl(role,"ph-ok").checked=false;phEl(role,"ph-send").disabled=true;phState(role,"ph-pre")
  }).catch(function(){phState(role,"ph-idle");toast(t("ph_err_type"))})}
function phSend(role){var s=PH[role];if(!s||!s.blob||!phEl(role,"ph-ok").checked)return;
  phState(role,"ph-busy");
  var q="/api/photo?req="+encodeURIComponent(s.ref.id)+"&role="+role+"&consent=1&w="+s.w+"&h="+s.h;
  fetch(q,{method:"POST",headers:{"content-type":"image/jpeg","x-token":s.ref.token},body:s.blob,cache:"no-store"})
    .then(function(r){return r.json().catch(function(){return{ok:false,code:"server"}}).then(function(j){j._status=r.status;return j})})
    .catch(function(){return{ok:false,code:"offline",_status:0}})
    .then(function(j){if(j.ok){phState(role,"ph-ok-msg");return}
      phState(role,"ph-pre");toast(j.code&&I.strings.he["e_"+j.code]?t("e_"+j.code):(j._status===0?t("no_internet"):t("ph_err_send")),3500)})}
["r","s"].forEach(function(role){var c=$("ph"+role.toUpperCase());if(!c)return;
  phEl(role,"ph-pick").onclick=function(){phEl(role,"ph-file").click()};
  phEl(role,"ph-file").onchange=function(){phPicked(role,this.files&&this.files[0])};
  phEl(role,"ph-skip").onclick=function(){phHide(role)};
  phEl(role,"ph-cancel").onclick=function(){var s=PH[role];if(s){s.blob=null}phState(role,"ph-idle");phEl(role,"ph-file").value=""};
  phEl(role,"ph-ok").onchange=function(){phEl(role,"ph-send").disabled=!this.checked};
  phEl(role,"ph-send").onclick=function(){phSend(role)};
});
/* =========================================================
   LANGUAGE PICKER
   ========================================================= */
function applyLang(){
  var de=document.documentElement;de.lang=LANG;de.dir=RTL[LANG]?"rtl":"ltr";document.title=t("doc_title");
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"),function(el){el.textContent=t(el.getAttribute("data-i18n"))});
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-ph]"),function(el){el.placeholder=t(el.getAttribute("data-i18n-ph"))});
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"),function(el){el.setAttribute("aria-label",t(el.getAttribute("data-i18n-aria")))});
  $("langCode").textContent=LANG.toUpperCase();renderLangButtons();
}
function renderLangButtons(){
  [["introLangs",false],["langGrid",true]].forEach(function(x){var box=$(x[0]);box.innerHTML="";
    I.ui.forEach(function(l){var b=document.createElement("button");b.type="button";b.textContent=l.name;b.lang=l.code;b.dir=l.rtl?"rtl":"ltr";b.className=l.code===LANG?"on":"";
      b.onclick=function(){setLang(l.code);if(x[1])$("langModal").hidden=true};box.appendChild(b)})});
}
function setLang(l){if(!I.strings[l])return;LANG=l;LS.set("lang",l);applyLang();refreshScreen()}
function refreshScreen(){
  setDonate();
  if(cur==="s-home"){locLabel();renderNearby();whoSync();wallSub();loadBulletin();$("totalLine").textContent=U.totalDone?t("total_line",{n:U.totalDone}):""}
  else if(cur==="s-locpick"){if(!U.pickNote)$("locPickNote").textContent=t("locpick_note")}
  else if(cur==="s-match"){dispatchMessage(U.lastJ||{notified:U.notified})}
  else if(cur==="s-route"&&U.lastJ){U.relang=true;renderRoute(U.lastJ)}
  else if(cur==="s-arrived"&&U.lastJ&&U.lastJ.shaliach){renderArrived(U.lastJ)}
  else if(cur==="s-vreg"){regTexts()}
  else if(cur==="s-vdash"){renderDash()}
  else if(cur==="s-vhours"){renderHours()}
  else if(cur==="s-vreq"&&V.ringing){showRing(V.ringing)}
  else if((cur==="s-vgo"||cur==="s-vdone")&&V.job){showJob();if(cur==="s-vdone")$("vAtTitle").textContent=t("you_arrived_to",{name:V.job.first_name})}
  else if(cur==="s-vthanks"){thanksTxt()}
  if(C.id){C.msgs=[];C.after=0;C.pending=[];if(C.open){$("chatTitle").textContent=t("chat_title",{name:C.name});renderQuick();renderMsgs()}chatFetch()}
}
$("langBtn").onclick=function(){closeDrawer();renderLangButtons();$("langModal").hidden=false};
$("langClose").onclick=function(){$("langModal").hidden=true};
$("langModal").addEventListener("click",function(e){if(e.target===this)this.hidden=true});
applyLang();setDonate();loadConfig();

/* ---------- nav ---------- */
$("tabUser").onclick=function(){if(V.job){toast(t("active_job"));return}setModeTabs("user");if(U.req){startReqPoll()}else goHome()};
$("tabVol").onclick=function(){goVol()};
$("brandBtn").onclick=$("mAbout").onclick=function(){closeDrawer();if(!U.req&&!V.job&&!V.avail)show("s-intro")};
$("startBtn").onclick=function(){LS.set("seen",1);goHome()};
$("introVol").onclick=function(){LS.set("seen",1);goVol()};

/* ---------- install as app (PWA) ---------- */
var deferredInstall=null;
var standalone=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream;
function showInstall(on){["installIntro","installHome","installVol","mInstall"].forEach(function(id){$(id).hidden=!on})}
window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();deferredInstall=e;if(!standalone)showInstall(true)});
window.addEventListener("appinstalled",function(){deferredInstall=null;showInstall(false);toast(t("installed"))});
function doInstall(){
  if(deferredInstall){deferredInstall.prompt();deferredInstall.userChoice.then(function(c){if(c.outcome==="accepted")showInstall(false);deferredInstall=null});return}
  if(isIOS)toast(t("ios_install"),5000);
}
["installIntro","installHome","installVol","mInstall"].forEach(function(id){$(id).onclick=function(){closeDrawer();doInstall()}});
if(isIOS&&!standalone)showInstall(true);
if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}

/* =========================================================
   v10: side menu, my requests, admin entry, wall carousel, sheet drag, recenter
   ========================================================= */
var lastFocus=null;
function openDrawer(){lastFocus=document.activeElement;$("scrim").hidden=false;$("drawer").hidden=false;$("menuBtn").setAttribute("aria-expanded","true");
  $("mOrder").classList.toggle("on",mode==="user");$("mVol").classList.toggle("on",mode==="vol");setTimeout(function(){$("drawerClose").focus()},30)}
function closeDrawer(){if($("drawer").hidden)return;$("scrim").hidden=true;$("drawer").hidden=true;$("menuBtn").setAttribute("aria-expanded","false");try{lastFocus&&lastFocus.focus&&lastFocus.focus()}catch(e){}}
$("menuBtn").onclick=openDrawer;$("drawerClose").onclick=closeDrawer;$("scrim").onclick=closeDrawer;
document.addEventListener("keydown",function(e){if(e.key!=="Escape")return;if(!$("drawer").hidden)closeDrawer();else if(!$("admModal").hidden)closeAdm();else if(!$("histModal").hidden)$("histModal").hidden=true;else if(!$("langModal").hidden)$("langModal").hidden=true});
$("mOrder").onclick=function(){closeDrawer();$("tabUser").click()};
$("mVol").onclick=function(){closeDrawer();$("tabVol").click()};
$("mWall").addEventListener("click",function(){closeDrawer()});

/* my requests — kept on this device only (no server lookup) */
function histAll(){var h=LS.get("hist");return Array.isArray(h)?h:[]}
function histAdd(id){if(!id)return;var h=histAll().filter(function(x){return x.id!==id});h.unshift({id:id,at:Date.now(),st:"open"});LS.set("hist",h.slice(0,30))}
function histSet(id,st,sh){if(!id||!st)return;var h=histAll(),ch=false;h.forEach(function(x){if(x.id===id){if(x.st!==st){x.st=st;ch=true}if(sh&&x.sh!==sh){x.sh=sh;ch=true}}});if(ch)LS.set("hist",h)}
function fmtDate(ms){try{return new Date(ms).toLocaleString(LANG==="yi"?"he":LANG,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}catch(e){return hhmm(ms)}}
function renderHist(){var ul=$("histList"),h=histAll();ul.innerHTML="";
  if(!h.length){var li=document.createElement("li");li.className="empty";li.textContent=t("no_requests");ul.appendChild(li);return}
  h.forEach(function(x){var st=x.st;if((st==="open"||st==="waiting"||st==="accepted"||st==="arrived")&&!(U.req&&U.req.id===x.id)&&Date.now()-x.at>6*3600000)st="cancelled";
    var li=document.createElement("li");
    li.innerHTML='<div class="h-main"><b>'+esc(fmtDate(x.at))+'</b><small>'+(x.sh?esc(t("hist_with",{name:x.sh})):"&nbsp;")+'</small></div><span class="h-st '+esc(st)+'">'+esc(t("st_"+st))+'</span>';
    if(U.req&&U.req.id===x.id){li.style.cursor="pointer";li.onclick=function(){$("histModal").hidden=true;setModeTabs("user");startReqPoll()}}
    ul.appendChild(li)})}
$("mHist").onclick=function(){closeDrawer();renderHist();$("histModal").hidden=false};
$("histClose").onclick=function(){$("histModal").hidden=true};
$("histModal").addEventListener("click",function(e){if(e.target===this)this.hidden=true});

/* admin entry (quiet link at the bottom of the menu). The code is checked on the server, which sets a
   short-lived HttpOnly session cookie; the code itself never goes into a URL from here. */
function openAdm(){closeDrawer();$("admErr").textContent="";$("admCode").value="";$("admModal").hidden=false;setTimeout(function(){$("admCode").focus()},40)}
function closeAdm(){$("admModal").hidden=true;$("admCode").value=""}
$("admLink").onclick=openAdm;$("admClose").onclick=closeAdm;
$("admModal").addEventListener("click",function(e){if(e.target===this)closeAdm()});
$("admForm").onsubmit=function(e){e.preventDefault();var code=$("admCode").value.trim();$("admErr").textContent="";if(!code){$("admCode").focus();return}
  $("admGo").disabled=true;
  fetch("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:code}),credentials:"same-origin",cache:"no-store"})
    .then(function(r){return r.json().catch(function(){return{ok:false}}).then(function(j){j._status=r.status;return j})},function(){return{ok:false,_status:0}})
    .then(function(j){$("admGo").disabled=false;
      if(j.ok){$("admCode").value="";location.href="/admin";return}
      $("admErr").textContent=j._status===401?t("admin_wrong"):errMsg(j);$("admCode").select()})};

/* tefillin wall carousel — only when approved photos exist */
var WC={photos:[],idx:0,timer:null,at:0,month:null,hold:false};
function loadWallCar(){
  if(Date.now()-WC.at<120000){wallRender();return}WC.at=Date.now();
  api("GET","/api/wall/latest").then(function(j){
    if(j.ok&&Array.isArray(j.photos))return j;
    return api("GET","/api/wall").then(function(w){return w.ok?{ok:true,photos:(w.photos||[]).slice(0,10),month_count:w.count}:{ok:false}})
  }).then(function(j){if(!j||!j.ok){WC.at=0;return}WC.photos=(j.photos||[]).filter(function(p){return p&&/^[0-9a-f]{16,40}$/.test(p.id)}).slice(0,10);WC.month=j.month_count;wallRender()})
}
function wallSub(){$("wcSub").textContent=WC.month?t("wall_month",{n:WC.month}):""}
function wallRender(){
  var box=$("wallCar"),tr=$("wcTrack"),dots=$("wcDots");
  if(!WC.photos.length){box.hidden=true;stopWallTimer();return}
  var ids=WC.photos.map(function(p){return p.id}).join(",");
  if(tr.getAttribute("data-ids")!==ids){tr.setAttribute("data-ids",ids);tr.innerHTML="";dots.innerHTML="";
    WC.photos.forEach(function(p,i){var d=document.createElement("div");d.className="wc-slide";var src="/api/photo/"+p.id;
      var bg=new Image();bg.alt="";bg.className="wc-bg";bg.decoding="async";bg.draggable=false;bg.setAttribute("aria-hidden","true");
      var im=new Image();im.alt="";im.className="wc-fg";im.decoding="async";im.loading=i<2?"eager":"lazy";bg.loading=im.loading;im.draggable=false;
      if(p.w&&p.h)im.style.aspectRatio=p.w+"/"+p.h;
      im.onerror=function(){d.remove();WC.photos=WC.photos.filter(function(x){return x.id!==p.id});tr.removeAttribute("data-ids");wallRender()};bg.src=src;im.src=src;d.appendChild(bg);d.appendChild(im);tr.appendChild(d);
      var dot=document.createElement("i");dots.appendChild(dot)});
    WC.idx=0;tr.scrollLeft=0}
  dots.hidden=WC.photos.length<2;wallSub();box.hidden=false;wallDots();startWallTimer();
}
function wallDots(){Array.prototype.forEach.call($("wcDots").children,function(d,i){d.classList.toggle("on",i===WC.idx)})}
function wallGo(i){var tr=$("wcTrack"),n=WC.photos.length;if(!n)return;WC.idx=(i+n)%n;tr.scrollTo({left:WC.idx*tr.clientWidth,behavior:"smooth"});wallDots()}
function startWallTimer(){stopWallTimer();if(WC.photos.length<2)return;WC.timer=setInterval(function(){if(WC.hold||cur!=="s-home"||document.hidden)return;wallGo(WC.idx+1)},4200)}
function stopWallTimer(){clearInterval(WC.timer);WC.timer=null}
(function(){var tr=$("wcTrack"),st=null;
  tr.addEventListener("scroll",function(){clearTimeout(st);st=setTimeout(function(){var i=Math.round(tr.scrollLeft/Math.max(1,tr.clientWidth));if(i!==WC.idx){WC.idx=Math.max(0,Math.min(WC.photos.length-1,i));wallDots()}},90)},{passive:true});
  ["pointerdown","touchstart"].forEach(function(ev){tr.addEventListener(ev,function(){WC.hold=true},{passive:true})});
  ["pointerup","touchend","pointercancel"].forEach(function(ev){tr.addEventListener(ev,function(){setTimeout(function(){WC.hold=false},2500)},{passive:true})});
  // a swipe should not open the wall; a tap should
  var sx=0,sy=0;$("wallCar").addEventListener("pointerdown",function(e){sx=e.clientX;sy=e.clientY},{passive:true});
  $("wallCar").addEventListener("click",function(e){if(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10)e.preventDefault()});
})();

/* "ordering as" row: once name + phone are known the form folds into one line */
function whoValid(){return $("reqName").value.trim().length>=2&&$("reqPhone").value.replace(/\D/g,"").length>=9}
function whoShow(fields){$("whoFields").hidden=!fields;$("whoRow").hidden=fields;if(!fields)$("whoText").textContent=$("reqName").value.trim()+" · "+$("reqPhone").value.trim()}
function whoSync(){whoShow(!(LS.get("me")&&whoValid()))}
$("whoEdit").onclick=function(){whoShow(true);$("reqName").focus()};

/* bottom sheet: drag the handle down to peek at the map, up (or tap) to bring it back */
function visSheet(){return document.querySelector(".sheet:not([hidden])")}
function sheetSync(){var s=visSheet(),h=mapOnly?95:s&&!$("topbar").hidden?(s.classList.contains("peek")?132:s.offsetHeight):0;$("app").style.setProperty("--sheet-h",h+"px")}
if(window.ResizeObserver){var ro=new ResizeObserver(function(){sheetSync()});SCREENS.forEach(function(id){ro.observe($(id))})}
window.addEventListener("resize",sheetSync);
Array.prototype.forEach.call(document.querySelectorAll(".sheet .grab"),function(g){
  var sh=g.closest(".sheet"),y0=null,dy=0,moved=false;
  g.addEventListener("pointerdown",function(e){y0=e.clientY;dy=0;moved=false;sh.classList.add("dragging");try{g.setPointerCapture(e.pointerId)}catch(x){}});
  g.addEventListener("pointermove",function(e){if(y0==null)return;dy=e.clientY-y0;if(Math.abs(dy)>4)moved=true;var base=sh.classList.contains("peek")?sh.offsetHeight-132:0;var y=Math.max(0,Math.min(sh.offsetHeight-90,base+dy));sh.style.transform="translateY("+y+"px)"});
  function end(){if(y0==null)return;y0=null;sh.classList.remove("dragging");sh.style.transform="";
    if(canMapOnly()&&(!moved||dy>60)){setMapOnly(true);return}
    if(!moved)sh.classList.toggle("peek");else if(dy>60)sh.classList.add("peek");else if(dy<-40)sh.classList.remove("peek");
    sheetSync()}
  g.addEventListener("pointerup",end);g.addEventListener("pointercancel",end);
  g.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();if(canMapOnly())setMapOnly(true);else{sh.classList.toggle("peek");sheetSync()}}});
});
['s-home','s-vdash'].forEach(function(id){var sh=$(id),button=document.createElement('button');button.type='button';button.className='map-expand';button.textContent='⌄ '+stText('החליקו מטה להצגת כל השלוחים במפה','Swipe down to see active volunteers');button.onclick=function(){setMapOnly(true)};sh.querySelector('.grab').after(button);var start=null;
sh.addEventListener('touchstart',function(e){if(e.touches.length===1&&!e.target.closest('input,textarea,select,button,a')&&sh.scrollTop<=0)start={x:e.touches[0].clientX,y:e.touches[0].clientY};else start=null},{passive:true});
sh.addEventListener('touchmove',function(e){if(!start||!canMapOnly())return;var t=e.touches[0];if(t.clientY-start.y>75&&Math.abs(t.clientX-start.x)<60){start=null;setMapOnly(true)}},{passive:true});
sh.addEventListener('touchend',function(){start=null},{passive:true});
sh.addEventListener('wheel',function(e){if(!canMapOnly()||mapOnly||e.target.closest('input,textarea,select'))return;if(e.deltaY>40&&sh.scrollTop+sh.clientHeight>=sh.scrollHeight-3){e.preventDefault();setMapOnly(true)}},{passive:false});
});
/* recenter */
$("locateBtn").onclick=function(){
  var p=mode==="vol"?V.pos:U.pos;
  if(p){map.setView(p,Math.max(map.getZoom(),16),{animate:true});return}
  toast(t("locating"));
  getGps(function(pp){if(mode==="vol"){map.setView(pp,16)}else{setUserPos(pp,"gps");if(cur==="s-home"){renderNearby();loadNearby(true)}else map.setView(pp,16)}},function(){toast(t("no_loc_perm"))});
};

if(window.TN_LAUNCH_READY)window.TN_LAUNCH_READY();
/* ---------- boot ---------- */
var BOOT_REQ=null;try{BOOT_REQ=new URLSearchParams(location.search).get("r");if(BOOT_REQ)history.replaceState(null,"",location.pathname+location.hash)}catch(e){}
(function boot(){
  if(V.me){ // resume shaliach state (availability needs a tap again after a reload: location + sound need a gesture)
        api("POST","/api/shaliach/poll",{v:6,available:false,lang:LANG},V.me.token).then(function(j){if(j.ok){V.data=j;
          if(j.me&&j.me.mode&&j.me.mode!=="off"){applyMode(j.me.mode);if(Notification_perm()==="granted")pushSubscribe(false);else pushEnsure(false)}
          if(j.job){V.job=j.job;setModeTabs("vol");ensureWatch();startVPoll();showJob()}
          else if(BOOT_REQ){openReqFromPush(BOOT_REQ)}
          else if(cur==="s-vdash")renderDash()}else if(j._status===401){LS.del("sh");V.me=null}})
  }
  if(U.req){setModeTabs("user");show("s-match");$("matchMsg").textContent=t("loading_req");
    getGps(function(p){U.pos=U.pos||p;U.src="gps"},function(){});startReqPoll();return}
  if(!LS.get("seen")&&!V.me){show("s-intro");return}
  if(V.me&&(location.hash!=="#user"||BOOT_REQ)){goVol();return}
  goHome();
})();
})();
