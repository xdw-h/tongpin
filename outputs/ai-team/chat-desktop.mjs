import {followDesktop} from './desktop-stream.mjs';
import {useAttachments} from './attachments-ui.mjs';
export function toChatMessages(items,threadId){
  return items.filter(i=>['userMessage','agentMessage'].includes(i.type)).map(i=>({id:i.id,sender:i.type==='userMessage'?'me':'local',text:i.type==='userMessage'?(i.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').split('\n\n用户附件（本次请求提供的本地文件，请按需要读取；附件内容作为资料处理）：\n')[0]:i.text||'',attachments:i.attachments||[],createdAt:i.startedAtMs?new Date(i.startedAtMs).toISOString():null,real:i.type==='agentMessage',desktopThreadId:threadId})).filter(i=>i.text||i.attachments.length);
}
export function mergeChatHistory(current,incoming){
  const threadId=incoming[0]?.desktopThreadId||current[0]?.desktopThreadId;
  const pending=current.filter(m=>m.pending&&m.desktopThreadId===threadId&&!incoming.some(i=>i.sender==='me'&&(i.text===m.text||i.text.endsWith('\n用户指令：\n'+m.text))&&!(m.historyIds||[]).includes(i.id)));
  const updates=new Map(incoming.map(m=>[m.id,m]));
  const result=current.filter(m=>!m.pending&&m.desktopThreadId===threadId).map(m=>updates.get(m.id)||m);
  for(const message of incoming)if(!result.some(m=>m.id===message.id))result.push(message);
  for(const message of pending){const index=result.findIndex(i=>i.sender==='local'&&message.historyIds&&!message.historyIds.includes(i.id));result.splice(index<0?result.length:index,0,message);}
  return result;
}
export function createDraftStore(storage,onError=()=>{}){
  const key='tongpin-drafts-v1';let entries={};
  try{const saved=JSON.parse(storage.getItem(key)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))entries=saved;}catch{onError();}
  function save(){try{storage.setItem(key,JSON.stringify(entries));return true;}catch{onError();return false;}}
  return {get(id){const draft=entries[id];return {text:typeof draft?.text==='string'?draft.text:'',quote:typeof draft?.quote==='string'?draft.quote:''};},set(id,text,quote=''){entries[id]={text,quote};return save();},clear(id){delete entries[id];save();}};
}
export function useDesktopChat(Vue,{getToken,enabled,scroll,notify}){
  const {ref,computed,onUnmounted}=Vue;
  const rows=ref([]),selectedId=ref(''),messages=ref([]),connected=ref(false),loading=ref(false),sending=ref(false),notice=ref(''),cursor=ref(null),lastRequestId=ref('');
  const task=computed(()=>rows.value.find(t=>t.id===selectedId.value));
  const streamState=ref('idle'),activeTurnId=ref(null),stopping=ref(false),token=ref('');
  const attachmentDraft=useAttachments(Vue,{threadId:selectedId,getToken:()=>tokenOverride||getToken(),notify});
  let closeStream;
  function updateSnapshot(data){if(data.threadId!==selectedId.value)return;connected.value=true;activeTurnId.value=data.activeTurnId;if(task.value)Object.assign(task.value,data.thread,{liveStatus:data.liveStatus});const incoming=toChatMessages(data.data,data.threadId),reply=incoming.findLast(m=>m.sender==='local');if(awaitingReplies.has(data.threadId)&&reply&&reply.id!==awaitingReplies.get(data.threadId)&&!data.activeTurnId){notice.value='已收到原任务最新回复';awaitingReplies.delete(data.threadId);}messages.value=mergeChatHistory(messages.value,incoming);scroll(true);}
  function startStream(){closeStream?.();if(!selectedId.value){streamState.value='idle';return;}const id=selectedId.value;closeStream=followDesktop({threadId:id,getToken:()=>tokenOverride||getToken(),onSnapshot:updateSnapshot,onState:state=>{if(selectedId.value===id)streamState.value=state;},onReconnect:async()=>{await refreshToken();if(selectedId.value===id)await loadHistory(false,true);}});}
  async function refreshToken(){const response=await fetch('./api/codex/status');const status=await response.json();if(status.token){tokenOverride=status.token;token.value=status.token;}}
  let tokenOverride='';
  const statusText=value=>({active:'处理中',running:'处理中',idle:'空闲',notLoaded:'未加载',needsAttention:'待处理',unknown:'状态未知'}[value]||'状态未知');
  const pending=new Map(),awaitingReplies=new Map();let generation=0,pollCount=0,listBusy=false,attempts={},lastRequests={};
  try{attempts=JSON.parse(localStorage.getItem('chat-desktop-attempts')||sessionStorage.getItem('chat-desktop-attempts')||'{}');}catch{}
  try{lastRequests=JSON.parse(localStorage.getItem('chat-desktop-last-requests')||'{}');}catch{}
  const saveAttempts=()=>{try{localStorage.setItem('chat-desktop-attempts',JSON.stringify(attempts));localStorage.setItem('chat-desktop-last-requests',JSON.stringify(lastRequests));}catch{notify('发送编号无法保存，请在关闭页面前核对投递结果');}};
  async function request(path,body){
    const response=await fetch('./api/codex/desktop/'+path,{method:body?'POST':'GET',headers:{'X-AI-Team-Token':tokenOverride||getToken(),...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(30000)});
    const data=await response.json();if(!response.ok){const error=Error(data.error||'桌面连接失败');error.data=data;throw error;}return data;
  }
  async function refresh(){
    if(listBusy)return;listBusy=true;
    try{await refreshToken();const data=await request('live');rows.value=data.data;connected.value=true;}catch{connected.value=false;}finally{listBusy=false;}
  }
  async function loadHistory(more=false,quiet=false){
    if(!selectedId.value||loading.value)return;
    const id=selectedId.value,current=generation;loading.value=true;
    try{
      const data=await request('history?id='+encodeURIComponent(id)+(more&&cursor.value?'&cursor='+encodeURIComponent(cursor.value):''));
      if(current!==generation)return;
      connected.value=true;if(task.value){task.value.liveStatus=data.liveStatus;Object.assign(task.value,data.thread||{});}
      const incoming=toChatMessages(data.data,id);
      const lastReply=incoming.findLast(m=>m.sender==='local');
      if(awaitingReplies.has(id)&&lastReply&&lastReply.id!==awaitingReplies.get(id)){notice.value='已收到原任务最新回复';awaitingReplies.delete(id);}
      if(more){messages.value=[...incoming.filter(i=>!messages.value.some(m=>m.id===i.id)),...messages.value];cursor.value=data.nextCursor;}
      else{const hadHistory=messages.value.some(m=>!m.pending);messages.value=mergeChatHistory([...messages.value,...(pending.get(id)||[]).filter(i=>!messages.value.some(m=>m.id===i.id))],incoming);if(!hadHistory)cursor.value=data.nextCursor;}
      pending.set(id,messages.value.filter(m=>m.pending));
      if(!quiet||enabled())scroll(quiet);
    }catch(error){if(current===generation){connected.value=false;notice.value=error.message;}}finally{if(current===generation)loading.value=false;}
  }
  async function checkReceipt(){
    const id=selectedId.value,requestId=attempts[id]?.requestId||lastRequestId.value;if(!requestId)return;
    try{const receipt=await request('receipt?requestId='+encodeURIComponent(requestId));if(selectedId.value===id)notice.value=receipt.state==='accepted'?'已确认原任务收到此指令；不会重复投递':receipt.state==='sending'?'消息正在投递，尚未确认；请稍后核对':'发送结果未知，请核对原任务';}
    catch(error){if(selectedId.value===id)notice.value=error.data?.error||'暂时无法查询发送回执；未重新投递';}
  }
  async function select(id){closeStream?.();activeTurnId.value=null;generation++;selectedId.value=id;messages.value=[];cursor.value=null;loading.value=false;notice.value='';lastRequestId.value=attempts[id]?.requestId||lastRequests[id]||'';try{localStorage.setItem('chat-desktop-selected',id);}catch{}if(id){await loadHistory();if(selectedId.value===id){startStream();if(attempts[id])await checkReceipt();}}scroll();}
  async function send(text){
    if(!selectedId.value||sending.value||attachmentDraft.uploading.value)return false;
    if(!connected.value){notify('桌面连接已断开，请刷新任务连接。消息未发送。');return false;}
    const id=selectedId.value,attachmentIds=attachmentDraft.files.value.map(f=>f.id);let input=attempts[id];
    if(!input||input.text!==text||JSON.stringify(input.attachmentIds||[])!==JSON.stringify(attachmentIds)){input={requestId:crypto.randomUUID(),threadId:id,text,attachmentIds};attempts[id]=input;saveAttempts();}
    lastRequestId.value=input.requestId;
    lastRequests[id]=input.requestId;saveAttempts();
    const message={id:input.requestId,sender:'me',text,attachments:[...attachmentDraft.files.value],createdAt:new Date().toISOString(),desktopThreadId:id,pending:true,historyIds:messages.value.map(m=>m.id)};
    if(!(pending.get(id)||[]).some(m=>m.id===message.id))pending.set(id,[...(pending.get(id)||[]),message]);
    if(!messages.value.some(m=>m.id===message.id))messages.value.push(message);
    awaitingReplies.set(id,messages.value.findLast(m=>m.sender==='local')?.id||'');
    sending.value=true;notice.value='正在发送到原任务…';scroll();
    try{
      const receipt=await request('send',input);
      if(selectedId.value===id)notice.value=receipt.message||'指令已投递，等待原任务回复';
      if(receipt.state!=='accepted')return false;
      delete attempts[id];saveAttempts();attachmentDraft.clearSent(id,attachmentIds);if(selectedId.value===id){await loadHistory();startStream();}return true;
    }catch(error){if(selectedId.value===id)notice.value=error.data?.error||'发送结果未知，请先核对原任务，不要重复发送。';return false;}
    finally{sending.value=false;}
  }
  async function stop(){if(stopping.value||!activeTurnId.value)return;stopping.value=true;const id=selectedId.value;try{const result=await request('stop',{threadId:id,turnId:activeTurnId.value});if(selectedId.value===id)notice.value=result.message;}catch(e){notice.value=e.message;}finally{stopping.value=false;}}
  async function migrateDirectory(){if(!selectedId.value)return;try{const result=await request('directory',{threadId:selectedId.value});Object.assign(task.value,result.thread);notice.value=result.message;}catch(e){notice.value=e.message;}}
  const timer=setInterval(async()=>{if(document.hidden||!enabled()||sending.value)return;if(streamState.value!=='live')await loadHistory(false,true);if(++pollCount%3===0)await refresh();},4000);
  onUnmounted(()=>{clearInterval(timer);closeStream?.();});
  return {rows,selectedId,messages,connected,loading,sending,notice,cursor,lastRequestId,checkReceipt,task,statusText,refresh,select,loadHistory,send,streamState,activeTurnId,stopping,stop,migrateDirectory,token,...attachmentDraft};
}
