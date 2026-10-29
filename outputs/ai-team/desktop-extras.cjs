const {projectState}=require('./desktop-owner.cjs');
const {bindTask}=require('./project-binding.cjs');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function decorateAttachments(data,store,threadId){return data.map(item=>{
 if(item.type!=='userMessage'||!store)return item;const source=JSON.stringify(item.content||[]);const ids=[...new Set(source.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g)||[])];const attachments=[];
 for(const id of ids){try{attachments.push(store.public(store.resolve(threadId,[id])[0]));}catch{}}
 return {...item,attachments};
});}
function createDesktopExtras({desktop,owner,attachments,images,resultFiles,ledgerPath},json,body){
 const actions=owner?new (require('./desktop-requests.cjs').RequestActions)(owner,ledgerPath?ledgerPath+'.approvals':null):null;
 return async(req,res,url)=>{
  const action=url.pathname.split('/').pop();if(!['upload','attachment','image','events','stop','directory','requests','respond','result-file'].includes(action))return false;
  const threadId=url.searchParams.get('id');
  if(req.method==='GET'&&action==='requests'){if(!validId(threadId)){json(res,400,{error:'任务编号无效'});return true;}try{if(!actions)throw Error('桌面待确认连接不可用');await desktop.read(threadId);const data=await actions.list(threadId);json(res,200,{data,requestsPending:!!data.length});}catch(e){json(res,503,{error:e.message});}return true;}
  if(req.method==='GET'&&['attachment','image','events','result-file'].includes(action)){
   if(!validId(threadId)){json(res,400,{error:'任务编号无效'});return true;}
   if(action==='result-file'){try{if(!resultFiles)throw Error('下载不可用');const file=resultFiles.resolve(threadId,url.searchParams.get('fileId'));res.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});require('node:fs').createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);}catch{json(res,404,{error:'产物不可用或不属于当前任务，请刷新对话'});}return true;}
   if(action==='image'){try{const file=images.resolve(threadId,url.searchParams.get('imageId'));res.writeHead(200,{'Content-Type':file.mime,'Content-Length':require('node:fs').statSync(file.path).size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`});require('node:fs').createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);}catch{json(res,404,{error:'图片不存在、不可用或不属于当前任务'});}return true;}
   if(action==='attachment'){
    try{const file=attachments.resolve(threadId,[url.searchParams.get('attachmentId')])[0];res.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`});require('node:fs').createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);}catch(e){json(res,404,{error:e.message});}return true;
   }
   if(!owner){json(res,503,{error:'桌面实时连接不可用'});return true;}
   await desktop.read(threadId);
   res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
   let disposed=false,release,resetting=false,lastPayload='';
   const send=(event,data)=>{if(disposed)return;if(res.writableLength>1024*1024){res.destroy();return;}res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
   const onState=event=>{if(event.threadId!==threadId)return;const data=projectState(threadId,event.state);data.thread=bindTask(data.thread);data.data=decorateAttachments(data.data,attachments,threadId);if(images)data.data=images.decorate(data.data,threadId);if(resultFiles)data.data=resultFiles.decorate(data.data,threadId,[data.thread.cwd,data.thread.projectDirectory]);const payload=JSON.stringify(data);if(payload!==lastPayload){lastPayload=payload;send('snapshot',data);}};
   const resync=async id=>{if(id!==threadId||resetting||disposed)return;resetting=true;try{await owner.snapshot(threadId);}catch{send('connection',{state:'reconnecting',message:'实时连接中断，正在重新连接'});res.end();}finally{resetting=false;}};
   const disconnected=()=>{send('connection',{state:'reconnecting',message:'桌面实时连接已断开'});res.end();};
   const streamError=e=>{if(e.threadId===threadId){send('connection',{state:'unsupported',message:e.error});res.end();}};
   owner.on('state',onState);owner.on('resync',resync);owner.on('disconnected',disconnected);owner.on('streamError',streamError);
   const heartbeat=setInterval(()=>send('ping',{time:Date.now()}),15000);
   const cleanup=()=>{if(disposed)return;disposed=true;clearInterval(heartbeat);owner.off('state',onState);owner.off('resync',resync);owner.off('disconnected',disconnected);owner.off('streamError',streamError);release?.();};res.on('close',cleanup);
   try{release=await owner.follow(threadId);if(disposed){release();return true;}await owner.snapshot(threadId);}catch(e){send('connection',{state:'unavailable',message:e.message});res.end();}return true;
  }
  if(req.method!=='POST'||!['upload','stop','directory','respond'].includes(action)){json(res,405,{error:'请求方法无效'});return true;}
  let input;try{input=await body(req,action==='upload'?15*1024*1024:30000);}catch(e){json(res,400,{error:e.message});return true;}
  if(!input||!validId(input.threadId)){json(res,400,{error:'任务编号无效'});return true;}
  try{
   const current=await desktop.read(input.threadId);
   if(action==='respond'){if(!actions)throw Error('桌面待确认连接不可用');if(!((typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<500)||(typeof input.requestId==='number'&&Number.isSafeInteger(input.requestId)))||!/^[a-f0-9]{64}$/.test(input.version||''))throw Error('请求编号或版本无效');const result=await actions.submit(input.threadId,input);json(res,result.state==='accepted'?200:202,result);return true;}
   if(action==='upload'){if(!attachments)throw Error('附件存储不可用');json(res,201,attachments.save(input.threadId,input));return true;}
   if(!owner)throw Error('当前桌面不支持此操作');
   if(action==='stop'){if(typeof input.turnId!=='string'||!input.turnId||input.turnId.length>100)throw Error('当前执行轮次无效');const result=await owner.interrupt(input.threadId,input.turnId);json(res,200,{...result,message:'已向原任务发送停止指令'});return true;}
   const binding=bindTask(current.thread);if(!binding.projectDirectory)throw Error('当前任务没有待迁移的项目目录');
   if(current.liveStatus==='active')throw Error('任务正在执行，请停止或等待完成后迁移目录');
   if(!require('node:fs').statSync(binding.projectDirectory).isDirectory())throw Error('目标项目目录不存在');
   await owner.updateDirectory(input.threadId,binding.targetWorkspaceDirectory);const verified=bindTask((await desktop.read(input.threadId)).thread);if(verified.directoryBinding!=='migrated')throw Error('目录尚未通过读回验证');json(res,200,{thread:verified,message:'实际工作目录已迁移'});
  }catch(e){json(res,409,{error:e.message});}return true;
 };
}
module.exports={createDesktopExtras,decorateAttachments};
