/* Uses the existing worker queue for mutual exclusion, but separate storage and commands. */
const FS_SWITCH_DEFAULT={backupThreshold:10,nextSwitch:{},enabled:false,mode:'MANUAL',handled:{},quarantined:{},history:[]};
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
async function switchTab(url){
  const group=url.match(/10\.10\.(99\.(?:153|155))/)?.[1];
  if(group&&typeof openSipsTabWithRole==='function')return openSipsTabWithRole(group,'LOAD_BALANCER');
  const tabs=await chrome.tabs.query({url});if(tabs.length!==1)throw Error('Cần mở đúng một tab: '+url);return tabs[0].id;}
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
  let grew=!Detection.cdrPrimary(observed)&&(targetState?.history||[]).some(x=>x.time>op.targetWatchStartedAt&&x.vt>initial),last;
  do{
    const delay=Math.max(0,Math.min(2000,deadline-Date.now()));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const state=await switchSnapshot();
    if(!state.monitoringEnabled||Detection.pausedFor(state,p.group))throw Error('MONITOR tắt hoặc tới giờ nghỉ trong lúc theo dõi FS mới.');
    last=await switchCommand(opensips,{type:'FS_SWITCH_READ_NODE',node:p.target});
    if(last.groupId!==p.groupId||!Number.isFinite(last.used))throw Error('Group ID/VT đích chưa xác minh; không BLOCK.');
    if(!Detection.cdrPrimary(state)&&last.used>initial)grew=true;
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
  if(!Detection.cdrPrimary(check)&&last.used>initial){op.targetVtIncreased=true;op.stage='VT_INCREASED';return;}
  // The shared worker queue cannot consume scheduled snapshots during this wait.
  // Read the live FreeSWITCH DOM instead of rejecting our own queued-old data.
  const fresh=await switchCommand(tab,{type:'READ_FS_NUMBERS'});
  const numbers=(fresh.numbers||[]).filter(n=>n.fs===p.target.fs&&n.profile===p.profile&&n.status==='ACTIVE');
  if(numbers.length!==1||numbers[0].phone!==p.target.phone||!numbers[0].hasStatusControl)
    throw Error('Số ACTIVE đích đã thay đổi hoặc không có điều khiển; không BLOCK.');
  if(check.config.cdrVerificationEnabled){
    if(Date.now()-op.targetWatchStartedAt>120000)throw Error('CDR chưa xác nhận locked sau 120 giây; không tự BLOCK đích. Kiểm tra thủ công.');
    let proof;
    try{const records=await queryCdr(p.group,p.target.fs,p.target.ip);
      proof=Cdr.evaluate(records,{ip:p.target.ip,after:op.targetWatchStartedAt,now:Date.now()});}
    catch(error){proof={locked:false,reason:String(error.message||error)};}

    op.targetCdr=proof;
    if(Detection.cdrPrimary(check)&&!check.config.cdrRequireVtDrop)op.targetCdrConfirmationReads=proof.locked?Math.min(2,(op.targetCdrConfirmationReads||0)+1):0;
    const targetState=Object.values(check.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs);
    const vtReady=!check.config.cdrRequireVtDrop||targetState&&Detection.hybridVtReady(check,{...targetState,currentVt:last.used,updatedAt:Date.now(),cdr:{decision:{...proof,checkedAt:Date.now()}}},Date.now());
    if(!proof.locked||!vtReady||(Detection.cdrPrimary(check)&&!check.config.cdrRequireVtDrop&&op.targetCdrConfirmationReads<2)){op.stage='WAITING_CDR';op.targetWatchPending=true;op.targetWatchDeadline=Date.now()+(2000);
      await switchSave(f);return;}
    const current=await switchCommand(opensips,{type:'FS_SWITCH_READ_NODE',node:p.target});
    if(current.groupId!==p.groupId||!Number.isFinite(current.used))throw Error('Group ID/VT thay đổi trong lúc kiểm tra CDR.');
    if(!Detection.cdrPrimary(check)&&current.used>initial){op.targetVtIncreased=true;op.stage='VT_INCREASED';return;}
    const rows=await switchCommand(tab,{type:'READ_FS_NUMBERS'});
    const active=(rows.numbers||[]).filter(n=>n.fs===p.target.fs&&n.profile===p.profile&&n.status==='ACTIVE');
    if(active.length!==1||active[0].phone!==p.target.phone||!active[0].hasStatusControl)throw Error('Số ACTIVE thay đổi trong lúc kiểm tra CDR.');
  }
  op.stage='BLOCK_TARGET';op.targetBlockRequestedAt=Date.now();await switchSave(f);
  await switchCommand(tab,{type:'AUTO_BLOCK_FS',fs:p.target.fs,profile:p.profile,phone:p.target.phone});
  const latest=await getState(),at=Date.now();latest.freeSwitchNextActionAt=at+3000;latest.lastFreeSwitchAction={group:p.group,at};
  const target=Object.values(latest.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs&&x.ip===p.target.ip);
  if(target){
    target.cdrBlockOutcome={incidentId:op.id,phone:p.target.phone,at,confirmed:true,mode:f.mode||'MANUAL',cdrCountAtBlock:op.targetCdr?.locked?(op.targetCdr.consecutiveTotal??op.targetCdr.count):null};
    target.baseline=p.source.baseline||target.baseline;target.baselineVt=target.baseline;
    target.incident={id:op.id,locked:true,autoExecuted:true,switchedAt:at,oldPhone:p.target.phone,vtAtSwap:last.used,actionCount:1,rotation:true};
    target.switchedAt=at;target.history=[];target.state='COOLDOWN';target.activeBeforeIncident=true;
    Detection.event(latest,'AUTO_BLOCKED',target,at,Detection.cdrPrimary(latest)?'CDR đích xác nhận 5 cuộc lỗi mới; đã BLOCK số ACTIVE':'VT đích không tăng sau 5 giây; đã BLOCK số ACTIVE');
    Detection.recordGroupAction(latest,target,at);
  }
  op.targetBlocked=true;op.stage='RECOVERING';await saveState(latest);
}
async function performSwitch(plan,f){
  const opensips=await switchTab(`http://10.10.${plan.group}/*`);
  const result=await FsSwitch.execute(plan,f,{
    now:Date.now,save:async feature=>{if(feature.operation)feature.operation.opensipsTabId=opensips;await switchSave(feature);},
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
      if(value!==0&&node.fs===plan.target.fs){
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
      if(value!==0&&node.fs===plan.target.fs){
        const peers=Object.values(latest.fsStates||{}).filter(x=>x.group===group&&x.fs!==plan.source.fs&&x.fs!==plan.target.fs&&Detection.isFsActive(latest,x,at));
        if(peers.length){latest.groupTrials=latest.groupTrials||{};latest.groupTrials[group]={fs:plan.source.fs,completedAt:at,until:at+(latest.config.groupObserveMs??9000),
          peers:Object.fromEntries(peers.map(x=>[x.key,x.currentVt]))};}
      }
      await saveState(latest);
    },
    monitorTarget:async()=>{
      const state=await getState();
      if(Detection.cdrPrimary(state)&&state.config.cdrRequireVtDrop){f.operation.stage='ROUTING_VERIFIED';f.operation.targetWatchPending=false;return;}
      const op=f.operation;op.targetWatchStartedAt=Date.now();op.targetWatchDeadline=Date.now()+5000;
      op.targetWatchPending=true;await switchSave(f);
      // Let the other group work while this group collects fresh VT.
      setTimeout(()=>{messageQueue=messageQueue.then(()=>processSwitch({type:'FS_SWITCH_WATCH',operationId:op.id})).catch(()=>{});},5000);
      chrome.alarms.create('fs-switch-watch-'+op.id,{when:op.targetWatchDeadline});
    }
  });
  if(result.status==='DONE'){
    const latest=await getState();
    if(Detection.cdrPrimary(latest)&&latest.config.cdrRequireVtDrop){
      for(const fs of [plan.source.fs,plan.target.fs])if(f.quarantined[`${plan.group}|${fs}`]===result.id)delete f.quarantined[`${plan.group}|${fs}`];
      await switchSave(f);
    }
    const eventType=plan.action==='ENABLE'?'FS_ENABLED':plan.action==='DISABLE'?'FS_DISABLED':'FS_TRANSFERRED';
    Detection.event(latest,eventType,{group:plan.group,fs:plan.source.fs,incident:{id:result.id}},Date.now(),`${plan.source.fs} → ${plan.target.fs}: Save + Reload xác minh thành công`);
    const event=latest.events.find(e=>e.type===eventType&&e.incidentId===result.id);
    if(event){event.targetFs=plan.target.fs;if(plan.action==='ENABLE')event.fs=plan.target.fs;}
    await saveState(latest);
  }
  return result;
}
async function runDueSwitchWatches(f,operationId){
  const seen=new Set();
  for(const op of [f.operation,...f.history].filter(Boolean)){
    if(seen.has(op.id))continue;seen.add(op.id);
    if(!(op.status==='DONE'||op.status==='FAILED'&&op.stage==='MONITORING_TARGET'&&/Load Balancer/.test(op.error||''))||!op.targetWatchPending&&op.status!=='FAILED'||Date.now()<op.targetWatchDeadline||operationId&&op.id!==operationId)continue;
    f.history=f.history.map(x=>x.id===op.id?op:x);
    op.targetWatchPending=false;op.status='RUNNING';await switchSave(f);
    try{
      if(!f.enabled)throw Error('Thay FS đã OFF; dừng theo dõi tự BLOCK đích.');
      let tab;
      const candidates=await chrome.tabs.query({url:`http://10.10.${op.plan.group}/*`});
      const saved=candidates.find(t=>t.id===op.opensipsTabId);
      if(saved)tab=saved.id;
      else if(candidates.length===1)tab=candidates[0].id;
      else tab=await switchTab(`http://10.10.${op.plan.group}/*`);
      await monitorSwitchTarget(tab,op.plan,f,op);
      op.status='DONE';op.error=null;op.finishedAt=Date.now();
      if(op.targetWatchPending){
        setTimeout(()=>{messageQueue=messageQueue.then(()=>processSwitch({type:'FS_SWITCH_WATCH',operationId:op.id})).catch(()=>{});},2000);
        await chrome.alarms.create('fs-switch-watch-'+op.id,{when:op.targetWatchDeadline});
      }
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
async function toggleFsNode(msg,f,s){
  const policy=FsSwitch.groups[msg.group];
  if(!policy||!policy.fs.includes(msg.fs)||![0,policy.groupId].includes(msg.expected))throw Error('FS/Group ID không hợp lệ.');
  if(f.operation?.status==='RUNNING'||f.operation?.targetWatchPending||f.lastTest?.status==='RUNNING')throw Error('Đang có lượt thay FS; chờ hoàn tất trước khi bật/tắt.');
  const ips={'FS01':'10.10.101.176','FS02':'10.10.101.170','FS03':'10.10.101.184','FS04':'10.10.101.180','FS05':'10.10.101.58','FS06':'10.10.101.87','FS07':'10.10.101.88'};
  const nodes=(s.opensips?.[msg.group]?.nodes||[]).filter(n=>n.fs===msg.fs&&n.ip===ips[msg.fs]&&Number.isInteger(n.destinationId)&&n.destinationId>0);
  if(nodes.length!==1)throw Error('Chưa có destination chính xác; mở Load Balancer và chờ dữ liệu.');
  const node={fs:msg.fs,ip:ips[msg.fs],id:nodes[0].destinationId};
  const tab=await switchTab(`http://10.10.${msg.group}/*`);
  const before=await switchCommand(tab,{type:'FS_SWITCH_READ_NODE',node});
  if(before.groupId!==msg.expected)throw Error('Group ID đã thay đổi; kiểm tra lại trước khi bấm.');
  const value=msg.expected===0?policy.groupId:0;
  const result=await switchCommand(tab,{type:'FS_SWITCH_SET_GROUP',group:msg.group,node,expected:msg.expected,value});
  if(!result.reloaded||result.groupId!==value)throw Error('Chưa xác nhận Reload on Server; kiểm tra OpenSIPS.');
  const verified=await refreshSwitchPage(tab,node,value,result.pageId);
  const latest=await getState(),at=Date.now();
  for(const n of latest.opensips?.[msg.group]?.nodes||[])if(n.fs===msg.fs&&n.ip===node.ip)n.groupId=verified.groupId;
  for(const fs of Object.values(latest.fsStates||{}))if(fs.group===msg.group&&fs.fs===msg.fs&&fs.ip===node.ip){
    fs.groupId=value;fs.groupIdAt=at;fs.cdrEnabledAt=at;fs.activatedAt=value===0?null:at;fs.activationInitialVt=before.used;fs.cdr=null;
    fs.lastIncident=fs.incident;fs.incident=null;fs.candidateId=null;fs.state=value===0?'INACTIVE':'WAITING_CDR';
  }
  latest.pendingAutoActions=(latest.pendingAutoActions||[]).filter(a=>a.group!==msg.group||a.fs!==msg.fs);
  Detection.refreshAlerts(latest,at);await saveState(latest);
  return {ok:true,groupId:value,fs:msg.fs};
}
function reconcileSwitchLocks(f,s){
  if(!Detection.cdrPrimary(s)||!s.config.cdrRequireVtDrop)return;
  for(const op of [f.operation,...f.history].filter(Boolean)){
    const p=op.plan;
    if(!p||!(op.status==='DONE'||op.status==='FAILED'&&['MONITORING_TARGET','WAITING_CDR','VT_INCREASED'].includes(op.stage)))continue;
    const snapshot=s.opensips?.[p.group];
    if(!snapshot||Date.now()-snapshot.updatedAt>45000)continue;
    const source=snapshot.nodes.filter(n=>n.fs===p.source.fs&&n.ip===p.source.ip&&n.destinationId===p.source.id);
    const target=snapshot.nodes.filter(n=>n.fs===p.target.fs&&n.ip===p.target.ip&&n.destinationId===p.target.id);
    if(source.length!==1||target.length!==1||source[0].groupId!==0||target[0].groupId!==p.groupId)continue;
    op.status='DONE';op.stage='ROUTING_VERIFIED';op.targetWatchPending=false;op.error=null;
    for(const fs of [p.source.fs,p.target.fs])if(f.quarantined?.[`${p.group}|${fs}`]===op.id)delete f.quarantined[`${p.group}|${fs}`];
  }
}
async function processSwitch(msg){
  if(msg.type==='FS_SWITCH_TICK'&&typeof runCollectionEvening==='function'){const live=await getState();await runCollectionEvening(live);await saveState(live);}
  const f=await switchState();
  const initial=await switchSnapshot();
  reconcileSwitchLocks(f,initial);
  if(['FS_SWITCH_TICK','FS_SWITCH_WATCH'].includes(msg.type))await runDueSwitchWatches(f,msg.operationId);
  const s=await switchSnapshot();
  if(msg.type==='FS_SWITCH_RELOAD'){
    if(!FsSwitch.groups[msg.group])throw Error('Nhóm OpenSIPS không hợp lệ.');
    if(f.operation?.status==='RUNNING'||f.lastTest?.status==='RUNNING')throw Error('Chờ thao tác thay FS hoàn tất trước khi Reload.');
    const tab=await switchTab(`http://10.10.${msg.group}/*`);
    const result=await switchCommand(tab,{type:'FS_SWITCH_RELOAD_SERVER',group:msg.group});
    if(!result.reloaded)throw Error('Chưa xác nhận lb_reload thành công.');
    await chrome.tabs.reload(tab,{bypassCache:true});
    return {ok:true,group:msg.group,reloaded:true,pageRefreshed:true};
  }
  if(msg.type==='FS_SWITCH_TOGGLE_NODE')return toggleFsNode(msg,f,s);
  if(['FS_SWITCH_TEST_PREVIEW','FS_SWITCH_TEST_CONFIRM'].includes(msg.type))return processSwitchTest(msg,f,s);
  // Release reservations only after the target has truly recovered under detection.
  for(const op of [f.operation,...f.history].filter(x=>x?.status==='DONE')){
    const p=op.plan;
    const target=Object.values(s.fsStates||{}).find(x=>x.group===p.group&&x.fs===p.target.fs);
    if(target?.state==='HEALTHY'&&(Detection.cdrPrimary(s)||target.currentVt>0)&&target.updatedAt>=op.finishedAt+30000){
      if(f.quarantined[`${p.group}|${p.source.fs}`]===op.id)delete f.quarantined[`${p.group}|${p.source.fs}`];
      if(f.quarantined[`${p.group}|${p.target.fs}`]===op.id)delete f.quarantined[`${p.group}|${p.target.fs}`];
    }
  }
  if(msg.type==='FS_SWITCH_THRESHOLD'){
    if(!Number.isSafeInteger(msg.value)||msg.value<0)throw Error('Ngưỡng BACKUP phải là số nguyên từ 0 trở lên.');
    f.backupThreshold=msg.value;
  }
  if(msg.type==='FS_SWITCH_PRESET'){
    const policy=FsSwitch.groups[msg.group];
    if(!policy)throw Error('Nhóm không hợp lệ.');
    if(f.operation?.status==='RUNNING')throw Error('Đang thay FS; chờ thao tác hoàn tất.');
    f.nextSwitch={...f.nextSwitch};
    if(msg.clear)delete f.nextSwitch[msg.group];
    else{
      if((!msg.source&&!msg.target)||(msg.source&&!policy.fs.includes(msg.source))||(msg.target&&!policy.fs.includes(msg.target))||(msg.source&&msg.source===msg.target))throw Error('Chọn FS cần tắt, bật hoặc cả hai; hai FS phải khác nhau và cùng nhóm.');
      f.nextSwitch[msg.group]={source:msg.source,target:msg.target,createdAt:Date.now()};
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
  return {ok:true,feature:f,candidates:FsSwitch.plans(latest,f,Date.now()),diagnostics:FsSwitch.diagnostics(latest,f,Date.now()),threshold:FsSwitch.threshold(f),autoBlockEnabled:latest.autoEnabled,nodes:latest.opensips};
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
