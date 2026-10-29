export function followDesktop({threadId,getToken,onSnapshot,onState,onReconnect,heartbeatMs=45000}){
 const controller=new AbortController();let retries=0;
 const delay=ms=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);controller.signal.addEventListener('abort',done,{once:true});});
 async function run(){while(!controller.signal.aborted){
  const connection=new AbortController();const abort=()=>connection.abort();controller.signal.addEventListener('abort',abort,{once:true});let watchdog;const heartbeat=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>connection.abort(),heartbeatMs);};heartbeat();
  try{
   onState(retries?'reconnecting':'connecting');
   const response=await fetch('./api/codex/desktop/events?id='+encodeURIComponent(threadId),{headers:{'X-AI-Team-Token':getToken()},signal:connection.signal});
   if(!response.ok){if(response.status===403)await onReconnect?.();throw Error('实时连接不可用');}
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   try{while(!controller.signal.aborted){const {done,value}=await reader.read();if(done)throw Error('实时连接已关闭');heartbeat();buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const event=frame.match(/^event: (.+)$/m)?.[1],line=frame.match(/^data: (.+)$/m)?.[1];if(!line)continue;const data=JSON.parse(line);if(event==='snapshot'){retries=0;onState('live');onSnapshot(data);}else if(event==='connection'){if(data.state==='unavailable'){onState('polling',data.message);return;}onState(data.state,data.message);}}}}finally{await reader.cancel().catch(()=>{});}
  }catch{if(controller.signal.aborted)break;onState('reconnecting');await delay(Math.min(15000,1000*2**Math.min(retries++,4)));if(!controller.signal.aborted)await Promise.resolve(onReconnect?.()).catch(()=>{});}
  finally{clearTimeout(watchdog);controller.signal.removeEventListener('abort',abort);}
 }}
 run();return ()=>{controller.abort();};
}
