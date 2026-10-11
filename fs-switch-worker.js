/* Uses the existing worker queue for mutual exclusion, but separate storage and commands. */
const FS_SWITCH_DEFAULT={enabled:false,mode:'MANUAL',handled:{},quarantined:{},history:[]};
async function switchState(){
  const r=await chrome.storage.local.get('fsSwitch');const f={...structuredClone(FS_SWITCH_DEFAULT),...r.fsSwitch};
  let interrupted=false;
  for(const op of [f.operation,...f.history].filter(Boolean))if(op.status==='RUNNING'){
    op.status='FAILED';op.targetWatchPending=false;
    op.error='Worker khởi động lại giữa thao tác; kiểm tra OpenSIPS/FreeSWITCH. Không tự chạy lại.';
    interrupted=true;
  }
  if(interrupted)await switchSave(f);
  if(f.lastTest?.status==='RUNNING'){f.lastTest.status='FAILED';f.lastTest.error='Test bị gián đoạn; kiểm tra Group ID và Reload trước khi thử lại.';await switchSave(f);}
  f.history=f.history.filter(x=>x.startedAt>Date.now()-3*86400000);return f;
}
async function switchSave(f){await chrome.storage.local.set({fsSwitch:f});}
async function switchSnapshot(){const s=await getState();Detection.applySchedule(s,Date.now());return s;}
async function switchTab(url){const tabs=await chrome.tabs.query({url});if(tabs.length!==1)throw Error('Cần mở đúng một tab: '+url);return tabs[0].id;}
async function switchCommand(id,msg){const r=await chrome.tabs.sendMessage(id,msg);if(!r?.ok)throw Error(r?.error||'Trang không xác nhận thành công.');return r;}
async function refreshSwitchPage(tab,node,value,oldPageId){
  await chrome.tabs.reload(tab,{bypassCache:true});
  const deadline=Date.now()+20000;
  let reason='Đang chờ trang OpenSIPS tải lại';
  do{
    try{
      const current=await chrome.tabs.get(tab);
      if(current.status==='complete'){
        const r=await chrome.tabs.sendMessage(tab,{type:'FS_SWITCH_READ_NODE',node});
        if(r?.ok&&r.pageId&&r.pageId!==oldPageId){
          if(r.groupId!==value)throw Error('Trang mới hiển thị Group ID khác giá trị vừa lưu.');
          return r;
        }
        reason=r?.error||'Đang chờ content script của trang mới';
      }
    }catch(error){reason=String(error.message||error);}
    await new Promise(resolve=>setTimeout(resolve,250));
  }while(Date.now()<deadline);
  throw Error('Đã đổi Group ID nhưng chưa xác minh trang sau refresh: '+reason);
}
async function monitorSwitchTarget(opensips,p,f,operation=f.operation){
  const op=operation,initial=op.targetInitialVt;
  if(!Number.isFinite(initial))throw Error('Chưa đọc được VT trước khi bật FS; không tự BLOCK.');
  const deadline=op.targetWatchDeadline||Date.now()+5000;
  op.targetWatchStartedAt=op.targetWatchStartedAt||Date.now();op.targetWatchDeadline=deadline;await switchSave(f);
  const observed=await getState();
  const targetState=Object.values(observed.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs&&x.ip===p.target.ip);
  let grew=(targetState?.history||[]).some(x=>x.time>op.targetWatchStartedAt&&x.vt>initial),last;
  do{
    const delay=Math.max(0,Math.min(2000,deadline-Date.now()));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const state=await switchSnapshot();
    if(!state.monitoringEnabled||Detection.pausedFor(state,p.group))throw Error('MONITOR tắt hoặc tới giờ nghỉ trong lúc theo dõi FS mới.');
    last=await switchCommand(opensips,{type:'FS_SWITCH_READ_NODE',node:p.target});
    if(last.groupId!==p.groupId||!Number.isFinite(last.used))throw Error('Group ID/VT đích chưa xác minh; không BLOCK.');
    if(last.used>initial)grew=true;
    op.targetLastVt=last.used;await switchSave(f);
  }while(Date.now()<deadline);
  if(grew){op.targetVtIncreased=true;op.stage='VT_INCREASED';return;}
  const state=await switchSnapshot();
  const tab=await switchTab('http://10.10.101.67:5003/*');
  await waitForFreeSwitch(state,p.group);
  const check=await switchSnapshot();
  if(!check.monitoringEnabled||Detection.pausedFor(check,p.group))throw Error('Dừng trước BLOCK đích do MONITOR/lịch nghỉ.');
  // Recheck after waiting for the shared write gap: traffic may now be rising.
  last=await switchCommand(opensips,{type:'FS_SWITCH_READ_NODE',node:p.target});
  if(last.groupId!==p.groupId||!Number.isFinite(last.used))throw Error('Không xác minh được VT/Group ID trước BLOCK.');
  if(last.used>initial){op.targetVtIncreased=true;op.stage='VT_INCREASED';return;}
  // The shared worker queue cannot consume scheduled snapshots during this wait.
  // Read the live FreeSWITCH DOM instead of rejecting our own queued-old data.
  const fresh=await switchCommand(tab,{type:'READ_FS_NUMBERS'});
  const numbers=(fresh.numbers||[]).filter(n=>n.fs===p.target.fs&&n.profile===p.profile&&n.status==='ACTIVE');
  if(numbers.length!==1||numbers[0].phone!==p.target.phone||!numbers[0].hasStatusControl)
    throw Error('Số ACTIVE đích đã thay đổi hoặc không có điều khiển; không BLOCK.');
  op.stage='BLOCK_TARGET';op.targetBlockRequestedAt=Date.now();await switchSave(f);
  await switchCommand(tab,{type:'AUTO_BLOCK_FS',fs:p.target.fs,profile:p.profile,phone:p.target.phone});
  const latest=await getState(),at=Date.now();latest.freeSwitchNextActionAt=at+5000;latest.lastFreeSwitchAction={group:p.group,at};
  const target=Object.values(latest.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs&&x.ip===p.target.ip);
  if(target){
    target.baseline=p.source.baseline||target.baseline;target.baselineVt=target.baseline;
    target.incident={id:op.id,locked:true,autoExecuted:true,switchedAt:at,oldPhone:p.target.phone,actionCount:1,rotation:true};
    target.switchedAt=at;target.history=[];target.state='COOLDOWN';target.activeBeforeIncident=true;
    Detection.event(latest,'AUTO_BLOCKED',target,at,'VT đích không tăng sau 5 giây; đã BLOCK số ACTIVE');
    Detection.recordGroupAction(latest,target,at);
  }
  op.targetBlocked=true;op.stage='RECOVERING';await saveState(latest);
}
async function performSwitch(plan,f){
  const opensips=await switchTab(`http://10.10.${plan.group}/*`);
  const result=await FsSwitch.execute(plan,f,{
    now:Date.now,save:switchSave,
    validate:async p=>{
      const s=await switchSnapshot();
      if(!s.monitoringEnabled||Detection.pausedFor(s,p.group))throw Error('MONITOR phải ON và nhóm đang trong giờ làm.');
      // Exclude only this operation's reservations during validation.
      const view={...f,operation:null,handled:{...f.handled},quarantined:{...f.quarantined}};
      delete view.handled[p.key];delete view.quarantined[`${p.group}|${p.source.fs}`];delete view.quarantined[`${p.group}|${p.target.fs}`];
      const current=FsSwitch.plans(s,view,Date.now()).find(x=>x.key===p.key);
      if(!current||FsSwitch.identity(current)!==FsSwitch.identity(p))throw Error('Dữ liệu đã thay đổi; xem lại kế hoạch.');
    },
    setGroup:async(group,node,expected,value)=>{
      const s=await switchSnapshot();if(!s.monitoringEnabled||Detection.pausedFor(s,group))throw Error('Đã tắt MONITOR hoặc tới giờ nghỉ; kiểm tra chuyển FS đang dở.');
      if(node.fs===plan.target.fs){
        const before=await switchCommand(opensips,{type:'FS_SWITCH_READ_NODE',node});
        if(before.groupId!==expected||!Number.isFinite(before.used))throw Error('Không đọc được Group ID/VT đích trước khi bật.');
        f.operation.targetInitialVt=before.used;await switchSave(f);
      }
      const result=await switchCommand(opensips,{type:'FS_SWITCH_SET_GROUP',node,expected,value,group});
      await refreshSwitchPage(opensips,node,value,result.pageId);
      const latest=await getState(),nodes=latest.opensips[group].nodes||[];
      const updated=nodes.find(n=>n.fs===node.fs&&n.ip===node.ip&&n.destinationId===node.id);
      if(!updated)throw Error('Destination biến mất sau refresh; kiểm tra thủ công.');
      updated.groupId=value;
      const at=Date.now();Detection.sample(latest,group,[updated],at);
      if(node.fs===plan.target.fs){
        const peers=Object.values(latest.fsStates||{}).filter(x=>x.group===group&&x.fs!==plan.source.fs&&x.fs!==plan.target.fs&&Detection.isFsActive(latest,x,at));
        if(peers.length){latest.groupTrials=latest.groupTrials||{};latest.groupTrials[group]={fs:plan.source.fs,completedAt:at,until:at+(latest.config.groupObserveMs??9000),
          peers:Object.fromEntries(peers.map(x=>[x.key,x.currentVt]))};}
      }
      await saveState(latest);
    },
    monitorTarget:async()=>{
      const op=f.operation;op.targetWatchStartedAt=Date.now();op.targetWatchDeadline=Date.now()+5000;
      op.targetWatchPending=true;await switchSave(f);
      // Let the other group work while this group collects fresh VT.
      setTimeout(()=>{messageQueue=messageQueue.then(()=>processSwitch({type:'FS_SWITCH_WATCH',operationId:op.id})).catch(()=>{});},5000);
      chrome.alarms.create('fs-switch-watch-'+op.id,{when:op.targetWatchDeadline});
    }
  });
  return result;
}
async function runDueSwitchWatches(f,operationId){
  const seen=new Set();
  for(const op of [f.operation,...f.history].filter(Boolean)){
    if(seen.has(op.id))continue;seen.add(op.id);
    if(op.status!=='DONE'||!op.targetWatchPending||Date.now()<op.targetWatchDeadline||operationId&&op.id!==operationId)continue;
    f.history=f.history.map(x=>x.id===op.id?op:x);
    op.targetWatchPending=false;op.status='RUNNING';await switchSave(f);
    try{
      if(!f.enabled)throw Error('Thay FS đã OFF; dừng theo dõi tự BLOCK đích.');
      const tab=await switchTab(`http://10.10.${op.plan.group}/*`);
      await monitorSwitchTarget(tab,op.plan,f,op);
      op.status='DONE';op.finishedAt=Date.now();
    }catch(error){op.status='FAILED';op.error=String(error.message||error);op.finishedAt=Date.now();f.operation=op;}
    await switchSave(f);
  }
}
async function processSwitchTest(msg,f,s){
  if(f.enabled)throw Error('Test riêng không chạy đồng thời với Thay FS đầy đủ.');
  const tab=await switchTab('http://10.10.99.153/*');
  if(msg.type==='FS_SWITCH_TEST_PREVIEW'){
    if(!['FS03','FS04'].includes(msg.fs)||![0,2].includes(msg.value))throw Error('Test chỉ FS03/FS04 với Group ID 0 hoặc 2.');
    const expectedIp=msg.fs==='FS03'?'10.10.101.184':'10.10.101.180';
    const nodes=(s.opensips?.['99.153']?.nodes||[]).filter(n=>n.fs===msg.fs&&n.ip===expectedIp&&Number.isInteger(n.destinationId)&&n.destinationId>0);
    if(nodes.length!==1)throw Error('Chưa có đúng một destination FS cần test. Mở trang Load Balancer Collection và chờ đọc dữ liệu.');
    const node={fs:msg.fs,ip:expectedIp,id:nodes[0].destinationId};
    const result=await switchCommand(tab,{type:'FS_SWITCH_READ_TEST',node});
    const expected=msg.value===2?0:2;
    if(result.groupId!==expected)throw Error(`Group ID hiện là ${result.groupId}; thao tác yêu cầu ${expected} → ${msg.value}.`);
    f.testPreview={id:`test-opensips-${Date.now()}-${msg.fs}-${msg.value}`,node,expected,value:msg.value,createdAt:Date.now()};
    await switchSave(f);return {ok:true,preview:f.testPreview};
  }
  const preview=f.testPreview;
  if(!preview||preview.id!==msg.testId||Date.now()-preview.createdAt>60000)throw Error('Xác nhận test đã hết hiệu lực; kiểm tra lại.');
  const main=await getState();
  main.fsTestExclusions={...main.fsTestExclusions,[`99.153|${preview.node.fs}`]:{testId:preview.id,releaseAfterOff:false}};
  main.pendingAutoActions=(main.pendingAutoActions||[]).filter(a=>!(a.group==='99.153'&&a.fs===preview.node.fs));
  main.alerts=(main.alerts||[]).filter(a=>!(a.group==='99.153'&&a.fs===preview.node.fs));
  await saveState(main);
  f.testPreview=null;f.lastTest={...preview,status:'RUNNING',startedAt:Date.now()};await switchSave(f);
  try{
    const result=await switchCommand(tab,{type:'FS_SWITCH_SET_GROUP',group:'99.153',node:preview.node,expected:preview.expected,value:preview.value});
    if(!result.reloaded||result.groupId!==preview.value)throw Error('Chưa xác nhận Group ID sau Reload on Server.');
    f.lastTest.stage='REFRESHING_PAGE';await switchSave(f);
    await refreshSwitchPage(tab,preview.node,preview.value,result.pageId);
    f.lastTest.pageRefreshed=true;
    if(preview.value===0){
      const latest=await getState();
      if(latest.fsTestExclusions?.[`99.153|${preview.node.fs}`])latest.fsTestExclusions[`99.153|${preview.node.fs}`].releaseAfterOff=true;
      await saveState(latest);
    }
    f.lastTest.status='DONE';f.lastTest.finishedAt=Date.now();await switchSave(f);return {ok:true,test:f.lastTest};
  }catch(error){f.lastTest.status='FAILED';f.lastTest.error=String(error.message||error);await switchSave(f);throw error;}
}
async function processSwitch(msg){
  const f=await switchState();
  if(['FS_SWITCH_TICK','FS_SWITCH_WATCH'].includes(msg.type))await runDueSwitchWatches(f,msg.operationId);
  const s=await switchSnapshot();
  if(['FS_SWITCH_TEST_PREVIEW','FS_SWITCH_TEST_CONFIRM'].includes(msg.type))return processSwitchTest(msg,f,s);
  // Release reservations only after the target has truly recovered under detection.
  for(const op of [f.operation,...f.history].filter(x=>x?.status==='DONE')){
    const p=op.plan;
    const target=Object.values(s.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs);
    if(target?.state==='HEALTHY'&&target.currentVt>0&&target.updatedAt>=op.finishedAt+30000){
      if(f.quarantined[`${p.group}|${p.source.fs}`]===op.id)delete f.quarantined[`${p.group}|${p.source.fs}`];
      if(f.quarantined[`${p.group}|${p.target.fs}`]===op.id)delete f.quarantined[`${p.group}|${p.target.fs}`];
    }
  }
  if(msg.type==='FS_SWITCH_SETTINGS'){
    if(!['MANUAL','AUTOMATIC'].includes(msg.mode))throw Error('Chế độ không hợp lệ.');
    f.enabled=!!msg.enabled;f.mode=msg.mode;
  }
  if(msg.type==='FS_SWITCH_RELEASE'){
    if(f.enabled||!f.operation||f.operation.status==='RUNNING'||f.operation.id!==msg.operationId)throw Error('Tắt Thay FS và kiểm tra thủ công trước khi mở khóa.');
    const id=f.operation.id;
    f.quarantined=Object.fromEntries(Object.entries(f.quarantined).filter(([,value])=>value!==id));
    f.handled=Object.fromEntries(Object.entries(f.handled).filter(([,value])=>value!==id));
    f.operation.acknowledgedAt=Date.now();f.operation.status='ACKNOWLEDGED';f.operation.targetWatchPending=false;
    for(const op of f.history)if(op.id===id){op.status='ACKNOWLEDGED';op.targetWatchPending=false;op.acknowledgedAt=f.operation.acknowledgedAt;}
  }
  const candidates=FsSwitch.plans(s,f,Date.now());
  if(msg.type==='FS_SWITCH_CONFIRM'){
    if(!f.enabled||f.mode!=='MANUAL')throw Error('Bật Thay FS ở chế độ xác nhận tay.');
    const p=candidates.find(x=>FsSwitch.identity(x)===msg.identity);if(!p)throw Error('Kế hoạch đã hết hiệu lực; tải lại dữ liệu.');
    await performSwitch(p,f);
  }else if(msg.type==='FS_SWITCH_TICK'&&f.enabled&&f.mode==='AUTOMATIC'&&candidates.length){await performSwitch(candidates[0],f);}
  await switchSave(f);
  const latest=await switchSnapshot();
  return {ok:true,feature:f,candidates:FsSwitch.plans(latest,f,Date.now()),diagnostics:FsSwitch.diagnostics(latest,f,Date.now()),threshold:FsSwitch.BACKUP_THRESHOLD,autoBlockEnabled:latest.autoEnabled};
}
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
  if(!msg.type?.startsWith('FS_SWITCH_'))return;
  messageQueue=messageQueue.then(async()=>reply(await processSwitch(msg))).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name!=='fs-switch-check'&&!alarm.name.startsWith('fs-switch-watch-'))return;
  messageQueue=messageQueue.then(()=>processSwitch({type:'FS_SWITCH_TICK'})).catch(()=>{});
});
chrome.alarms.create('fs-switch-check',{periodInMinutes:0.5});
