const fs=require('node:fs');
const bindingPath=require('node:path').join(__dirname,'project-bindings.json');
const bindings=fs.existsSync(bindingPath)?require(bindingPath):{};
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase()===b.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
function bindTask(task){const binding=bindings[task.id];return binding?{...task,projectDirectory:binding.directory,executionDirectory:task.cwd,targetWorkspaceDirectory:binding.workspaceDirectory||binding.directory,originalDirectory:binding.previousDirectory,directoryBinding:samePath(task.cwd,binding.directory)||samePath(task.cwd,binding.workspaceDirectory)?'migrated':'instruction'}:task;}
function buildTaskPrompt(threadId,text,cwd){
  const binding=bindings[threadId];if(!binding)return text;
  if(!fs.statSync(binding.directory).isDirectory())throw Error('绑定的项目目录不可用，未发送消息');
  if(samePath(cwd,binding.directory))return text;
  return `项目目录迁移约定（本条指令的执行范围）：\n项目现在位于 ${binding.directory}。桌面会话记录的旧目录 ${binding.previousDirectory} 已停用。\n本次及后续项目文件读取、编辑、测试和命令执行，必须显式使用 ${binding.directory} 作为工作目录。不要在旧目录重建项目或写入文件。如无法使用新目录，请说明原因并停止项目写操作。\n\n用户指令：\n${text}`;
}
module.exports={bindTask,buildTaskPrompt};
