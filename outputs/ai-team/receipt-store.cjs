const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
class ReceiptStore{
  constructor(legacyPath){this.legacyPath=legacyPath;this.directory=legacyPath?legacyPath+'.d':null;this.memory=new Map();if(this.directory)fs.mkdirSync(this.directory,{recursive:true});}
  file(id){if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw Error('无效的请求编号');return path.join(this.directory,id+'.json');}
  get(id){
    let job;
    if(!this.directory)job=this.memory.get(id);
    else{
      try{job=JSON.parse(fs.readFileSync(this.file(id)+'.result','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!job)try{job=JSON.parse(fs.readFileSync(this.file(id),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!job&&fs.existsSync(this.legacyPath)){const legacy=JSON.parse(fs.readFileSync(this.legacyPath,'utf8'));job=legacy[id];}
    }
    if(job?.state==='sending'&&Date.now()-Date.parse(job.createdAt)>60000)return {...job,state:'unknown',error:'投递尚未确认。请核对原任务，不会自动重新发送。'};
    return job;
  }
  reserve(job){
    const old=this.get(job.requestId);if(old)return {created:false,job:old};
    if(!this.directory){this.memory.set(job.requestId,job);return {created:true,job};}
    const target=this.file(job.requestId),tmp=target+'.'+randomUUID()+'.tmp';
    try{
      fs.writeFileSync(tmp,JSON.stringify(job),{encoding:'utf8',flag:'wx'});
      // Publish a complete file exclusively. A second process cannot acquire this request.
      try{fs.linkSync(tmp,target);}catch(error){if(error.code==='EEXIST')return {created:false,job:this.get(job.requestId)};throw error;}
      return {created:true,job};
    }finally{try{fs.unlinkSync(tmp);}catch{}}
  }
  update(job){
    if(!this.directory){this.memory.set(job.requestId,job);return;}
    const target=this.file(job.requestId)+'.result',tmp=target+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(job),{encoding:'utf8',flag:'wx'});fs.linkSync(tmp,target);}finally{try{fs.unlinkSync(tmp);}catch{}}
  }
}
module.exports={ReceiptStore};
