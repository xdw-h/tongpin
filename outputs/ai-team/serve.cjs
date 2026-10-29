const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const lan = process.argv.includes('--lan');
const codexEnabled = process.argv.includes('--codex');
const port = Number(process.env.AI_TEAM_PORT || (codexEnabled ? 4188 : 4187));
const access=lan?new (require('./lan-access.cjs').LanAccess)({port,configPath:path.join(root,'../../work/private/lan-access.json')}):null;
let bridge, api,owner;
if (codexEnabled) {
  const {CodexBridge}=require('./codex-bridge.cjs');
  const {createCodexApi}=require('./codex-api.cjs');
  const cwd=path.join(root,'.codex-chat-space');
  fs.mkdirSync(cwd,{recursive:true});
  bridge=new CodexBridge({cwd});
  const {DesktopBridge}=require('./desktop-bridge.cjs');
  owner=new (require('./desktop-owner.cjs').DesktopOwner)();
  const attachments=new (require('./attachments.cjs').AttachmentStore)(path.join(root,'../../work/uploads'));
  const images=new (require('./message-images.cjs').MessageImages)();
  const resultFiles=new (require('./result-files.cjs').ResultFiles)();
  api=createCodexApi(bridge,{resultFiles,access,desktop:new DesktopBridge({configPath:path.join(root,'../../work/desktop-connection.json')}),owner,attachments,images,ledgerPath:path.join(root,'../../work/desktop-requests.json')});
}
const types = {'.png':'image/png','.webmanifest':'application/manifest+json; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const allowed = new Set(['mobile-actions.mjs','mobile-tools.mjs','mobile-tools.css','task-manager.mjs','connection-panel.mjs','notice-center.mjs','conversation-search.mjs','mobile-workspace.mjs','new-task-ui.mjs','mobile-workspace.css','theme.js','theme.css','task-process.mjs','icons/tongpin-v1-32.png','icons/tongpin-v1-180.png','icons/tongpin-v1-192.png','icons/tongpin-v1-512.png','manifest.webmanifest','upload-queue.mjs','upload-storage.mjs','upload-transport.mjs','draft-editor.mjs','task-results.mjs','task-results-ui.mjs','task-groups.mjs','mobile-layout.mjs','reply-reader.mjs','pending-requests.mjs','index.html','message-gallery.mjs','message-markdown.mjs','vendor/marked.esm.js','pair.html','pair.css','pair.js','tongpin.css','tongpin-shell.mjs','styles.css','app.js','domain.mjs','chat-desktop.mjs','task-reliability.mjs','desktop-stream.mjs','attachments-ui.mjs','chat-desktop.css','desktop.html','desktop.js','desktop.css','desktop-continue.css','vendor/vue.global.prod.js']);
const server = http.createServer(async(req,res)=>{
  try{if(access&&await access.handle(req,res))return;}catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'访问认证暂不可用'}));return;}
  if(req.url==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({service:'tongpin',pid:process.pid,supervised:process.env.TONGPIN_SUPERVISED==='1',uptime:Math.floor(process.uptime()),lan:!!access}));return;}
  if(api && req.url.startsWith('/api/codex/')) {
    try { await api(req,res); } catch { if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'接入服务处理失败，请刷新页面。'}));} }
    return;
  }
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let name;
  try { name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'') || 'index.html'; }
  catch {res.writeHead(400);res.end('Bad request');return;}
  if (!allowed.has(name)) {res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(root,name),(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(name)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:data);
  });
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Set AI_TEAM_PORT to another port.`:error.message);process.exitCode=1;});
server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>console.log(`同频: http://127.0.0.1:${port}${access?' · 手机配对入口已开启':''}`));
function shutdown(){owner?.close();bridge?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
