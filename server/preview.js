'use strict';
// Isolated hostname preview. No imports from the live server/store, no database,
// no credentials, no outgoing requests, no registrations, dispatch or messages.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.webmanifest':'application/manifest+json; charset=utf-8'};
const banner='<aside dir="rtl" style="position:sticky;top:0;z-index:99999;background:#fff4ca;color:#17243a;padding:14px;text-align:center;font:16px Arial,sans-serif;border-bottom:2px solid #d4a944"><b>תפילין נאו - תצוגת בדיקה בלבד</b><br>אין כאן משתמשים, הזמנות או הרשמה. הכתובת הפעילה טרם הועברה.<br><span lang="en" dir="ltr">Read-only preview. No live data or registration. No user cutover.</span></aside>';
const server=http.createServer((req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Referrer-Policy','no-referrer');
 let u;try{u=new URL(req.url,'http://preview')}catch{return res.writeHead(400).end()}
 if(u.pathname==='/healthz'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,preview:true,live_data:false,write_access:false}))}
 if(u.pathname==='/robots.txt'){res.writeHead(200,{'content-type':'text/plain'});return res.end('User-agent: *\nDisallow: /\n')}
 if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/admin')){res.writeHead(503,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,code:'preview_read_only',message:'Read-only preview: live data and actions are disabled.'}))}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end('Read-only preview')}
 let name;try{name=decodeURIComponent(u.pathname)}catch{return res.writeHead(400).end()}
 if(name==='/'){const lang=/^(he|en|fr|ru|es|pt|it|yi)$/.test(u.searchParams.get('lang'))?u.searchParams.get('lang'):'he';name='/'+lang+'/index.html'}
 if(name.endsWith('/'))name+='index.html';
 const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
 fs.readFile(file,(err,buf)=>{if(err){res.writeHead(404);return res.end('Not found')}
  const ext=path.extname(file);res.writeHead(200,{'content-type':types[ext]||'application/octet-stream'});
  if(req.method==='HEAD')return res.end();
  if(ext==='.html')return res.end(buf.toString().replace(/<body[^>]*>/i,m=>m+banner));
  return res.end(buf);
 });
});
server.listen(Number(process.env.PORT||8080),'0.0.0.0');
