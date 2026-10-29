const {spawn}=require('node:child_process');
const readline=require('node:readline');

// No credentials are read or transported by the web server. Codex owns its existing provider configuration.
class CodexBridge {
  constructor(options={}) {
    this.executable=options.executable || process.env.AI_TEAM_CODEX_BIN || 'codex';
    this.cwd=options.cwd;this.spawn=options.spawn||spawn;this.timeoutMs=options.timeoutMs||120000;
    this.pending=new Map();this.threads=new Map();this.sequence=0;this.child=null;this.connecting=null;
    this.ready=false;this.busy=false;this.error='';this.active=null;this.model='';this.provider='';
  }
  status(){return {enabled:true,ready:this.ready,busy:this.busy,error:this.error,model:this.model,provider:this.provider,mode:'text-only',sessionContext:'临时协作会话；服务重启后重新开始'};}
  async connect(){
    if(this.ready)return this.status();
    if(this.connecting)return this.connecting;
    this.connecting=this._connect().finally(()=>{this.connecting=null;});return this.connecting;
  }
  async _connect(){
    this.error='';
    const args=['app-server','--stdio','-c','features.shell_tool=false','-c','features.apps=false','-c','features.hooks=false','-c','features.plugins=false','-c','agents.enabled=false','-c','web_search="disabled"'];
    const child=this.spawn(this.executable,args,{cwd:this.cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child=child;
    const lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}this.receive(message);});
    child.stderr.on('data',()=>{}); // Do not return raw diagnostics or account/provider data to the browser.
    child.on('error',error=>this.fail(error.code==='ENOENT'?'找不到 codex 程序，请在启动参数中指定路径。':error.message));
    child.on('exit',()=>{lines.close();if(this.child===child){this.child=null;this.fail('Codex 连接已断开，请重新连接。');}});
    try {
      await this.call('initialize',{clientInfo:{name:'tongpin_local_bridge',version:'0.2.0'}});
      this.write({method:'initialized',params:{}});
      const account=await this.call('account/read',{refreshToken:false});
      if(account.requiresOpenaiAuth&&!account.account)throw new Error('当前 Codex 通道需要登录，请先在本机完成 Codex 登录。');
      this.ready=true;return this.status();
    }catch(error){this.error=error.message;this.close();throw error;}
  }
  write(message){if(!this.child?.stdin?.writable)throw new Error('Codex 连接不可用');this.child.stdin.write(JSON.stringify(message)+'\n');}
  call(method,params){return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 请求超时`));},20000);this.pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});try{this.write({id,method,params});}catch(error){this.pending.get(id)?.reject(error);this.pending.delete(id);}});}
  receive(message){
    if(message.id!==undefined&&this.pending.has(message.id)&&!message.method){const item=this.pending.get(message.id);this.pending.delete(message.id);message.error?item.reject(new Error(message.error.message||'Codex 协议错误')):item.resolve(message.result);return;}
    if(message.id!==undefined&&message.method){
      // This integration has no approval UI. Decline tools rather than auto-approve side effects.
      try{if(message.method.includes('requestApproval'))this.write({id:message.id,result:{decision:'decline'}});else this.write({id:message.id,error:{code:-32601,message:'Text-only bridge does not support this tool'}});}catch{}
      if(this.active){const active=this.active;this.interrupt();active.reject(new Error('当前连接仅支持文字问答，工具请求已拒绝。'));}return;
    }
    const active=this.active,p=message.params;if(!active||!p||p.threadId!==active.threadId)return;
    if(message.method==='item/completed'&&p.item?.type==='agentMessage')active.items.set(p.item.id,{text:p.item.text,phase:p.item.phase});
    if(message.method==='item/started'&&['commandExecution','fileChange','mcpToolCall','dynamicToolCall'].includes(p.item?.type)){this.interrupt();active.reject(new Error('当前连接不支持工具执行，请仅发送文字问题。'));return;}
    if(message.method==='error'&&!p.willRetry){active.reject(new Error(p.error?.message||'Codex 请求失败'));return;}
    if(message.method==='turn/completed'){
      if(p.turn.status!=='completed'){active.reject(new Error(p.turn.error?.message||'Codex 任务已中断'));return;}
      const items=[...active.items.values()];const finals=items.filter(i=>i.phase==='final_answer');
      const text=(finals.length?finals:items.filter(i=>i.phase!=='commentary')).map(i=>i.text).filter(Boolean).join('\n\n');
      if(!text){active.reject(new Error('Codex 已结束，但没有返回回答。'));return;}
      active.resolve({text,threadId:active.threadId,model:this.model,provider:this.provider});
    }
  }
  async ask(conversationId,text){
    if(this.busy)throw new Error('Codex 正在处理另一条消息，请等待完成后再发送。');
    this.busy=true;
    try{
      await this.connect();let threadId=this.threads.get(conversationId);
      if(/任务|历史|对话记录|桌面.*进度/.test(text)){
        const result=await this.call('thread/list',{limit:15,sortKey:'updated_at',modelProviders:[],useStateDbOnly:true});
        const rows=result.data||[];
        return {text:'已查询本机真实任务记录（最近 '+rows.length+' 条）：\n'+rows.map((t,i)=>(i+1)+'. '+(t.name||t.preview||'未命名任务').replace(/\s+/g,' ').slice(0,90)).join('\n')+'\n\n实时运行状态尚未连接，因此不能判断哪些正在执行，也不能据此说“没有任务”。\n点击左侧“桌面任务”，选择任务查看历史对话；当前支持只读查看，追加指令、停止和审批尚未接通。',model:this.model,provider:this.provider};
      }
      if(!threadId){const result=await this.call('thread/start',{
        cwd:this.cwd,sandbox:'read-only',approvalPolicy:'never',ephemeral:true,
        developerInstructions:'你是同频聊天页面的独立 Codex 问答会话，不是桌面任务所属实例。禁止声称桌面没有正在执行的任务；未获得实时运行状态时必须说未知。网页的桌面任务中心已支持查询本机持久化任务和历史，实时状态、追加指令、停止与审批未接通。仅根据本会话文字回答，禁止调用工具、读取文件、执行命令、修改文件、联网查询、创建子代理或向其他人发消息。不要声称读取或验证了未获得的资料。使用简洁中文。'
      });threadId=result.thread.id;this.threads.set(conversationId,threadId);this.model=result.model||'';this.provider=result.modelProvider||'';}
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.error='Codex 回答超过 120 秒，连接已关闭。';this.close();},this.timeoutMs);
        const finish=(fn,value)=>{if(this.active?.threadId===threadId)this.active=null;clearTimeout(timer);fn(value);};
        this.active={threadId,items:new Map(),resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};
        this.call('turn/start',{threadId,input:[{type:'text',text}]}).then(result=>{if(this.active?.threadId===threadId)this.active.turnId=result.turn?.id;}).catch(error=>this.active?.reject(error));
      });
    }catch(error){this.error=error.message;throw error;}finally{this.busy=false;}
  }
  interrupt(){const active=this.active;if(active?.turnId)this.call('turn/interrupt',{threadId:active.threadId,turnId:active.turnId}).catch(()=>{});}
  fail(message){this.ready=false;this.error=message;for(const item of this.pending.values())item.reject(new Error(message));this.pending.clear();this.active?.reject(new Error(message));this.threads.clear();}
  close(){const child=this.child;this.child=null;this.fail(this.error||'Codex 连接已关闭');if(child){child.stdin.end();child.kill();}}
}
module.exports={CodexBridge};
