/* Called only inside the shared worker queue. Does not change FreeSWITCH numbers. */
/** Tác dụng: Điều phối lượt đổi cuối buổi Collection, tắt node ban đêm và khôi phục node buổi sáng. */
async function runCollectionEvening(state){
 if(typeof CollectionEvening==='undefined'||!state.monitoringEnabled)return;
 if(state.collectionEvening?.status==='RUNNING'){
  state.collectionEvening.status='FAILED';state.collectionEvening.error='Lịch Collection bị gián đoạn; kiểm tra Group ID trước khi tiếp tục.';state.importantFailures=[{id:'evening-interrupted-'+state.collectionEvening.date,fs:'Collection',at:Date.now(),title:'Lịch Collection bị gián đoạn',detail:state.collectionEvening.error},...(state.importantFailures||[])].slice(0,20);await saveState(state);return;
 }
 // Retire the 17:00 consolidation state without changing any current Group ID.
 if(state.collectionEvening&&state.collectionEvening.policy!==27&&!['NIGHT','RUNNING'].includes(state.collectionEvening.status)){
  state.collectionEvening=null;await saveState(state);
 }
 const time=CollectionEvening.phase(Date.now());
 if(time.minute>=1080&&state.collectionEvening?.date!==time.date){
  state.collectionEvening={policy:27,date:time.date,status:'WAIT_FINAL'};await saveState(state);
 }
 // Hết cửa sổ 18:00–18:05 thì nghỉ đêm dù chưa có lượt đổi cuối.
 if((time.minute>=1085||time.minute<480)&&state.collectionEvening?.policy===27&&state.collectionEvening.status==='WAIT_FINAL'){
  state.collectionEvening={...state.collectionEvening,status:'FINAL_CONFIRMED',stopReason:'HARD_STOP_18_05'};
  Detection.applySchedule(state,Date.now());await saveState(state);
 }
 const final=CollectionEvening.finalChange(state,Date.now());
 if(final){state.collectionEvening={policy:27,date:final.date,status:'FINAL_CONFIRMED',finalIncidentId:final.incidentId,finalAt:final.at};Detection.applySchedule(state,Date.now());await saveState(state);}
 const rotation=await chrome.storage.local.get('fsSwitch');
 if(['RUNNING','FAILED'].includes(rotation.fsSwitch?.operation?.status)||rotation.fsSwitch?.lastTest?.status==='RUNNING')return;
 const job=CollectionEvening.next(state,Date.now());if(!job)return;
 let tab;
 await CollectionEvening.execute(state,job,{now:/** Tác dụng: Cung cấp đồng hồ hiện tại cho bộ thực thi lịch Collection. */ ()=>Date.now(),save:saveState,setGroup:/** Tác dụng: Bật/tắt Group ID cho node và xác minh lại qua luồng Save/Reload. */ async(node,expected,value)=>{
  if(tab==null)tab=await switchTab('http://10.10.99.153/*');
  const before=await switchCommand(tab,{type:'FS_SWITCH_READ_NODE',node});
  if(before.groupId===value)return; // A persisted step may already be applied.
  if(before.groupId!==expected)throw Error('Group ID đã thay đổi ở '+node.fs+'; dừng lịch Collection.');
  const result=await switchCommand(tab,{type:'FS_SWITCH_SET_GROUP',node,expected,value,group:'99.153'});
  await refreshSwitchPage(tab,node,value,result.pageId);
  const n=state.opensips['99.153'].nodes.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong runCollectionEvening. */ n=>n.fs===node.fs&&n.ip===node.ip&&n.destinationId===node.id);
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
