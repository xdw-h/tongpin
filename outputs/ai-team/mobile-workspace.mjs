import {collectResult} from './task-results.mjs';
export function workspaceRows(rows,{mode='focus',pins=[],query='',group=r=>r.liveStatus,name=r=>r.name||''}={}){
 const needle=query.trim().toLowerCase(),all=rows.filter(r=>(name(r)+' '+(r.cwd||'')).toLowerCase().includes(needle));
 const time=r=>typeof r.updatedAt==='number'?(r.updatedAt<1e12?r.updatedAt*1000:r.updatedAt):Date.parse(r.updatedAt)||0;
 const recent=new Set([...rows].sort((a,b)=>time(b)-time(a)).slice(0,10).map(r=>r.id));const list=all.filter(r=>needle||mode==='all'||mode==='archived'||mode==='focus'&&(recent.has(r.id)||pins.includes(r.id)||['attention','running'].includes(group(r)))||mode===group(r));
 const rank=r=>group(r)==='attention'?0:group(r)==='running'?1:pins.includes(r.id)?2:3;
 return list.sort((a,b)=>rank(a)-rank(b)||Number(pins.includes(b.id))-Number(pins.includes(a.id))||time(b)-time(a));
}
export function activityText(items=[],runtime={}){
 if(runtime.requestsPending)return '等待你处理确认事项';
 const result=collectResult(items,runtime);if(result.status==='completed')return '本轮已结束，可查看结果';if(result.status==='failed')return '本轮执行失败，请查看结果';if(result.status==='interrupted')return '本轮已停止';
 const current=items.filter(i=>i.turnId===result.turnId),latest=current.findLast(i=>i.type==='agentMessage'&&i.phase==='commentary'&&!i.questions?.length&&i.text?.trim());
 const active=current.findLast(i=>i.status==='inProgress'&&['commandExecution','mcpToolCall','fileChange','imageGeneration'].includes(i.type));
 if(active)return ({commandExecution:'正在执行命令',mcpToolCall:'正在调用工具',fileChange:'正在修改文件',imageGeneration:'正在生成图片'})[active.type];
 return latest?.text.replace(/\s+/g,' ').slice(0,150)||(result.status==='inProgress'?'正在处理任务':'等待下一步指令');
}
