import {Marked} from './vendor/marked.esm.js';
const escape=text=>String(text||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown=new Marked({gfm:true,breaks:true,renderer:{html:token=>escape(token.text),image:()=>'',link(token){const label=this.parser.parseInline(token.tokens);if(!/^(https?:\/\/|mailto:)/i.test(token.href||''))return label;return '<a href="'+escape(token.href)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';}}});
export function renderMarkdown(text){try{return markdown.parse(String(text||''));}catch{return '<p>'+escape(text)+'</p>';}}
