const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const MAX_FRAME=8*1024*1024;
class DesktopBridge{
  constructor({configPath,timeoutMs=20000}={}){
    this.configPath=configPath;
    let saved={};try{saved=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch{}
    this.pipePath=process.env.CODEX_APP_TOOLS_PIPE_PATH||saved.pipePath;
    this.callerThreadId=process.env.CODEX_THREAD_ID||process.env.CODEX_SESSION_ID||saved.callerThreadId;
    this.timeoutMs=timeoutMs;
    if(configPath&&process.env.CODEX_APP_TOOLS_PIPE_PATH&&this.callerThreadId){fs.mkdirSync(path.dirname(configPath),{recursive:true});fs.writeFileSync(configPath,JSON.stringify({pipePath:this.pipePath,callerThreadId:this.callerThreadId}),'utf8');}
  }
  available(){return !!(this.pipePath&&this.callerThreadId);}
  refreshPipe(){
    if(process.platform!=='win32')return;
    try{const pipes=fs.readdirSync('\\\\.\\pipe\\');if(this.pipePath&&pipes.includes(this.pipePath.replace(/^.*[\\/]/,'')))return;const candidates=pipes.filter(name=>name.startsWith('codex-app-tools-'));if(candidates.length!==1)return;this.pipePath='\\\\.\\pipe\\'+candidates[0];if(this.configPath)fs.writeFileSync(this.configPath,JSON.stringify({pipePath:this.pipePath,callerThreadId:this.callerThreadId}),'utf8');}catch{}
  }
  call(tool,args){
    this.refreshPipe();
    if(!['list_threads','read_thread','send_message_to_thread','list_projects','create_thread','set_thread_title','set_thread_archived'].includes(tool))return Promise.reject(Error('不支持的桌面操作'));
    if(!this.available())return Promise.reject(Error('桌面连接未配置，请从 Codex 启动本机服务'));
    return new Promise((resolve,reject)=>{
      const socket=net.createConnection(this.pipePath);let buffer=Buffer.alloc(0),settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
      const timer=setTimeout(()=>finish(Error('桌面连接超时')),this.timeoutMs);
      socket.on('error',()=>finish(Error('桌面连接已断开，请从 Codex 重新启动本机服务')));
      socket.on('close',()=>{if(!settled)finish(Error('桌面连接意外关闭'));});
      socket.on('connect',()=>{
        const payload=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{arguments:args,callerSource:'codex',callId:randomUUID(),namespace:'codex_app',threadId:this.callerThreadId,tool,turnId:randomUUID()}}));
        const frame=Buffer.alloc(payload.length+4);frame.writeUInt32LE(payload.length);payload.copy(frame,4);socket.write(frame);
      });
      socket.on('data',chunk=>{
        buffer=Buffer.concat([buffer,chunk]);
        if(buffer.length<4)return;
        const size=buffer.readUInt32LE(0);if(size>MAX_FRAME){finish(Error('桌面响应超过大小限制'));return;}if(buffer.length<size+4)return;
        try{
          const response=JSON.parse(buffer.subarray(4,size+4).toString('utf8'));
          if(response.error)throw Error(response.error.message||'桌面操作失败');
          const result=response.result,text=(result?.contentItems||[]).filter(i=>i.type==='inputText').map(i=>i.text).join('\n');
          if(!result?.success)throw Error(text||'桌面拒绝了本次操作');
          let data;try{data=JSON.parse(text);}catch{data={message:text};}
          finish(null,data);
        }catch(error){finish(error);}
      });
    });
  }
  async manage(threadId,operation,title){if(operation==='rename')return this.call('set_thread_title',{threadId,source:'codex',title});if(['archive','restore'].includes(operation))return this.call('set_thread_archived',{threadId,hostId:'local',source:'codex',archived:operation==='archive'});throw Error('不支持此管理操作');}
  async projects(){const result=await this.call('list_projects',{});return (result.projects||[]).filter(p=>p.projectKind==='local'&&p.hostId==='local').map(p=>({projectId:p.projectId,label:p.label,path:p.path,hostId:'local',projectKind:'local'}));}
  async create(projectId,prompt){return this.call('create_thread',{prompt,target:{type:'project',projectId,environment:{type:'local'}}});}
  async list(){
    const result=await this.call('list_threads',{limit:50});
    return [...(result.pinnedThreads||[]),...(result.threads||[])].filter((t,i,a)=>t.kind==='codex'&&(!t.hostId||t.hostId==='local')&&a.findIndex(x=>x.id===t.id)===i).map(t=>({id:t.id,name:t.title,cwd:t.cwd,updatedAt:t.updatedAt,kind:t.kind,hostId:t.hostId||'local',isUnread:t.isUnread,liveStatus:t.status}));
  }
  async summary(threadId){const result=await this.call('read_thread',{threadId,hostId:'local',turnLimit:1,maxOutputCharsPerItem:300});if(result.thread?.kind!=='codex'||result.thread?.hostId&&result.thread.hostId!=='local')throw Error('仅支持本机任务');const turn=result.turns?.[0],liveStatus=result.thread?.status?.type||result.thread?.status||'unknown';const asyncPending=require('./async-questions.cjs').asyncRequests(threadId,{cwd:result.thread?.cwd,turns:turn?[{...turn,turnId:turn.id}]:[]}).length>0;const preview=(turn?.items||[]).findLast(i=>i.type==='agentMessage'&&i.text?.trim()&&!i.questions?.length&&['commentary','final_answer','final',undefined].includes(i.phase))?.text;const previewText=require('./summary-text.cjs').summaryText(preview);return {threadId,preview:previewText,liveStatus,latestTurn:turn?{id:turn.id,status:turn.status,startedAt:turn.startedAt}:null,requestsPending:liveStatus==='needsAttention'||asyncPending};}
  async read(threadId,cursor){
    const args={threadId,hostId:'local',turnLimit:5,maxOutputCharsPerItem:10000,...cursor?{cursor}:{}};
    let result;try{result=await this.call('read_thread',args);}catch(e){if(!/history exceeds the read size limit|oversized turn/i.test(e.message))throw e;result=await this.call('read_thread',{...args,turnLimit:1,maxOutputCharsPerItem:3000});}
    if(result.thread?.kind!=='codex'||result.thread?.hostId&&result.thread.hostId!=='local')throw Error('当前仅支持本机 Codex 任务');
    const data=[];
    for(const turn of [...(result.turns||[])].reverse())for(const item of turn.items||[]){
      const common={id:item.id,turnId:turn.id,startedAtMs:item.startedAt||turn.startedAt,completedAtMs:item.completedAt||turn.completedAt};
      if(item.type==='userMessage')data.push({...item,...common});
      if(item.type==='agentMessage')data.push({...common,type:'agentMessage',text:item.text,phase:item.phase,questions:item.questions});
      if(item.type==='imageGeneration')data.push({...common,type:'imageGeneration',status:item.status,savedPath:item.savedPath});
      if(item.type==='commandExecution')data.push({...common,type:item.type,command:item.command,status:item.status,exitCode:item.exitCode,aggregatedOutput:String(item.aggregatedOutput||'').slice(-2000)});
      if(item.type==='fileChange')data.push({...common,type:item.type,changes:item.changes,status:item.status});
      if(item.type==='mcpToolCall')data.push({...common,type:item.type,server:item.server,tool:item.tool,status:item.status});
    }
    return {latestTurn:result.turns?.[0]?{id:result.turns[0].id,status:result.turns[0].status,startedAt:result.turns[0].startedAt}:null,turns:(result.turns||[]).map(t=>({id:t.id,status:t.status,startedAt:t.startedAt})),requestsPending:(result.thread?.status?.type||result.thread?.status)==='needsAttention',data,nextCursor:result.page?.nextCursor||null,liveStatus:result.thread?.status?.type||result.thread?.status||'unknown',thread:{id:result.thread?.id,name:result.thread?.title,cwd:result.thread?.cwd}};
  }
  async send(threadId,text){return this.call('send_message_to_thread',{threadId,hostId:'local',prompt:text});}
}
module.exports={DesktopBridge};
