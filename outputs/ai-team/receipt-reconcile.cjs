function reconcileReceipt(job,runtime){
 if(job.turnId||!job.baselineTurnIds||!job.sentText)return job;
 const baseline=new Set(job.baselineTurnIds),created=Date.parse(job.createdAt);
 const candidates=(runtime.data||[]).filter(item=>{
  if(item.type!=='userMessage'||!item.turnId||baseline.has(item.turnId))return false;
  const turn=(runtime.turns||[]).find(t=>t.id===item.turnId),raw=turn?.startedAt||item.startedAtMs;
  const started=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(raw);
  return Number.isFinite(started)&&started>=created-2000&&(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')===job.sentText;
 });
 return candidates.length===1?{...job,state:'accepted',turnId:candidates[0].turnId,matchedUserId:candidates[0].id}:job;
}
module.exports={reconcileReceipt};
