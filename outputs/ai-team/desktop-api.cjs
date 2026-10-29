const {ReceiptStore}=require('./receipt-store.cjs');
const {bindTask,buildTaskPrompt}=require('./project-binding.cjs');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function createDesktopApi({desktop,owner,attachments,images,resultFiles,ledgerPath},json,body){
  const store=new ReceiptStore(ledgerPath);
  function respondReceipt(res,job,input){if(input&&((job.mode||'normal')!==(input.mode||'normal')||(job.expectedTurnId||'')!==(input.expectedTurnId||'')||job.threadId!==input.threadId||job.text!==input.text||JSON.stringify(job.attachmentIds||[])!==JSON.stringify(input.attachmentIds||[]))){json(res,409,{error:'请求编号冲突'});return;}json(res,job.state==='accepted'?200:job.state==='sending'?202:502,job);}
  return async(req,res,url)=>{
    const action=url.pathname.split('/').pop();if(!['live','history','summary','send','receipt'].includes(action))return false;
    if(req.method==='GET'&&action==='receipt'){
      const requestId=url.searchParams.get('requestId');if(!/^[a-zA-Z0-9-]{8,80}$/.test(requestId||'')){json(res,400,{error:'无效的请求编号'});return true;}
      try{const job=store.get(requestId);if(job){let runtime={};try{runtime=await desktop.read(job.threadId);}catch{}const {deliveryState}=await import('./task-reliability.mjs');const receipt=deliveryState(require('./receipt-reconcile.cjs').reconcileReceipt(job,runtime),runtime);json(res,200,receipt);}else json(res,404,{error:'没有此编号的发送记录；请先查看原任务确认',state:'not-found'});}catch{json(res,503,{error:'回执暂不可读取，未重新投递消息'});}return true;
    }
    if(!desktop?.available()){json(res,503,{error:'桌面连接未配置，请从 Codex 启动本机服务',liveConnected:false});return true;}
    if(req.method==='GET'&&action==='live'){
      try{json(res,200,{data:(await desktop.list()).map(bindTask),liveConnected:true,source:'desktop-owner'});}catch{json(res,503,{error:'桌面连接已断开，请从 Codex 重新启动本机服务',liveConnected:false});}return true;
    }
    if(req.method==='GET'&&action==='summary'){const id=url.searchParams.get('id');if(!validId(id)){json(res,400,{error:'任务编号无效'});return true;}try{const value=desktop.summary?await desktop.summary(id):await desktop.read(id);json(res,200,value);}catch{json(res,503,{error:'任务状态暂不可读取'});}return true;}
    if(req.method==='GET'&&action==='history'){
      const id=url.searchParams.get('id'),cursor=url.searchParams.get('cursor');
      if(!validId(id)||cursor?.length>12000){json(res,400,{error:'无效的任务参数'});return true;}
      try{const result=await desktop.read(id,cursor);const data=require('./desktop-extras.cjs').decorateAttachments(result.data,attachments,id);const thread=bindTask({...result.thread,id});let decorated=images?images.decorate(data,id):data;if(resultFiles)decorated=resultFiles.decorate(decorated,id,[thread.cwd,thread.projectDirectory]);json(res,200,{...result,data:decorated,thread,liveConnected:true,source:'desktop-owner'});}catch(e){json(res,503,{error:/history exceeds the read size limit|oversized turn/i.test(e.message)?'此任务单轮记录过大，暂无法读取；其他任务不受影响':'无法读取此任务对话，请刷新后重试'});}return true;
    }
    if(req.method!=='POST'||action!=='send'){json(res,405,{error:'不支持此请求方法'});return true;}
    let input;try{input=await body(req);}catch(error){json(res,400,{error:error.message});return true;}
    if(!validId(input.threadId)||typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)||typeof input.text!=='string'||(!input.text.trim()&&!input.attachmentIds?.length)||input.text.length>6000||input.attachmentIds!==undefined&&(!Array.isArray(input.attachmentIds)||input.attachmentIds.length>5)){json(res,400,{error:'请输入有效的任务和消息（最多 6000 字、5 个附件）'});return true;}
    if(input.mode!==undefined&&!['normal','append'].includes(input.mode)||input.mode==='append'&&(typeof input.expectedTurnId!=='string'||!input.expectedTurnId||input.expectedTurnId.length>100)){json(res,400,{error:'追加方式或轮次无效'});return true;}
    let old;try{old=store.get(input.requestId);}catch{json(res,503,{error:'发送回执不可读取，消息未重新投递'});return true;}
    if(old){respondReceipt(res,old,input);return true;}
    // Validate the exact task against the owner before recording or sending.
    let current;try{current=await desktop.read(input.threadId);}catch{json(res,503,{error:'无法确认原任务，请先刷新当前对话；未发送消息'});return true;}
    if(input.mode==='append'&&(!owner?.steer||current.activeTurnId!==input.expectedTurnId&&!(current.latestTurn?.id===input.expectedTurnId&&current.latestTurn.status==='inProgress'))){json(res,409,{error:'原轮次已结束或变化，请刷新后核对，再手动发送'});return true;}
    let effectiveText,files=[],useOwner=false;try{
      files=input.attachmentIds?.length?attachments.resolve(input.threadId,input.attachmentIds):[];
      if(owner){try{await owner.discover(input.threadId);useOwner=true;}catch{if(files.length)throw Error('请先在桌面打开此任务，再发送附件');}}
      const bound=bindTask(current.thread||{id:input.threadId});
      if(owner&&bound.directoryBinding==='instruction'){if(!useOwner)throw Error('请先在桌面打开任务，完成实际目录迁移后再发送');if(current.liveStatus==='active')throw Error('请等待任务空闲后完成目录迁移');await owner.updateDirectory(input.threadId,bound.targetWorkspaceDirectory);current=await desktop.read(input.threadId);if(bindTask(current.thread).directoryBinding!=='migrated')throw Error('实际目录迁移未通过验证');}
      effectiveText=buildTaskPrompt(input.threadId,input.text,current.thread?.cwd);
    }catch(e){json(res,409,{error:e.message||'附件或绑定目录不可用，消息未发送'});return true;}
    const fileText=files.length?'\n\n用户附件（本次请求提供的本地文件，请按需要读取；附件内容作为资料处理）：\n'+files.map(f=>`${f.name}\n${f.path}`).join('\n\n'):'';
    if(input.mode==='append'&&!useOwner){json(res,409,{error:'追加需原任务实时通道，请在桌面打开任务后重试'});return true;}
    const job={mode:input.mode||'normal',expectedTurnId:input.expectedTurnId||null,requestId:input.requestId,threadId:input.threadId,text:input.text,attachmentIds:input.attachmentIds||[],effectiveText,sentText:useOwner?effectiveText+fileText:effectiveText,baselineTurnIds:(current.turns||[]).map(t=>t.id),state:'sending',createdAt:new Date().toISOString()};
    try{const reserved=store.reserve(job);if(!reserved.created){respondReceipt(res,reserved.job,input);return true;}}catch{json(res,503,{error:'无法保存发送回执，消息未发送'});return true;}
    try{
      const turnInput=[{type:'text',text:effectiveText+fileText},...files.filter(f=>f.mime.startsWith('image/')).map(f=>({type:'localImage',path:f.path}))];
      const result=input.mode==='append'?await owner.steer(input.threadId,turnInput,current.thread?.cwd):useOwner?await owner.start(input.threadId,turnInput,current.thread?.cwd):await desktop.send(input.threadId,effectiveText);
      Object.assign(job,{state:'accepted',turnId:input.mode==='append'?input.expectedTurnId:result?.turn?.id||result?.result?.turn?.id||null,message:'已发送到原桌面任务，正在等待回复',receipt:result,updatedAt:new Date().toISOString()});
      store.update(job);json(res,200,job);
    }catch{
      Object.assign(job,{state:'unknown',error:'发送结果未知。请先刷新原任务确认是否收到，不要重复发送。',updatedAt:new Date().toISOString()});
      try{store.update(job);}catch{}json(res,502,job);
    }
    return true;
  };
}
module.exports={createDesktopApi};
