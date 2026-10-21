importScripts("history-db.js", "detection.js", "fs-switch.js", "cdr.js", "collection-evening.js");
try{importScripts("supabase-config.js", "history-cloud.js");}catch(error){console.warn("Supabase chưa cấu hình; dùng lịch sử trên máy.");}
const DEFAULT_STATE = {
  autoEnabled: false,
  autoBlockMode: "MANUAL",
  autoCooldowns: {},
  monitoringEnabled: true,
  grafana: {
    "99.153": { value: null, history: [], updatedAt: null },
    "99.155": { value: null, history: [], updatedAt: null }
  },
  opensips: {
    "99.153": { nodes: [], updatedAt: null, diagnostic: null },
    "99.155": { nodes: [], updatedAt: null, diagnostic: null }
  },
  freeswitch: { nodes: [], numbers: [], updatedAt: null },
  alerts: [],
  pendingAutoActions: [],
  confirmedAutoActions: {},
  fsStates: {},
  events: [],
  config: {...Detection.CONFIG,detectionSource:"CDR",cdrVerificationEnabled:true,cdrRequireVtDrop:true},
  detectionVersion: 2,
  eventKeys: {}
};

async function getState() {
  const r = await chrome.storage.local.get(["state","fsSwitch","remoteSync"]);
  if(!r.state) return structuredClone(DEFAULT_STATE);
  const base=structuredClone(DEFAULT_STATE);
  const state={
    ...base,
    ...r.state,
    grafana:{...base.grafana,...(r.state.grafana||{})},
    opensips:{...base.opensips,...(r.state.opensips||{})},
    config:{...base.config,...(r.state.config||{}),baselineSamples:Detection.CONFIG.baselineSamples,sampleIntervalMs:Detection.CONFIG.sampleIntervalMs,groupObserveMs:Detection.CONFIG.groupObserveMs,cdrObservationEnabled:true,cdrRequireVtDrop:r.state.config?.detectionSource==="VT"?false:(r.state.config?.cdrRequireVtDrop??true),detectionSource:r.state.config?.detectionSource||"CDR",cdrVerificationEnabled:(r.state.config?.detectionSource||"CDR")==="CDR",staleMs:45000,sampleGapMs:75000,
      workdayStartMinute:480,scheduledPauseStartMinute:700,
      backupBlockWaitMs:5000,
      freeSwitchActionGapMs:3000,freeSwitchAutomaticGapMs:3000}
  };
  if(r.state.detectionVersion!==2){
    for(const [key,f] of Object.entries(state.fsStates)){
      if(f.incident?.locked||f.incident?.autoExecuted||["COOLDOWN","RECOVERING"].includes(f.state)){
        f.group=key.split("|")[0]; f.key=key; f.history=[];
        f.incident={...f.incident,id:f.incident?.id||key,locked:true,autoExecuted:true,switchedAt:f.incident?.switchedAt||f.switchedAt||Date.now()};
        f.state="COOLDOWN";
      }else delete state.fsStates[key];
    }
    state.pendingAutoActions=[];state.detectionVersion=2;
  }
  // Older versions entered cooldown before receiving a successful page result.
  for(const f of Object.values(state.fsStates||{})){
    if(f.incident&&(f.incident.actionPending||f.incident.actionUncertain)&&
      !f.incident.autoExecuted&&!f.incident.manualExecuted){
      f.state='SUSPECTED';f.incident.locked=true;
      f.incident.switchedAt=null;f.switchedAt=null;f.incident.stableSince=null;
    }
  }
  if(typeof HistoryDB!=='undefined')await HistoryDB.append(state.events);
  const retained=(state.events||[]).slice(0,200);
  state.events=retained;
  state.remoteSync=r.remoteSync||{};
  state.fsSwitchEnabled=!!r.fsSwitch?.enabled;
  state.rotationBarriers=Detection.rotationBarriers(r.fsSwitch);
  return state;
}
async function saveState(state) { if(typeof HistoryDB!=='undefined')await HistoryDB.append(state.events);await chrome.storage.local.set({state:{...state,events:(state.events||[]).slice(0,200)}}); }

const keyOf=Detection.keyOf;
function classify(state){Detection.refreshAlerts(state,Date.now());return state;}

async function broadcastMonitoring(enabled){
  const tabs=await chrome.tabs.query({
    url:["http://10.10.99.153/*","http://10.10.99.155/*"]
  });
  for(const tab of tabs){
    if(!tab.id) continue;
    chrome.tabs.sendMessage(tab.id,{type:"MONITORING_CHANGED",enabled}).catch(()=>{});
  }
}


