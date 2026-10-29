import { formatDate, routeMessage } from './domain.mjs';
import {useDesktopChat,createDraftStore} from './chat-desktop.mjs';
import {AttachmentBar} from './attachments-ui.mjs';
const { createApp, ref, computed, watch, nextTick, onMounted, reactive } = window.Vue;
const paths = {
  chat:'M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  task:'M9 5H5v16h14V5h-4 M9 3h6v4H9V3z M8 13l2 2 5-5',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3z',
  search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  plus:'M12 5v14 M5 12h14', close:'M6 6l12 12 M18 6 6 18',
  group:'M3 3h7v7H3V3z M14 3h7v7h-7V3z M3 14h7v7H3v-7z M14 14h7v7h-7v-7z',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7h.01',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  shield:'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4z M8 12l3 3 5-6',
  panel:'M3 4h18v16H3V4z M15 4v16 M18 8h.01 M18 12h.01',
  pin:'M9 3h6l-1 5 4 4v2H6v-2l4-4-1-5z M12 14v7',
  file:'M5 2h9l5 5v15H5V2z M14 2v6h5 M8 12h8 M8 16h6',
  arrow:'M5 12h14 M14 7l5 5-5 5',back:'M15 5l-7 7 7 7',
  send:'M22 2 9 15 M22 2l-8 20-5-7-7-5L22 2z',
  clip:'M21 11 11 21a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L9 19a2 2 0 0 1-3-3l10-10',
  layers:'m12 2 10 6-10 6L2 8l10-6z M2 12l10 6 10-6 M2 16l10 6 10-6',
  bot:'M5 7h14v13H5V7z M12 3v4 M10 3h4 M2 11v5 M22 11v5 M9 12h.01 M15 12h.01 M9 16h6'
};
const members = [
  {id:'local',name:'我的 Codex',initial:'C',role:'本机任务与文字问答',project:'真实接入',status:'offline',color:'blue',real:true}
];
const conversations = [
  {id:'local',name:'我的 Codex',type:'direct',memberId:'local'}
];
const STORAGE='tongpin-demo-v1';
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2);
const iso = () => new Date().toISOString();
function initialMessages() {
  return {local:[]};
}
function load() {
  try {
    const data=JSON.parse(localStorage.getItem(STORAGE));
    if (!data || data.version!==1 || typeof data.messages!=='object' || !Array.isArray(data.tasks)) return null;
    for (const c of conversations) {
      if(c.id==='local' && !data.messages.local) data.messages.local=[];
      if (!Array.isArray(data.messages[c.id]) || !data.messages[c.id].every(m=>typeof m.text==='string' && typeof m.sender==='string' && typeof m.id==='string')) return null;
    }
    data.messages=Object.fromEntries(conversations.map(c=>[c.id,data.messages[c.id]]));
    data.tasks=data.tasks.filter(t=>typeof t.text==='string' && members.some(m=>m.id===t.memberId) && conversations.some(c=>c.id===t.conversationId));
    return data;
  } catch { return null; }
}

