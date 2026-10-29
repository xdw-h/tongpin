export function bindMobileViewport({window:win,root,onBefore=()=>{},onAfter=()=>{}}){
 const viewport=win.visualViewport;let frame,disposed=false,last='',baseline=win.innerHeight,width=win.innerWidth;
 function update(){if(disposed)return;const mobile=win.matchMedia('(max-width:760px)').matches;if(!mobile){root.style.removeProperty('--app-height');root.style.removeProperty('--app-top');root.classList.remove('keyboard-open');last='';return;}if(viewport&&Math.abs((viewport.scale||1)-1)>.02)return;
  if(width!==win.innerWidth){width=win.innerWidth;baseline=win.innerHeight;}
  const height=Math.max(1,Math.round(viewport?.height||win.innerHeight)),top=Math.max(0,Math.round(viewport?.offsetTop||0));baseline=Math.max(baseline,height);const key=height+':'+top;if(last===key)return;onBefore();root.style.setProperty('--app-height',height+'px');root.style.setProperty('--app-top',top+'px');root.classList.toggle('keyboard-open',baseline-height>120);last=key;onAfter();
 }
 function schedule(){if(frame)win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(update);}
 viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);win.addEventListener('resize',schedule);update();
 return ()=>{disposed=true;if(frame)win.cancelAnimationFrame(frame);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);root.style.removeProperty('--app-height');root.style.removeProperty('--app-top');root.classList.remove('keyboard-open');};
}
export function resizeComposer(element,{height=800,mobile=false}={}){if(!element)return;const min=mobile?44:50,max=mobile?Math.max(min,Math.min(160,Math.floor(height*.25))):160;element.style.height='auto';const size=Math.max(min,Math.min(max,element.scrollHeight));element.style.height=size+'px';element.style.overflowY=element.scrollHeight>max?'auto':'hidden';}