// All extension status writes share the worker message queue and this spacing.
// Keep the timestamp in storage so a worker restart does not erase the gap.
function nextFreeSwitchAt(state,group){
  const last=state.lastFreeSwitchAction;
  if(group&&last?.group&&last.group!==group)return last.at+3000;
  return state.freeSwitchNextActionAt||0;
}
async function waitForFreeSwitch(state,group){
  const delay=Math.max(0,nextFreeSwitchAt(state,group)-Date.now());
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
}
// Keep one selected phone per FS independently of the inventory page filter.
function updateDisplayNumbers(previous,rows,now,pins={}){
  const display={...(previous||{})};
  for(const fs of ['FS01','FS02','FS03','FS04','FS05','FS06','FS07']){
    const profile=Number(fs.slice(2))<=4?'COLLECTION':'TELESALE';
    const scoped=rows.filter(n=>n.fs===fs&&n.profile===profile);
    const old=display[fs],pinned=pins[fs];
    const current=scoped.find(n=>n.phone===(pinned||old?.phone));
    const active=scoped.filter(n=>n.status==='ACTIVE');
    let chosen;
    if(current?.status==='BACKUP'&&(pinned||old?.phone===current.phone))chosen=current;
    else if(active.length===1)chosen=active[0];
    else if(current&&current.status!=='BLOCKED')chosen=current;
    if(chosen)display[fs]={...chosen,updatedAt:now};
    else if(current?.status==='BLOCKED')delete display[fs];
  }
  return display;
}
async function readManualFreeSwitch(tabId,fs,profile,phone,expectedStatus){
 const read=()=>chrome.tabs.sendMessage(tabId,{type:'READ_FS_NUMBERS'}).catch(()=>null);
 const usable=r=>r?.ok&&(r.numbers||[]).some(n=>n.fs===fs&&n.profile===profile&&n.hasStatusControl&&(phone?n.phone===phone&&n.status===expectedStatus:n.status==='ACTIVE'));
 let result=await read();
 if(usable(result))return result;
 // Refresh only before dispatching a write, never retry an uncertain status change.
 await chrome.tabs.reload(tabId);
 const deadline=Date.now()+10000;
 do{
   await new Promise(resolve=>setTimeout(resolve,500));
   result=await read();if(usable(result))return result;
 }while(Date.now()<deadline);
 return result;
}
let statusWriteInProgress=false;
async function sendFreeSwitchStatus(state,tabId,payload,automatic=false){
  // Reserve before sending; the DOM can update before the SQLite transaction
  // finishes. Reserve a longer quiet period for unattended automatic writes.
  const gap=Math.max(3000,automatic?(state.config.freeSwitchAutomaticGapMs||3000):(state.config.freeSwitchActionGapMs||3000));
  state.freeSwitchNextActionAt=Date.now()+gap;
  await saveState(state);
  statusWriteInProgress=true;
  try{return await chrome.tabs.sendMessage(tabId,payload);}
  finally{
    statusWriteInProgress=false;
    state.freeSwitchNextActionAt=Date.now()+gap;
    state.lastFreeSwitchAction={group:payload.profile==='COLLECTION'?'99.153':payload.profile==='TELESALE'?'99.155':null,at:Date.now()};
    await saveState(state);
  }
}

