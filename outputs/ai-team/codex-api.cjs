const {randomBytes}=require('node:crypto');
const CONVERSATIONS=new Set(['local','building','wang','li','ops','chen','zhang']);
function createCodexApi(bridge,options={}){
  const token=randomBytes(24).toString('hex'),jobs=new Map();
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
  async function body(req,limit=30000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('请求体过大');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('请求体必须为 JSON');}}
  const manageApi=require('./desktop-manage.cjs').createManageApi(options,json,body);
  const diagnosticsApi=require('./connection-diagnostics.cjs').createDiagnosticsApi(options,json);
  const taskApi=require('./desktop-create.cjs').createTaskApi(options,json,body);
  const desktopApi=require('./desktop-api.cjs').createDesktopApi(options,json,body);
  const desktopExtras=require('./desktop-extras.cjs').createDesktopExtras(options,json,body);
  return async(req,res)=>{
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/codex/'))return false;
    // Protect the local account bridge from cross-origin requests and DNS rebinding.
    const host=req.headers.host||'';
    if(options.access){const denied=options.access.authorize(req);if(denied){json(res,denied.status,{error:denied.error});return true;}}
    else if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host)){json(res,403,{error:'Codex 接口只允许本机访问'});return true;}
    if(req.headers.origin&&req.headers.origin!==`http://${host}`){json(res,403,{error:'不允许跨站调用 Codex'});return true;}
    if(req.method==='GET'&&url.pathname==='/api/codex/status'){json(res,200,{...bridge.status(),token});return true;}
    if(/^\/api\/codex\/desktop\/(manage|management|diagnostics|projects|create|creation|live|history|summary|send|receipt|upload|attachment|image|result-file|events|stop|directory|requests|respond)$/.test(url.pathname)){
      if(req.headers['x-ai-team-token']!==token){json(res,403,{error:'请刷新页面后重试'});return true;}
      return await manageApi(req,res,url)||await diagnosticsApi(req,res,url)||await taskApi(req,res,url)||await desktopExtras(req,res,url)||desktopApi(req,res,url);
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/codex/desktop/')){
      if(req.headers['x-ai-team-token']!==token){json(res,403,{error:'请刷新页面后重试'});return true;}
      const action=url.pathname.split('/').pop(),id=url.searchParams.get('id');
      if(!['threads','items'].includes(action)||action==='items'&&!/^[a-f0-9-]{36}$/.test(id||'')){json(res,400,{error:'无效的任务参数'});return true;}
      const cursor=url.searchParams.get('cursor')||null;
      if(cursor&&cursor.length>12000){json(res,400,{error:'无效的分页参数'});return true;}
      try{
        await bridge.connect();
        const result=await bridge.call(action==='threads'?'thread/list':'thread/items/list',action==='threads'?{limit:30,cursor,sortKey:'updated_at',modelProviders:[],useStateDbOnly:true,archived:url.searchParams.get('archived')==='true'}:{threadId:id,limit:50,cursor,sortDirection:'desc'});
        // A separate app-server cannot report the desktop owner's live runtime status.
        let data=(result.data||[]).map(row=>action==='threads'?{id:row.id,name:row.name||row.preview||'未命名任务',preview:row.preview,cwd:row.cwd,updatedAt:row.updatedAt,liveStatus:'unknown'}:{...row.item,startedAtMs:row.startedAtMs,completedAtMs:row.completedAtMs}).filter(row=>action==='threads'||['userMessage','agentMessage','imageGeneration','commandExecution','fileChange','mcpToolCall'].includes(row.type));
        if(action==='items'&&options.images)data=options.images.decorate(data,id);
        json(res,200,{data,nextCursor:result.nextCursor||null,source:'persisted-history',liveConnected:false});
      }catch{json(res,503,{error:'无法读取本机历史，请检查 Codex 连接后重试'});}
      return true;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/codex/jobs/')){const job=jobs.get(url.pathname.split('/').pop());json(res,job?200:404,job||{error:'任务不存在或服务已重启；请重新发送，不会自动重试。'});return true;}
    if(req.method!=='POST'){json(res,405,{error:'不支持此请求方法'});return true;}
    if(req.headers['x-ai-team-token']!==token){json(res,403,{error:'页面连接已失效，请刷新页面'});return true;}
    if(url.pathname==='/api/codex/connect'){try{json(res,200,await bridge.connect());}catch{json(res,503,{error:'Codex 连接失败，请确认本机程序和登录配置。',...bridge.status()});}return true;}
    if(url.pathname==='/api/codex/jobs'){
      let input;try{input=await body(req);}catch(error){json(res,400,{error:error.message});return true;}
      if(typeof input.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||!CONVERSATIONS.has(input.conversationId)||typeof input.text!=='string'||!input.text.trim()||input.text.length>6000){json(res,400,{error:'消息或会话参数不合法'});return true;}
      const old=jobs.get(input.id);if(old){if(old.text!==input.text||old.conversationId!==input.conversationId){json(res,409,{error:'任务编号冲突'});return true;}json(res,200,old);return true;}
      if(!bridge.status().ready){json(res,503,{error:'请先连接本机 Codex'});return true;}
      if(bridge.status().busy){json(res,409,{error:'Codex 正在处理另一条消息，请等待完成后重发。'});return true;}
      if(jobs.size>=1000){const done=[...jobs].find(([,j])=>j.state!=='running');if(done)jobs.delete(done[0]);else{json(res,429,{error:'任务数量已达上限'});return true;}}
      const job={id:input.id,conversationId:input.conversationId,text:input.text,state:'running',createdAt:new Date().toISOString()};jobs.set(job.id,job);
      bridge.ask(input.conversationId,input.text).then(result=>{Object.assign(job,{state:'done',answer:result.text,model:result.model,completedAt:new Date().toISOString()});}).catch(()=>{Object.assign(job,{state:'failed',error:'Codex 未完成本次请求。请检查接入面板中的连接状态，确认后手动重发。',completedAt:new Date().toISOString()});});
      json(res,202,job);return true;
    }
    json(res,404,{error:'接口不存在'});return true;
  };
}
module.exports={createCodexApi};
