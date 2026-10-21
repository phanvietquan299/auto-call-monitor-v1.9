/* Read-only policy for Collection consolidation; execution uses the shared worker queue. */
(function(root){
 const policy=root.FsSwitch||(typeof require==='function'?require('./fs-switch'):null);
 function phase(now){
  const local=new Date(now+25200000),minute=local.getUTCHours()*60+local.getUTCMinutes();
  return {date:local.toISOString().slice(0,10),minute,previousDate:new Date(local.getTime()-86400000).toISOString().slice(0,10),consolidate:minute>=1020};
 }
 function plan(state,now){
  const time=phase(now),group='99.153';
  if(!time.consolidate||!state.monitoringEnabled||state.collectionEvening?.date===time.date)return null;
  const data=state.opensips?.[group];
  if(!data||now-data.updatedAt<0||now-data.updatedAt>45000||!state.freeswitch?.updatedAt||now-state.freeswitch.updatedAt<0||now-state.freeswitch.updatedAt>45000)return null;
  const candidates=[];
  for(const fs of policy.groups[group].fs){
   const rows=(data.nodes||[]).filter(n=>n.fs===fs&&n.resource==='vt');
   if(rows.length!==1||![0,2].includes(rows[0].groupId)||!Number.isInteger(rows[0].destinationId)||rows[0].destinationId<=0)return null;
   const summary=state.freeswitch.backupCounts?.[fs];
   if(summary?.source!=='SUMMARY'||now-summary.updatedAt<0||now-summary.updatedAt>45000)return null;
   const backups=policy.backupCount(state,fs,'COLLECTION',now);
   if(!Number.isSafeInteger(backups)||backups<0)return null;
   candidates.push({...rows[0],id:rows[0].destinationId,backups});
  }
  candidates.sort((a,b)=>b.backups-a.backups||Number(b.groupId===2)-Number(a.groupId===2)||a.fs.localeCompare(b.fs));
  const selected=candidates[0];
  return {date:time.date,group,selected,enable:selected.groupId===0?[selected]:[],disable:candidates.filter(n=>n.fs!==selected.fs&&n.groupId===2)};
 }
 function next(state,now){
  if(!state.monitoringEnabled)return null;
  const time=phase(now),saved=state.collectionEvening;
  if(saved?.status==='RUNNING'||saved?.status==='FAILED'&&(saved.date===time.date||time.minute<1020))return null;
  const data=state.opensips?.['99.153'];
  const fresh=data&&now-data.updatedAt>=0&&now-data.updatedAt<=45000;
  if(saved?.status==='FINAL_CONFIRMED'){
   if(!fresh)return null;
   const nodes=(data.nodes||[]).filter(n=>policy.groups['99.153'].fs.includes(n.fs)&&n.resource==='vt');
   if(nodes.length!==4||new Set(nodes.map(n=>n.fs)).size!==4||nodes.some(n=>![0,2].includes(n.groupId)||!Number.isInteger(n.destinationId)))return null;
   return {kind:'NIGHT',date:saved.date,selected:saved.selected,enable:[],disable:nodes.filter(n=>n.groupId===2).map(n=>({...n,id:n.destinationId}))};
  }
  if(saved?.status==='NIGHT'&&time.previousDate===saved.date&&time.minute>=480&&time.minute<1020){
   if(!fresh)return null;
   const rows=(data.nodes||[]).filter(n=>n.fs===saved.selected.fs&&n.ip===saved.selected.ip&&n.destinationId===saved.selected.id&&n.resource==='vt');
   if(rows.length!==1||![0,2].includes(rows[0].groupId))return null;
   return {kind:'MORNING',date:saved.date,selected:saved.selected,enable:rows[0].groupId===0?[saved.selected]:[],disable:[]};
  }
  const p=plan(state,now);return p?{...p,kind:'CONSOLIDATE'}:null;
 }
 function finalChange(state,now){
  const saved=state.collectionEvening,time=phase(now);
  if(saved?.status!=='SINGLE'||!((saved.date===time.date&&time.minute>=1080)||(saved.date===time.previousDate&&time.minute<480)))return null;
  const active=(state.opensips?.['99.153']?.nodes||[]).filter(n=>policy.groups['99.153'].fs.includes(n.fs)&&n.resource==='vt'&&n.groupId===2);
  if(active.length!==1)return null;
  const f=Object.values(state.fsStates||{}).find(f=>f.group==='99.153'&&f.fs===active[0].fs),i=f?.incident||f?.lastIncident;
  const end=Date.parse(saved.date+'T18:00:00+07:00');
  const manual=(state.events||[]).find(e=>e.group==='99.153'&&e.fs===active[0].fs&&e.type==='MANUAL_FS_STATUS'&&e.at>=end&&/ACTIVE → BLOCKED/.test(e.detail||''));
  const confirmed=i&&(i.autoExecuted||i.manualExecuted)&&!i.actionUncertain&&!i.actionPending&&i.switchedAt>=end;
  return confirmed||manual?{incidentId:confirmed?i.id:manual.incidentId||'manual-'+manual.at,at:confirmed?i.switchedAt:manual.at,selected:{...active[0],id:active[0].destinationId}}:null;
 }
 async function execute(state,job,deps){
  const previous=state.collectionEvening;
  state.collectionEvening={...previous,date:job.date,selected:job.selected,status:'RUNNING',stage:job.kind,startedAt:deps.now()};await deps.save(state);
  try{
   for(const node of job.enable)await deps.setGroup(node,0,2);
   for(const node of job.disable)await deps.setGroup(node,2,0);
   state.collectionEvening={...state.collectionEvening,status:{CONSOLIDATE:'SINGLE',NIGHT:'NIGHT',MORNING:'RESUMED'}[job.kind],finishedAt:deps.now()};
  }catch(error){state.collectionEvening={...state.collectionEvening,status:'FAILED',error:String(error.message||error),failedAt:deps.now()};}
  await deps.save(state);return state.collectionEvening;
 }
 const api={phase,plan,next,finalChange,execute};if(typeof module!=='undefined')module.exports=api;else root.CollectionEvening=api;
})(globalThis);
