const OPEN='<send_user_message_question_reply>',CLOSE='</send_user_message_question_reply>';
function asyncRequests(threadId,state){
 const turns=state.turnHistory?.kind==='canonical'?Object.values(state.turnHistory.history?.entitiesByKey||{}).filter(t=>t.turnId):state.turns||[];
 const latest=[...turns].sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0)).at(-1);
 if(!latest||!['inProgress','completed'].includes(latest.status))return [];
 const answered=new Set();for(const item of latest.items||[]){if(item.type==='steeringUserMessage'&&item.status!=='accepted')continue;const content=item.type==='userMessage'?item.content:item.type==='steeringUserMessage'?item.input:null;if(!Array.isArray(content))continue;const text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();const start=text.lastIndexOf(OPEN);if(start<0||!text.endsWith(CLOSE))continue;try{const parsed=JSON.parse(text.slice(start+OPEN.length,-CLOSE.length));for(const answer of Array.isArray(parsed)?parsed:[parsed])if(typeof answer.questionItemId==='string')answered.add(answer.questionItemId);}catch{}}
 return (latest.items||[]).filter(i=>i.type==='agentMessage'&&typeof i.id==='string'&&i.questions?.length).flatMap(item=>{
  const questions=item.questions.map((q,index)=>({id:JSON.stringify(['request_user_input_async',item.id,index]),header:'问题 '+(index+1),question:q.title,isOther:true,options:(q.options||[]).map(label=>({label,description:''}))})).filter(q=>!answered.has(q.id));
  if(!questions.length)return [];
  return [{id:'async:'+item.id,method:'tongpin/asyncQuestions',params:{threadId,turnId:latest.turnId||latest.id,itemId:item.id,deliveryMode:latest.status,cwd:state.cwd,questions}}];
 });
}
function asyncReply(threadId,req,answers){
 const replies=req.params.questions.map(q=>({questionItemId:q.id,question:q.question,answer:answers[q.id][0]}));
 const text=OPEN+'\n'+JSON.stringify(replies)+'\n'+CLOSE,input=[{type:'text',text,text_elements:[]}];
 if(req.params.deliveryMode==='completed')return {method:'thread-follower-start-turn',params:{conversationId:threadId,turnStart:{request:{threadId,input,...req.params.cwd?{cwd:req.params.cwd}:{}},context:{attachments:[],inheritThreadSettings:true}}}};
 return {method:'thread-follower-steer-turn',params:{conversationId:threadId,input,attachments:[],restoreMessage:{text,cwd:req.params.cwd,createdAt:Date.now(),context:{prompt:text,addedFiles:[],fileAttachments:[],ideContext:null,imageAttachments:[],commentAttachments:[]}}}};
}
module.exports={asyncRequests,asyncReply};
