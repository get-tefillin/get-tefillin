// Tefillin Now — Tefillin Wall (public): monthly counter, % change, bar graph, approved photos, archive.
(function(){
"use strict";
var I=window.TN_I18N,$=function(id){return document.getElementById(id)};
var RTL={he:1,yi:1};
var LOC={he:"he-IL",en:"en-GB",fr:"fr-FR",ru:"ru-RU",es:"es-ES",pt:"pt-BR",it:"it-IT",yi:"yi"};
function lsGet(k){try{return JSON.parse(localStorage.getItem("tn_"+k))}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem("tn_"+k,JSON.stringify(v))}catch(e){}}
var qs=new URLSearchParams(location.search);
function pickLang(){
  var q=qs.get("lang");if(q&&I.strings[q])return q;
  var s=lsGet("lang");if(s&&I.strings[s])return s;
  var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||"he"];
  for(var i=0;i<ls.length;i++){var c=String(ls[i]||"").toLowerCase().split("-")[0];if(c==="iw")c="he";if(c==="ji")c="yi";if(I.strings[c])return c}
  return "he";
}
var LANG=pickLang();
function t(k,v){var s=(I.strings[LANG]||{})[k];if(s==null)s=I.strings.he[k];if(s==null)return k;
  if(v)s=s.replace(/\{(\w+)\}/g,function(m,n){return v[n]!=null?v[n]:m});return s}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function mDate(mk,day){var p=mk.split("-");return new Date(Date.UTC(+p[0],+p[1]-1,day||15,12))}
function lastDay(mk){var p=mk.split("-");return new Date(Date.UTC(+p[0],+p[1],0,12)).getUTCDate()}
function fmt(opts,d,lang){try{return new Intl.DateTimeFormat(LOC[lang||LANG]||LANG,Object.assign({timeZone:"UTC"},opts)).format(d)}catch(e){return new Intl.DateTimeFormat("en",Object.assign({timeZone:"UTC"},opts)).format(d)}}
function monthLong(mk,withYear){
  if(LANG==="yi"){var m=fmt({month:"long"},mDate(mk));return withYear?m+" "+mk.slice(0,4):m}
  return withYear?fmt({month:"long",year:"numeric"},mDate(mk)):fmt({month:"long"},mDate(mk))}
function monthShort(mk){return fmt({month:"short"},mDate(mk))}
function hebMonths(mk){
  var base=(LANG==="yi"?"he":LANG);
  try{var f=new Intl.DateTimeFormat((LOC[base]||base)+"-u-ca-hebrew",{month:"long",timeZone:"UTC"});
    var a=f.format(mDate(mk,1)),b=f.format(mDate(mk,lastDay(mk)));return a===b?a:a+"–"+b}catch(e){return""}}
function nf(n){try{return new Intl.NumberFormat(LOC[LANG]||LANG).format(n)}catch(e){return String(n)}}
function plural(n){var cat="other";try{cat=new Intl.PluralRules(LOC[LANG]||LANG).select(n)}catch(e){}
  var s=I.strings[LANG]||{};return s["wall_n_"+cat]!=null?"wall_n_"+cat:"wall_n_other"}

var D=null,month=(/^20\d\d-(0[1-9]|1[0-2])$/.test(qs.get("m")||"")?qs.get("m"):null);

function applyLang(){
  var de=document.documentElement;de.lang=LANG;de.dir=RTL[LANG]?"rtl":"ltr";document.title=t("wall_doc_title");
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"),function(el){el.textContent=t(el.getAttribute("data-i18n"))});
  Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"),function(el){el.setAttribute("aria-label",t(el.getAttribute("data-i18n-aria")))});
  // "previous" points backwards in reading direction
  $("prevM").textContent=RTL[LANG]?"›":"‹";$("nextM").textContent=RTL[LANG]?"‹":"›";
  $("brand").setAttribute("aria-label",t("wall_back"));
  var sel=$("langSel");sel.innerHTML="";I.ui.forEach(function(l){var o=document.createElement("option");o.value=l.code;o.textContent=l.name;if(l.code===LANG)o.selected=true;sel.appendChild(o)});
}
$("langSel").onchange=function(){if(I.strings[this.value]){LANG=this.value;lsSet("lang",LANG);applyLang();if(D)render()}};

function load(m){
  document.body.classList.add("loading");
  return fetch("/api/wall"+(m?"?m="+m:""),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){
    document.body.classList.remove("loading");
    if(!j||!j.ok)throw new Error("bad");D=j;month=j.month;
    var u=new URL(location.href);if(j.is_current)u.searchParams.delete("m");else u.searchParams.set("m",j.month);history.replaceState(null,"",u.pathname+u.search);
    render()}).catch(function(){document.body.classList.remove("loading");$("cntLbl").textContent=t("wall_err")})}

