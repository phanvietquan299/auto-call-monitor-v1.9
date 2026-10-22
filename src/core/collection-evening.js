/* Collection uses the 1.17.24 policy, with one final confirmed locked change after 18:00. */
(function(root){
 const members=['FS01','FS02','FS03','FS04'];
 function phase(now){
  const local=new Date(now+25200000),minute=local.getUTCHours()*60+local.getUTCMinutes();
  return {date:local.toISOString().slice(0,10),minute,previousDate:new Date(local.getTime()-86400000).toISOString().slice(0,10)};
 }
 function eveningDate(now){const t=phase(now);return t.minute>=1080?t.date:t.minute<480?t.previousDate:null;}
 function finalChange(state,now){
  const date=eveningDate(now);if(!date)return null;
  const saved=state.collectionEvening;
  if(saved?.date===date&&['RUNNING','FINAL_CONFIRMED','NIGHT','FAILED'].includes(saved.status)&&saved.policy===27)return null;
  const end=Date.parse(date+'T18:00:00+07:00');
  const changes=Object.values(state.fsStates||{}).filter(f=>f.group==='99.153'&&members.includes(f.fs)).flatMap(f=>[f.incident,f.lastIncident]).filter(i=>i&&(i.autoExecuted||i.manualExecuted)&&!i.actionUncertain&&!i.actionPending&&i.switchedAt>=end&&i.switchedAt<=now);
  changes.sort((a,b)=>a.switchedAt-b.switchedAt);
  return changes.length?{date,incidentId:changes[0].id,at:changes[0].switchedAt}:null;
 }
 function next(state,now){
  if(!state.monitoringEnabled)return null;
  const saved=state.collectionEvening,time=phase(now),data=state.opensips?.['99.153'];
  if(!saved||!data||now-data.updatedAt<0||now-data.updatedAt>45000)return null;
  const nodes=(data.nodes||[]).filter(n=>members.includes(n.fs)&&n.resource==='vt');
  if(nodes.length!==4||new Set(nodes.map(n=>n.fs)).size!==4||nodes.some(n=>![0,2].includes(n.groupId)||!Number.isInteger(n.destinationId)||n.destinationId<=0))return null;
  const active=nodes.filter(n=>n.groupId===2).map(n=>({...n,id:n.destinationId}));
  if(saved.policy===27&&saved.status==='FINAL_CONFIRMED')return {kind:'NIGHT',date:saved.date,enable:[],disable:active,resumeNodes:saved.resumeNodes||active};
  if(saved.status==='NIGHT'&&saved.date===time.previousDate&&time.minute>=480&&time.minute<1080){
   const resume=saved.resumeNodes||(saved.selected?[saved.selected]:[]);
   if(!resume.length)return null;
   const enable=[];
   for(const n of resume){const row=nodes.find(x=>x.fs===n.fs&&x.ip===n.ip&&x.destinationId===n.id);if(!row)return null;if(row.groupId===0)enable.push(n);}
   return {kind:'MORNING',date:saved.date,enable,disable:[],resumeNodes:resume};
  }
  return null;
 }
 async function execute(state,job,deps){
  state.collectionEvening={...state.collectionEvening,policy:27,date:job.date,resumeNodes:job.resumeNodes,status:'RUNNING',stage:job.kind,startedAt:deps.now()};await deps.save(state);
  try{
   for(const n of job.enable)await deps.setGroup(n,0,2);
   for(const n of job.disable)await deps.setGroup(n,2,0);
   state.collectionEvening={...state.collectionEvening,status:job.kind==='NIGHT'?'NIGHT':'RESUMED',finishedAt:deps.now()};
  }catch(error){state.collectionEvening={...state.collectionEvening,status:'FAILED',error:String(error.message||error),failedAt:deps.now()};}
  await deps.save(state);return state.collectionEvening;
 }
 const api={phase,eveningDate,finalChange,next,execute};if(typeof module!=='undefined')module.exports=api;else root.CollectionEvening=api;
})(globalThis);
