const {ReceiptStore}=require('./receipt-store.cjs');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function createManageApi({desktop,ledgerPath,store=new ReceiptStore(ledgerPath?ledgerPath+'.manage':null)},json,body){return async(req,res,url)=>{
 const action=url.pathname.split('/').pop();if(!['manage','management'].includes(action))return false;
 if(action==='management'&&req.method==='GET'){const id=url.searchParams.get('requestId');if(!/^[a-zA-Z0-9-]{8,80}$/.test(id||'')){json(res,400,{error:'无效的管理编号'});return true;}const job=store.get(id);json(res,job?200:404,job||{error:'未找到操作回执，请在原任务核对',state:'not-found'});return true;}
 if(action!=='manage'||req.method!=='POST'){json(res,405,{error:'请求方法无效'});return true;}
 let input;try{input=await body(req);}catch{json(res,400,{error:'管理参数无效'});return true;}
 if(!input||!validId(input.threadId)||!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId||'')||!['rename','archive','restore'].includes(input.operation)||input.operation==='rename'&&(typeof input.title!=='string'||!input.title.trim()||input.title.length>100||/[\r\n\x00-\x1f]/.test(input.title))){json(res,400,{error:'任务、操作或名称无效（名称最多 100 字）'});return true;}
 const same=job=>job.threadId===input.threadId&&job.operation===input.operation&&(job.title||'')===(input.operation==='rename'?input.title.trim():'');
 const respond=job=>{if(!same(job)){json(res,409,{error:'操作编号冲突，请核对原任务'});return;}json(res,200,job);};
 const old=store.get(input.requestId);if(old){respond(old);return true;}
 let current;try{current=await desktop.read(input.threadId);}catch{json(res,503,{error:'无法核对原任务，尚未执行操作'});return true;}
 if(input.operation==='archive'&&(['active','running','needsAttention'].includes(current.liveStatus)||current.latestTurn?.status==='inProgress'||current.requestsPending)){json(res,409,{error:'任务正在执行或等待确认，请处理完毕后再归档'});return true;}
 const job={requestId:input.requestId,threadId:input.threadId,operation:input.operation,title:input.operation==='rename'?input.title.trim():'',state:'sending',createdAt:new Date().toISOString()};const reserved=store.reserve(job);if(!reserved.created){respond(reserved.job);return true;}
 try{await desktop.manage(job.threadId,job.operation,job.title);Object.assign(job,{state:'accepted',message:({rename:'任务已重命名',archive:'任务已归档',restore:'任务已恢复'})[job.operation]});}catch{Object.assign(job,{state:'unknown',message:'操作结果待核对，请查看原任务；不会自动重复执行'});}store.update(job);respond(job);return true;
};}
module.exports={createManageApi};
