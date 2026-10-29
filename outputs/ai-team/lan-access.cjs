const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const privateIp=ip=>/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip);
function lanAddresses(){return Object.entries(os.networkInterfaces()).filter(([name])=>!/vmware|vmnet|virtual|loopback|wsl/i.test(name)).flatMap(([,rows])=>rows.filter(r=>r.family==='IPv4'&&!r.internal&&privateIp(r.address)).map(r=>r.address));}
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
class LanAccess{
 constructor({port,addresses=lanAddresses(),configPath,now=Date.now}={}){this.port=port;this.addresses=[...new Set(addresses.filter(privateIp))];if(!this.addresses.length)throw Error('未找到可用于手机连接的局域网地址');this.configPath=configPath;this.now=now;this.attempts=new Map();this.responses=new Set();try{this.config=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('配对配置损坏，请在电脑端检查');this.config=this.newConfig();this.save();}if(!/^[A-F0-9]{12}$/.test(this.config.code)||!/^[a-f0-9]{64}$/.test(this.config.key))throw Error('配对配置无效');}
 newConfig(){return {code:crypto.randomBytes(6).toString('hex').toUpperCase(),key:crypto.randomBytes(32).toString('hex')};}
 save(){fs.mkdirSync(path.dirname(this.configPath),{recursive:true});const temporary=this.configPath+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(this.config),'utf8');fs.renameSync(temporary,this.configPath);}
 isLocal(req){const peer=(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(peer)&&new RegExp('^(127\\.0\\.0\\.1|localhost):'+this.port+'$').test(req.headers.host||'');}
 validate(req){const host=req.headers.host||'';const local=this.isLocal(req);if(!local&&!this.addresses.some(ip=>host===ip+':'+this.port))return {status:403,error:'访问地址不受信任，请使用电脑显示的手机地址'};if(!local&&!privateIp((req.socket?.remoteAddress||'').replace(/^::ffff:/,''))&&!['127.0.0.1','::1'].includes(req.socket?.remoteAddress))return {status:403,error:'仅允许本机和局域网访问'};if(req.headers.origin&&req.headers.origin!=='http://'+host||req.headers['sec-fetch-site']==='cross-site')return {status:403,error:'不允许跨站访问'};return null;}
 sign(value){return crypto.createHmac('sha256',this.config.key).update(value).digest('base64url');}
 session(req){const cookies=req.headers.cookie||'';const token=cookies.split(';').map(s=>s.trim()).find(s=>s.startsWith('tongpin_session='))?.slice(16)||'';const [payload,signature,...extra]=token.split('.');if(extra.length||!payload||!signature||!equal(this.sign(payload),signature))return false;try{const state=JSON.parse(Buffer.from(payload,'base64url').toString());return Number.isFinite(state.exp)&&state.exp>this.now()&&state.exp<=this.now()+31*86400000;}catch{return false;}}
 authorize(req){return this.validate(req)||(!this.isLocal(req)&&!this.session(req)?{status:401,error:'请先在手机上输入电脑端的访问码完成配对'}:null);}
 info(){return {local:true,code:this.config.code.match(/.{4}/g).join('-'),addresses:this.addresses.map(ip=>'http://'+ip+':'+this.port),expiresInDays:30};}
 revoke(){this.config=this.newConfig();this.save();for(const res of this.responses)res.destroy();this.responses.clear();}
 json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
 async handle(req,res){const url=new URL(req.url,'http://localhost');const invalid=this.validate(req);if(invalid){this.json(res,invalid.status,{error:invalid.error});return true;}
  if(url.pathname==='/access/pair'){
   if(req.method!=='POST'||req.headers.origin!=='http://'+req.headers.host){this.json(res,403,{error:'配对请求无效，请在配对页面操作'});return true;}
   const peer=req.socket.remoteAddress;let attempt=this.attempts.get(peer);if(!attempt||attempt.until<=this.now()){attempt={count:0,until:this.now()+5*60000};if(this.attempts.size>1000)this.attempts.clear();this.attempts.set(peer,attempt);}if(attempt.count>=5){this.json(res,429,{error:'尝试次数过多，请 5 分钟后重试'},{'Retry-After':String(Math.ceil((attempt.until-this.now())/1000))});return true;}
   let input;try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)throw Error();chunks.push(chunk);}input=JSON.parse(Buffer.concat(chunks).toString());}catch{this.json(res,400,{error:'配对请求格式无效'});return true;}
   if(typeof input.code!=='string'||!equal(input.code.replace(/[\s-]/g,'').toUpperCase(),this.config.code)){attempt.count++;this.json(res,401,{error:'访问码不正确，请核对电脑端显示的访问码'});return true;}
   this.attempts.delete(peer);const payload=Buffer.from(JSON.stringify({id:crypto.randomBytes(16).toString('hex'),exp:this.now()+30*86400000})).toString('base64url');this.json(res,200,{ok:true},{'Set-Cookie':`tongpin_session=${payload}.${this.sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`});return true;
  }
  if(['/theme.js','/theme.css','/pair.html','/pair.css','/pair.js','/manifest.webmanifest','/icons/tongpin-v1-32.png','/icons/tongpin-v1-180.png','/icons/tongpin-v1-192.png','/icons/tongpin-v1-512.png'].includes(url.pathname)&&['GET','HEAD'].includes(req.method))return false;
  const denied=this.authorize(req);if(denied){if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/access/')&&req.method==='GET'){res.writeHead(303,{Location:'/pair.html','Cache-Control':'no-store'});res.end();}else this.json(res,denied.status,{error:denied.error});return true;}
  if(url.pathname==='/access/info'){if(req.method!=='GET'){this.json(res,405,{error:'请求方法无效'});return true;}this.json(res,200,this.isLocal(req)?this.info():{local:false,paired:true});return true;}
  if(url.pathname==='/access/revoke'){if(!this.isLocal(req)||req.method!=='POST'||req.headers.origin!=='http://'+req.headers.host){this.json(res,403,{error:'请在电脑本机撤销手机授权'});return true;}this.revoke();this.json(res,200,this.info());return true;}
  if(!this.isLocal(req)){this.responses.add(res);res.on('close',()=>this.responses.delete(res));}return false;
 }
}
module.exports={LanAccess,lanAddresses};
