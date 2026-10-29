export function formatDate(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!value) return '-';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const input = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function routeMessage(value, conversation, members) {
  const text = value.trim();
  if (!text) throw new Error('请输入消息内容');
  const recipients = conversation.type === 'direct'
    ? members.filter(m => m.id === conversation.memberId)
    : members.filter(m => text.includes(`@${m.name}`));
  return { text, targets:recipients.map(m => m.id), queued:recipients.filter(m => m.status === 'offline' || m.status === 'paused').map(m => m.id) };
}
export function createRequestId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
