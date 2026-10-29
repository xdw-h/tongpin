const net=require('node:net'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
const VERSIONS={'initialize':0,'thread-owner-discovery':1,'thread-follower-load-complete-history':1,'thread-follower-start-turn':2,'thread-follower-interrupt-turn':4,'thread-follower-update-thread-settings':2};
function applyPatches(state,patches){
 const next=structuredClone(state);
 for(const patch of patches||[]){const parts=patch.path;if(!Array.isArray(parts)||parts.some(p=>['__proto__','prototype','constructor'].includes(String(p))))throw Error('无效的流式补丁');if(!parts.length)throw Error('不支持根补丁');let target=next;for(const part of parts.slice(0,-1)){if(!target||!Object.hasOwn(target,part))throw Error('流式补丁路径失效');target=target[part];}const key=parts.at(-1);
  if(patch.op==='remove'){if(Array.isArray(target))target.splice(Number(key),1);else delete target[key];}
  else if(patch.op==='add'||patch.op==='replace'){if(Array.isArray(target)&&patch.op==='add')target.splice(key==='-'?target.length:Number(key),0,patch.value);else target[key]=patch.value;}
  else throw Error('未知流式补丁');
 }return next;
}
class DesktopOwner extends EventEmitter{
 constructor({pipePath='\\\\.\\pipe\\codex-ipc',timeoutMs=20000}={}){super();this.pipePath=pipePath;this.timeoutMs=timeoutMs;this.pending=new Map();this.states=new Map();this.follows=new Map();this.socket=null;this.connecting=null;this.clientId=null;}
 async connect(){if(this.clientId&&this.socket&&!this.socket.destroyed)return;if(this.connecting)return this.connecting;this.connecting=new Promise((resolve,reject)=>{
  const socket=net.createConnection(this.pipePath);this.socket=socket;let buffer=Buffer.alloc(0);const fail=()=>{if(this.socket!==socket)return;this.clientId=null;for(const p of this.pending.values())p.reject(Error('桌面实时连接已断开'));this.pending.clear();this.states.clear();this.emit('disconnected');reject(Error('桌面实时连接已断开'));};
  socket.on('error',fail);socket.on('close',fail);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);try{while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(!size||size>32*1024*1024)throw Error('桌面响应过大');if(buffer.length<size+4)break;const msg=JSON.parse(buffer.subarray(4,size+4));buffer=buffer.subarray(size+4);this.receive(msg);}}catch{socket.destroy();}});
  socket.on('connect',()=>this.request('initialize',{clientType:'codex'},0).then(response=>{this.clientId=response.result.clientId;resolve();}).catch(error=>{socket.destroy();reject(error);}));
 }).finally(()=>{this.connecting=null;});return this.connecting;}
 write(message){if(!this.socket||this.socket.destroyed)throw Error('桌面实时连接已关闭');const body=Buffer.from(JSON.stringify(message)),frame=Buffer.alloc(body.length+4);frame.writeUInt32LE(body.length);body.copy(frame,4);this.socket.write(frame);}
 request(method,params,version=VERSIONS[method],targetClientId){return new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('桌面请求超时，未自动重试'));},this.timeoutMs);const finish=(fn,value)=>{clearTimeout(timer);fn(value);};this.pending.set(requestId,{resolve:v=>finish(resolve,v),reject:e=>finish(reject,e)});try{this.write({type:'request',requestId,method,params,version,...targetClientId?{targetClientId}:{}});}catch(e){this.pending.delete(requestId);finish(reject,e);}});}
 receive(msg){
  if(msg.type==='response'){const p=this.pending.get(msg.requestId);this.pending.delete(msg.requestId);if(msg.resultType==='error')p?.reject(Error(msg.error==='no-client-found'?'原任务尚未加载，请先在桌面打开该任务或发送一条文字消息':msg.error||'桌面操作失败'));else p?.resolve(msg);return;}
  if(msg.type==='client-discovery-request'){this.write({type:'client-discovery-response',requestId:msg.requestId,response:{canHandle:false}});return;}
  if(msg.type!=='broadcast')return;const p=msg.params;
  if(msg.method==='thread-stream-following-status-requested'&&this.follows.has(p?.conversationId))this.broadcastFollow(p.conversationId,true);
  if(msg.method!=='thread-stream-state-changed'||!p||p.hostId!=='local'||!this.follows.has(p.conversationId))return;
  if(msg.version!==11){this.emit('streamError',{threadId:p.conversationId,error:'当前桌面版本的实时协议不兼容，请刷新连接'});return;}
  const change=p.change,current=this.states.get(p.conversationId);try{
   if(change.type==='snapshot')this.states.set(p.conversationId,{revision:change.revision,state:change.conversationState});
   else if(change.type==='patches'){
    if(!current||current.revision!==change.baseRevision)throw Error('实时版本不连续');
    this.states.set(p.conversationId,{revision:change.revision,state:applyPatches(current.state,change.patches)});
   }else return;this.emit('state',{threadId:p.conversationId,...this.states.get(p.conversationId)});
  }catch{this.emit('resync',p.conversationId);}
 }
 async discover(threadId){await this.connect();const result=await this.request('thread-owner-discovery',{hostId:'local',conversationId:threadId});return {ownerClientId:result.handledByClientId};}
 broadcastFollow(threadId,following){this.write({type:'broadcast',method:'thread-stream-following-changed',version:1,params:{conversationId:threadId,hostId:'local',following}});}
 async follow(threadId){await this.connect();this.follows.set(threadId,(this.follows.get(threadId)||0)+1);this.broadcastFollow(threadId,true);return ()=>{const count=(this.follows.get(threadId)||1)-1;if(count)this.follows.set(threadId,count);else{this.follows.delete(threadId);this.states.delete(threadId);try{this.broadcastFollow(threadId,false);}catch{}}};}
 async snapshot(threadId){const {ownerClientId}=await this.discover(threadId);await this.request('thread-follower-load-complete-history',{conversationId:threadId},1,ownerClientId);}
 async updateDirectory(threadId,cwd){const {ownerClientId}=await this.discover(threadId);const result=await this.request('thread-follower-update-thread-settings',{conversationId:threadId,threadSettings:{cwd}},2,ownerClientId);if(result.result?.applied!==true)throw Error('桌面未应用项目目录');return result.result;}
 async interrupt(threadId,expectedTurnId){if(!expectedTurnId)throw Error('没有可停止的当前轮次');const {ownerClientId}=await this.discover(threadId);const result=await this.request('thread-follower-interrupt-turn',{conversationId:threadId,mode:'user-stop',expectedTurnId},4,ownerClientId);return result.result;}
 async start(threadId,input,cwd){input=input.map(item=>item.type==='text'?{...item,text_elements:Array.isArray(item.text_elements)?item.text_elements:[]}:item);const {ownerClientId}=await this.discover(threadId);const result=await this.request('thread-follower-start-turn',{conversationId:threadId,turnStart:{request:{threadId,input,...cwd?{cwd}:{}},context:{attachments:[],inheritThreadSettings:true}}},2,ownerClientId);return result.result;}
 async steer(threadId,input,cwd){input=input.map(item=>item.type==='text'?{...item,text_elements:Array.isArray(item.text_elements)?item.text_elements:[]}:item);const {ownerClientId}=await this.discover(threadId);const text=input.filter(i=>i.type==='text').map(i=>i.text).join('\n');const response=await this.request('thread-follower-steer-turn',{conversationId:threadId,input,attachments:[],restoreMessage:{text,cwd,createdAt:Date.now(),context:{prompt:text,addedFiles:[],fileAttachments:[],ideContext:null,imageAttachments:[],commentAttachments:[]}}},1,ownerClientId);if(!response.result||!Object.hasOwn(response.result,'result'))throw Error('原任务未确认收到追加要求');return response.result.result;}
 async readState(threadId){const release=await this.follow(threadId);let timer,listener;const ready=new Promise((resolve,reject)=>{listener=event=>{if(event.threadId===threadId)resolve(event.state);};this.on('state',listener);timer=setTimeout(()=>reject(Error('读取待确认请求超时，请刷新')),10000);});ready.catch(()=>{});try{await this.snapshot(threadId);return await ready;}finally{clearTimeout(timer);this.off('state',listener);release();}}
 async replyToRequest(threadId,reply){const allowed=['thread-follower-steer-turn','thread-follower-start-turn','thread-follower-submit-user-input','thread-follower-command-approval-decision','thread-follower-file-approval-decision','thread-follower-permissions-request-approval-response'];if(!allowed.includes(reply.method)||reply.params.conversationId!==threadId)throw Error('不支持此确认操作');const {ownerClientId}=await this.discover(threadId);const response=await this.request(reply.method,reply.params,reply.method==='thread-follower-start-turn'?2:1,ownerClientId);if(['thread-follower-steer-turn','thread-follower-start-turn'].includes(reply.method)&&response.result&&Object.hasOwn(response.result,'result'))return {ok:true};if(response.result?.ok!==true)throw Error('原任务未确认收到');return response.result;}
 close(){this.socket?.destroy();this.clientId=null;for(const p of this.pending.values())p.reject(Error('桌面实时连接已关闭'));this.pending.clear();}
}
function projectState(threadId,state){
 const turns=state.turnHistory?.kind==='canonical'?Object.values(state.turnHistory.history?.entitiesByKey||{}).filter(t=>t.turnId):state.turns||[];
 turns.sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0));
 const active=turns.findLast(t=>t.status==='inProgress');
 const data=turns.slice(-5).flatMap(t=>(t.items||[]).filter(i=>['userMessage','agentMessage','imageGeneration','commandExecution','fileChange','mcpToolCall'].includes(i.type)).map(i=>{const base={id:i.id,type:i.type,turnId:t.turnId||t.id,startedAtMs:t.turnStartedAtMs||null};if(i.type==='commandExecution')return {...base,command:i.command,status:i.status,exitCode:i.exitCode,aggregatedOutput:String(i.aggregatedOutput||'').slice(-2000)};if(i.type==='fileChange')return {...base,status:i.status,changes:(i.changes||[]).map(c=>({path:c.path,kind:c.kind,diff:String(c.diff||'').slice(0,24000),diffTruncated:String(c.diff||'').length>24000}))};if(i.type==='mcpToolCall')return {...base,server:i.server,tool:i.tool,status:i.status};return {...i,...base};}));
 return {threadId,data,latestTurn:turns.length?{id:turns.at(-1).turnId||turns.at(-1).id,status:turns.at(-1).status,startedAt:turns.at(-1).turnStartedAtMs}:null,turns:turns.map(t=>({id:t.turnId||t.id,status:t.status,startedAt:t.turnStartedAtMs})),liveStatus:state.threadRuntimeStatus?.type||'unknown',activeTurnId:active?.turnId||active?.id||null,thread:{id:threadId,name:state.title,cwd:state.cwd},requestsPending:require('./desktop-requests.cjs').projectRequests(threadId,state).length>0,requests:require('./desktop-requests.cjs').projectRequests(threadId,state)};
}
module.exports={DesktopOwner,applyPatches,projectState};