async function rotationFeature(){const r=await chrome.storage.local.get('fsSwitch');return r.fsSwitch||{};}
function rotationHeld(state,feature,f){return typeof FsSwitch!=='undefined'&&FsSwitch.holds(state,feature,f,Date.now());}
function processingStatus(state,feature){
  const now=Date.now();state.processingStatus={};
  for(const [key,f] of Object.entries(state.fsStates||{})){
    if(f.state!=='SUSPECTED')continue;
    let reason='';
    if(!state.monitoringEnabled)reason='MONITOR đang OFF.';
    else if(Detection.pausedFor(state,f.group))reason='Nhóm đang nghỉ theo lịch.';
    else if(state.fsTestExclusions?.[`${f.group}|${f.fs}`])reason='FS còn khóa test OpenSIPS; không BLOCK số đang test.';
    else if(f.groupId==null)reason='Chưa đọc được Group ID; refresh tab OpenSIPS.';
    else if(f.groupId!==(f.group==='99.153'?2:3))reason='Group ID không thuộc nhóm đang chạy; không BLOCK.';
    else if(!Detection.isFsActive(state,f,now))reason='Group ID đã quá 45 giây chưa cập nhật; kiểm tra tab OpenSIPS.';
    else if(now-f.updatedAt>state.config.staleMs)reason='Group ID đã cũ; chờ dữ liệu OpenSIPS mới.';
    else if(!Detection.groupActionGate(state,f,now).ready)reason=Detection.groupActionGate(state,f,now).reason;
    else if(!Detection.backupReady(state,f,now))reason='BLOCK dự phòng đang chờ nhóm thay FS hoàn tất và bằng chứng mới.';
    else if(rotationHeld(state,feature,f)){
      const reserved=feature.quarantined?.[`${f.group}|${f.fs}`];
      reason=reserved?'FS đang khóa trong lượt Thay FS; xem bước/lỗi trên trang THAY FS.':
        feature.mode==='MANUAL'?'BACKUP ≤ ngưỡng: chờ xác nhận THAY FS. Mở nút THAY FS → Kiểm tra và xác nhận.':
        'BACKUP ≤ ngưỡng: chờ lượt THAY FS tự động.';
      if(f.rotationError)reason+=' '+f.rotationError;
    }else if(f.incident?.autoExecuted)reason='Đã xác nhận BLOCKED; chờ đồng bộ phục hồi.';
    else if(f.incident?.locked)reason=f.incident.actionPending?'Đang chuyển trạng thái, chưa hoàn tất.':f.actionError||'Kết quả BLOCK chưa xác minh; kiểm tra FreeSWITCH.';
    else reason=f.actionError||(!state.autoEnabled?'AUTO BLOCK đang OFF.':state.autoBlockMode==='AUTOMATIC'?'Đang chờ lượt AUTO BLOCK.':'Chờ xác nhận BLOCK.');
    state.processingStatus[key]=reason;
    for(const a of state.pendingAutoActions||[])if(a.key===key){a.canConfirm=Detection.groupActionGate(state,f,now).ready&&Detection.isFsActive(state,f,now)&&Detection.backupReady(state,f,now)&&!rotationHeld(state,feature,f);a.waitReason=a.canConfirm?'':reason;}
  }
}
async function executeAutoBlock(state,f,phone) {
  await waitForFreeSwitch(state,f.group);
  const now=Date.now(),profile=f.group==='99.153'?'COLLECTION':'TELESALE';
  const tabs=await chrome.tabs.query({url:'http://10.10.101.67:5003/*'});
  Detection.applySchedule(state,Date.now());
  if(Detection.pausedFor(state,f.group)){f.actionError='Nhóm này đang nghỉ theo lịch; không BLOCK.';return false;}
  state.rotationBarriers=Detection.rotationBarriers(await rotationFeature());
  if(!Detection.groupActionGate(state,f,Date.now()).ready||!Detection.backupReady(state,f,Date.now())||rotationHeld(state,await rotationFeature(),f)||!Detection.isFsActive(state,f,Date.now())||!Detection.backupTargetValid(state,f,Date.now())||!state.monitoringEnabled||!state.autoEnabled||f.state!=='SUSPECTED'||!f.incident||
    f.incident.locked||f.incident.autoExecuted||f.incident.cancelled||!f.activeBeforeIncident||
    Date.now()-f.updatedAt>state.config.staleMs||(!Detection.cdrPrimary(state)&&f.recentMedian>f.baseline*state.config.suspectRatio)){
    f.actionError='Sự cố đã thay đổi hoặc dữ liệu đã cũ; không BLOCK.';return false;
  }
  if(tabs.length!==1||!tabs[0].id){
    f.actionError=`Expected exactly 1 FreeSWITCH tab; found ${tabs.length}`;
    Detection.event(state,'AUTO_FAILED',f,now,f.actionError);return false;
  }
  // Save the lock before sending the single status change, including failures.
  Object.assign(f.incident,{locked:true,actionCount:1,requestedAt:now,switchedAt:null,oldPhone:phone,vtAtSwap:f.currentVt,actionPending:true});
  f.switchedAt=null;f.actionError=null;
  f.detectionNote='Đang chuyển ACTIVE → BLOCKED; chưa xác nhận hoàn tất';
  Detection.refreshAlerts(state,now);
  await saveState(state);
  try{
    const r=await sendFreeSwitchStatus(state,tabs[0].id,{type:'AUTO_BLOCK_FS',fs:f.fs,profile,phone},state.autoBlockMode==='AUTOMATIC');
    f.incident.actionPending=false;
    if(r?.ok){f.cdrBlockOutcome={incidentId:f.incident.id,phone,at:Date.now(),confirmed:true,cdrCountAtBlock:f.cdr?.incidentId===f.incident.id?(Detection.cdrPrimary(state)?(f.incident.manualCdrProof?.consecutiveTotal??f.pairedCdrProof?.consecutiveTotal??f.cdr.decision?.consecutiveTotal):f.cdr.consecutiveTotal??f.cdr.count):null,mode:state.autoBlockMode||'MANUAL'};f.cdrUsedCallIds=[...new Set([...(f.cdrUsedCallIds||[]),...(f.incident.manualCdrProof?.callIds||f.pairedCdrProof?.callIds||f.cdr?.callIds||[])])].slice(-64);f.incident.autoExecuted=true;f.incident.actionUncertain=false;
      f.incident.switchedAt=Date.now();f.switchedAt=f.incident.switchedAt;
      f.autoValidationFailures=0;f.autoRetryAfter=null;
      Detection.transition(state,f,'COOLDOWN',Date.now(),'FreeSWITCH confirmed BLOCKED; cooldown started');
      Detection.event(state,'AUTO_BLOCKED',f,Date.now(),`${phone} ACTIVE → BLOCKED`);
      Detection.recordGroupAction(state,f,Date.now());
    }else if(r?.attempted===false){
      // The page explicitly rejected validation BEFORE dispatching change.
      // No phone was changed; do not trap the FS in a recovery lock.
      Object.assign(f.incident,{locked:false,actionCount:0,switchedAt:null,actionUncertain:false});
      f.switchedAt=null;f.actionError=r.error||'FreeSWITCH từ chối trước khi đổi trạng thái';
      f.autoValidationFailures=(f.autoValidationFailures||0)+1;
      f.autoRetryAfter=Date.now()+state.config.autoValidationRetryMs;
      Detection.transition(state,f,'SUSPECTED',Date.now(),'No status change attempted; waiting to revalidate');
      Detection.event(state,'AUTO_FAILED',f,Date.now(),`${r.errorCode||'VALIDATION'}: ${f.actionError}`);
      Detection.refreshAlerts(state,Date.now());
    }else{f.incident.actionUncertain=true;f.actionError=r?.error||'Status change result unknown';
      Detection.event(state,'AUTO_FAILED',f,Date.now(),f.actionError);}
  }catch(e){f.incident.actionPending=false;f.incident.actionUncertain=true;f.actionError=String(e);
    Detection.event(state,'AUTO_FAILED',f,Date.now(),f.actionError);}
  Detection.refreshAlerts(state,Date.now());
  await saveState(state);
  return !!f.incident.autoExecuted;
}
async function autoBlockNewAlerts(state) {
  if(typeof runCollectionEvening==='function')await runCollectionEvening(state);
  let feature=await rotationFeature();
  if(typeof scheduleCdrChecks==='function')scheduleCdrChecks(state,feature);
  if(typeof FsSwitch!=='undefined'&&typeof processSwitch==='function'&&feature.enabled&&feature.mode==='AUTOMATIC'&&FsSwitch.plans(state,feature,Date.now()).length){
    const plans=FsSwitch.plans(state,feature,Date.now());
    await saveState(state);
    try{await processSwitch({type:'FS_SWITCH_TICK'});}
    catch(error){
      // A missing tab or a preflight failure must not abort other FS actions.
      const first=plans[0];
      const f=Object.values(state.fsStates).find(x=>x.group===first?.group&&x.fs===first?.source.fs);
      if(f){f.rotationError=String(error.message||error);await saveState(state);}
    }
    Object.assign(state,await getState());feature=await rotationFeature();
  }
  const now=Date.now();
  Detection.applySchedule(state,now);
  state.pendingAutoActions=(state.pendingAutoActions||[]).filter(a=>{
    const f=state.fsStates[a.key];
    return !!f&&(Detection.manualCdrProof(state,f)||Detection.groupActionGate(state,f,Date.now()).ready)&&Detection.backupReady(state,f,now)&&!rotationHeld(state,feature,f)&&Detection.isFsActive(state,f,now)&&Detection.backupTargetValid(state,f,now)&&!Detection.pausedFor(state,a.group)&&state.monitoringEnabled&&state.autoEnabled&&f?.state==='SUSPECTED'&&
      f.incident?.id===a.incidentId&&!f.incident.locked&&!f.incident.cancelled&&
      now-f.updatedAt<=state.config.staleMs&&now-state.freeswitch.updatedAt<=state.config.staleMs&&
      (Detection.cdrPrimary(state)||f.recentMedian<=f.baseline*state.config.suspectRatio)&&
      (state.freeswitch.numbers||[]).filter(n=>n.fs===a.fs&&n.profile===a.profile&&n.status==='ACTIVE').length===1&&
      (state.freeswitch.numbers||[]).some(n=>n.fs===a.fs&&n.profile===a.profile&&n.status==='ACTIVE'&&n.phone===a.phone);
  });
  if(!state.monitoringEnabled||!state.autoEnabled){processingStatus(state,feature);return state;}
  const ordered=[...(state.alerts||[])].sort((a,b)=>{
    if(a.group!==b.group)return a.group.localeCompare(b.group);
    const ranked=Detection.groupCandidates(state,a.group,Date.now()).map(f=>f.key);
    const rank=x=>{const i=ranked.indexOf(keyOf(x));return i<0?Infinity:i;};return rank(a)-rank(b);
  });
  for(const a of ordered){
    const f=state.fsStates[keyOf(a)],profile=a.group==='99.153'?'COLLECTION':'TELESALE';
    if(!f||!Detection.groupActionGate(state,f,Date.now()).ready||!Detection.backupReady(state,f,now)||rotationHeld(state,feature,f)||!Detection.isFsActive(state,f,now)||!Detection.backupTargetValid(state,f,now)||Detection.pausedFor(state,a.group)||!f?.incident||f.state!=='SUSPECTED'||!f.activeBeforeIncident||
      f.incident.cancelled||f.incident.locked||f.incident.autoExecuted||
      now-f.updatedAt>state.config.staleMs||(!Detection.cdrPrimary(state)&&f.recentMedian>f.baseline*state.config.suspectRatio))continue;
    const matches=(state.freeswitch.numbers||[]).filter(n=>n.fs===a.fs&&n.profile===profile&&n.status==='ACTIVE');
    if(matches.length!==1||!matches[0].hasStatusControl||!state.freeswitch.updatedAt||now-state.freeswitch.updatedAt>state.config.staleMs){
      f.actionError=`Expected one fresh ACTIVE ${profile} row with status control; found ${matches.length}`;
      Detection.event(state,'AUTO_FAILED',f,now,f.actionError);continue;
    }
    if(f.incident.oldPhone&&f.incident.oldPhone!==matches[0].phone){
      f.actionError='ACTIVE phone changed; waiting for updated configuration';continue;
    }
    if(!f.autoValidationFailures)f.actionError=null;
    if(state.autoBlockMode==='AUTOMATIC'){
      state.pendingAutoActions=state.pendingAutoActions.filter(x=>x.key!==f.key);
      if(Date.now()<(f.autoRetryAfter||0)||(f.autoValidationFailures||0)>=state.config.maxAutoValidationRetries)continue;
      if(Date.now()<nextFreeSwitchAt(state,f.group)&&state.lastFreeSwitchAction?.group===f.group){
        f.autoQueueUntil=nextFreeSwitchAt(state,f.group);continue;
      }
      f.autoQueueUntil=null;
      await executeAutoBlock(state,f,matches[0].phone);
      continue;
    }
    if(!state.pendingAutoActions.some(x=>x.key===f.key&&x.incidentId===f.incident.id)){
      state.pendingAutoActions.push({...a,key:f.key,profile,phone:matches[0].phone,createdAt:now});
      Detection.event(state,'AUTO_PREVIEW',f,now,'Waiting for user confirmation: ACTIVE → BLOCKED');
    }
  }
  if(typeof runCollectionEvening==='function')await runCollectionEvening(state);
  processingStatus(state,feature);
  return state;
}

