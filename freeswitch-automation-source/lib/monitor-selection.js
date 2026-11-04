/* Selection belongs to the preview Monitor, never changes node status or production data. */
const fs=require('fs'),path=require('path');
const profiles={'99.153':'COLLECTION','99.155':'TELESALE'};
const key=node=>JSON.stringify([node.id,node.host,node.profile]);
function createMonitorSelection({file,getNodes}){
 let state={monitoringEnabled:true,revision:0,groups:{'99.153':[],'99.155':[]}},queue=Promise.resolve();
 if(fs.existsSync(file)){try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if((saved.monitoringEnabled!==undefined&&typeof saved.monitoringEnabled!=='boolean')||!Number.isSafeInteger(saved.revision)||Object.keys(profiles).some(g=>!Array.isArray(saved.groups?.[g])||saved.groups[g].some(k=>typeof k!=='string')))throw Error();state={...saved,monitoringEnabled:saved.monitoringEnabled!==false};}catch(_){/* Fail closed on invalid selection storage. */}}
 const read=()=>JSON.parse(JSON.stringify(state));
 async function commit(next){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';await fs.promises.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.promises.rename(temp,file);state=next;return read();}
 return {read,setEnabled(input){
  const task=queue.then(async()=>{
   if(!input||typeof input.enabled!=='boolean')throw Error('Trạng thái MONITOR không hợp lệ');
   if(input.revision!==state.revision){const error=Error('Cấu hình Monitor đã thay đổi; tải lại trước khi bật/tắt');error.status=409;throw error;}
   return commit({...state,revision:state.revision+1,monitoringEnabled:input.enabled});
  });queue=task.catch(()=>{});return task;
 },async catalog(){return {...read(),nodes:(await getNodes()).filter(n=>Object.values(profiles).includes(n.profile)).map(({id,host,profile})=>({id,host,profile}))};},save(input){
  const task=queue.then(async()=>{
   if(!input||!profiles[input.group]||!Array.isArray(input.keys)||input.keys.length>100||input.keys.some(k=>typeof k!=='string'))throw Error('Danh sách node không hợp lệ');
   if(input.revision!==state.revision){const error=Error('Lựa chọn đã thay đổi trên máy khác; mở lại Thêm node');error.status=409;throw error;}
   const allowed=new Set((await getNodes()).filter(n=>n.profile===profiles[input.group]).map(key));const keys=[...new Set(input.keys)];
   if(keys.some(k=>!allowed.has(k)))throw Error('Node không còn thuộc nhóm trong Quản lý Node; tải lại danh sách');
   const next={...state,revision:state.revision+1,groups:{...state.groups,[input.group]:keys}};
   return commit(next);
  });queue=task.catch(()=>{});return task;
 }};
}
module.exports={createMonitorSelection,key};
