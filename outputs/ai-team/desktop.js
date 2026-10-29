import {createActionStore,shortcutRows,createLongPress,copyText,MessageCopy} from './mobile-actions.mjs';
import {collectResult} from './task-results.mjs';
import {ConversationSearch} from './conversation-search.mjs';
import {TaskManager} from './task-manager.mjs';
import {ConnectionPanel} from './connection-panel.mjs';
import {NoticeCenter} from './notice-center.mjs';
import {noticeRows} from './mobile-tools.mjs';
import {workspaceRows,activityText} from './mobile-workspace.mjs';
import {NewTask} from './new-task-ui.mjs';
import {TaskProcess} from './task-process.mjs';
import {DraftEditor} from './draft-editor.mjs';
import {TaskResults} from './task-results-ui.mjs';
import {taskGroup,groupCounts,groupLabel} from './task-groups.mjs';
import {bindMobileViewport,resizeComposer} from './mobile-layout.mjs';
import {ReplyReader} from './reply-reader.mjs';
import {PendingRequests} from './pending-requests.mjs';
import {deliveryState,turnNotice,mergeTaskItems,catchUpHistory} from './task-reliability.mjs';
import {formatDate,createRequestId} from './domain.mjs';
import {createDraftStore} from './chat-desktop.mjs';
import {useAttachments,AttachmentBar,UploadPending} from './attachments-ui.mjs';
import {followDesktop} from './desktop-stream.mjs';
import {shell,iconPaths} from './tongpin-shell.mjs';
import {MessageGallery} from './message-gallery.mjs';
import {renderMarkdown} from './message-markdown.mjs';
const {createApp,ref,computed,onMounted,onUnmounted,watch,nextTick}=window.Vue;
document.getElementById('desktop').innerHTML=shell;
createApp({components:{MessageCopy,ConversationSearch,TaskManager,ConnectionPanel,NoticeCenter,NewTask,TaskProcess,DraftEditor,UploadPending,TaskResults,ReplyReader,PendingRequests,AttachmentBar,MessageGallery,UiIcon:{props:['name'],template:'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[name]||paths.chat"/></svg>',data:()=>({paths:iconPaths})}},setup(){
  const theme=ref(window.TongpinTheme?.get()||'system');const syncTheme=()=>{theme.value=window.TongpinTheme?.get()||'system';};function setTheme(value){window.TongpinTheme?.set(value);syncTheme();}window.addEventListener('tongpin-theme-change',syncTheme);
  const manageTarget=ref(null),noticesOpen=ref(false),diagnosticsOpen=ref(false),searchOpen=ref(false),toast=ref(null),lastListAt=ref(null),lastHistoryAt=ref(null),lastHistoryTask=ref(null),lastSyncError=ref('');let toastTimer;
  const noticeList=computed(()=>noticeRows(notices.value,rows.value));
  function saveNotices(){try{localStorage.setItem('tongpin-notices',JSON.stringify(notices.value));}catch{}}
  function dismissNotice(id){delete notices.value[id];notices.value={...notices.value};if(toast.value?.id===id)toast.value=null;saveNotices();}
  function clearNotices(){notices.value={};toast.value=null;saveNotices();}
  function publishNotice(id,notice){const old=notices.value[id];if(old?.kind===notice.kind&&old?.turnId===notice.turnId)return;const row=rows.value.find(r=>r.id===id);const value={...notice,at:Date.now(),title:row?.name||'任务更新'};notices.value={...notices.value,[id]:value};saveNotices();const viewing=selected.value?.id===id&&!document.hidden&&view.value!=='profile'&&autoScroll&&(!window.matchMedia('(max-width:760px)').matches||mobileChat.value);if(!viewing){toast.value={id,...value};clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.value=null;},8000);}}
  async function openNotice(notice){noticesOpen.value=false;toast.value=null;view.value='chat';if(archived.value){archived.value=false;statusFilter.value='focus';await changeArchive();}let task=rows.value.find(r=>r.id===notice.id);if(!task){await loadThreads();task=rows.value.find(r=>r.id===notice.id)||{id:notice.id,name:notice.title||'任务更新',liveStatus:'unknown'};}await select(task);if(selected.value?.id===notice.id&&lastHistoryTask.value===notice.id){dismissNotice(notice.id);await setChatTab(['completed','failed','interrupted'].includes(notice.kind)?'results':'chat');}}
  async function managedTask(job){if(job.state!=='accepted')return;if(job.operation==='archive')offerUndo(job);if(job.operation==='restore'&&archiveUndo.value?.threadId===job.threadId){archiveUndo.value=null;saveUndo();}if(job.operation==='rename'){rows.value=rows.value.map(r=>r.id===job.threadId?{...r,name:job.title}:r);if(selected.value?.id===job.threadId)selected.value={...selected.value,name:job.title};if(manageTarget.value?.task.id===job.threadId)manageTarget.value={...manageTarget.value,task:{...manageTarget.value.task,name:job.title}};}else{rows.value=rows.value.filter(r=>r.id!==job.threadId);dismissNotice(job.threadId);if(selected.value?.id===job.threadId){savePosition();drafts.set('desktop:'+selected.value.id,draft.value);closeStream?.();generation++;selected.value=null;items.value=[];activeTurnId.value=null;mobileChat.value=false;}await loadThreads(false,true);}}
  function clearSearchMarks(){messageList.value?.querySelectorAll('.search-hit').forEach(el=>el.classList.remove('search-hit'));window.CSS?.highlights?.delete('tongpin-search');}
  function closeSearch(){searchOpen.value=false;clearSearchMarks();}
  async function locateMessage(id,query){autoScroll=false;await setChatTab('chat');await nextTick();clearSearchMarks();const root=messageList.value,hit=[...(root?.querySelectorAll('[data-search-id]')||[])].find(el=>el.dataset.searchId===id);if(!hit)return;for(let node=hit.parentElement;node&&node!==root;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;hit.classList.add('search-hit');if(window.CSS?.highlights&&window.Highlight&&query){const walker=document.createTreeWalker(hit,NodeFilter.SHOW_TEXT),ranges=[];let node;while((node=walker.nextNode())&&ranges.length<100){const source=node.textContent.toLowerCase(),needle=query.trim().toLowerCase();let from=0,index;while((index=source.indexOf(needle,from))>=0&&ranges.length<100){const range=new Range();range.setStart(node,index);range.setEnd(node,index+needle.length);ranges.push(range);from=index+needle.length;}}CSS.highlights.set('tongpin-search',new Highlight(...ranges));}hit.scrollIntoView({block:'center'});savePosition();}
  const editingDraft=ref(false);const chatTab=ref('chat'),currentRuntime=ref({});
  async function setChatTab(tab){if(chatTab.value==='chat')savePosition();chatTab.value=tab;if(tab==='chat')await restorePosition(positions.get(selected.value?.id));}
  const readingItem=ref(null),composerInput=ref(null);let releaseViewport;
  const view=ref('chat'),mobileChat=ref(false),activeOnly=ref(false),messageList=ref(null),copied=ref(false);let autoScroll=true,copyTimer;
  const newTaskOpen=ref(false),pins=ref([]);try{const saved=JSON.parse(localStorage.getItem('tongpin-pins')||'[]');if(Array.isArray(saved))pins.value=saved.filter(id=>typeof id==='string');}catch{}
  function togglePin(id){pins.value=pins.value.includes(id)?pins.value.filter(x=>x!==id):[id,...pins.value];try{localStorage.setItem('tongpin-pins',JSON.stringify(pins.value));}catch{error.value='置顶暂未保存，刷新前仍可使用';}}
  function taskPreview(row){const state=taskStates.value[row.id];return state&&state.sourceUpdatedAt===row.updatedAt&&state.preview?state.preview:'打开任务查看最新进展';}
  const activity=computed(()=>activityText(items.value,currentRuntime.value));
  async function continueEditing(){setChatTab('chat');await nextTick();composerInput.value?.focus();}
  async function createdTask(task){newTaskOpen.value=false;view.value='chat';archived.value=false;statusFilter.value='focus';await loadThreads();if(!rows.value.some(r=>r.id===task.id))rows.value=[task,...rows.value];await select(rows.value.find(r=>r.id===task.id)||task);}
  const statusFilter=ref('focus'),taskStates=ref({}),statesBusy=ref(false);const taskCounts=computed(()=>groupCounts(rows.value,taskStates.value));
  const rowGroup=row=>taskGroup(row,taskStates.value[row.id]);const rowStatus=row=>groupLabel(rowGroup(row),taskStates.value[row.id]?.sourceUpdatedAt===row.updatedAt?taskStates.value[row.id]:null);
  const pendingCards=ref([]);const notices=ref({}),newMessages=ref(false),taskAttention=ref(false),gapCursor=ref(null);let recovering=false;const observed=new Map(),positions=new Map();
  try{for(const entry of JSON.parse(localStorage.getItem('tongpin-observed')||'[]'))observed.set(...entry);for(const entry of JSON.parse(localStorage.getItem('tongpin-reading')||'[]'))positions.set(...entry);}catch{}
  try{notices.value=JSON.parse(localStorage.getItem('tongpin-notices')||'{}');}catch{}
  function savePosition(){const el=messageList.value;if(!el||!selected.value)return;const top=el.getBoundingClientRect().top;const node=[...el.querySelectorAll('[data-message-id]')].find(n=>n.getBoundingClientRect().bottom>top);positions.set(selected.value.id,{bottom:autoScroll,id:node?.dataset.messageId,offset:node?node.getBoundingClientRect().top-top:0,scrollTop:el.scrollTop});try{localStorage.setItem('tongpin-reading',JSON.stringify([...positions].slice(-100)));}catch{}}
  async function restorePosition(position){await nextTick();const el=messageList.value;if(!el||!position)return;if(position.bottom){el.scrollTop=el.scrollHeight;return;}const node=[...el.querySelectorAll('[data-message-id]')].find(n=>n.dataset.messageId===position.id);el.scrollTop=node?el.scrollTop+node.getBoundingClientRect().top-el.getBoundingClientRect().top-position.offset:position.scrollTop;}
  function readNotice(){if(!selected.value||lastHistoryTask.value!==selected.value.id||lastSyncError.value||document.hidden||!autoScroll)return;delete notices.value[selected.value.id];notices.value={...notices.value};try{localStorage.setItem('tongpin-notices',JSON.stringify(notices.value));}catch{}}
  function observeRuntime(id,data){if(selected.value?.id===id){taskAttention.value=!!data.requestsPending;if(Array.isArray(data.requests))pendingCards.value=data.requests;}const turns=data.turns||[],next=turns.find(t=>t.id===data.activeTurnId)||data.latestTurn||turns.findLast(t=>t.status==='inProgress')||[...turns].sort((a,b)=>{const time=t=>typeof t.startedAt==='number'?t.startedAt:Date.parse(t.startedAt)||0;return time(b)-time(a);})[0];if(selected.value?.id===id&&(next||data.requestsPending!==undefined))currentRuntime.value={latestTurn:next,requestsPending:!!data.requestsPending,turns:data.turns||currentRuntime.value.turns||[]};if(next||data.requestsPending!==undefined){const row=rows.value.find(t=>t.id===id);taskStates.value={...taskStates.value,[id]:{latestTurn:next,requestsPending:!!data.requestsPending,preview:data.preview??[...(data.data||[])].reverse().find(i=>i.type==='agentMessage'&&i.text?.trim()&&!i.questions?.length)?.text?.split('```')[0].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`#]/g,'').replace(/\s+/g,' ').trim().slice(0,220)??taskStates.value[id]?.preview??'',sourceUpdatedAt:row?.updatedAt,fetchedAt:Date.now()}};}if(next){const value={...next,requestsPending:data.requestsPending},notice=turnNotice(observed.get(id),value);observed.set(id,value);try{localStorage.setItem('tongpin-observed',JSON.stringify([...observed].slice(-100)));}catch{}if(notice)publishNotice(id,notice);}if(receipts.value[id]){receipts.value={...receipts.value,[id]:deliveryState(receipts.value[id],data)};saveReceipts();}if(selected.value?.id===id&&view.value!=='profile'&&(!window.matchMedia('(max-width:760px)').matches||mobileChat.value))readNotice();}
  function saveReceipts(){try{localStorage.setItem('tongpin-receipts',JSON.stringify(receipts.value));}catch{}}
  async function checkReceipts(){for(const [id,receipt] of Object.entries(receipts.value)){if(!['sending','accepted','running','attention','unknown'].includes(receipt.state)||!receipt.requestId)continue;try{const result=await request('desktop/receipt?requestId='+encodeURIComponent(receipt.requestId));receipts.value={...receipts.value,[id]:{...receipt,...result}};if(result.state!==receipt.state&&['completed','failed','interrupted','attention'].includes(result.state)){publishNotice(id,{kind:result.state,turnId:result.turnId});}if(['accepted','running','attention','completed','failed','interrupted'].includes(result.state)){const sentText=result.text??receipt.text;attachments.clearSent(id,result.attachmentIds||receipt.attachmentIds||[]);if(typeof sentText==='string'&&drafts.get('desktop:'+id).text.trim()===sentText.trim()){drafts.clear('desktop:'+id);if(selected.value?.id===id&&draft.value.trim()===sentText.trim())draft.value='';}attempts.delete(id);saveAttempts();}}catch{}}saveReceipts();}
  async function resume(){if(document.hidden||recovering)return;recovering=true;try{closeStream?.();token=(await request('status')).token;uiToken.value=token;await loadThreads(false,true);await loadItems(false,true);await checkReceipts();await checkTaskNotices();startStream();}catch{streamState.value='reconnecting';}finally{recovering=false;}}
  function visibility(){if(document.hidden){savePosition();closeStream?.();streamState.value='paused';}else void resume();}
  function offline(){savePosition();closeStream?.();streamState.value='offline';}
  function releaseAttempt(){const id=selected.value?.id;if(!id||receipts.value[id]?.state!=='unknown')return;if(!confirm('确认你已查看原任务，且没有收到这条消息？确认后可重新编辑并手动发送。'))return;receipts.value={...receipts.value,[id]:{...receipts.value[id],state:'rejected',message:'已按你的核对结果解除等待，请确认内容后发送'}};attempts.delete(id);saveAttempts();saveReceipts();}
  function jumpToEnd(){autoScroll=true;newMessages.value=false;void scrollEnd();readNotice();}
  const accessInfo=ref(null);
  async function loadAccessInfo(){try{const response=await fetch('/access/info');if(response.ok)accessInfo.value=await response.json();}catch{}}
  async function revokeDevices(){if(!confirm('撤销所有手机授权并更换访问码？已连接的手机需要重新配对。'))return;try{const response=await fetch('/access/revoke',{method:'POST'});const data=await response.json();if(!response.ok)throw Error(data.error);accessInfo.value=data;}catch(e){error.value=e.message;}}
  const displayName=t=>(t?.name||'未命名任务').replaceAll('AI版QQ','同频');
  const projectName=value=>String(value||'').split(/[\\/]/).filter(Boolean).slice(-2).join(' / ');
  const shortStamp=value=>{const date=formatDate(typeof value==='number'?(value<1e12?value*1000:value):value);return date==='-'?'-':date.slice(0,10)===formatDate(new Date()).slice(0,10)?date.slice(11,16):date.slice(0,10);};
  function onMessageScroll(){const el=messageList.value;if(el){autoScroll=el.scrollHeight-el.scrollTop-el.clientHeight<100;savePosition();if(autoScroll){newMessages.value=false;readNotice();}}}
  async function scrollEnd(){await nextTick();if(autoScroll&&messageList.value)messageList.value.scrollTop=messageList.value.scrollHeight;else await restorePosition(positions.get(selected.value?.id));}
  function backToList(){mobileChat.value=false;}
  async function setFilter(mode){statusFilter.value=mode==='active'?'running':mode;activeOnly.value=mode==='active'||mode==='running';if(archived.value!==(mode==='archived')){archived.value=mode==='archived';await changeArchive();}}
  function composerKeydown(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.matchMedia('(min-width:761px)').matches){event.preventDefault();void send();}}
  const copyTarget=ref(null);
  function copiedMessage(){copied.value=true;clearTimeout(copyTimer);copyTimer=setTimeout(()=>copied.value=false,2000);}
  async function copyMessage(item){try{await copyText(text(item),{navigator,document});copiedMessage();}catch{error.value='';copyTarget.value={text:text(item),manual:true};}}
  const rows=ref([]),items=ref([]),selected=ref(null),cursor=ref(null),itemCursor=ref(null),query=ref(''),archived=ref(false),busy=ref(false),historyBusy=ref(false),error=ref(''),liveConnected=ref(false),sending=ref(false),draft=ref(''),receipts=ref({}),lastRefresh=ref('');
  let token='',generation=0,timer,polls=0,switchingDraft=false;let attempts;
  const streamState=ref('idle'),activeTurnId=ref(null),stopping=ref(false),uiToken=ref('');let closeStream;
  const attachments=useAttachments(window.Vue,{threadId:computed(()=>selected.value?.id||''),getToken:()=>token,notify:message=>{error.value=message;}});
  function startStream(){closeStream?.();if(!selected.value||archived.value||document.hidden||!navigator.onLine)return;const id=selected.value.id;closeStream=followDesktop({threadId:id,getToken:()=>token,onState:(state,message)=>{if(selected.value?.id===id){streamState.value=state;if(message)lastSyncError.value=message;}},onReconnect:async()=>{token=(await request('status')).token;uiToken.value=token;await loadItems(false,true);},onSnapshot:data=>{if(selected.value?.id!==id)return;savePosition();observeRuntime(id,data);activeTurnId.value=data.activeTurnId;selected.value={...selected.value,...data.thread,liveStatus:data.liveStatus};if(!autoScroll&&data.data.some(i=>!items.value.some(old=>old.id===i.id)))newMessages.value=true;items.value=mergeTaskItems(items.value,data.data);lastRefresh.value=formatDate(new Date());lastHistoryAt.value=Date.now();lastHistoryTask.value=id;lastSyncError.value='';}});}
  async function stop(){if(!selected.value||!activeTurnId.value||stopping.value)return;stopping.value=true;try{await request('desktop/stop',{threadId:selected.value.id,turnId:activeTurnId.value});}catch(e){error.value=e.message;}finally{stopping.value=false;}}
  async function migrate(){try{const result=await request('desktop/directory',{threadId:selected.value.id});selected.value={...selected.value,...result.thread};}catch(e){error.value=e.message;}}
  const drafts=createDraftStore(localStorage,()=>{error.value='草稿保存不可用，请在刷新前复制内容';});

  const actionStore=createActionStore(localStorage),actionRevision=ref(0),lastTaskId=ref(''),actionMessage=ref('');
  try{lastTaskId.value=localStorage.getItem('desktop-center-selected')||'';}catch{}
  const shortcuts=computed(()=>archived.value?[]:shortcutRows(rows.value,pins.value,lastTaskId.value));
  const heldText=computed(()=>{actionRevision.value;return actionStore.held(selected.value?.id);});
  const resultTurn=computed(()=>collectResult(items.value,currentRuntime.value));
  const resultAccepted=computed(()=>{actionRevision.value;return actionStore.accepted(selected.value?.id,resultTurn.value.turnId);});
  function actionChange(fn){try{fn();actionRevision.value++;return true;}catch(e){error.value=e.message||'无法保存，请保留当前内容';return false;}}
  function holdRequirement(){if(!selected.value||archived.value||sending.value||attachments.files.value.length||attachments.pending.value.length){error.value='暂存仅保存文字，请先处理附件';return;}if(actionChange(()=>actionStore.hold(selected.value.id,draft.value))){draft.value='';actionMessage.value='要求已暂存，执行结束后可取回并手动发送';}}
  function takeRequirement(){if(!selected.value||sending.value||!heldText.value)return;const combined=[draft.value,heldText.value].filter(Boolean).join('\n\n');if(combined.length>6000){error.value='合并后超过 6000 字，请先缩短输入内容';return;}if(!drafts.set('desktop:'+selected.value.id,combined)){error.value='草稿保存失败，暂存内容仍保留';return;}draft.value=combined;if(actionChange(()=>actionStore.removeHeld(selected.value.id))){actionMessage.value='已取回输入框，请核对后发送';void continueEditing();}}
  function removeRequirement(){if(selected.value&&confirm('移除这条暂存要求？'))actionChange(()=>actionStore.removeHeld(selected.value.id));}
  function acceptResult(){if(archived.value||resultTurn.value.status!=='completed'||!resultTurn.value.summary||taskAttention.value||lastHistoryTask.value!==selected.value?.id||lastSyncError.value)return;actionChange(()=>actionStore.accept(selected.value.id,resultTurn.value.turnId));}
  function adjustResult(){if(selected.value&&!actionChange(()=>actionStore.clearAcceptance(selected.value.id)))return;void continueEditing();}
  const longPress=createLongPress(value=>{if(window.getSelection()?.toString())return;copyTarget.value={text:text(value),manual:false};});
  function startMessagePress(event,item){if(event.target.closest('a,button,input,textarea,summary')||window.getSelection()?.toString())return;longPress.start(event,item);}
  function leaveWarning(event){if(!attachments.hasUnsent.value)return;event.preventDefault();event.returnValue='';}
  window.addEventListener('beforeunload',leaveWarning);
  let undoTimer;const archiveUndo=ref(null);
  try{const saved=JSON.parse(localStorage.getItem('tongpin-archive-undo')||'null');if(saved&&(saved.expiresAt>Date.now()||saved.state==='unknown'))archiveUndo.value=saved;}catch{}
  function saveUndo(){try{localStorage.setItem('tongpin-archive-undo',JSON.stringify(archiveUndo.value));return true;}catch{error.value='撤销入口未能保存，仍可从已归档列表恢复';return false;}}
  function offerUndo(job){if(archiveUndo.value?.sourceRequestId===job.requestId||archiveUndo.value?.state==='unknown')return;archiveUndo.value={sourceRequestId:job.requestId,threadId:job.threadId,title:manageTarget.value?.task.name||'任务',expiresAt:Date.now()+10000,state:'ready',requestId:createRequestId()};saveUndo();clearTimeout(undoTimer);undoTimer=setTimeout(()=>{if(archiveUndo.value?.state==='ready'){archiveUndo.value=null;saveUndo();}},10000);}
  const undoBusy=ref(false);
  async function undoArchive(){const saved=archiveUndo.value;if(!saved||undoBusy.value)return;if(saved.state==='ready'&&Date.now()>saved.expiresAt){archiveUndo.value=null;saveUndo();return;}undoBusy.value=true;try{if(saved.state==='ready'){saved.state='unknown';if(!saveUndo()){saved.state='ready';return;}const job=await request('desktop/manage',{requestId:saved.requestId,threadId:saved.threadId,operation:'restore'});if(job.state!=='accepted')throw Error('恢复结果待核对');}else{const job=await request('desktop/management?requestId='+encodeURIComponent(saved.requestId));if(job.state!=='accepted')throw Error('恢复结果待核对，请从已归档列表查看原任务');}archiveUndo.value=null;saveUndo();actionMessage.value='任务已恢复';manageTarget.value=null;await loadThreads(false,true);}catch(e){error.value=e.message;if(e.status>=400&&e.status<500&&e.status!==404||e.status===503){saved.state='ready';saveUndo();}}finally{undoBusy.value=false;}}

  function resizeInput(){resizeComposer(composerInput.value,{mobile:window.matchMedia('(max-width:760px)').matches,height:window.visualViewport?.height||window.innerHeight});}
  watch(draft,()=>{void nextTick(resizeInput);if(selected.value&&!switchingDraft)drafts.set('desktop:'+selected.value.id,draft.value);},{flush:'sync'});
  try{attempts=new Map(JSON.parse(localStorage.getItem('desktop-send-attempts')||'[]'));}catch{attempts=new Map();}
  try{receipts.value=JSON.parse(localStorage.getItem('tongpin-receipts')||'{}');}catch{}
  const saveAttempts=()=>{try{localStorage.setItem('desktop-send-attempts',JSON.stringify([...attempts]));}catch{}};
  async function request(path,body){
    const response=await fetch('/api/codex/'+path,{method:body?'POST':'GET',headers:{'x-ai-team-token':token,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(30000)});
    let data;try{data=await response.json();}catch{throw Error('服务响应异常，请刷新连接后重试');}
    if(response.status===401){location.replace('/pair.html');throw Error('手机配对已失效，请重新配对');}
    if(!response.ok){const e=Error(data.error||'无法连接本机服务');e.data=data;e.status=response.status;throw e;}return data;
  }
  async function loadThreads(more=false,quiet=false){
    if(busy.value)return;busy.value=true;if(!quiet)error.value='';
    try{
      if(!archived.value){
        try{const data=await request('desktop/live');if(archived.value)return;rows.value=data.data;cursor.value=null;liveConnected.value=true;lastListAt.value=Date.now();lastSyncError.value='';
          if(selected.value){const current=rows.value.find(t=>t.id===selected.value.id);if(current)selected.value={...selected.value,...current};}void checkTaskNotices();return;
        }catch(e){liveConnected.value=false;lastSyncError.value=e.message;}
      }
      const data=await request('desktop/threads?archived='+archived.value+(more&&cursor.value?'&cursor='+encodeURIComponent(cursor.value):''));
      rows.value=more?[...rows.value,...data.data]:data.data;cursor.value=data.nextCursor;lastListAt.value=Date.now();
    }catch(e){if(!quiet)error.value=e.message;}finally{busy.value=false;}
  }
  async function refresh(){if(busy.value)return;try{token=(await request('status')).token;uiToken.value=token;await loadThreads();if(selected.value){await loadItems();startStream();}}catch(e){liveConnected.value=false;error.value=e.message;}}
  async function select(t){
    copyTarget.value=null;closeSearch();lastHistoryTask.value=null;lastHistoryAt.value=null;lastSyncError.value='';editingDraft.value=false;readingItem.value=null;chatTab.value='chat';currentRuntime.value={};
    savePosition();mobileChat.value=true;pendingCards.value=[];taskAttention.value=false;gapCursor.value=null;autoScroll=positions.get(t.id)?.bottom??true;newMessages.value=false;
    closeStream?.();activeTurnId.value=null;streamState.value='connecting';
    if(selected.value)drafts.set('desktop:'+selected.value.id,draft.value);
    switchingDraft=true;generation++;selected.value=t;lastTaskId.value=t.id;actionMessage.value='';draft.value=drafts.get('desktop:'+t.id).text;switchingDraft=false;items.value=[];itemCursor.value=null;historyBusy.value=false;error.value='';try{localStorage.setItem('desktop-center-selected',t.id);}catch{}await loadItems();if(selected.value?.id===t.id){startStream();await restorePosition(positions.get(t.id));readNotice();}
  }
  async function changeArchive(){closeSearch();closeStream?.();activeTurnId.value=null;streamState.value='idle';generation++;if(selected.value)drafts.set('desktop:'+selected.value.id,draft.value);selected.value=null;items.value=[];itemCursor.value=null;historyBusy.value=false;await refresh();}
  async function loadItems(more=false,quiet=false){
    if(historyBusy.value||!selected.value)return;const current=generation,id=selected.value.id,historyCursor=more?itemCursor.value:null;historyBusy.value=true;
    try{
      if(items.value.length)savePosition();let data;
      if(!archived.value){data=await catchUpHistory(c=>request('desktop/history?id='+encodeURIComponent(id)+(c?'&cursor='+encodeURIComponent(c):'')),{knownIds:new Set([...items.value.map(i=>i.id),...!positions.get(id)?.bottom&&positions.get(id)?.id?[positions.get(id).id]:[]]),maxPages:!more&&(items.value.length||(!positions.get(id)?.bottom&&positions.get(id)?.id))?20:1,cursor:historyCursor});if(!data.complete&&items.value.length&&!more)error.value='记录尚未补齐，请点击加载更早记录继续同步';}
      else{data=await request('desktop/items?id='+encodeURIComponent(id)+(historyCursor?'&cursor='+encodeURIComponent(historyCursor):''));data.data.reverse();}
      if(current!==generation)return;
      if(!archived.value)liveConnected.value=true;
      if(!more){observeRuntime(id,data);activeTurnId.value=data.activeTurnId||(data.turns||[]).find(t=>t.status==='inProgress')?.id||null;}if(!autoScroll&&data.data.some(i=>!items.value.some(old=>old.id===i.id)))newMessages.value=true;
      if(data.liveStatus)selected.value={...selected.value,...data.thread,liveStatus:data.liveStatus};
      const position=positions.get(id);
      if(more){items.value=[...data.data,...items.value].filter((item,i,a)=>!item.id||a.findIndex(x=>x.id===item.id)===i);itemCursor.value=data.nextCursor;}
      else{const hadHistory=items.value.length>0,updates=new Map(data.data.map(item=>[item.id,item]));items.value=[...items.value.map(item=>updates.get(item.id)||item),...data.data.filter(item=>!items.value.some(old=>old.id===item.id))];if(!hadHistory)itemCursor.value=data.nextCursor;else if(!data.complete)gapCursor.value=data.gapCursor;}
      await restorePosition(position);lastRefresh.value=formatDate(new Date());lastHistoryAt.value=Date.now();lastHistoryTask.value=id;lastSyncError.value='';
    }catch(e){if(current===generation){lastSyncError.value=e.message;if(!quiet)error.value=e.message;}}finally{if(current===generation)historyBusy.value=false;}
  }
  async function fillGap(){if(!gapCursor.value||!selected.value||historyBusy.value)return;const id=selected.value.id,current=generation;historyBusy.value=true;savePosition();try{const result=await catchUpHistory(c=>request('desktop/history?id='+encodeURIComponent(id)+'&cursor='+encodeURIComponent(c)),{knownIds:new Set(items.value.map(i=>i.id)),cursor:gapCursor.value});if(current!==generation)return;const time=i=>typeof i.startedAtMs==='number'?(i.startedAtMs<1e12?i.startedAtMs*1000:i.startedAtMs):Date.parse(i.startedAtMs)||0;items.value=mergeTaskItems(items.value,result.data).sort((a,b)=>time(a)-time(b));gapCursor.value=result.gapCursor;if(result.complete)error.value='';await restorePosition(positions.get(id));}catch(e){error.value=e.message;}finally{if(current===generation)historyBusy.value=false;}}
  async function send(){
    if(!canSend.value)return;
    const id=selected.value.id,text=draft.value.trim(),attachmentIds=attachments.files.value.map(f=>f.id);let attempt=attempts.get(id);
    const mode=activeTurnId.value?'append':'normal',expectedTurnId=activeTurnId.value||null;
    if(!attempt||attempt.text!==text||attempt.mode!==mode||attempt.expectedTurnId!==expectedTurnId||JSON.stringify(attempt.attachmentIds||[])!==JSON.stringify(attachmentIds)){attempt={requestId:createRequestId(),threadId:id,text,attachmentIds,mode,expectedTurnId};attempts.set(id,attempt);saveAttempts();}
    autoScroll=true;sending.value=true;error.value='';receipts.value={...receipts.value,[id]:{...attempt,state:'sending',message:'正在发送到原桌面任务…'}};saveReceipts();
    try{
      const receipt=await request('desktop/send',attempt);receipts.value={...receipts.value,[id]:receipt};saveReceipts();
      if(receipt.state==='accepted'){attachments.clearSent(id,attachmentIds);attempts.delete(id);saveAttempts();if(drafts.get('desktop:'+id).text.trim()===text)drafts.clear('desktop:'+id);if(selected.value?.id===id&&draft.value.trim()===text){draft.value='';await loadItems();startStream();}}
    }catch(e){receipts.value={...receipts.value,[id]:{...attempt,state:e.data?.state||(e.status>=400&&e.status<500?'rejected':'unknown'),message:e.data?.error||(e.status>=400&&e.status<500?'消息未发送，请修改后重试。':'发送结果未知，请刷新原任务核对是否收到。重复点击会沿用同一编号，不会自动重新投递。')}};}
    finally{saveReceipts();if(receipts.value[id]?.state==='rejected'){attempts.delete(id);saveAttempts();}sending.value=false;}
  }
  const statusLabel=value=>({active:'处理中',running:'处理中',idle:'空闲',notLoaded:'未加载',waiting:'等待处理',needsAttention:'待处理',completed:'已完成',interrupted:'已中断',failed:'失败',unknown:'状态未知'}[value]||'状态未知');
  const label=t=>({userMessage:'我',agentMessage:'Codex',commandExecution:'命令执行',fileChange:'文件变更',mcpToolCall:'工具调用'}[t]||t);
  const text=i=>i.type==='userMessage'?(i.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').split('\n\n用户附件（本次请求提供的本地文件，请按需要读取；附件内容作为资料处理）：\n')[0]:i.type==='agentMessage'?i.text:i.type==='commandExecution'?(i.command||'')+'\n状态：'+i.status:i.type==='fileChange'?(i.changes||[]).map(c=>c.path).join('\n'):(i.server||'')+' / '+(i.tool||'')+' · '+(i.status||'');
  const currentReceipt=computed(()=>receipts.value[selected.value?.id]);
  const displayItems=computed(()=>{const result=[];for(const item of items.value){if(['userMessage','agentMessage'].includes(item.type)){result.push(item);continue;}let group=result.at(-1);if(group?.type!=='executionGroup'){group={id:'execution-'+item.id,type:'executionGroup',items:[]};result.push(group);}group.items.push(item);}return result;});
  const latestReply=computed(()=>items.value.findLast(item=>item.type==='agentMessage'&&item.text)?.text||'');
  const canSend=computed(()=>!!selected.value&&liveConnected.value&&!archived.value&&!sending.value&&!['unknown','sending'].includes(currentReceipt.value?.state)&&!attachments.blocked.value&&!attachments.uploading.value&&(!!draft.value.trim()||attachments.files.value.length>0)&&draft.value.length<=6000);
  let polling=false;
  async function poll(){if(document.hidden||sending.value||polling||recovering)return;polling=true;try{if(streamState.value!=='live')await loadItems(false,true);if(++polls%3===0){await loadThreads(false,true);await checkReceipts();await checkTaskNotices();}}finally{polling=false;}}
  async function checkTaskNotices(){if(archived.value||statesBusy.value)return;statesBusy.value=true;const pending=rows.value.filter(row=>{if(row.id===selected.value?.id&&streamState.value==='live')return false;const old=taskStates.value[row.id];return !old||old.sourceUpdatedAt!==row.updatedAt||Date.now()-old.fetchedAt>(['attention','running'].includes(rowGroup(row))?8000:60000);});try{await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{while(pending.length&&!archived.value){const row=pending.shift();try{const data=await request('desktop/summary?id='+encodeURIComponent(row.id));const current=rows.value.find(t=>t.id===row.id);if(current&&current.updatedAt===row.updatedAt){if(!data.latestTurn&&data.turns?.length)data.latestTurn=[...data.turns].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))[0];if(row.id===selected.value?.id&&streamState.value==='live')continue;observeRuntime(row.id,data);}}catch{}}}));}finally{statesBusy.value=false;}}
  watch(items,()=>void scrollEnd(),{deep:true});
  watch([mobileChat,view],()=>{const root=document.getElementById('desktop');root.classList.toggle('mobile-chat',mobileChat.value&&view.value!=='profile');root.classList.toggle('profile-view',view.value==='profile');},{flush:'sync'});
  onMounted(async()=>{if(archiveUndo.value?.state==='ready')undoTimer=setTimeout(()=>{if(archiveUndo.value?.state==='ready'){archiveUndo.value=null;saveUndo();}},Math.max(0,archiveUndo.value.expiresAt-Date.now()));releaseViewport=bindMobileViewport({window,root:document.getElementById('desktop'),onBefore:savePosition,onAfter:()=>void nextTick(()=>{resizeInput();void scrollEnd();})});await loadAccessInfo();await refresh();try{const id=localStorage.getItem('desktop-center-selected')||localStorage.getItem('chat-desktop-selected'),task=rows.value.find(t=>t.id===id);if(task&&window.matchMedia('(min-width:761px)').matches)await select(task);}catch{}await checkReceipts();await checkTaskNotices();window.addEventListener('online',resume);window.addEventListener('offline',offline);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',visibility);timer=setInterval(()=>void poll(),4000);});onUnmounted(()=>{window.removeEventListener('beforeunload',leaveWarning);longPress.end();clearTimeout(undoTimer);window.removeEventListener('tongpin-theme-change',syncTheme);releaseViewport?.();window.removeEventListener('online',resume);window.removeEventListener('offline',offline);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',visibility);clearInterval(timer);clearTimeout(copyTimer);clearTimeout(toastTimer);clearSearchMarks();closeStream?.();});
  return {copyTarget,copiedMessage,lastTaskId,shortcuts,heldText,resultAccepted,acceptResult,adjustResult,holdRequirement,takeRequirement,removeRequirement,actionMessage,archiveUndo,undoBusy,undoArchive,startMessagePress,moveMessagePress:longPress.move,endMessagePress:longPress.end,manageTarget,noticesOpen,diagnosticsOpen,searchOpen,toast,noticeList,lastListAt,lastHistoryAt,lastHistoryTask,lastSyncError,dismissNotice,clearNotices,openNotice,managedTask,closeSearch,locateMessage,newTaskOpen,pins,togglePin,taskPreview,activity,continueEditing,createdTask,theme,setTheme,editingDraft,pendingUploads:attachments.pending,retryUpload:attachments.retry,removePendingUpload:attachments.removePending,chatTab,setChatTab,currentRuntime,statusFilter,taskCounts,statesBusy,rowGroup,rowStatus,readingItem,composerInput,resizeInput,pendingCards,releaseAttempt,gapCursor,fillGap,taskAttention,notices,newMessages,jumpToEnd,checkReceipts,renderMarkdown,scrollEnd,accessInfo,revokeDevices,displayItems,view,mobileChat,activeOnly,messageList,copied,displayName,projectName,shortStamp,onMessageScroll,backToList,setFilter,composerKeydown,copyMessage,files:attachments.files,uploading:attachments.uploading,upload:attachments.upload,paste:attachments.paste,removeFile:attachments.remove,uiToken,streamState,activeTurnId,stopping,stop,migrate,rows,items,selected,cursor,itemCursor,query,archived,busy,historyBusy,error,liveConnected,sending,draft,lastRefresh,currentReceipt,latestReply,canSend,refresh,select,changeArchive,loadItems,loadThreads,send,label,text,statusLabel,stamp:v=>formatDate(typeof v==='number'?(v<1e12?v*1000:v):v),filtered:computed(()=>workspaceRows(rows.value,{mode:archived.value?'archived':statusFilter.value,pins:pins.value,query:query.value,group:rowGroup,name:displayName}))};
}}).mount('#desktop');