const TaskPicker={
  props:['rows','selected','disabled','statusText'],emits:['choose'],
  data:()=>({open:false,query:''}),
  computed:{
    current(){return this.rows.find(t=>t.id===this.selected);},
    matches(){const q=this.query.trim().toLocaleLowerCase();return this.rows.filter(t=>[t.name,t.projectDirectory,t.cwd].filter(Boolean).join(' ').toLocaleLowerCase().includes(q));}
  },
  mounted(){this.outside=e=>{if(!this.$el.contains(e.target))this.open=false;};document.addEventListener('pointerdown',this.outside);},
  beforeUnmount(){document.removeEventListener('pointerdown',this.outside);},
  watch:{disabled(value){if(value)this.open=false;}},
  methods:{
    toggle(){this.open=!this.open;if(this.open){this.query='';this.$nextTick(()=>this.$refs.search.focus());}},
    close(){this.open=false;this.$refs.trigger.focus();},
    choose(id){this.$emit('choose',id);this.close();},
    move(event){const items=[...this.$el.querySelectorAll('.task-choice')];if(!items.length)return;const i=items.indexOf(document.activeElement);items[(i+(event.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();}
  },
  template:`<div class="task-picker" @keydown.esc.stop.prevent="close" @keydown.down.prevent="move" @keydown.up.prevent="move">
    <button ref="trigger" class="task-picker-trigger" type="button" aria-label="对话任务" aria-haspopup="dialog" :aria-expanded="open" :disabled="disabled" @click="toggle"><span class="task-trigger-name">{{current?.name||'独立文字问答'}}</span><span class="task-trigger-status" v-if="current">{{statusText(current.liveStatus)}}</span><svg class="task-picker-chevron" aria-hidden="true" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5"/></svg></button>
    <section v-if="open" class="task-picker-panel" role="dialog" aria-label="选择对话任务">
      <header><strong>切换对话任务</strong><button type="button" aria-label="关闭任务选择" @click="close">×</button></header>
      <input ref="search" v-model="query" type="search" placeholder="搜索任务名称或目录" aria-label="搜索任务" autocomplete="off">
      <div class="task-picker-list"><button type="button" class="task-choice standalone-choice" :class="{selected:!selected}" :aria-pressed="!selected" @click="choose('')"><span class="task-choice-copy"><strong>独立文字问答</strong><span>开始独立问答，不关联已有任务</span></span><span v-if="!selected" aria-hidden="true">✓</span></button>
      <p class="task-picker-caption">已有任务 · {{matches.length}}</p>
      <button type="button" v-for="t in matches" :key="t.id" class="task-choice" :class="{selected:t.id===selected}" :aria-pressed="t.id===selected" @click="choose(t.id)"><span class="task-choice-copy"><strong :title="t.name">{{t.name}}</strong><span :title="t.projectDirectory||t.cwd">{{t.projectDirectory||t.cwd||'未关联项目目录'}}</span></span><span class="task-choice-state">{{statusText(t.liveStatus)}}</span><span v-if="t.id===selected" aria-hidden="true">✓</span></button>
      <p v-if="!matches.length" class="task-picker-empty">没有匹配的任务，试试其他关键词</p></div>
    </section></div>`
};
createApp({
  components:{TaskPicker,AttachmentBar,icon:{props:['name'],template:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="path"/></svg>',computed:{path(){return paths[this.name]||paths.info;}}}},
  setup() {
    const teamMembers=reactive(members);
    const bridge=ref({enabled:false,ready:false,busy:false,error:'',model:''});
    let bridgeToken='',statusTimer;const realPolls=new Map();
    const saved=load();
    const messages=ref(saved?.messages || initialMessages());
    const tasks=ref((saved?.tasks || []).map(t=>t.state==='running'&&!t.real?{...t,state:'queued'}:t));
    let initialConversation='local';try{const previous=localStorage.getItem('chat-active-conversation');if(conversations.some(c=>c.id===previous))initialConversation=previous;}catch{}
    const activeId=ref(initialConversation),view=ref('chats'),filter=ref('all'),search=ref(''),draft=ref('');
    const modal=ref(''),toast=ref(''),showDetails=ref(window.innerWidth>1050),mobileChat=ref(false);
    const messageArea=ref(null),editor=ref(null),dialog=ref(null),composerFocused=ref(false);
    const historySearch=ref(false),messageSearch=ref(''),quote=ref('');
    const mentionOpen=ref(false),mentionQuery=ref(''),mentionIndex=ref(0),mentionStart=ref(-1);
    const storageAvailable=ref(true),demoEnabled=ref(saved?.demoEnabled!==false),draftReady=ref(false);
    const typing=ref({});let toastTimer,switchingDraft=false,draftStorageFailed=false;const timers=new Map();
    const draftStore=createDraftStore(localStorage,()=>{if(!draftStorageFailed){draftStorageFailed=true;notify('草稿保存不可用，请在刷新前复制输入内容');}});
    const member=id=>teamMembers.find(m=>m.id===id)||{name:'未知成员',initial:'?',color:'blue',status:'offline',role:'未知'};
    const current=computed(()=>conversations.find(c=>c.id===activeId.value));
    const statusText=s=>({online:'可接任务',busy:'处理中',offline:'离线',paused:'已暂停'}[s]||'未知');
    const taskLabel=(s,real=false)=>(real?{done:'已完成',running:'处理中',queued:'等待处理',failed:'失败'}:{done:'演示已完成',running:'演示处理中',queued:'等待处理',failed:'失败'})[s]||'等待处理';
    const filteredConversations=computed(()=>conversations.filter(c=>(filter.value==='all'||filter.value===c.type)&&c.name.includes(search.value.trim())));
    const filteredMembers=computed(()=>teamMembers.filter(m=>(m.name+m.role+m.project).includes(search.value.trim())));
    const filteredTasks=computed(()=>tasks.value.filter(t=>t.text.includes(search.value.trim())).slice().reverse());
    const currentTasks=computed(()=>tasks.value.filter(t=>t.conversationId===activeId.value));
    const pendingTasks=computed(()=>tasks.value.filter(t=>['queued','running'].includes(t.state)).length);
    const availableCount=computed(()=>teamMembers.filter(m=>m.status==='online').length);
    const visibleMembers=computed(()=>current.value.type==='group'?teamMembers:[member(current.value.memberId)]);
    const desktop=useDesktopChat(window.Vue,{getToken:()=>bridgeToken,enabled:()=>activeId.value==='local',scroll,notify});
    const {rows:desktopRows,selectedId:desktopId,connected:desktopConnected,loading:desktopLoading,sending:desktopSending,notice:desktopNotice,cursor:desktopCursor,task:desktopTask,lastRequestId:desktopRequestId}=desktop;
    watch([desktopConnected,()=>desktopTask.value?.liveStatus],()=>{member('local').status=desktopConnected.value?(desktopTask.value?.liveStatus==='active'?'busy':'online'):bridge.value.ready?(bridge.value.busy?'busy':'online'):'offline';});
    const draftKey=()=>activeId.value==='local'&&desktopId.value?'desktop:'+desktopId.value:'conversation:'+activeId.value;
    const restoreDraft=()=>{const saved=draftStore.get(draftKey());draft.value=saved.text;quote.value=saved.quote;};
    watch([draft,quote],()=>{if(!switchingDraft)draftStore.set(draftKey(),draft.value,quote.value);},{flush:'sync'});
    const desktopMessages=computed(()=>realConversation.value&&!!desktopId.value);
    const shownMessages=computed(()=>(desktopMessages.value?desktop.messages.value:messages.value[activeId.value]||[]).filter(m=>m.text.includes(messageSearch.value)));
    const activeTyping=computed(()=>desktopMessages.value?(desktopTask.value?.liveStatus==='active'?'原桌面任务':''):Object.values(typing.value[activeId.value]||{}).join('、'));
    const mentionCandidates=computed(()=>teamMembers.filter(m=>m.name.includes(mentionQuery.value)||m.role.includes(mentionQuery.value)));
    const realConversation=computed(()=>current.value.memberId==='local');
    const connectionBanner=computed(()=>desktopConnected.value?'已连接桌面 Codex。在“我的 Codex”中选择原任务，直接使用下方输入框继续对话。其他成员仍为演示。':bridge.value.ready?'本机文字问答已连接；桌面任务连接暂不可用，请点击刷新任务。':'我的 Codex 尚未连接。其他成员状态与自动回复仍为演示；点击“接入 Codex”连接本机。');
    const modalTitle=computed(()=>({connect:'连接团队的 Codex',new:'发起对话',settings:'空间设置',reset:'重置演示记录',rules:'团队协作约定',notice:'消息通知',files:'文件共享',sample:'接口字段样例'}[modal.value]||''));
    function notify(text){toast.value=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',3500);}
    async function refreshBridge(){
      try{const response=await fetch('./api/codex/status',{cache:'no-store'});if(!response.ok){bridge.value={enabled:false,ready:false,busy:false,error:'当前为静态演示服务，请使用 -Codex 启动接入服务（端口 4188）。'};return;}
        const data=await response.json();bridgeToken=data.token;delete data.token;bridge.value=data;
      }catch{bridge.value={enabled:false,ready:false,busy:false,error:'无法连接本机服务，请检查启动窗口。'};}
      finally{member('local').status=desktopConnected.value?'online':bridge.value.ready?(bridge.value.busy?'busy':'online'):'offline';}
    }
    async function apiPost(path,body={}){const response=await fetch('./api/codex/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-AI-Team-Token':bridgeToken},body:JSON.stringify(body)});let data;try{data=await response.json();}catch{throw Error('接入服务未返回有效数据，请刷新页面。');}if(!response.ok)throw Error(data.error||'Codex 请求失败');return data;}
    const connecting=ref(false);
    async function chooseDesktopTask(id){draftStore.set(draftKey(),draft.value,quote.value);switchingDraft=true;const loading=desktop.select(id);restoreDraft();messageSearch.value='';switchingDraft=false;await loading;}
    async function refreshDesktop(){await refreshBridge();await desktop.refresh();if(desktopId.value)await desktop.loadHistory();}
    async function sendDesktop(){const id=desktopId.value,text=(quote.value?'引用消息（仅作为上下文）：\n'+quote.value+'\n\n':'')+draft.value.trim(),original=draft.value;if(await desktop.send(text)){const saved=draftStore.get('desktop:'+id);if(saved.text===original)draftStore.clear('desktop:'+id);if(activeId.value==='local'&&desktopId.value===id&&draft.value===original){draft.value='';quote.value='';}}}
    async function connectCodex(){if(connecting.value)return;connecting.value=true;try{await refreshBridge();if(!bridge.value.enabled)throw Error(bridge.value.error);await apiPost('connect');await refreshBridge();notify('本机 Codex 已连接，可以开始文字问答。');openDirect(member('local'));modal.value='';}catch(error){notify(error.message);await refreshBridge();}finally{connecting.value=false;}}
    async function pollReal(task){
      if(realPolls.has(task.id))return;realPolls.set(task.id,true);
      try{
        const response=await fetch('./api/codex/jobs/'+encodeURIComponent(task.id),{cache:'no-store'});const job=await response.json();
        if(!response.ok)throw Error(job.error||'任务状态查询失败');
        if(job.state==='running'){realPolls.delete(task.id);const timer=setTimeout(()=>{realPolls.delete(task.id);pollReal(task);},900);realPolls.set(task.id,timer);return;}
        task.state=job.state;
        if(!messages.value[task.conversationId].some(m=>m.requestId===task.id)){
          if(job.state==='done')add(task.conversationId,{sender:'local',text:job.answer,real:true,requestId:task.id});
          else add(task.conversationId,{sender:'system',text:job.error||'真实 Codex 请求失败，请手动重发。',requestId:task.id});
        }
        delete typing.value[task.conversationId]?.[task.id];realPolls.delete(task.id);await refreshBridge();persist();
      }catch(error){realPolls.delete(task.id);task.state='failed';delete typing.value[task.conversationId]?.[task.id];add(task.conversationId,{sender:'system',text:'Codex 任务状态未知：'+error.message+' 请确认后手动重发，系统不会自动重复调用。',requestId:task.id});persist();}
    }
    async function startReal(cid,text){const task={id:uid(),conversationId:cid,memberId:'local',text,createdAt:iso(),state:'running',real:true};tasks.value.push(task);const live=tasks.value.find(t=>t.id===task.id);if(!typing.value[cid])typing.value[cid]={};typing.value[cid][task.id]='我的 Codex';member('local').status='busy';try{await apiPost('jobs',{id:task.id,conversationId:cid,text});pollReal(live);}catch(error){live.state='failed';delete typing.value[cid]?.[task.id];add(cid,{sender:'system',text:'真实 Codex 请求未完成：'+error.message,requestId:task.id});await refreshBridge();}}
    function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({version:1,messages:messages.value,tasks:tasks.value,demoEnabled:demoEnabled.value}));storageAvailable.value=true;}catch{if(storageAvailable.value)notify('浏览器存储不可用，当前消息仅保留到页面关闭');storageAvailable.value=false;}}
    watch([messages,tasks,demoEnabled],persist,{deep:true});
    watch(modal,async value=>{if(value){await nextTick();dialog.value?.focus();}});
    watch(demoEnabled,value=>{if(!value){for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const [cid,entries] of Object.entries(typing.value)){for(const id of Object.keys(entries)){if(!tasks.value.find(t=>t.id===id)?.real)delete typing.value[cid][id];}}tasks.value.forEach(t=>{if(t.state==='running'&&!t.real)t.state='queued';});}});
    async function scroll(follow=false){const area=messageArea.value;if(follow&&area&&area.scrollHeight-area.scrollTop-area.clientHeight>100)return;await nextTick();if(messageArea.value)messageArea.value.scrollTop=messageArea.value.scrollHeight;}
    function select(id){draftStore.set(draftKey(),draft.value,quote.value);switchingDraft=true;activeId.value=id;restoreDraft();switchingDraft=false;try{localStorage.setItem('chat-active-conversation',id);}catch{}mentionOpen.value=false;messageSearch.value='';historySearch.value=false;mobileChat.value=true;if(window.innerWidth<1050)showDetails.value=false;scroll();}
    function openDirect(m){view.value='chats';filter.value='all';search.value='';select(m.id);}
    function preview(id){const list=messages.value[id]||[];const msg=list[list.length-1];return msg?msg.text.replace(/\n/g,' '):'开始一段新的协作';}
    function lastTime(id){const list=messages.value[id]||[];return list.length?formatDate(list[list.length-1].createdAt).slice(11,16):'';}
    function mentionParts(text){const escaped=members.map(m=>m.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));return text.split(new RegExp('(@(?:'+escaped.join('|')+'))','g'));}
    async function insertAt(){await nextTick();const el=editor.value;const pos=el?.selectionStart??draft.value.length;draft.value=draft.value.slice(0,pos)+'@'+draft.value.slice(pos);await nextTick();el?.focus();el?.setSelectionRange(pos+1,pos+1);updateMention();}
    function updateMention(){const pos=editor.value?.selectionStart??draft.value.length;const before=draft.value.slice(0,pos);const idx=before.lastIndexOf('@');const query=before.slice(idx+1);mentionOpen.value=idx>=0&&!query.includes('\n')&&!members.some(m=>before.slice(idx).startsWith('@'+m.name+' '))&&query.length<=16;mentionQuery.value=query;mentionStart.value=idx;mentionIndex.value=0;}
    async function chooseMention(m){const pos=editor.value?.selectionStart??draft.value.length;const start=mentionStart.value>=0?mentionStart.value:pos;draft.value=draft.value.slice(0,start)+'@'+m.name+' '+draft.value.slice(pos);mentionOpen.value=false;await nextTick();editor.value?.focus();const end=start+m.name.length+2;editor.value?.setSelectionRange(end,end);}
    async function chooseMember(m){draft.value+=(draft.value&&!draft.value.endsWith(' ')?' ':'')+'@'+m.name+' ';await nextTick();editor.value?.focus();}
    async function usePrompt(topic){const who=current.value.type==='group'?'@小王的 AI ':'';draft.value=who+(topic==='接口字段'?(realConversation.value?'请解释设计楼宇查询接口时，请求参数和返回字段应该关注什么。':'请帮我核对楼宇查询接口的请求参数和返回字段。'):'请帮我整理代码评审需要关注的问题清单。');await nextTick();editor.value?.focus();}
    async function quoteMessage(msg){quote.value=(msg.sender==='me'?'我':member(msg.sender).name)+'：'+msg.text.slice(0,150);await nextTick();editor.value?.focus();}
    function onKeydown(event){if(event.isComposing||event.keyCode===229)return;if(mentionOpen.value){if(event.key==='Escape'){mentionOpen.value=false;event.preventDefault();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){const n=mentionCandidates.value.length;mentionIndex.value=n?(mentionIndex.value+(event.key==='ArrowDown'?1:-1)+n)%n:0;event.preventDefault();return;}if(event.key==='Enter'&&!event.shiftKey&&mentionCandidates.value.length){event.preventDefault();chooseMention(mentionCandidates.value[mentionIndex.value]||mentionCandidates.value[0]);return;}}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}}
    function add(cid,msg){messages.value[cid].push({id:uid(),createdAt:iso(),...msg});if(cid===activeId.value)scroll();}
    function replyFor(m,text){if(m.id==='wang')return text.includes('接口')||text.includes('字段')?'这条请求可以按「请求参数 → 返回字段 → 空值与异常 → 导出口径」逐项核对。\n正式接入后，我会读取主人授权的后端项目，并返回可核对的文件路径和字段差异。\n当前为演示回复，没有读取真实代码。':'建议先明确涉及的接口、预期行为和实际结果，再定位对应的处理逻辑。\n正式接入后可核对授权项目中的代码；当前没有访问项目文件。';if(m.id==='li')return '前端可以先检查三项：\n1. 查询条件与接口参数是否对应。\n2. 空值、错误和加载状态是否完整。\n3. 日期是否统一格式化，列表与导出条件是否一致。\n这是一条演示回复，没有修改真实页面。';return '建议验收至少覆盖：正常数据、无数据、参数边界、权限限制和接口异常。\n正式接入后可根据实际需求整理清单；当前没有执行任何测试。';}
    function send(){if(!draft.value.trim()&&!(desktopMessages.value&&desktop.files.value.length))return;if(desktopMessages.value){if(!desktopSending.value)void sendDesktop();return;}let routed;try{routed=routeMessage(draft.value,current.value,teamMembers);}catch(e){notify(e.message);return;}if(routed.targets.includes('local')&&!bridge.value.ready){modal.value='connect';notify('请先连接本机 Codex，输入内容已保留。');return;}const cid=activeId.value;add(cid,{sender:'me',text:routed.text,quote:quote.value});const realText=(quote.value?'引用消息（仅作为上下文）：\n'+quote.value+'\n\n':'')+routed.text;draft.value='';quote.value='';mentionOpen.value=false;
      for(const id of routed.targets){const m=member(id);if(m.real){startReal(cid,realText);continue;}const waiting=routed.queued.includes(id)||!demoEnabled.value;const task={id:uid(),conversationId:cid,memberId:id,text:routed.text,createdAt:iso(),state:waiting?'queued':'running'};tasks.value.push(task);
        if(waiting){add(cid,{sender:'system',text:!demoEnabled.value?'尚未接入 Codex，任务仅记录在本机，等待接入。':`${m.name} 当前离线（示例），请求已记入本机等待列表。`});continue;}
        if(!typing.value[cid])typing.value[cid]={};typing.value[cid][task.id]=m.name;
        const timer=setTimeout(()=>{timers.delete(task.id);if(!demoEnabled.value)return;add(cid,{sender:id,text:replyFor(m,routed.text),demo:true});task.state='done';// update the reactive task through its proxy
          const live=tasks.value.find(t=>t.id===task.id);if(live)live.state='done';delete typing.value[cid]?.[task.id];persist();scroll();},m.status==='busy'?2600:1500);timers.set(task.id,timer);
      }
      if(!routed.targets.length&&current.value.type==='group')notify('消息已保存。@一位 AI 同事可体验任务处理。');scroll();
    }
    function reset(){if(tasks.value.some(t=>t.real&&t.state==='running')){notify('真实 Codex 任务仍在运行，请等待结束后再重置。');return;}for(const timer of timers.values())clearTimeout(timer);timers.clear();typing.value={};messages.value=initialMessages();tasks.value=[];draft.value='';quote.value='';demoEnabled.value=true;modal.value='';persist();scroll();notify('已恢复初始演示记录');}
    onMounted(async()=>{persist();scroll();await refreshBridge();await desktop.refresh();switchingDraft=true;try{const id=localStorage.getItem('chat-desktop-selected');if(id&&desktopRows.value.some(t=>t.id===id))await desktop.select(id);}catch{}restoreDraft();switchingDraft=false;draftReady.value=true;statusTimer=setInterval(refreshBridge,7000);if(bridge.value.enabled){for(const task of tasks.value.filter(t=>t.real&&t.state==='running'))pollReal(task);}});
    return {desktopFiles:desktop.files,desktopUploading:desktop.uploading,uploadDesktopFiles:desktop.upload,pasteDesktopFiles:desktop.paste,removeDesktopFile:desktop.remove,desktopToken:desktop.token,desktopStreamState:desktop.streamState,desktopTurnId:desktop.activeTurnId,desktopStopping:desktop.stopping,stopDesktop:desktop.stop,migrateDirectory:desktop.migrateDirectory,notify,draftReady,desktopRequestId,checkDesktopReceipt:desktop.checkReceipt,desktopRows,desktopId,desktopConnected,desktopLoading,desktopSending,desktopNotice,desktopCursor,desktopTask,desktopMessages,chooseDesktopTask,refreshDesktop,loadDesktopHistory:desktop.loadHistory,desktopStatusText:desktop.statusText,members:teamMembers,bridge,connecting,realConversation,connectionBanner,refreshBridge,connectCodex,conversations,formatDate,member,statusText,taskLabel,messages,tasks,activeId,view,filter,search,draft,modal,toast,showDetails,mobileChat,messageArea,editor,dialog,composerFocused,historySearch,messageSearch,quote,mentionOpen,mentionIndex,mentionCandidates,storageAvailable,demoEnabled,current,filteredConversations,filteredMembers,filteredTasks,currentTasks,pendingTasks,availableCount,visibleMembers,shownMessages,activeTyping,modalTitle,select,openDirect,preview,lastTime,mentionParts,insertAt,updateMention,chooseMention,chooseMember,usePrompt,quoteMessage,onKeydown,send,reset};
  }
}).mount('#app');
