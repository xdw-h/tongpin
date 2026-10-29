const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const MAX_FILE=10*1024*1024,MAX_FILES=5;
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
class AttachmentStore{
 constructor(root){this.root=path.resolve(root);fs.mkdirSync(this.root,{recursive:true});}
 save(threadId,input){
  if(typeof threadId!=='string'||!threadId||threadId.length>80)throw Error('附件任务无效');
  if(typeof input?.data!=='string'||input.data.length>Math.ceil(MAX_FILE/3)*4||!input.data.length||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw Error('附件内容无效或超过 10 MB');
  const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>MAX_FILE)throw Error('附件必须在 1 字节至 10 MB 之间');
  const name=String(input.name||'附件').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g,'_').slice(0,150)||'附件';
  const ext=path.extname(name).toLowerCase();let mime='application/octet-stream';
  if(['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)){
   const valid=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()):ext==='.webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!valid)throw Error('图片格式与实际内容不匹配');mime=ext==='.png'?'image/png':ext==='.gif'?'image/gif':ext==='.webp'?'image/webp':'image/jpeg';
  }
  if(input.uploadId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.uploadId))throw Error('上传编号无效');
  const id=input.uploadId||randomUUID(),dir=path.join(this.root,id),hash=createHash('sha256').update(bytes).digest('hex');if(fs.existsSync(dir)){let previous;try{previous=JSON.parse(fs.readFileSync(path.join(dir,'metadata.json'),'utf8'));}catch{throw Error('上传编号记录不完整，请移除后重新添加附件');}if(previous.threadId!==threadId||previous.name!==name||previous.hash!==hash)throw Error('上传编号或附件内容冲突');const verified=this.resolve(threadId,[id])[0];if(createHash('sha256').update(fs.readFileSync(verified.path)).digest('hex')!==hash)throw Error('附件内容已变化，请重新上传');return this.public(verified);}fs.mkdirSync(dir);const file={id,threadId,name,mime,hash,size:bytes.length,path:path.join(dir,name),createdAt:new Date().toISOString()};
  fs.writeFileSync(file.path,bytes,{flag:'wx'});fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify(file),{flag:'wx'});return this.public(file);
 }
 public(file){return {id:file.id,name:file.name,mime:file.mime,size:file.size};}
 resolve(threadId,ids=[]){
  if(!Array.isArray(ids)||ids.length>MAX_FILES||new Set(ids).size!==ids.length)throw Error('每条消息最多附加 5 个不同附件');
  return ids.map(id=>{if(!validId(id))throw Error('附件编号无效');let file;try{file=JSON.parse(fs.readFileSync(path.join(this.root,id,'metadata.json'),'utf8'));}catch{throw Error('附件已丢失，请重新上传');}
   if(file.threadId!==threadId)throw Error('附件不属于当前任务');const expected=path.join(this.root,id,file.name);if(file.path!==expected||path.dirname(expected)!==path.join(this.root,id)||!fs.statSync(expected).isFile())throw Error('附件路径无效');return file;
  });
 }
}
module.exports={AttachmentStore,MAX_FILE,MAX_FILES};
