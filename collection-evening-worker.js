/* Called only inside the shared worker queue. Does not change FreeSWITCH numbers. */
async function runCollectionEvening(state){
 if(typeof CollectionEvening==='undefined'||!state.monitoringEnabled)return;
 if(state.collectionEvening?.status==='RUNNING'){
  state.collectionEvening.status='FAILED';state.collectionEvening.error='Lịch Collection bị gián đoạn; kiểm tra Group ID trước khi tiếp tục.';state.importantFailures=[{id:'evening-interrupted-'+state.collectionEvening.date,fs:'Collection',at:Date.now(),title:'Lịch Collection bị gián đoạn',detail:state.collectionEvening.error},...(state.importantFailures||[])].slice(0,20);await saveState(state);return;
 }
 const final=CollectionEvening.finalChange(state,Date.now());
 if(final){state.collectionEvening={...state.collectionEvening,status:'FINAL_CONFIRMED',finalIncidentId:final.incidentId,finalAt:final.at,selected:final.selected};Detection.applySchedule(state,Date.now());await saveState(state);}
 const rotation=await chrome.storage.local.get('fsSwitch');
 if(['RUNNING','FAILED'].includes(rotation.fsSwitch?.operation?.status)||rotation.fsSwitch?.lastTest?.status==='RUNNING')return;
 const job=CollectionEvening.next(state,Date.now());if(!job)return;
 let tab,targetVerified=false;
 await CollectionEvening.execute(state,job,{now:()=>Date.now(),save:saveState,setGroup:async(node,expected,value)=>{
  if(job.kind==='CONSOLIDATE'&&!targetVerified){
    const fsTab=await switchTab('http://10.10.101.67:5003/*');
    const read=await switchCommand(fsTab,{type:'READ_FS_NUMBERS'});
    const active=(read.numbers||[]).filter(n=>n.fs===job.selected.fs&&n.profile==='COLLECTION'&&n.status==='ACTIVE');
    if(active.length!==1)throw Error('FS được chọn chưa có đúng một số ACTIVE; chưa gom Collection.');
    targetVerified=true;
  }
  if(tab==null)tab=await switchTab('http://10.10.99.153/*');
  const before=await switchCommand(tab,{type:'FS_SWITCH_READ_NODE',node});
  if(before.groupId===value)return; // A persisted step may already be applied.
  if(before.groupId!==expected)throw Error('Group ID đã thay đổi ở '+node.fs+'; dừng lịch Collection.');
  const result=await switchCommand(tab,{type:'FS_SWITCH_SET_GROUP',node,expected,value,group:'99.153'});
  await refreshSwitchPage(tab,node,value,result.pageId);
  const n=state.opensips['99.153'].nodes.find(n=>n.fs===node.fs&&n.ip===node.ip&&n.destinationId===node.id);
  if(!n)throw Error('Không còn destination '+node.fs);
  n.groupId=value;state.opensips['99.153'].updatedAt=Date.now();
  Detection.sample(state,'99.153',[n],Date.now());
  state.events.unshift({type:value===2?'FS_ENABLED':'FS_DISABLED',at:Date.now(),fs:node.fs,group:'99.153',incidentId:'collection-evening-'+job.date+'-'+job.kind+'-'+node.fs,detail:'Lịch Collection '+job.kind});
 }});
 if(state.collectionEvening.status==='FAILED'){
  const op=state.collectionEvening;state.importantFailures=[{id:'evening-'+op.date+'-'+op.stage,fs:'Collection',at:Date.now(),title:'Lịch Collection chưa hoàn tất',detail:op.error},...(state.importantFailures||[])].slice(0,20);await saveState(state);
 }
 Detection.applySchedule(state,Date.now());
}