let messageQueue=Promise.resolve();
function handleMainMessage(msg,sender,sendResponse){
  if(msg.type?.startsWith('FS_SWITCH_'))return;
  if(msg.type==='HISTORY_READ'&&typeof CloudHistory!=='undefined'){
    if(msg.date&&!/^\d{4}-\d{2}-\d{2}$/.test(msg.date)){sendResponse({ok:false,error:'Ngày không hợp lệ'});return;}
    HistoryDB.read(msg.date||'').then(events=>sendResponse({ok:true,events,sync:CloudHistory.status()})).catch(error=>sendResponse({ok:false,error:String(error)}));return true;
  }
  if(msg.type==='GET_STATE'&&statusWriteInProgress){
    // Read only: expose the persisted SUSPECTED / pending lock while the page
    // is responding, without racing writes or marking the action completed.
    getState().then(state=>sendResponse({ok:true,state})).catch(error=>sendResponse({ok:false,error:String(error)}));
    return true;
  }
  messageQueue=messageQueue.then(async()=>{
    let state=await getState();
    const previousSchedule=JSON.stringify(state.schedule);
    Detection.applySchedule(state,Date.now());

    if(msg.type==="GET_STATE"){
      state.pendingAutoActions=(state.pendingAutoActions||[]).filter(a=>{
        const f=state.fsStates[a.key];
        return f&&f.state==='SUSPECTED'&&f.incident?.id===a.incidentId&&!f.incident.locked&&
          (Detection.manualCdrProof(state,f)||Detection.groupActionGate(state,f,Date.now()).ready);
      });
      Detection.refreshAlerts(state,Date.now());
      const feature=await rotationFeature();state.fsSwitchOperation=feature.operation;
      processingStatus(state,feature);
      await saveState(state);
      sendResponse({ok:true,state});
      return;
    }

    if(msg.type==='MANUAL_FS_STATUS'){
      const fs=String(msg.fs||''),profile=Number(fs.slice(2))<=4?'COLLECTION':'TELESALE';
      if(!/^FS0[1-7]$/.test(fs)||(!msg.refresh&&(!['ACTIVE','BACKUP','BLOCKED'].includes(msg.status)||!['ACTIVE','BACKUP','BLOCKED'].includes(msg.expectedStatus)||!msg.phone))){sendResponse({ok:false,error:'Số hoặc trạng thái không hợp lệ.'});return;}
      await waitForFreeSwitch(state);
      const tabs=await chrome.tabs.query({url:'http://10.10.101.67:5003/*'});
      if(tabs.length!==1||!tabs[0].id){sendResponse({ok:false,error:'Cần mở đúng một tab FreeSWITCH.'});return;}
      // Re-read after queued automatic actions; never apply a click to a replacement phone.
      const read=await readManualFreeSwitch(tabs[0].id,fs,profile,msg.refresh?null:msg.phone,msg.expectedStatus);
      if(msg.refresh){
        if(read?.ok){const previous=state.freeswitch.numbers||[];state.freeswitch={...state.freeswitch,numbers:read.numbers,updatedAt:Date.now(),displayNumbers:updateDisplayNumbers(state.freeswitch.displayNumbers,read.numbers,Date.now(),state.freeswitch.displayPins)};Detection.observeManualSwaps(state,read.numbers,Date.now(),previous);await saveState(state);}
        const ready=(read?.numbers||[]).some(n=>n.fs===fs&&n.profile===profile&&n.status==='ACTIVE'&&n.hasStatusControl);
        sendResponse({ok:!!ready,error:ready?null:'Chưa có số ACTIVE hoặc FreeSWITCH chưa sẵn sàng.'});return;
      }
      const rows=(read?.numbers||[]).filter(n=>n.fs===fs&&n.profile===profile&&n.phone===msg.phone&&n.status===msg.expectedStatus&&n.hasStatusControl);
      if(!read?.ok||rows.length!==1){sendResponse({ok:false,error:'Số hoặc trạng thái đã thay đổi. Chờ cập nhật rồi thử lại.'});return;}
      let result;
      try{result=await sendFreeSwitchStatus(state,tabs[0].id,{type:'MANUAL_FS_STATUS',fs,profile,phone:msg.phone,expectedStatus:msg.expectedStatus,status:msg.status});}
      catch(error){result={ok:false,error:String(error)};}
      if(result?.ok){
        const pins={...(state.freeswitch.displayPins||{})};
        if(msg.status==='BACKUP')pins[fs]=msg.phone;else delete pins[fs];
        const displayNumbers={...(state.freeswitch.displayNumbers||{})};
        if(msg.status==='BLOCKED')delete displayNumbers[fs];
        else displayNumbers[fs]={...rows[0],status:msg.status,updatedAt:Date.now()};
        state.freeswitch={...state.freeswitch,displayNumbers,displayPins:pins};
        if(msg.expectedStatus==='ACTIVE'&&msg.status==='BLOCKED'){
          const node=Object.values(state.fsStates||{}).find(f=>f.fs===fs&&f.group===(profile==='COLLECTION'?'99.153':'99.155'));
          if(node)Detection.recordManualSwap(state,node,Date.now(),`${msg.phone} ACTIVE → BLOCKED trên tool`);
        }
        const latest=await chrome.tabs.sendMessage(tabs[0].id,{type:'READ_FS_NUMBERS'}).catch(()=>null);
        if(latest?.ok){const previous=state.freeswitch.numbers||[];state.freeswitch={...state.freeswitch,numbers:latest.numbers,updatedAt:Date.now(),displayNumbers:updateDisplayNumbers(state.freeswitch.displayNumbers,latest.numbers,Date.now(),state.freeswitch.displayPins)};Detection.observeManualSwaps(state,latest.numbers,Date.now(),previous);}
        state.events.unshift({type:'MANUAL_FS_STATUS',at:Date.now(),fs,group:profile==='COLLECTION'?'99.153':'99.155',phone:msg.phone,detail:`${msg.phone}: ${msg.expectedStatus} → ${msg.status}`});
        await saveState(state);
      }
      if(!result?.ok){
        const at=Date.now();state.importantFailures=[{id:`manual|${fs}|${at}`,fs,at,title:'Đổi trạng thái số thất bại',detail:result?.error||'Chưa xác minh được trạng thái FreeSWITCH.'},...(state.importantFailures||[])].slice(0,20);
        await saveState(state);
      }
      sendResponse(result||{ok:false,error:'Chưa xác minh được trạng thái.'});return;
    }

    if(msg.type==='PREVIEW_TEST_BLOCK_FS01'||msg.type==='CONFIRM_TEST_BLOCK_FS01'){
      if(msg.type==='CONFIRM_TEST_BLOCK_FS01')await waitForFreeSwitch(state);
      const now=Date.now(),fs='FS01',profile='COLLECTION';
      const rows=(state.freeswitch.numbers||[]).filter(n=>n.fs===fs&&n.profile===profile&&n.status==='ACTIVE');
      const node=Object.values(state.fsStates||{}).find(f=>f.group==='99.153'&&f.fs===fs);
      const valid=rows.length===1&&rows[0].hasStatusControl&&state.freeswitch.updatedAt&&
        now-state.freeswitch.updatedAt<=state.config.staleMs;
      if(!valid||node?.currentVt>0){
        sendResponse({ok:false,error:node?.currentVt>0?'FS01 đang có VT > 0, không thực hiện test.':'Cần đúng một số ACTIVE FS01 / COLLECTION và dữ liệu FreeSWITCH mới. Refresh tab FreeSWITCH.'});return;
      }
      if(msg.type==='PREVIEW_TEST_BLOCK_FS01'){
        state.testBlockSequence=(state.testBlockSequence||0)+1;
        state.testBlockPreview={id:`FS01-test-${now}-${state.testBlockSequence}`,phone:rows[0].phone,createdAt:now};
        await saveState(state);sendResponse({ok:true,preview:{...state.testBlockPreview,fs,profile,currentVt:node?.currentVt??null}});return;
      }
      const preview=state.testBlockPreview;
      if(!preview||preview.id!==msg.testId||preview.phone!==msg.phone||rows[0].phone!==msg.phone||now-preview.createdAt>60000){
        sendResponse({ok:false,error:'Yêu cầu test đã cũ hoặc số ACTIVE thay đổi. Bấm Test BLOCK FS01 để kiểm tra lại.'});return;
      }
      const tabs=await chrome.tabs.query({url:'http://10.10.101.67:5003/*'});
      if(tabs.length!==1||!tabs[0].id){sendResponse({ok:false,error:'Cần mở đúng một tab FreeSWITCH.'});return;}
      state.testBlockPreview=null;
      state.lastTestBlock={...preview,at:now,pending:true};
      await saveState(state);
      let result;
      try{result=await sendFreeSwitchStatus(state,tabs[0].id,{type:'AUTO_BLOCK_FS',fs,profile,phone:msg.phone});}
      catch(error){result={ok:false,error:String(error)};}
      state.lastTestBlock.pending=false;state.lastTestBlock.ok=!!result?.ok;
      state.lastTestBlock.error=result?.error;
      state.events.unshift({type:result?.ok?'TEST_BLOCKED':'TEST_BLOCK_FAILED',at:Date.now(),group:'99.153',fs,
        detail:`TEST FS01: ${msg.phone} ACTIVE → BLOCKED${result?.error?' · '+result.error:''}`});
      state.events=(state.events||[]).filter(e=>e.at>Date.now()-3*86400000);
      await saveState(state);sendResponse({ok:!!result?.ok,error:result?.error||(!result?.ok?'Không xác minh được trạng thái; kiểm tra FreeSWITCH.':null)});return;
    }

    if(msg.type==='SET_AUTO_BLOCK_MODE'){
      if(!['MANUAL','AUTOMATIC'].includes(msg.mode)){
        sendResponse({ok:false,error:'Chế độ AUTO BLOCK không hợp lệ.'});return;
      }
      state.autoBlockMode=msg.mode;
      if(msg.mode==='AUTOMATIC')state.pendingAutoActions=[];
      state.events.unshift({type:'AUTO_MODE_CHANGED',at:Date.now(),detail:msg.mode});
      state.events=(state.events||[]).filter(e=>e.at>Date.now()-3*86400000);
      classify(state);await autoBlockNewAlerts(state);
      await saveState(state);sendResponse({ok:true,state});return;
    }

    if(msg.type==="SET_AUTO"){
      state.autoEnabled=!!msg.enabled;
      state.events.unshift({type:state.autoEnabled?"AUTO_ON":"AUTO_OFF",at:Date.now()});
      state.events=(state.events||[]).filter(e=>e.at>Date.now()-3*86400000);
      state=classify(state);state=await autoBlockNewAlerts(state);
      await saveState(state);
      sendResponse({ok:true,state});
      return;
    }

    if(msg.type==='RECHECK_AUTO_BLOCK'){
      const f=state.fsStates[msg.key];
      if(!f||f.state!=='SUSPECTED'||f.incident?.id!==msg.incidentId||f.incident.locked||!f.autoValidationFailures){
        sendResponse({ok:false,error:'Sự cố đã thay đổi hoặc kết quả thao tác chưa rõ; kiểm tra FreeSWITCH.'});return;
      }
      f.autoValidationFailures=0;f.autoRetryAfter=null;f.actionError=null;
      classify(state);await autoBlockNewAlerts(state);await saveState(state);
      sendResponse({ok:!f.actionError,error:f.actionError,state});return;
    }
    if(msg.type==='ACK_MANUAL_AFTER_FAILURE'){
      const f=state.fsStates[msg.key];
      if(!f||f.incident?.id!==msg.incidentId||!f.incident.locked||!f.incident.actionUncertain){
        sendResponse({ok:false,error:'Sự cố không còn chờ kiểm tra tay.'});return;
      }
      f.incident.manualExecuted=true;f.incident.actionUncertain=false;f.incident.switchedAt=Date.now();
      f.incident.stableSince=null;f.switchedAt=f.incident.switchedAt;f.history=[];f.actionError=null;
      Detection.transition(state,f,'COOLDOWN',Date.now(),'User confirmed manual handling after uncertain result');
      Detection.event(state,'MANUAL_SWITCH',f,Date.now(),'User confirmed manual handling; recovery lock retained');
      await saveState(state);sendResponse({ok:true,state});return;
    }

    if(msg.type==='REPORT_MANUAL_SWAP'){
      const f=state.fsStates[msg.key];
      if(!f||f.incident?.id!==msg.incidentId||!Detection.recordManualSwap(state,f,Date.now(),'User reported manual swap; incident locked')){
        sendResponse({ok:false,error:'Incident changed or already locked.'});return;
      }
      await saveState(state);sendResponse({ok:true,state});return;
    }
    if(msg.type==='CANCEL_AUTO_BLOCK'){
      const f=state.fsStates[msg.key];
      if(f?.incident?.id===msg.incidentId&&!f.incident.locked){
        f.incident.cancelled=true;f.incident.rejectedCdrCalls=f.cdr?.decision?.callIds?.join('|');Detection.event(state,'AUTO_CANCELLED',f,Date.now());
      }
      state.pendingAutoActions=state.pendingAutoActions.filter(a=>a.key!==msg.key||a.incidentId!==msg.incidentId);
      await saveState(state);sendResponse({ok:true,state});return;
    }
    if(msg.type==='CONFIRM_AUTO_BLOCK'){
      classify(state);await autoBlockNewAlerts(state);
      const action=state.pendingAutoActions.find(a=>a.key===msg.key&&a.incidentId===msg.incidentId);
      const f=action&&state.fsStates[action.key];
      if(!action||!msg.phone||action.phone!==msg.phone||!f?.activeBeforeIncident||action.group!==f.group||action.fs!==f.fs||
        action.profile!==(f.group==='99.153'?'COLLECTION':'TELESALE')){
        await saveState(state);sendResponse({ok:false,error:'Sự cố hoặc số ACTIVE đã thay đổi, dữ liệu cũ hoặc AUTO đã tắt. Vui lòng kiểm tra lại.'});return;
      }
      state.pendingAutoActions=state.pendingAutoActions.filter(a=>a!==action);
      const ok=await executeAutoBlock(state,f,action.phone);
      // Clear queued peer confirmations immediately, before a dashboard read
      // or another OpenSIPS sample. The group observation starts on success.
      state.pendingAutoActions=state.pendingAutoActions.filter(a=>{
        const peer=state.fsStates[a.key];
        return peer&&!peer.incident?.locked&&(Detection.manualCdrProof(state,peer)||Detection.groupActionGate(state,peer,Date.now()).ready);
      });
      await saveState(state);sendResponse({ok,error:ok?null:f.actionError,state});return;
    }

    if(msg.type==="SET_MONITORING"){
      state.monitoringEnabled=!!msg.enabled;
      if(!state.monitoringEnabled){state.alerts=[];state.pendingAutoActions=[];}
      state.events.unshift({
        type:state.monitoringEnabled?"MONITORING_ON":"MONITORING_OFF",
        at:Date.now()
      });
      state.events=(state.events||[]).filter(e=>e.at>Date.now()-3*86400000);
      await saveState(state);
      await broadcastMonitoring(state.monitoringEnabled);
      sendResponse({ok:true,state});
      return;
    }

    if(msg.type==="GRAFANA_SAMPLE"){
      for(const [group,value] of Object.entries(msg.values||{})){
        if(!state.grafana[group]) continue;
        Detection.grafana(state,group,Number(value),Date.now());
      }
    }

    if(msg.type==="OPENSIPS_SAMPLE"){
      const group=msg.group;
      if(state.opensips[group] && msg.diagnostic?.tableFound && msg.diagnostic?.httpStatus===200){
        const old=state.opensips[group].nodes||[];
        state.opensips[group].nodes=(msg.nodes||[]).map(n=>{
          const prev=old.find(x=>x.ip===n.ip&&x.resource===n.resource);
          const history=[...(prev?.history||[]),n.used].slice(-120);
          return {...n,history};
        });
        state.opensips[group].updatedAt=Date.now();
        state.opensips[group].diagnostic=msg.diagnostic||null;
        for(const n of state.opensips[group].nodes){
          const reserved=`${group}|${n.fs}`;
          if(n.groupId===0&&state.fsTestExclusions?.[reserved]?.releaseAfterOff)delete state.fsTestExclusions[reserved];
        }
        Detection.sample(state,group,state.opensips[group].nodes,Date.now());
      } else if(state.opensips[group]){
        state.opensips[group].diagnostic=msg.diagnostic||null;
      }
    }

    if(msg.type==="FREESWITCH_SAMPLE"){
      const previous=state.freeswitch.numbers||[];
      const backupCounts={...(state.freeswitch.backupCounts||{})};
      const at=Date.now();
      for(const node of msg.data?.backupSummary||[])if(/^FS\d+$/.test(node.fs)&&Number.isInteger(node.backups)&&node.backups>=0)
        backupCounts[node.fs]={count:node.backups,updatedAt:at,source:'SUMMARY'};
      // Preserve display counts when a filtered/empty inventory arrives. This cache is not ACTIVE evidence.
      for(const row of msg.data?.numbers||[])if(row.status==='BACKUP'&&backupCounts[row.fs]?.source!=='SUMMARY')
        backupCounts[row.fs]={count:msg.data.numbers.filter(n=>n.fs===row.fs&&n.profile===row.profile&&n.status==='BACKUP').length,updatedAt:at,source:'INVENTORY'};
      const displayPins=state.freeswitch.displayPins||{};
      const displayNumbers=updateDisplayNumbers(state.freeswitch.displayNumbers,msg.data?.numbers||[],at,displayPins);
      state.freeswitch={...msg.data,backupCounts,updatedAt:at,displayNumbers,displayPins};
      Detection.observeManualSwaps(state,state.freeswitch.numbers||[],Date.now(),previous);
    }

    if(msg.type==='SET_MOBILE_PASSWORD'){
      const config=globalThis.SupabaseHistoryConfig;
      if(!config){sendResponse({ok:false,error:'Chưa có cấu hình Supabase.'});return;}
      const response=await fetch(config.url+'/rest/v1/rpc/call_monitor_mobile?apikey='+encodeURIComponent(config.anonKey),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:'set_password',p_payload:{password:msg.password}}),signal:AbortSignal.timeout(30000)});
      const result=await response.json();sendResponse(response.ok?result:{ok:false,error:result.message||'Không lưu được mật khẩu.'});return;
    }
    if(msg.type==='CREATE_MOBILE_LINK'){
      const config=globalThis.SupabaseHistoryConfig;
      if(!config){sendResponse({ok:false,error:'Chưa có cấu hình Supabase trên máy'});return;}
      const code=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
      const response=await fetch(config.url+'/rest/v1/rpc/call_monitor_mobile_link',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_code:code}),signal:AbortSignal.timeout(10000)});
      if(!response.ok){sendResponse({ok:false,error:'Không tạo được liên kết đăng nhập app'});return;}
      sendResponse({ok:true,url:'https://phanvietquan299.github.io/auto-call-monitor-v1.9/#code='+code});return;
    }
    if(msg.type==='DISMISS_CDR_WARNING'){
      state.cdrWarnings=(state.cdrWarnings||[]).filter(w=>w.fs!==msg.fs);await saveState(state);sendResponse({ok:true});return;
    }
    if(msg.type==='HISTORY_READ'){
      if(typeof HistoryDB==='undefined'){sendResponse({ok:true,events:state.events});return;}
      if(msg.date&&!/^\d{4}-\d{2}-\d{2}$/.test(msg.date)){sendResponse({ok:false,error:'Ngày không hợp lệ'});return;}
      await HistoryDB.append(state.events);sendResponse({ok:true,events:await HistoryDB.read(msg.date||'')});return;
    }
    if(msg.type==="CLEAR_HISTORY"){
      const {date,startTime,endTime}=msg;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||![startTime,endTime].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||''))){
        sendResponse({ok:false,error:'Chọn ngày và khung giờ hợp lệ để xóa log.'});return;
      }
      const start=Date.parse(`${date}T${startTime}:00+07:00`),end=Date.parse(`${date}T${endTime}:00+07:00`)+60000;
      if(!Number.isFinite(start)||new Date(start+7*3600000).toISOString().slice(0,10)!==date||end<=start){
        sendResponse({ok:false,error:'Ngày không hợp lệ hoặc giờ kết thúc phải từ giờ bắt đầu trở đi.'});return;
      }
      const archived=typeof HistoryDB!=='undefined'?await HistoryDB.remove(start,end):null;
      const count=state.events.length;
      state.events=state.events.filter(e=>!(e.at>=start&&e.at<end));
      await saveState(state);sendResponse({ok:true,deleted:archived??count-state.events.length,state});return;
    }

    // Recompute alerts after applying the newest sample.
    state=classify(state);
    state=await autoBlockNewAlerts(state);
    await saveState(state);
    sendResponse({ok:true,state});
  }).catch(e=>sendResponse({ok:false,error:String(e)}));
  return true;
}
chrome.runtime.onMessage.addListener(handleMainMessage);

