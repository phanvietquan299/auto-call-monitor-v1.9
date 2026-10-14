async function getState(){
  const r=await chrome.runtime.sendMessage({type:"GET_STATE"});
  return r?.state||null;
}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dismissedCdrWarnings=new Set();
const cdrWarningKey=w=>`${w.group}|${w.fs}|${w.pattern}|${w.at}`;
document.querySelector('#summary').onclick=event=>{
  const close=event.target.closest('[data-dismiss-cdr]');
  if(close){dismissedCdrWarnings.add(close.dataset.dismissCdr);close.closest('[data-cdr-warning]').remove();}
};
const age=ts=>ts?Math.max(0,Math.round((Date.now()-ts)/1000))+"s ago":"-";
const clock=ts=>ts?new Date(ts).toLocaleTimeString():"-";

const vietnamDate=ts=>new Date(ts+7*3600000).toISOString().slice(0,10);
let historyPage=1,historyDate=vietnamDate(Date.now()),historyPages=1;
const historyDateInput=document.querySelector('#history-date');historyDateInput.value=historyDate;
historyDateInput.onchange=()=>{historyDate=historyDateInput.value;historyPage=1;render();};
document.querySelector('#history-all').onclick=()=>{historyDate='';historyDateInput.value='';historyPage=1;render();};
function historyPageNumbers(current,total){
  const numbers=[...new Set([1,total,current-1,current,current+1].filter(n=>n>=1&&n<=total))].sort((a,b)=>a-b);
  const result=[];
  for(const n of numbers){const last=result[result.length-1];if(typeof last==='number'&&n-last>1){if(n-last===2)result.push(last+1);else result.push('…');}result.push(n);}
  return result;
}
function goHistoryPage(value){
  const page=Number(value);
  if(!Number.isInteger(page)||page<1||page>historyPages)return;
  historyPage=page;render();
}
document.querySelector('#history-pages').onclick=event=>{
  const button=event.target.closest('[data-history-page]');if(button)goHistoryPage(button.dataset.historyPage);
};
document.querySelector('#history-jump-form').onsubmit=event=>{
  event.preventDefault();goHistoryPage(document.querySelector('#history-jump').value);
};
function renderHistory(s){
  const successful=new Set(['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED']);
  const identities=new Set();
  const logs=(s.events||[]).filter(e=>{
    if(!successful.has(e.type)||!e.fs||!e.incidentId||historyDate&&vietnamDate(e.at)!==historyDate)return false;
    const id=`${e.group}|${e.fs}|${e.incidentId}`;
    if(identities.has(id))return false;identities.add(id);return true;
  });
  const counts={},seen=new Set();
  for(const e of logs){
    if(!['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED'].includes(e.type)||!e.incidentId)continue;
    const id=`${e.group}|${e.fs}|${e.incidentId}`;
    if(seen.has(id))continue;seen.add(id);
    const label=`${e.fs} · ${e.group==='99.153'?'Collection':'Sale'}`;counts[label]=(counts[label]||0)+1;
  }
  document.querySelector('#history-stats').innerHTML=`<p><b>Tổng: ${seen.size} lượt xử lý BLOCK thành công</b> (không tính test, lỗi hoặc đang chờ).</p>`+
    Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)).map(([label,count])=>`<div>${esc(label)}: <b>${count}</b></div>`).join('');
  historyPages=Math.max(1,Math.ceil(logs.length/8));historyPage=Math.min(historyPage,historyPages);
  document.querySelector('#history-page').textContent=`Trang ${historyPage}/${historyPages} · ${logs.length} log`;
  const buttons=historyPageNumbers(historyPage,historyPages).map(n=>typeof n==='number'
    ?`<button type="button" data-history-page="${n}" aria-label="Trang ${n}"${n===historyPage?' aria-current="page"':''}>${n}</button>`
    :'<span class="page-ellipsis" aria-hidden="true">…</span>').join('');
  const navigation=document.querySelector('#history-pages');
  if(navigation.innerHTML!==buttons)navigation.innerHTML=buttons;
  document.querySelector('#history-jump').max=historyPages;
  const historyMarkup=logs.slice((historyPage-1)*8,historyPage*8).map(e=>
    `<div class="event"><time class="log-time" datetime="${new Date(e.at).toISOString()}"><b>${new Date(e.at).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false})}</b><span>${new Date(e.at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</span></time><span class="log-fs">${esc(e.fs||'—')}</span><span class="log-result"><b>${e.type==='FS_ENABLED'?'Đã bật FS':e.type==='FS_DISABLED'?'Đã tắt FS':e.type==='FS_TRANSFERRED'?`Đã chuyển FS → ${esc(e.targetFs||'')}`:'Đã chuyển BLOCKED'}</b>${e.isBackup?' · dự phòng':''}${e.phone?`<span class="log-phone">${esc(e.phone)}</span>`:''}</span></div>`
  ).join('')||'<p class="muted">Chưa có lượt chuyển BLOCKED thành công trong ngày đã chọn.</p>';
  const historyLogs=document.querySelector('#history-logs');
  if(historyLogs.innerHTML!==historyMarkup)historyLogs.innerHTML=historyMarkup;
}


