(function(){"use strict";
var map=L.map('map',{zoomControl:false,minZoom:2,maxZoom:18}).setView([23,12],2);
L.control.zoom({position:'bottomleft'}).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
var standLayer=L.layerGroup().addTo(map);
var layer=L.layerGroup().addTo(map), pending=false, queued=false, timer, debounce;
function esc(t){return String(t||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var lastStands=0,standSeq=0;
function updateStands(bounds,force){if(!force&&Date.now()-lastStands<60000)return;lastStands=Date.now();var seq=++standSeq;fetch('/api/stands?bounds='+bounds.join(','),{signal:AbortSignal.timeout(12000)}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(j){if(seq!==standSeq)return;standLayer.clearLayers();j.stands.forEach(function(s){var html='<b>'+esc(s.name)+'</b><p>'+esc(s.address)+'</p><p>'+(s.open_now?'פתוח כעת לפי השעות':'סגור כעת לפי השעות')+'</p><p>'+esc(s.note)+'</p><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination='+s.lat+','+s.lng+'">ניווט לדוכן</a>';L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<span class="cluster stand">▣</span>',iconSize:[38,38],iconAnchor:[19,19]})}).bindPopup(html).addTo(standLayer)});document.getElementById('standCount').textContent=j.total+' דוכנים באזור המפה'+(j.limited?' · התקרבו להצגת כל הדוכנים':'')}).catch(function(){if(seq!==standSeq)return;document.getElementById('standCount').textContent='עדכון דוכנים נכשל';standLayer.clearLayers();lastStands=0})}
function update(){
 if(document.hidden)return;
 if(pending){queued=true;return}pending=true;
 var b=map.getBounds(), w=b.getWest(),e=b.getEast();
 if(e-w>=360){w=-180;e=180}else{w=((w+180)%360+360)%360-180;e=((e+180)%360+360)%360-180}
 var bounds=[w,Math.max(-85,b.getSouth()),e,Math.min(85,b.getNorth())];
 updateStands(bounds,false);
 fetch('/api/world-map?zoom='+map.getZoom()+'&bounds='+bounds.map(function(n){return n.toFixed(3)}).join(','),{signal:AbortSignal.timeout(12000)})
 .then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){
 if(!d.ok)throw Error();layer.clearLayers();
 d.clusters.forEach(function(c){var m=L.marker([c.lat,c.lng],{icon:L.divIcon({className:'',html:'<span class="cluster '+(c.count===1?'single':'')+'">'+(c.count===1?'●':c.count)+'</span>',iconSize:[44,44],iconAnchor:[22,22]})});m.bindTooltip(c.count+' שלוחים זמינים · מיקום מקורב');m.on('click',function(){if(map.getZoom()<14)map.setView([c.lat,c.lng],Math.min(14,map.getZoom()+3))});m.addTo(layer)});
 document.getElementById('count').textContent=d.total+' שלוחים זמינים בעולם';
 layer.remove();if(document.getElementById('showVols').checked)layer.addTo(map);
 document.getElementById('state').textContent=(d.total===0?'אין כרגע שלוחים זמינים. המפה תתעדכן אוטומטית.':(d.limited?'התקרבו למפה להצגת כל הסמנים באזור.':'עודכן '+new Date(d.at).toLocaleTimeString('he-IL')));
 }).catch(function(){document.getElementById('state').textContent='העדכון לא הצליח. הנתונים הקודמים עשויים להיות לא עדכניים. מנסה שוב…';layer.clearLayers();document.getElementById('count').textContent='ממתין לחיבור';})
 .finally(function(){pending=false;if(queued){queued=false;update()}});
}
map.on('moveend',function(){clearTimeout(debounce);debounce=setTimeout(function(){lastStands=0;update()},350)});
document.addEventListener('visibilitychange',function(){if(!document.hidden)update()});
document.getElementById('world').onclick=function(){map.setView([23,12],2)};
document.getElementById('locate').onclick=function(){if(navigator.geolocation)navigator.geolocation.getCurrentPosition(function(p){map.setView([p.coords.latitude,p.coords.longitude],12)},function(){document.getElementById('state').textContent='אין הרשאת מיקום. אפשר להזיז את המפה ידנית.'},{timeout:10000,maximumAge:60000})};
if(window.parent!==window){document.getElementById('back').onclick=function(e){e.preventDefault();window.parent.postMessage('close-world-map',location.origin)};document.querySelector('.actions a').onclick=document.getElementById('back').onclick;}
document.getElementById('showVols').onchange=function(){if(this.checked)layer.addTo(map);else layer.remove()};document.getElementById('showStands').onchange=function(){if(this.checked)standLayer.addTo(map);else standLayer.remove()};
update();timer=setInterval(update,15000);
})();