// Open/focus the dashboard as a normal Chrome tab.
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL("dashboard.html");
  const tabs=await chrome.tabs.query({url});
  if(tabs.length){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true});}
  else await chrome.tabs.create({url});
});

// Extension alarms wake the worker even when source tabs are inactive.
const OPENSIPS_ALARM='opensips-reload';
async function ensureOpenSipsAlarm(){
  if(!await chrome.alarms.get(OPENSIPS_ALARM))
    await chrome.alarms.create(OPENSIPS_ALARM,{periodInMinutes:0.5});
}
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name!==OPENSIPS_ALARM)return;
  (async()=>{
    const separate=await chrome.storage.local.get('fsSwitch');
    if(separate.fsSwitch?.operation?.status==='RUNNING'||separate.fsSwitch?.lastTest?.status==='RUNNING')return;
    const tabs=await chrome.tabs.query({url:['http://10.10.99.153/*','http://10.10.99.155/*']});
    const hosts=new Map();
    for(const t of tabs){
      const host=t.url?.match(/^http:\/\/(10\.10\.99\.(?:153|155))(?:\/|$)/)?.[1]||`tab:${t.id}`;
      if(!hosts.has(host))hosts.set(host,[]);hosts.get(host).push(t);
    }
    const assigned=new Map();
    for(const peers of hosts.values()){
      peers.sort((a,b)=>a.id-b.id);
      if(peers.length>=2){assigned.set(peers[0].id,'LOAD_BALANCER');assigned.set(peers[1].id,'CDR');}
    }
    await Promise.allSettled(tabs.filter(t=>t.id!=null&&!t.active&&t.status!=='loading').map(async t=>{
      const r=await chrome.tabs.sendMessage(t.id,{type:'OPENSIPS_PAGE_ROLE'});
      const role=assigned.get(t.id)||r?.role;
      if(r?.ok&&['CDR','LOAD_BALANCER'].includes(role))
        await chrome.tabs.sendMessage(t.id,{type:'OPENSIPS_REFRESH_TOOL',role});
    }));
    // CDR must also wake independently if VT samples have temporarily stopped.
    if(typeof scheduleCdrChecks==='function'){
      messageQueue=messageQueue.then(async()=>{const state=await getState();scheduleCdrChecks(state);await saveState(state);}).catch(()=>{});
      await messageQueue;
    }
  })().catch(()=>{});
});
chrome.runtime.onInstalled.addListener(()=>{ensureOpenSipsAlarm().catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{ensureOpenSipsAlarm().catch(()=>{});});
ensureOpenSipsAlarm().catch(()=>{});

importScripts("cdr-worker.js", "fs-switch-worker.js", "collection-evening-worker.js");

try{importScripts("telegram-worker.js");}catch(error){console.warn("Telegram bridge unavailable");}
