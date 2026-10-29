const {ReceiptStore}=require('./receipt-store.cjs');
function createTaskApi({desktop,ledgerPath,store=new ReceiptStore(ledgerPath?ledgerPath+'.create':null)},json,body){
 const handler=async(req,res,url)=>{
 const action=url.pathname.split('/').pop();if(!['projects','create','creation'].includes(action))return false;
 if(action==='projects'&&req.method==='GET'){try{json(res,200,{data:await desktop.projects(),computer:'本机 Codex'});}catch{json(res,503,{error:'无法读取电脑项目，请检查桌面连接'});}return true;}
 if(action==='creation'&&req.method==='GET'){const id=url.searchParams.get('requestId');if(!/^[a-zA-Z0-9-]{8,80}$/.test(id||'')){json(res,400,{error:'无效的创建编号'});return true;}const job=store.get(id);json(res,job?200:404,job||{state:'not-found',error:'没有找到创建回执，请先在任务列表核对'});return true;}
 if(action!=='create'||req.method!=='POST'){json(res,405,{error:'请求方法无效'});return true;}
 let input;try{input=await body(req);}catch{json(res,400,{error:'创建参数无效'});return true;}
 if(!input||!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId||'')||typeof input.projectId!=='string'||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>6000){json(res,400,{error:'请选择项目并输入任务要求（最多 6000 字）'});return true;}
 const respond=job=>{if(job.projectId!==input.projectId||job.prompt!==input.prompt){json(res,409,{error:'创建编号冲突，请核对原任务'});return;}json(res,200,job);};
 const old=store.get(input.requestId);if(old){respond(old);return true;}
 let projects;try{projects=await desktop.projects();}catch{json(res,503,{error:'项目列表不可读取，尚未创建任务'});return true;}
 if(!projects.some(p=>p.projectId===input.projectId&&p.projectKind==='local'&&p.hostId==='local')){json(res,400,{error:'只能选择当前电脑已保存的本机项目'});return true;}
 const job={requestId:input.requestId,projectId:input.projectId,prompt:input.prompt,state:'sending',createdAt:new Date().toISOString()};const reservation=store.reserve(job);if(!reservation.created){respond(reservation.job);return true;}
 try{const result=await desktop.create(input.projectId,input.prompt.trim());if(!result.threadId&&!result.clientThreadId)throw Error('missing identity');Object.assign(job,{state:'accepted',threadId:result.threadId||null,clientThreadId:result.clientThreadId||null,hostId:result.hostId||'local',message:result.threadId?'任务已创建':'任务正在初始化，请刷新任务列表核对'});}catch{Object.assign(job,{state:'unknown',message:'创建结果待核对，请查看电脑任务列表；不会自动重复创建'});}
 store.update(job);respond(job);return true;
 };handler.store=store;return handler;
}
module.exports={createTaskApi};
