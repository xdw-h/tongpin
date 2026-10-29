import {UploadQueue} from './upload-queue.mjs';
import {pendingStorage} from './upload-storage.mjs';
import {uploadFile} from './upload-transport.mjs';
export function useAttachments(Vue,{threadId,getToken,notify}){
 const {ref,watch,computed}=Vue,files=ref([]),pending=ref([]),uploading=ref(false),restoring=ref(true);let saved={},warned=false,queue;
 try{saved=JSON.parse(localStorage.getItem('tongpin-attachments-v1')||'{}');}catch{}
 const persist=()=>{try{localStorage.setItem('tongpin-attachments-v1',JSON.stringify(saved));}catch{notify('附件草稿保存失败，请保持页面打开');}};
 const update=()=>{if(!queue)return;pending.value=queue.entries(threadId.value);uploading.value=pending.value.some(r=>r.status==='uploading');};
 queue=new UploadQueue({storage:pendingStorage(),send:(file,options)=>uploadFile(file,{...options,getToken}),completedCount:id=>(saved[id]||[]).length,isComplete:(id,fileId)=>(saved[id]||[]).some(f=>f.id===fileId),onChange:update,onStorageError:()=>{if(!warned){warned=true;notify('浏览器无法保存待上传文件，刷新前请重试或移除附件');}},onComplete:(id,file)=>{const next=[...(saved[id]||[]).filter(f=>f.id!==file.id),file];saved[id]=next;if(threadId.value===id)files.value=next;persist();}});
 queue.ready.finally(()=>{restoring.value=false;update();});
 watch(threadId,id=>{files.value=Array.isArray(saved[id])?saved[id]:[];update();},{immediate:true});
 watch(files,value=>{if(threadId.value){saved[threadId.value]=value;persist();}},{deep:true,flush:'sync'});
 async function upload(input){const id=threadId.value;if(!id){notify('请先选择已有任务，再添加附件');return;}try{const ids=await queue.add(id,input);await queue.run(id,ids);}catch(e){notify(e.message);}}
 function paste(event){const incoming=Array.from(event.clipboardData?.files||[]);if(incoming.length){event.preventDefault();void upload(incoming);}}
 function remove(id){files.value=files.value.filter(f=>f.id!==id);}
 function clearSent(id,ids){const next=(saved[id]||[]).filter(f=>!ids.includes(f.id));saved[id]=next;if(threadId.value===id)files.value=next;else persist();}
 return {files,pending,uploading,hasUnsent:computed(()=>{files.value;pending.value;return queue.rows.size>0||Object.values(saved).some(value=>Array.isArray(value)&&value.length>0);}),blocked:computed(()=>restoring.value||pending.value.length>0),upload,paste,remove,clearSent,retry:id=>queue.run(threadId.value,[id]),removePending:id=>queue.remove(threadId.value,id)};
}
export const UploadPending={props:['rows'],emits:['retry','remove'],data:()=>({urls:{}}),watch:{rows:{immediate:true,deep:true,handler(rows){const ids=new Set((rows||[]).map(r=>r.id));for(const [id,url] of Object.entries(this.urls))if(!ids.has(id)){URL.revokeObjectURL(url);delete this.urls[id];}for(const row of rows||[])if(row.file?.type?.startsWith('image/')&&!this.urls[row.id])this.urls[row.id]=URL.createObjectURL(row.file);}}},beforeUnmount(){for(const url of Object.values(this.urls))URL.revokeObjectURL(url);},template:`<div v-if="rows?.length" class="upload-pending" aria-label="待上传附件"><article v-for="row in rows" :key="row.id" class="upload-row"><img v-if="urls[row.id]" :src="urls[row.id]" :alt="row.name"><div class="upload-copy"><strong>{{row.name}}</strong><small v-if="row.status==='uploading'">{{row.progress>=100?'正在确认上传结果…':'上传中 '+row.progress+'%'}}</small><small v-else-if="row.status==='failed'" class="upload-error">{{row.error}}</small><small v-else>等待上传</small><progress v-if="row.status==='uploading'" max="100" :value="row.progress" :aria-label="row.name+'上传进度'"></progress></div><button v-if="row.status==='failed'" type="button" @click="$emit('retry',row.id)" :aria-label="'重试上传 '+row.name">重试</button><button type="button" @click="$emit('remove',row.id)" :aria-label="(row.status==='uploading'?'取消上传 ':'移除待上传附件 ')+row.name">{{row.status==='uploading'?'取消':'移除'}}</button></article><p>附件上传完成或移除后，才能发送消息。</p></div>`};
export const AttachmentBar={
 props:{files:Array,threadId:String,token:String,removable:Boolean,disabled:Boolean},emits:['remove','error'],
 data:()=>({urls:{}}),
 watch:{files:{immediate:true,deep:true,handler(){this.load();}},token(){this.load();}},
 beforeUnmount(){for(const url of Object.values(this.urls))URL.revokeObjectURL(url);this.disposed=true;},
 methods:{
  async blob(file){const response=await fetch('./api/codex/desktop/attachment?id='+encodeURIComponent(this.threadId)+'&attachmentId='+encodeURIComponent(file.id),{headers:{'X-AI-Team-Token':this.token}});if(!response.ok)throw Error('附件不可读取，请重新上传');return response.blob();},
  async load(){if(!this.token)return;for(const file of this.files||[]){if(!file.mime?.startsWith('image/')||this.urls[file.id])continue;try{const blob=await this.blob(file);if(!this.disposed)this.urls[file.id]=URL.createObjectURL(blob);}catch{}}},
  async download(file){try{const url=URL.createObjectURL(await this.blob(file)),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){this.$emit('error',e.message);}}
 },
 template:`<div v-if="files?.length" class="attachment-bar"><div class="attachment-chip" v-for="file in files" :key="file.id"><button type="button" class="attachment-open" @click="download(file)" :title="'下载 '+file.name"><img v-if="urls[file.id]" :src="urls[file.id]" :alt="file.name"><span v-else class="attachment-symbol" aria-hidden="true">▤</span><span class="attachment-copy"><strong>{{file.name}}</strong><small>{{Math.max(1,Math.ceil(file.size/1024))}} KB</small></span></button><button v-if="removable" type="button" class="attachment-remove" :disabled="disabled" @click="$emit('remove',file.id)" :aria-label="'移除附件 '+file.name">×</button></div></div>`
};