let selectedAction=null, confirmationBusy=false, dismissedAction=null;
const dialog=document.querySelector('#block-dialog');
const actionId=a=>a?`${a.key}|${a.incidentId}|${a.phone}`:null;
let noticeTimer=null;
function confirmationNotice(message){
  if(noticeTimer!==null)clearTimeout(noticeTimer);
  document.querySelector('#confirmation-status').textContent=message;
  noticeTimer=setTimeout(()=>{document.querySelector('#confirmation-status').textContent='';noticeTimer=null;},30000);
}
// Patch existing nodes so touch scrolling keeps the same scroll container and
// browser momentum instead of recreating the entire table every second.
function patchChildren(target,source){
  const wanted=[...source.childNodes];
  for(let i=0;i<wanted.length;i++){
    const next=wanted[i],current=target.childNodes[i];
    if(!current){target.appendChild(next.cloneNode(true));continue;}
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){
      target.replaceChild(next.cloneNode(true),current);continue;
    }
    if(current.nodeType===1){
      for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
      patchChildren(current,next);
    }else if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;
  }
  while(target.childNodes.length>wanted.length)target.removeChild(target.lastChild);
}
function updateGroups(html){
  const template=document.createElement('template');template.innerHTML=html;
  patchChildren(document.querySelector('#groups'),template.content);
}
function deferConfirmation(){
  if(confirmationBusy)return;
  dismissedAction=actionId(selectedAction);dialog.close();
  confirmationNotice('Đang chờ xác nhận. Bấm Xác nhận BLOCK để mở lại và kiểm tra.');
}
async function respondToBlock(type){
  if(!selectedAction||confirmationBusy)return;
  const action={...selectedAction};
  confirmationBusy=true;renderSequence++;
  const confirm=document.querySelector('#block-confirm');
  confirm.disabled=true;confirm.textContent='Đang xử lý…';
  document.querySelector('#block-cancel').disabled=true;
  document.querySelector('#block-later').disabled=true;
  try{
    const r=await chrome.runtime.sendMessage({type,key:action.key,incidentId:action.incidentId,phone:action.phone});
    if(!r?.ok)confirmationNotice(r?.error||'Không thực hiện được thao tác. Kiểm tra lại FreeSWITCH.');
    else confirmationNotice(type==='CONFIRM_AUTO_BLOCK'?'Đã chuyển số ACTIVE → BLOCKED.':'Đã hủy AUTO cho sự cố này.');
  }catch(error){
    confirmationNotice('Mất kết nối extension. Reload extension và tải lại dashboard; kiểm tra trạng thái trên FreeSWITCH.');
  }finally{
    dismissedAction=actionId(action);dialog.close();selectedAction=null;confirmationBusy=false;
    confirm.disabled=false;confirm.textContent='Xác nhận ACTIVE → BLOCKED';
    document.querySelector('#block-cancel').disabled=false;
    document.querySelector('#block-later').disabled=false;
    render().catch(()=>{});
  }
}
document.querySelector('#block-confirm').onclick=()=>respondToBlock('CONFIRM_AUTO_BLOCK');
document.querySelector('#block-cancel').onclick=()=>respondToBlock('CANCEL_AUTO_BLOCK');
document.querySelector('#block-later').onclick=deferConfirmation;
dialog.addEventListener('cancel',event=>{event.preventDefault();deferConfirmation();});
function renderConfirmation(s,force=false){
  if(confirmationBusy||document.querySelector('#fs-node-dialog').open||autoModeDialog.open)return;
  const pending=s.autoEnabled&&s.monitoringEnabled&&s.autoBlockMode!=='AUTOMATIC'?(s.pendingAutoActions||[]).filter(a=>{
    const f=s.fsStates[a.key],trial=s.groupTrials?.[a.group];
    return !s.schedule?.groups?.[a.group]?.paused&&!f?.incident?.locked&&
      (f?.incident?.manualCdrProof||!trial||(Date.now()>=trial.until&&
        (s.config?.detectionSource==='CDR'||trial.peers?.[a.key]==null||(f?.history||[]).filter(x=>x.time>trial.completedAt).length>=2)));
  }):[];
  const action=selectedAction&&pending.find(a=>actionId(a)===actionId(selectedAction))||pending[0];
  const confirmationButton=document.querySelector('#open-confirmation');
  confirmationButton.hidden=pending.length===0;
  confirmationButton.textContent=`Xác nhận BLOCK (${pending.length})`;
  if(!action){
    dialog.close();selectedAction=null;
    if(force)confirmationNotice(Object.values(s.schedule?.groups||{}).some(g=>g.paused)?'Không có yêu cầu BLOCK hợp lệ. Sale nghỉ 11:40–13:00 và 17:00–09:00; Collection nghỉ 12:10–13:00 và 18:00–09:00.':s.autoEnabled?'Chưa có yêu cầu BLOCK hợp lệ chờ xác nhận.':'AUTO BLOCK đang OFF. Bật AUTO để tạo yêu cầu xác nhận.');
    return;
  }
  selectedAction=action;
  document.querySelector('#block-confirm').disabled=action.canConfirm===false;
  const f=s.fsStates[action.key]||{};
  document.querySelector('#block-details').innerHTML=`<p>Nhóm <b>${esc(action.group)}</b> · <b>${esc(action.fs)}</b> · ${esc(action.profile)}</p>
    ${action.isBackup?'<p><b>BLOCK dự phòng · lần 2/2: còn lỗi sau lần đầu.</b></p>':''}<p>IP: ${esc(action.ip)}<br>Số điện thoại: <b>${esc(action.phone)}</b><br>Trạng thái: <b>ACTIVE → BLOCKED</b></p>
    ${s.config?.detectionSource==='CDR'?`<p>CDR: <b>${esc(f.incident?.manualCdrProof?.consecutiveTotal??f.cdr?.decision?.consecutiveTotal??0)}/5 cuộc liên tiếp</b><br>480-0-0 / 480-1-0 · ${esc(age(f.incident?.manualCdrProof?.checkedAt??f.cdr?.decision?.checkedAt))}</p>`:`<p>VT hiện tại: ${esc(f.currentVt)}<br>Baseline: ${esc(f.baseline)}<br>Recent: ${esc(f.recentMedian)}<br>Mức tụt: ${esc(f.dropPercent)}%</p>`}
    <p class="muted">${action.canConfirm===false?esc(action.waitReason||"Đang chờ lượt xử lý")+"<br>":""}${pending.length} sự cố chờ kiểm tra. Chỉ đổi trạng thái số trên; không bấm Đổi Số.</p>`;
  if(force)dismissedAction=null;
  if(!dialog.open&&(force||actionId(action)!==dismissedAction))dialog.showModal();
}
document.querySelector('#open-confirmation').onclick=async()=>{
  try{const s=await getState();if(s)renderConfirmation(s,true);}
  catch(error){confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.');}
};

const autoModeDialog=document.querySelector('#auto-mode-dialog');
async function setAutoBlockMode(mode){
  try{
    const r=await chrome.runtime.sendMessage({type:'SET_AUTO_BLOCK_MODE',mode});
    confirmationNotice(r?.ok?(mode==='AUTOMATIC'?'Đã chọn Tự động. Khi AUTO BLOCK ON sẽ không hỏi từng lần.':'Đã chọn Xác nhận tay.'):r?.error||'Không đổi được chế độ.');
  }catch(error){confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.');}
  finally{autoModeDialog.close();render().catch(()=>{});}
}
document.querySelector('#auto-block-mode').onchange=async event=>{
  if(event.target.value==='AUTOMATIC'){
    if(dialog.open)deferConfirmation();
    autoModeDialog.showModal();
  }else await setAutoBlockMode('MANUAL');
};
document.querySelector('#auto-mode-confirm').onclick=async()=>{
  const button=document.querySelector('#auto-mode-confirm');button.disabled=true;
  try{await setAutoBlockMode('AUTOMATIC');}finally{button.disabled=false;}
};
function cancelAutoMode(){autoModeDialog.close();render().catch(()=>{});}
document.querySelector('#auto-mode-cancel').onclick=cancelAutoMode;
autoModeDialog.addEventListener('cancel',event=>{event.preventDefault();cancelAutoMode();});

let renderSequence=0;
async function render(){
  if(confirmationBusy)return;
  const sequence=++renderSequence;
  const s=await getState(); if(!s||sequence!==renderSequence||confirmationBusy)return;
  if(!autoModeDialog.open)document.querySelector('#auto-block-mode').value=s.autoBlockMode||'MANUAL';
  const toggle=document.querySelector("#toggle");
  const auto=document.querySelector("#auto");
  auto.textContent=s.autoEnabled?"AUTO BLOCK: ON":"AUTO BLOCK: OFF";
  auto.className=s.autoEnabled?"on":"off";
  toggle.textContent=s.monitoringEnabled?"MONITORING: ON":"MONITORING: OFF";
  toggle.className=s.monitoringEnabled?"on":"off";

  const specialWarnings=(s.cdrWarnings||[]).filter(w=>w.at>Date.now()-15000&&!dismissedCdrWarnings.has(cdrWarningKey(w))).slice(0,8);
  const specialMarkup=specialWarnings.length?`<div class="card warning"><b>CẢNH BÁO CDR ĐẶC BIỆT</b>${specialWarnings.map(w=>`<p data-cdr-warning><button type="button" class="secondary" data-dismiss-cdr="${esc(cdrWarningKey(w))}" aria-label="Đóng cảnh báo CDR" style="float:right;padding:2px 10px">×</button><b>${esc(w.fs)} · ${w.group==='99.153'?'Collection':'Sale'}</b> · ${esc(w.ip)}<br><b>${esc(w.pattern)}</b> · ${esc(w.count)} cuộc liên tiếp · ${esc(new Date(w.at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}</p>`).join('')}</div>`:'';
  const alerts=s.alerts||[];
  const blocked=Object.entries(s.fsStates||{}).filter(([key,f])=>f.state==='SUSPECTED'&&!alerts.some(a=>`${a.group}|${a.fs}|${a.ip}`===key));
  const blockedNotice=blocked.length?`<div class="card warning"><b>FS SUSPECTED đang chờ xử lý</b>${blocked.map(([key,f])=>`<p><b>${esc(f.fs)}</b> · ${esc(s.processingStatus?.[key]||f.actionError||'Chưa đủ dữ liệu/điều kiện xử lý; kiểm tra Group ID và trang THAY FS.')}</p>`).join('')}</div>`:'';
  const schedules=s.schedule?.groups||{};
  const pauseNotice=['99.153','99.155'].map(group=>{
    const g=schedules[group],name=group==='99.153'?'Collection':'Sale';
    if(!g?.paused)return '';
    return `<div class="card watching"><b>${name} · ${g.phase==='DAY_END'?`dừng qua đêm ${esc(g.startAt)}–09:00`:`tạm nghỉ ${esc(g.startAt)}–13:00`} (giờ Việt Nam)</b><div>${g.phase==='DAY_END'?'Nhóm này đã ngừng theo lịch; extension không phát hiện/block hoặc yêu cầu xác nhận.':group==='99.155'&&g.phase==='HANDOFF'?'Hệ thống tự động chạy FS08/09/10; extension không tiếp quản.':'Giảm tải theo lịch; không cảnh báo block cho nhóm này.'}</div><div>${g.phase==='DAY_END'?'Vẫn đọc Group ID/CDR. Đến 09:00 đánh giá CDR mới; MONITORING tắt tay vẫn giữ OFF.':'Vẫn đọc Group ID/CDR. Từ 13:00 đánh giá CDR mới.'}</div></div>`;
  }).join('');
  document.querySelector("#summary").innerHTML=specialMarkup+pauseNotice+(alerts.length
    ? `<div class="card bad"><b>${s.config?.cdrVerificationEnabled?'CDR XÁC NHẬN NGHI BLOCK':'SUSPECTED BLOCK'}</b>${alerts.map(a=>`<div>${esc(a.group)} → ${esc(a.fs)} (${esc(a.ip)})${a.actionPending?' · Đang đổi, chưa hoàn tất':a.actionUncertain?' · Chưa xác minh BLOCKED, cần kiểm tra':''}${s.processingStatus?.[`${a.group}|${a.fs}|${a.ip}`]?`<br>${esc(s.processingStatus[`${a.group}|${a.fs}|${a.ip}`])}`:''}</div>`).join("")}${s.autoEnabled
      ? `<div class="action-note">${s.autoBlockMode==='AUTOMATIC'?'AUTO BLOCK: tự đổi ACTIVE → BLOCKED khi đủ điều kiện.':'AUTO BLOCK: chờ bạn kiểm tra và xác nhận trước khi đổi ACTIVE → BLOCKED.'}</div>`
      : `<div class="action-note">${s.config?.cdrVerificationEnabled?'AUTO BLOCK OFF. Chỉ đổi số khi VT tụt theo baseline và CDR đủ 5 cuộc liên tiếp 480-0-0 / 480-1-0.':'ACTION REQUIRED: change the matching FreeSWITCH number from ACTIVE to BLOCKED manually.'}</div>`}</div>`
    : blocked.length?'':`<div class="card good">${s.monitoringEnabled?"No suspected block detected.":"Monitoring is manually OFF."}</div>`)+blockedNotice;

  renderConfirmation(s);

  let groups="";
  for(const g of ["99.153","99.155"]){
    const gr=s.grafana[g]||{}, os=s.opensips[g]||{};
    groups+=`<div class="card"><b>${g}</b> Traffic (tham khảo): <b>${gr.value??"-"}</b> <span class="muted">(${age(gr.updatedAt)})</span>
    <div class="table-wrap"><table><tr><th>FS</th><th>IP</th><th>VT</th><th>State</th><th>Dãy CDR</th><th>Số lần liên tiếp</th><th>Incident / Recovery</th><th>Profile</th></tr>`;
    for(const n of os.nodes||[]){
      const tc=n.trend==="DOWN"?"down":n.trend==="UP"?"up":"";
      const fs=s.fsStates?.[`${g}|${n.fs}|${n.ip}`]||{};
      const groupId=n.groupId??fs.groupId;
      const routed=groupId===(g==='99.153'?2:3);
      const rawState=fs.state||'INACTIVE';
      const awaitingCdr=s.config?.cdrVerificationEnabled&&rawState==='SUSPECTED'&&!fs.incident?.locked&&!fs.incident?.manualCdrProof&&!fs.pairedCdrProof&&(!fs.cdr?.locked||Date.now()-fs.cdr.checkedAt>10000);
      const shownState=awaitingCdr?'WAITING_CDR':rawState==='INACTIVE'?(groupId==null?'UNKNOWN_GROUP':routed?
        (s.schedule?.groups?.[g]?.paused?'PAUSED':s.config?.detectionSource==='CDR'?'WAITING_CDR':n.used>0?'LEARNING':'WAITING_VT'):'INACTIVE'):rawState;
      const learningNote=s.config?.cdrRequireVtDrop&&routed&&!fs.baseline?`Đang học baseline VT: ${(fs.healthyHistory||[]).length}/${s.config.baselineSamples||20} mẫu`:s.config?.detectionSource==='CDR'?(rawState==='WAITING_CDR'?'Chờ cuộc gọi CDR mới; không xử lý dữ liệu cũ':''):awaitingCdr?(fs.cdrStatus||'Chờ CDR 5 cuộc mới nhất 480-0-0 / 480-1-0'):rawState==='INACTIVE'&&routed?(s.schedule?.groups?.[g]?.paused?'Nhóm nghỉ theo lịch':
        !s.monitoringEnabled?'MONITOR đang OFF':n.used>0?
        `FS đang bật; học baseline ${fs.healthyHistory?.length||0}/${s.config.baselineSamples??20} mẫu`:'FS đang bật; chờ VT tăng'):
        rawState==='INACTIVE'&&groupId==null?'Chưa đọc được Group ID; không BLOCK':'';
      const stateClass=fs.state==="SUSPECTED"?"bad":fs.state==="HEALTHY"?"good":
        fs.state==="WATCHING"?"watching":fs.state==="WARNING"?"warning":
        ["COOLDOWN","RECOVERING"].includes(fs.state)?"cooldown":"muted";
      const manualButton=fs.state==='SUSPECTED'&&fs.incident&&!fs.incident.locked
        ? ` <button class="secondary" data-manual-key="${esc(`${g}|${n.fs}|${n.ip}`)}" data-incident-id="${esc(fs.incident.id)}">Đã thay tay</button>`:'';
      const failureButton=fs.incident?.actionUncertain
        ? ` <button class="secondary" data-failure-key="${esc(`${g}|${n.fs}|${n.ip}`)}" data-incident-id="${esc(fs.incident.id)}" data-failure-type="ACK_MANUAL_AFTER_FAILURE">Đã xử lý tay</button>`
        : fs.state==='SUSPECTED'&&fs.autoValidationFailures
          ? ` <button class="secondary" data-failure-key="${esc(`${g}|${n.fs}|${n.ip}`)}" data-incident-id="${esc(fs.incident.id)}" data-failure-type="RECHECK_AUTO_BLOCK">Kiểm tra lại AUTO</button>`:'';
      const switched=fs.incident?.switchedAt;
      const cooldownMs=g==='99.153'?(s.config.collectionCooldownMs??30000):(s.config.saleCooldownMs??30000);
      const remaining=switched?Math.max(0,Math.ceil((cooldownMs-(Date.now()-switched))/1000)):0;
      const queued=fs.state==='SUSPECTED'&&s.autoEnabled&&s.autoBlockMode==='AUTOMATIC'&&fs.autoQueueUntil>Date.now();
      const routingNote=n.groupId===0?'FS tắt trên OpenSIPS; bỏ qua VT còn treo':fs.groupId==null?'Chưa đọc được Group ID; không BLOCK':'';
      const status=learningNote||routingNote||(fs.incident?.actionPending?'Đang chuyển ACTIVE → BLOCKED; chưa hoàn tất':'')||fs.actionError||(queued?`Chờ lượt AUTO · ${Math.ceil((fs.autoQueueUntil-Date.now())/1000)}s`:'')||fs.incident?.actionUncertain&&'Swap result unknown; check manually'||
        (fs.state==='COOLDOWN'?`Locked · ${remaining}s`:fs.state==='RECOVERING'?`Locked · ${fs.recoveryNote||'Chờ CDR mới sau khi đổi số'}`:['WATCHING','WARNING','SUSPECTED'].includes(fs.state)?fs.detectionNote||'':'');
      const cdr=fs.cdr;
      const heldProof=s.autoBlockMode==='MANUAL'&&fs.state==='SUSPECTED'?fs.incident?.manualCdrProof:null;
      const pairedProof=fs.state==='SUSPECTED'&&Date.now()-(fs.pairedCdrProof?.checkedAt||0)<=15000?fs.pairedCdrProof:null;
      const scoring=heldProof||pairedProof||(s.config?.detectionSource==='CDR'?cdr?.decision:cdr);
      const cdrCount=cdr?`${scoring?.consecutiveTotal??scoring?.count??0}/5 liên tiếp`:fs.cdrStatus?'Đang kiểm tra':'Chưa kiểm tra';
      const cdrRecords=(cdr?.records||[]).slice(0,3).map(r=>`<div><b>${esc(r.sipCode??'?')}-${esc(r.setupTime??'?')}-${esc(r.duration??'?')}</b> <span class="muted">${esc(age(r.time))}</span></div>`).join('');
      const cdrCell=`<td data-label="Dãy CDR" class="cdr-data"><div class="cdr-records">${cdrRecords||'<span class="muted">Chờ dữ liệu CDR…</span>'}</div></td>
        <td data-label="Liên tiếp" class="cdr-count"><b>${esc(cdrCount)}</b><br><span class="muted">${heldProof?`Đã ghi nhận · ${esc(clock(heldProof.checkedAt))} · chờ xác nhận`:pairedProof?`CDR 5/5 đã ghi nhận · ${esc(age(pairedProof.checkedAt))}`:'480-0-0 / 480-1-0'}</span></td>`;

      const backupProfile=g==='99.153'?'COLLECTION':'TELESALE';
      const cachedBackup=s.freeswitch?.backupCounts?.[n.fs];
      const backupCount=cachedBackup?.count??(s.freeswitch?.numbers? s.freeswitch.numbers.filter(row=>row.fs===n.fs&&row.profile===backupProfile&&row.status==='BACKUP').length:null);
      groups+=`<tr><td data-label="FS">${esc(n.fs||"?")} (${backupCount??'—'})</td><td data-label="IP">${esc(n.ip)}</td><td data-label="VT">${esc(n.used??fs.currentVt??"—")}/${esc(n.capacity??"—")}</td><td data-label="Trạng thái" class="${stateClass}">${esc(shownState)}<br><span class="muted">Group ID: ${esc(n.groupId??fs.groupId??"—")}</span>${s.config.cdrRequireVtDrop?`<br><span class="muted">Baseline: ${esc(fs.baseline??"—")} · Tụt: ${esc(fs.dropPercent??"—")}%</span>`:""}</td>${routed?cdrCell:'<td data-label="Dãy CDR">FS không hoạt động</td><td data-label="Liên tiếp">—</td>'}<td data-label="Xử lý">${esc(fs.incident?.id||fs.candidateId||"-")}<br>${esc(status)}${fs.baselineRelearnNote?`<br><span class="muted">${esc(fs.baselineRelearnNote)}</span>`:""}${manualButton}${failureButton}${Date.now()-(fs.updatedAt||0)>s.config.staleMs?" · STALE":""}</td><td data-label="Profile">${esc(n.description)}</td></tr>`;
    }
    groups+="</table></div></div>";
  }
  updateGroups(groups);


  const switchButton=document.querySelector('#fs-switch-open');
  switchButton.textContent=`THAY FS: ${s.fsSwitchEnabled?'ON':'OFF'}`;
  switchButton.className=s.fsSwitchEnabled?'on':'off';
  try{const history=await chrome.runtime.sendMessage({type:'HISTORY_READ',date:historyDate});renderHistory(history?.ok&&Array.isArray(history.events)?{...s,events:history.events}:s);document.querySelector('#history-sync-status').textContent=history?.sync?.error?'Mất kết nối Supabase · đang giữ log trên máy và sẽ gửi lại':history?.sync?.source==='SUPABASE'?'Lưu trên Supabase':'Lưu trên máy · chưa kết nối Supabase';}catch(error){renderHistory(s);}
  document.querySelectorAll('[data-failure-key]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try{
      const r=await chrome.runtime.sendMessage({type:button.dataset.failureType,key:button.dataset.failureKey,incidentId:button.dataset.incidentId});
      confirmationNotice(r?.ok?'Đã ghi nhận kiểm tra/xử lý.':r?.error||'Không xử lý được yêu cầu.');
    }catch(error){confirmationNotice('Mất kết nối extension; kiểm tra FreeSWITCH.');}
    finally{button.disabled=false;render().catch(()=>{});}
  });
  document.querySelectorAll('[data-manual-key]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    const r=await chrome.runtime.sendMessage({type:'REPORT_MANUAL_SWAP',key:button.dataset.manualKey,incidentId:button.dataset.incidentId});
    if(!r?.ok)alert(r?.error||'Không ghi nhận được thay số');render();
  });
}
document.querySelector("#auto").onclick=async()=>{
  const s=await getState();
  const result=await chrome.runtime.sendMessage({type:"SET_AUTO",enabled:!s.autoEnabled});
  if(!result?.ok)confirmationNotice(result?.error||'Không bật/tắt được AUTO BLOCK.');
  render();
};
document.querySelector("#toggle").onclick=async()=>{
  const s=await getState();
  await chrome.runtime.sendMessage({type:"SET_MONITORING",enabled:!s.monitoringEnabled});
  render();
};
const clearHistoryDialog=document.querySelector('#clear-history-dialog');
let clearHistoryBusy=false;
document.querySelector('#clear').onclick=()=>{
  document.querySelector('#clear-history-date').value=historyDate||vietnamDate(Date.now());
  document.querySelector('#clear-history-start').value='00:00';
  document.querySelector('#clear-history-end').value='23:59';
  document.querySelector('#clear-history-error').textContent='';
  clearHistoryDialog.showModal();
};
document.querySelector('#clear-history-cancel').onclick=()=>{if(!clearHistoryBusy)clearHistoryDialog.close();};
clearHistoryDialog.addEventListener('cancel',e=>{if(clearHistoryBusy)e.preventDefault();});
document.querySelector('#clear-history-confirm').onclick=async()=>{
  if(clearHistoryBusy)return;
  const date=document.querySelector('#clear-history-date').value,startTime=document.querySelector('#clear-history-start').value,endTime=document.querySelector('#clear-history-end').value;
  const error=document.querySelector('#clear-history-error');
  if(!date||!startTime||!endTime||startTime>endTime){error.textContent='Chọn ngày và khung giờ hợp lệ.';return;}
  clearHistoryBusy=true;document.querySelector('#clear-history-confirm').disabled=true;
  try{
    const r=await chrome.runtime.sendMessage({type:'CLEAR_HISTORY',date,startTime,endTime});
    if(!r?.ok){error.textContent=r?.error||'Chưa xóa được log.';return;}
    clearHistoryDialog.close();historyPage=1;await render();
    confirmationNotice(`Đã xóa ${r.deleted||0} log ngày ${date}, ${startTime}–${endTime}.`);
  }catch(e){error.textContent='Mất kết nối extension; kiểm tra lại trước khi thử.';}
  finally{clearHistoryBusy=false;document.querySelector('#clear-history-confirm').disabled=false;}
};
render().catch(()=>confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.'));
setInterval(()=>render().catch(()=>{}),1000);

const mobileLinkButton=document.querySelector('#create-mobile-link');
mobileLinkButton.onclick=async()=>{
  mobileLinkButton.disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:'CREATE_MOBILE_LINK'});if(!result?.ok)throw Error(result?.error||'Không tạo được liên kết');document.querySelector('#mobile-link-url').value=result.url;document.querySelector('#mobile-link-dialog').showModal();}
  catch(error){confirmationNotice(error.message);}
  finally{mobileLinkButton.disabled=false;}
};
document.querySelector('#mobile-link-copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#mobile-link-url').value);confirmationNotice('Đã sao chép liên kết đăng nhập');}catch(error){document.querySelector('#mobile-link-url').select();}};
document.querySelector('#mobile-link-close').onclick=()=>document.querySelector('#mobile-link-dialog').close();