function render(){
  var j=D,mk=j.month;
  $("mName").textContent=monthLong(mk,true);$("mHeb").textContent=hebMonths(mk)?"("+hebMonths(mk)+")":"";
  var first=j.archive.length?j.archive[j.archive.length-1].m:mk;
  $("prevM").disabled=(mk<=first);$("nextM").disabled=!!j.is_current;
  $("cnt").textContent=nf(j.count);
  $("cntLbl").textContent=t(plural(j.count),{month:monthLong(mk,true)});
  var cmp=$("cmp"),pm=monthLong(j.prev_month,false),cls="",txt="";
  if(j.prev_count>0){
    if(j.pct>0){cls="up";txt=t("wall_up",{p:nf(j.pct),month:pm})}
    else if(j.pct<0){cls="down";txt=t("wall_down",{p:nf(-j.pct),month:pm})}
    else{cls="same";txt=t("wall_same",{month:pm})}
  }else if(j.count>0){cls="new";txt=t("wall_from0",{month:pm})}
  cmp.className="cmp "+cls;cmp.textContent=txt;cmp.hidden=!txt;
  var pl=[];if(j.prev_count>0)pl.push(t("wall_prev",{month:pm,n:nf(j.prev_count)}));if(j.is_current)pl.push(t("wall_partial"));
  $("prevLine").textContent=pl.join(" · ");
  chart(j.series,mk,j.current);
  $("phH").textContent=t("wall_photos",{month:monthLong(mk,true)});
  var g=$("grid");g.innerHTML="";
  j.photos.forEach(function(p){var b=document.createElement("button");b.type="button";
    b.innerHTML='<img loading="lazy" decoding="async" alt="'+esc(t("wall_photo_alt"))+'" src="/api/photo/'+esc(p.id)+'"'+(p.w&&p.h?' width="'+p.w+'" height="'+p.h+'"':'')+'>';
    b.onclick=function(){$("lbImg").src="/api/photo/"+p.id;$("lb").hidden=false};g.appendChild(b)});
  $("empty").textContent=t("wall_empty");$("empty").hidden=j.photos.length>0;
  var a=$("arch");a.innerHTML="";
  j.archive.forEach(function(x){var li=document.createElement("li"),b=document.createElement("button");b.type="button";b.className=x.m===mk?"on":"";
    b.innerHTML='<span>'+esc(monthLong(x.m,true))+'</span><span class="n"><span>🙏 <b>'+nf(x.n)+'</b></span><span>📸 '+nf(x.photos)+'</span></span>';
    b.onclick=function(){load(x.m);window.scrollTo({top:0,behavior:"smooth"})};li.appendChild(b);a.appendChild(li)});
}

function chart(series,sel,cur){
  var n=series.length,bw=30,gap=14,W=n*(bw+gap)+gap,H=150,top=22,bot=24,max=1;
  series.forEach(function(s){if(s.n>max)max=s.n});
  var rtl=!!RTL[LANG],h=['<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(t("wall_graph"))+'" style="max-width:'+Math.max(W,280)+'px;margin:0 auto">'];
  h.push('<line class="base" x1="0" x2="'+W+'" y1="'+(H-bot)+'" y2="'+(H-bot)+'"/>');
  series.forEach(function(s,i){
    var idx=rtl?(n-1-i):i,x=gap+idx*(bw+gap),bh=Math.round((H-top-bot)*s.n/max),y=H-bot-Math.max(bh,s.n?3:1),isSel=s.m===sel;
    h.push('<g data-m="'+s.m+'" style="cursor:pointer"><title>'+esc(monthLong(s.m,true)+": "+s.n)+'</title><rect class="bar'+(isSel?' sel':'')+(s.m===cur?' cur':'')+'" x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(bh,s.n?3:1)+'" rx="5"/>');
    h.push('<text class="val" x="'+(x+bw/2)+'" y="'+(y-5)+'">'+nf(s.n)+'</text>');
    h.push('<text class="ml'+(isSel?' sel':'')+'" x="'+(x+bw/2)+'" y="'+(H-7)+'">'+esc(monthShort(s.m))+'</text></g>');
  });
  h.push('</svg>');$("chart").innerHTML=h.join("");
  Array.prototype.forEach.call($("chart").querySelectorAll("g[data-m]"),function(g){g.addEventListener("click",function(){load(g.getAttribute("data-m"))})});
}
function shift(d){var p=month.split("-").map(Number),m=p[1]+d,y=p[0];if(m<1){m=12;y--}if(m>12){m=1;y++}return y+"-"+(m<10?"0":"")+m}
$("prevM").onclick=function(){if(month)load(shift(-1))};
$("nextM").onclick=function(){if(month)load(shift(1))};
$("lb").onclick=function(){$("lb").hidden=true;$("lbImg").removeAttribute("src")};
document.addEventListener("keydown",function(e){if(e.key==="Escape")$("lb").hidden=true});
applyLang();load(month);
})();
