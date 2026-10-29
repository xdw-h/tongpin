function summaryText(text){return String(text||'').split('```')[0].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`#]/g,'').replace(/\s+/g,' ').trim().slice(0,220);}
module.exports={summaryText};
