(()=>{
 const key='tongpin-theme',valid=value=>['system','light','dark'].includes(value),media=window.matchMedia('(prefers-color-scheme: dark)');let preference='system';
 try{const saved=localStorage.getItem(key);if(valid(saved))preference=saved;}catch{}
 function apply(){const actual=preference==='system'?(media.matches?'dark':'light'):preference;document.documentElement.dataset.theme=actual;document.documentElement.style.colorScheme=actual;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',actual==='dark'?'#111827':'#f6f8fc');window.dispatchEvent(new CustomEvent('tongpin-theme-change',{detail:preference}));}
 window.TongpinTheme={get:()=>preference,set(value){if(!valid(value))return;preference=value;try{localStorage.setItem(key,value);}catch{}apply();}};
 media.addEventListener('change',()=>{if(preference==='system')apply();});window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=valid(event.newValue)?event.newValue:'system';apply();}});apply();
})();
