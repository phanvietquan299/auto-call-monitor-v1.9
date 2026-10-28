/** Tác dụng: Đọc state đã lưu, bổ sung mặc định, chuẩn hóa node và giữ khóa sự cố chưa xác minh. */
async function getState(){
  const r=await chrome.runtime.sendMessage({type:"GET_STATE"});
  return r?.state||null;
}
const esc=/** Tác dụng: Escape ký tự HTML trong dữ liệu trước khi đưa vào giao diện. */ s=>String(s??"").replace(/[&<>"]/g,/** Tác dụng: Thay ký tự hoặc đoạn khớp biểu thức bằng nội dung đã chuyển đổi trong esc. */ c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const manualStatusBusy=new Set();
const manualStatusNotes=new Map();
/** Tác dụng: Chỉ hiển thị số ACTIVE màu xanh khi routing OpenSIPS của FS còn mới và đúng Group ID. */
function fsRoutingActive(s,fs,profile){
 const group=profile==='COLLECTION'?'99.153':'99.155',data=s.opensips?.[group];
 const age=Date.now()-(data?.updatedAt||0),nodes=(data?.nodes||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong fsRoutingActive. */ n=>n.fs===fs);
 return age>=0&&age<45000&&nodes.length===1&&nodes[0].groupId===(group==='99.153'?2:3);
}
/** Tác dụng: Dựng dropdown trạng thái cho đúng số hiển thị, kèm thông báo chờ hoặc kết quả thao tác. */
function manualStatusControl(s,fs,profile){
 const rows=(s.freeswitch?.numbers||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong manualStatusControl. */ n=>n.fs===fs&&n.profile===profile&&n.status==='ACTIVE');
 const row=s.freeswitch?.displayNumbers?.[fs]||(rows.length===1?rows[0]:null);
 if(!row)return `<div class="fs-phone-status muted"><span>Chờ số điện thoại</span><button class="secondary" data-refresh-phone="${esc(fs)}">Đọc lại số</button><select aria-label="Trạng thái số ${esc(fs)}" data-phone-status data-fs="${esc(fs)}" disabled><option value="" selected>Chờ cập nhật số…</option><option value="ACTIVE">⚪ ACTIVE</option><option value="BACKUP">🔵 BACKUP</option><option value="BLOCKED">🔴 BLOCKED</option></select></div>`;
 const busy=manualStatusBusy.has(fs),active=fsRoutingActive(s,fs,profile);
 const note=manualStatusNotes.get(fs),noteHtml=note&&Date.now()<note.until?`<small class="${note.error?'bad':'good'}">${esc(note.text)}</small>`:'';
 return `<div class="fs-phone-status"><span>${esc(row.phone)}</span><select aria-label="Trạng thái số ${esc(fs)}" data-phone-status data-fs="${esc(fs)}" data-phone="${esc(row.phone)}" data-expected="${esc(row.status)}" ${busy?'disabled':''}>${['ACTIVE','BACKUP','BLOCKED'].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong manualStatusControl. */ status=>`<option value="${status}" ${status===row.status?'selected':''}>${{ACTIVE:active?'🟢':'⚪',BACKUP:'🔵',BLOCKED:'🔴'}[status]} ${status}</option>`).join('')}</select>${busy?'<small>Đang đổi…</small>':noteHtml}</div>`;
}
document.querySelector('#groups').addEventListener('click',/** Tác dụng: Xử lý nút được bấm theo thuộc tính dữ liệu và gửi yêu cầu tương ứng. */ async event=>{
 const button=event.target.closest('[data-refresh-phone]');if(!button)return;
 button.disabled=true;confirmationNotice('Đang đọc lại số từ FreeSWITCH…');
 try{const result=await chrome.runtime.sendMessage({type:'MANUAL_FS_STATUS',fs:button.dataset.refreshPhone,refresh:true});if(!result?.ok)throw Error(result?.error||'Chưa đọc được số.');confirmationNotice('Đã đọc lại số FreeSWITCH.');}
 catch(error){confirmationNotice(error.message);}finally{button.disabled=false;render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});}
});
let nodePickerGroup=null,nodePickerState=null,nodePickerRows=[],nodePickerBusy=false;
const nodePickerDialog=document.querySelector('#node-picker-dialog');
/** Tác dụng: Dựng danh sách node của nhóm với checkbox theo lựa chọn hiển thị đã lưu. */
function drawNodePicker(){
 const group=nodePickerGroup,data=nodePickerState?.opensips?.[group]||{};
 nodePickerRows=FsSwitch.nodeCatalog(nodePickerState||{},group);
 const selected=nodePickerState?.nodeDisplay?.[group];
 document.querySelector('#node-picker-title').textContent=`Thêm node · ${group==='99.153'?'Collection':'Sale'}`;
 document.querySelector('#node-picker-list').innerHTML=nodePickerRows.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong drawNodePicker. */ (n,index)=>{
  const checked=Array.isArray(selected)?selected.includes(n.ip):(data.nodes||[]).some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong drawNodePicker. */ x=>x.ip===n.ip);
  const destinations=n.destinations.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong drawNodePicker. */ d=>`ID ${d.id??'—'} · Group ${d.groupId??'—'}`).join(' / ');
  return `<label class="node-picker-item"><input type="checkbox" data-node-pick="${index}" ${checked?'checked':''}><span><b>${esc(n.fs||'Chưa ghép tên FS')}</b> · ${esc(n.ip)}<small>${esc(destinations)}${n.ambiguous?' · Nhiều destination chưa phân biệt':''}${!n.fs?' · OpenSIPS/FreeSWITCH chưa cung cấp tên tương ứng':''}</small></span></label>`;
 }).join('')||'<p class="muted">Chưa có dữ liệu node. Mở tab OpenSIPS đã đăng nhập rồi tải lại.</p>';
}
/** Tác dụng: Khóa/mở nút tải và lưu node trong khi yêu cầu đang xử lý. */
function nodePickerSetBusy(value){nodePickerBusy=value;for(const id of ['node-picker-refresh','node-picker-save'])document.getElementById(id).disabled=value;}
/** Tác dụng: Yêu cầu tải catalog OpenSIPS mới và cập nhật danh sách chọn node hoặc lỗi kết nối. */
async function loadNodePicker(){
 if(nodePickerBusy)return;nodePickerSetBusy(true);document.querySelector('#node-picker-status').textContent='Đang tải node từ OpenSIPS…';
 try{
  const r=await chrome.runtime.sendMessage({type:'FS_SWITCH_SETTINGS',refreshGroup:nodePickerGroup});
  if(!r?.ok)throw Error(r?.error||'Không tải được node');
  nodePickerState=r.state||await getState();
  if(r.nodePicker){nodePickerState.opensips[nodePickerGroup].catalog=r.nodePicker.catalog;nodePickerState.nodeDisplay=r.nodePicker.nodeDisplay;}
  drawNodePicker();document.querySelector('#node-picker-status').textContent=`Đã tải ${nodePickerRows.length} node.`;
 }catch(e){document.querySelector('#node-picker-status').textContent=e.message;}
 finally{nodePickerSetBusy(false);}
}
document.querySelector('#groups').addEventListener('click',/** Tác dụng: Xử lý nút được bấm theo thuộc tính dữ liệu và gửi yêu cầu tương ứng. */ async event=>{
 const button=event.target.closest('[data-add-node]');if(!button||nodePickerBusy)return;
 nodePickerGroup=button.dataset.addNode;nodePickerState=await getState();drawNodePicker();nodePickerDialog.showModal();loadNodePicker();
});
document.querySelector('#node-picker-refresh').onclick=loadNodePicker;
document.querySelector('#node-picker-cancel').onclick=/** Tác dụng: Đóng hộp chọn node mà không lưu thay đổi tick. */ ()=>nodePickerDialog.close();
document.querySelector('#node-picker-save').onclick=/** Tác dụng: Lưu các IP đã tick theo nhóm; giữ lựa chọn tạm vắng và cập nhật bảng hiển thị. */ async()=>{
 if(nodePickerBusy)return;
 const selected=new Set([...document.querySelectorAll('[data-node-pick]:checked')].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng. */ el=>nodePickerRows[Number(el.dataset.nodePick)].ip));
 // Preserve selected nodes temporarily absent from the latest server response.
 for(const ip of nodePickerState?.nodeDisplay?.[nodePickerGroup]||[])if(!nodePickerRows.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện. */ n=>n.ip===ip))selected.add(ip);
 nodePickerSetBusy(true);
 try{const r=await chrome.runtime.sendMessage({type:'FS_SWITCH_SETTINGS',displayGroup:nodePickerGroup,displayIps:[...selected]});
  if(!r?.ok)throw Error(r?.error||'Không lưu được lựa chọn');nodePickerDialog.close();confirmationNotice('Đã cập nhật phạm vi node được monitor.');await render();
 }catch(e){document.querySelector('#node-picker-status').textContent=e.message;}finally{nodePickerSetBusy(false);}
};
document.querySelector('#groups').addEventListener('change',/** Tác dụng: Kiểm tra giá trị người dùng đổi rồi gửi lệnh đúng số/trạng thái mong đợi. */ async event=>{
 const select=event.target.closest('[data-phone-status]');if(!select)return;
 const {fs,phone,expected}=select.dataset,status=select.value;
 if(status===expected||manualStatusBusy.has(fs))return;
 manualStatusBusy.add(fs);select.disabled=true;
 confirmationNotice(`${fs}: đang đổi ${expected} → ${status}…`);
 try{
  const result=await chrome.runtime.sendMessage({type:'MANUAL_FS_STATUS',fs,phone,expectedStatus:expected,status});
  if(!result?.ok)throw Error(result?.error||'Không xác minh được trạng thái.');
  manualStatusNotes.set(fs,{text:`Đã đổi ${phone} → ${status}`,until:Date.now()+30000});
  confirmationNotice(`${fs}: đã đổi ${phone} → ${status}`);
 }catch(error){select.value=expected;manualStatusNotes.set(fs,{text:error.message,error:true,until:Date.now()+30000});confirmationNotice(error.message);}
 finally{manualStatusBusy.delete(fs);select.disabled=false;select.blur?.();render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});}
});
/** Tác dụng: Tổng hợp lỗi thao tác và sự cố cần chú ý để hiển thị nổi bật trên dashboard. */
function importantAlerts(s,now=Date.now()){
 const out=(s.importantFailures||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong importantAlerts. */ a=>now-a.at<86400000).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong importantAlerts. */ a=>({...a}));
 for(const f of Object.values(s.fsStates||{})){
  const i=f.incident||{},base=`${f.group}|${f.fs}|${i.id||'none'}`;
  if(i.actionUncertain||(!i.actionPending&&f.actionError&&!i.autoExecuted&&!i.manualExecuted))out.push({id:base+'|failure|'+(f.actionError||''),fs:f.fs,at:i.requestedAt||f.updatedAt,title:i.actionUncertain?'Chưa xác minh được kết quả đổi số':'Không đổi được số',detail:f.actionError||'Kiểm tra trạng thái FreeSWITCH trước khi thử lại.'});
  const cdr=f.cdr?.decision||f.cdr,switched=i.switchedAt||f.switchedAt;
  const attempts=new Set([...(i.attemptedPhones||[]),...(i.previousPhone?[i.previousPhone]:[]),...(i.oldPhone?[i.oldPhone]:[])]).size;
  const cdrAt=cdr?.checkedAt||f.cdr?.checkedAt;
  const active=f.groupId===(f.group==='99.153'?2:3);
  if(active&&!s.schedule?.groups?.[f.group]?.paused&&(i.autoExecuted||i.manualExecuted)&&!i.actionPending&&attempts>=2&&switched&&now-switched>=5000&&now-f.updatedAt<=45000&&now-cdrAt<=10000&&cdrAt>switched&&cdr?.newestCallTime>switched&&cdr.locked){
   out.push({id:base+'|no-recovery',fs:f.fs,at:switched,title:`Đã đổi ${attempts} số nhưng CDR vẫn lỗi`,detail:`VT hiện tại ${f.currentVt}; CDR mới vẫn báo lỗi liên tiếp. Cần kiểm tra FS/đầu số.`});
  }
 }
 const op=s.fsSwitchOperation;
 if(op?.status==='FAILED')out.push({id:`rotation|${op.id||op.startedAt||op.finishedAt}|${op.error}`,fs:op.plan?.source?.fs,title:'Thay FS thất bại',at:op.finishedAt||op.startedAt,detail:op.error||'Kiểm tra OpenSIPS/FreeSWITCH trước khi tiếp tục.'});
 return out;
}
let seenImportant=[];
try{seenImportant=JSON.parse(localStorage.getItem('monitor-important-seen')||'[]');if(!Array.isArray(seenImportant))seenImportant=[];}catch(_){}
const dismissedImportant=new Set(seenImportant);
document.querySelector('#summary').addEventListener('click',/** Tác dụng: Xử lý nút được bấm theo thuộc tính dữ liệu và gửi yêu cầu tương ứng. */ event=>{
 const button=event.target.closest('[data-important-dismiss]');if(!button)return;
 dismissedImportant.add(button.dataset.importantDismiss);
 try{localStorage.setItem('monitor-important-seen',JSON.stringify([...dismissedImportant].slice(-100)));}catch(_){}
 button.closest('[data-important-alert]').remove();
});
const dismissedCdrWarnings=new Set();
const cdrWarningKey=/** Tác dụng: Tạo khóa ổn định cho một cảnh báo chuỗi CDR đặc biệt. */ w=>`${w.group}|${w.fs}|${w.pattern}|${w.at}`;
document.querySelector('#summary').onclick=/** Tác dụng: Xử lý nút đóng cảnh báo CDR đặc biệt trong phần tổng quan. */ event=>{
  const close=event.target.closest('[data-dismiss-cdr]');
  if(close){dismissedCdrWarnings.add(close.dataset.dismissCdr);close.closest('[data-cdr-warning]').remove();}
};
const age=/** Tác dụng: Định dạng thời gian đã trôi qua từ lần cập nhật để giao diện thể hiện độ mới. */ ts=>ts?Math.max(0,Math.round((Date.now()-ts)/1000))+"s ago":"-";
const clock=/** Tác dụng: Định dạng timestamp thành giờ hiển thị theo múi giờ dùng trong giao diện. */ ts=>ts?new Date(ts).toLocaleTimeString():"-";

const vietnamDate=/** Tác dụng: Tạo ngày lọc lịch sử theo giờ Việt Nam thay vì múi giờ máy chạy. */ ts=>new Date(ts+7*3600000).toISOString().slice(0,10);
let historyPage=1,historyDate=vietnamDate(Date.now()),historyPages=1;
const historyDateInput=document.querySelector('#history-date');historyDateInput.value=historyDate;
historyDateInput.onchange=/** Tác dụng: Lưu ngày lịch sử người dùng chọn và tải lại trang đầu của ngày đó. */ ()=>{historyDate=historyDateInput.value;historyPage=1;render();};
document.querySelector('#history-all').onclick=/** Tác dụng: Chuyển bộ lọc lịch sử sang tất cả ngày và quay về trang đầu. */ ()=>{historyDate='';historyDateInput.value='';historyPage=1;render();};
/** Tác dụng: Chọn các số trang cần hiển thị để thanh phân trang lịch sử không quá dài. */
function historyPageNumbers(current,total){
  const numbers=[...new Set([1,total,current-1,current,current+1].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong historyPageNumbers. */ n=>n>=1&&n<=total))].sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong historyPageNumbers. */ (a,b)=>a-b);
  const result=[];
  for(const n of numbers){const last=result[result.length-1];if(typeof last==='number'&&n-last>1){if(n-last===2)result.push(last+1);else result.push('…');}result.push(n);}
  return result;
}
/** Tác dụng: Đổi trang lịch sử trong giới hạn hợp lệ và cập nhật giao diện. */
function goHistoryPage(value){
  const page=Number(value);
  if(!Number.isInteger(page)||page<1||page>historyPages)return;
  historyPage=page;render();
}
document.querySelector('#history-pages').onclick=/** Tác dụng: Chuyển trang khi người dùng bấm một nút phân trang lịch sử. */ event=>{
  const button=event.target.closest('[data-history-page]');if(button)goHistoryPage(button.dataset.historyPage);
};
document.querySelector('#history-jump-form').onsubmit=/** Tác dụng: Kiểm tra số trang nhập tay và chuyển tới trang lịch sử tương ứng. */ event=>{
  event.preventDefault();goHistoryPage(document.querySelector('#history-jump').value);
};
/** Tác dụng: Lọc, đếm và phân trang các sự kiện lịch sử theo ngày đang chọn. */
function renderHistory(s){
  const successful=new Set(['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED']);
  const identities=new Set();
  const logs=(s.events||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderHistory. */ e=>{
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
    Object.entries(counts).sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong renderHistory. */ ([a],[b])=>a.localeCompare(b)).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderHistory. */ ([label,count])=>`<div>${esc(label)}: <b>${count}</b></div>`).join('');
  historyPages=Math.max(1,Math.ceil(logs.length/8));historyPage=Math.min(historyPage,historyPages);
  document.querySelector('#history-page').textContent=`Trang ${historyPage}/${historyPages} · ${logs.length} log`;
  const buttons=historyPageNumbers(historyPage,historyPages).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderHistory. */ n=>typeof n==='number'
    ?`<button type="button" data-history-page="${n}" aria-label="Trang ${n}"${n===historyPage?' aria-current="page"':''}>${n}</button>`
    :'<span class="page-ellipsis" aria-hidden="true">…</span>').join('');
  const navigation=document.querySelector('#history-pages');
  if(navigation.innerHTML!==buttons)navigation.innerHTML=buttons;
  document.querySelector('#history-jump').max=historyPages;
  const historyMarkup=logs.slice((historyPage-1)*8,historyPage*8).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderHistory. */ e=>
    `<div class="event"><time class="log-time" datetime="${new Date(e.at).toISOString()}"><b>${new Date(e.at).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false})}</b><span>${new Date(e.at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</span></time><span class="log-fs">${esc(e.fs||'—')}</span><span class="log-result"><b>${e.type==='FS_ENABLED'?'Đã bật FS':e.type==='FS_DISABLED'?'Đã tắt FS':e.type==='FS_TRANSFERRED'?`Đã chuyển FS → ${esc(e.targetFs||'')}`:'Đã chuyển BLOCKED'}</b>${e.isBackup?' · dự phòng':''}${e.phone?`<span class="log-phone">${esc(e.phone)}</span>`:''}</span></div>`
  ).join('')||'<p class="muted">Chưa có lượt chuyển BLOCKED thành công trong ngày đã chọn.</p>';
  const historyLogs=document.querySelector('#history-logs');
  if(historyLogs.innerHTML!==historyMarkup)historyLogs.innerHTML=historyMarkup;
}


let selectedAction=null, confirmationBusy=false, dismissedAction=null;
const dialog=document.querySelector('#block-dialog');
const actionId=/** Tác dụng: Tạo định danh yêu cầu xác nhận từ sự cố và số đích để phân biệt các lượt xử lý. */ a=>a?`${a.key}|${a.incidentId}|${a.phone}`:null;
let noticeTimer=null;
/** Tác dụng: Hiển thị thông báo xác nhận/lỗi tạm thời và hẹn xóa thông báo cũ. */
function confirmationNotice(message){
  if(noticeTimer!==null)clearTimeout(noticeTimer);
  document.querySelector('#confirmation-status').textContent=message;
  noticeTimer=setTimeout(/** Tác dụng: Chạy bước tiếp theo sau thời gian chờ trong confirmationNotice. */ ()=>{document.querySelector('#confirmation-status').textContent='';noticeTimer=null;},30000);
}
// Patch existing nodes so touch scrolling keeps the same scroll container and
// browser momentum instead of recreating the entire table every second.
/** Tác dụng: Cập nhật DOM tại chỗ, giữ phần tử/control đang tương tác và vị trí cuộn khi có thể. */
function patchChildren(target,source){
  const wanted=[...source.childNodes];
  for(let i=0;i<wanted.length;i++){
    const next=wanted[i],current=target.childNodes[i];
    if(!current){target.appendChild(next.cloneNode(true));continue;}
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){
      target.replaceChild(next.cloneNode(true),current);continue;
    }
    if(current.nodeType===1){
      if(current.nodeName==='SELECT'&&current.hasAttribute('data-phone-status')){
        const sameTarget=current.getAttribute('data-fs')===next.getAttribute('data-fs')&&current.getAttribute('data-phone')===next.getAttribute('data-phone');
        if(sameTarget&&(document.activeElement===current||manualStatusBusy.has(current.dataset.fs)))continue;
        // A replacement phone must close the old picker before receiving new options.
        if(!sameTarget&&document.activeElement===current)current.blur();
      }
      for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
      patchChildren(current,next);
      if(current.nodeName==='SELECT'&&current.hasAttribute('data-phone-status')&&!manualStatusBusy.has(current.dataset.fs))current.value=next.value;
    }else if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;
  }
  while(target.childNodes.length>wanted.length)target.removeChild(target.lastChild);
}
/** Tác dụng: Phân tích HTML bảng mới và vá cây DOM hiện tại qua patchChildren. */
function updateGroups(html){
  const template=document.createElement('template');template.innerHTML=html;
  patchChildren(document.querySelector('#groups'),template.content);
}
/** Tác dụng: Đóng hộp xác nhận và ghi nhớ lượt đang hoãn, không thực hiện thay đổi số. */
function deferConfirmation(){
  if(confirmationBusy)return;
  dismissedAction=actionId(selectedAction);dialog.close();
  confirmationNotice('Đang chờ xác nhận. Bấm Xác nhận BLOCK để mở lại và kiểm tra.');
}
/** Tác dụng: Gửi xác nhận hoặc hủy đúng yêu cầu BLOCK; khóa nút khi chờ và hiển thị kết quả. */
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
    render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong respondToBlock. */ ()=>{});
  }
}
document.querySelector('#block-confirm').onclick=/** Tác dụng: Xác nhận thao tác BLOCK cho đúng sự cố và số đang chờ. */ ()=>respondToBlock('CONFIRM_AUTO_BLOCK');
document.querySelector('#block-cancel').onclick=/** Tác dụng: Hủy yêu cầu BLOCK hiện tại mà không thay đổi số. */ ()=>respondToBlock('CANCEL_AUTO_BLOCK');
document.querySelector('#block-later').onclick=deferConfirmation;
dialog.addEventListener('cancel',/** Tác dụng: Chặn đóng hộp thoại theo mặc định và chuyển yêu cầu BLOCK sang chờ xác nhận lại. */ event=>{event.preventDefault();deferConfirmation();});
/** Tác dụng: Chọn yêu cầu còn hợp lệ, dựng nội dung và điều khiển việc mở hộp xác nhận BLOCK. */
function renderConfirmation(s,force=false){
  if(confirmationBusy||document.querySelector('#fs-node-dialog').open||autoModeDialog.open)return;
  const pending=s.autoEnabled&&s.monitoringEnabled&&s.autoBlockMode!=='AUTOMATIC'?(s.pendingAutoActions||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderConfirmation. */ a=>{
    const f=s.fsStates[a.key],trial=s.groupTrials?.[a.group];
    return !s.schedule?.groups?.[a.group]?.paused&&!f?.incident?.locked&&
      (f?.incident?.manualCdrProof||!trial||(Date.now()>=trial.until&&
        (s.config?.detectionSource==='CDR'||trial.peers?.[a.key]==null||(f?.history||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderConfirmation. */ x=>x.time>trial.completedAt).length>=2)));
  }):[];
  const action=selectedAction&&pending.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong renderConfirmation. */ a=>actionId(a)===actionId(selectedAction))||pending[0];
  const confirmationButton=document.querySelector('#open-confirmation');
  confirmationButton.hidden=pending.length===0;
  confirmationButton.textContent=`Xác nhận BLOCK (${pending.length})`;
  if(!action){
    dialog.close();selectedAction=null;
    if(force)confirmationNotice(Object.values(s.schedule?.groups||{}).some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong renderConfirmation. */ g=>g.paused)?'Không có yêu cầu BLOCK hợp lệ. Sale nghỉ 11:40–13:00 và 17:00–08:00; Collection nghỉ 12:10–13:00 và 18:00–08:00.':s.autoEnabled?'Chưa có yêu cầu BLOCK hợp lệ chờ xác nhận.':'AUTO BLOCK đang OFF. Bật AUTO để tạo yêu cầu xác nhận.');
    return;
  }
  selectedAction=action;
  document.querySelector('#block-confirm').disabled=action.canConfirm===false;
  const f=s.fsStates[action.key]||{};
  const os01Only=f.incident?.os01CdrOnly;
  document.querySelector('#block-details').innerHTML=`<p>Nhóm <b>${esc(action.group)}</b> · <b>${esc(action.fs)}</b> · ${esc(action.profile)}</p>
    ${os01Only?'<p><b>OS01: hai lượt Search liên tiếp lỗi 5/5; không yêu cầu VT tụt.</b></p>':''}${action.isBackup?'<p><b>BLOCK dự phòng: CDR mới vẫn lỗi sau khi đổi số.</b></p>':''}<p>IP: ${esc(action.ip)}<br>Số điện thoại: <b>${esc(action.phone)}</b><br>Trạng thái: <b>ACTIVE → BLOCKED</b></p>
    ${s.config?.detectionSource==='CDR'?`<p>CDR: <b>${esc(f.incident?.manualCdrProof?.consecutiveTotal??f.cdr?.decision?.consecutiveTotal??0)}/5 cuộc liên tiếp</b><br>480-0-0 / 480-1-0 · ${esc(age(f.incident?.manualCdrProof?.checkedAt??f.cdr?.decision?.checkedAt))}</p>`:`<p>VT hiện tại: ${esc(f.currentVt)}<br>Baseline: ${esc(f.baseline)}<br>Recent: ${esc(f.recentMedian)}<br>Mức tụt: ${esc(f.dropPercent)}%</p>`}
    <p class="muted">${action.canConfirm===false?esc(action.waitReason||"Đang chờ lượt xử lý")+"<br>":""}${pending.length} sự cố chờ kiểm tra. Chỉ đổi trạng thái số trên; không bấm Đổi Số.</p>`;
  if(force)dismissedAction=null;
  if(!dialog.open&&(force||actionId(action)!==dismissedAction))dialog.showModal();
}
document.querySelector('#open-confirmation').onclick=/** Tác dụng: Mở lại hộp xác nhận cho yêu cầu BLOCK hợp lệ đang chờ. */ async()=>{
  try{const s=await getState();if(s)renderConfirmation(s,true);}
  catch(error){confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.');}
};

const autoModeDialog=document.querySelector('#auto-mode-dialog');
/** Tác dụng: Gửi chế độ BLOCK tay/tự động và phản ánh kết quả về giao diện. */
async function setAutoBlockMode(mode){
  try{
    const r=await chrome.runtime.sendMessage({type:'SET_AUTO_BLOCK_MODE',mode});
    confirmationNotice(r?.ok?(mode==='AUTOMATIC'?'Đã chọn Tự động. Khi AUTO BLOCK ON sẽ không hỏi từng lần.':'Đã chọn Xác nhận tay.'):r?.error||'Không đổi được chế độ.');
  }catch(error){confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.');}
  finally{autoModeDialog.close();render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong setAutoBlockMode. */ ()=>{});}
}
document.querySelector('#auto-block-mode').onchange=/** Tác dụng: Yêu cầu xác nhận trước khi bật tự động hoặc chuyển về chế độ tay. */ async event=>{
  if(event.target.value==='AUTOMATIC'){
    if(dialog.open)deferConfirmation();
    autoModeDialog.showModal();
  }else await setAutoBlockMode('MANUAL');
};
document.querySelector('#auto-mode-confirm').onclick=/** Tác dụng: Xác nhận bật chế độ BLOCK tự động cho các yêu cầu đủ điều kiện. */ async()=>{
  const button=document.querySelector('#auto-mode-confirm');button.disabled=true;
  try{await setAutoBlockMode('AUTOMATIC');}finally{button.disabled=false;}
};
/** Tác dụng: Đóng hộp xác nhận bật tự động và trả lựa chọn giao diện về chế độ hiện tại. */
function cancelAutoMode(){autoModeDialog.close();render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong cancelAutoMode. */ ()=>{});}
document.querySelector('#auto-mode-cancel').onclick=cancelAutoMode;
autoModeDialog.addEventListener('cancel',/** Tác dụng: Chặn đóng hộp thoại theo mặc định và hủy lựa chọn bật tự động. */ event=>{event.preventDefault();cancelAutoMode();});

let renderSequence=0;
/** Tác dụng: Đọc snapshot mới rồi dựng trạng thái, bảng dữ liệu, cảnh báo và control của giao diện. */
async function render(){
  if(confirmationBusy)return;
  const sequence=++renderSequence;
  const s=await getState(); if(!s||sequence!==renderSequence||confirmationBusy)return;
  if(!autoModeDialog.open)document.querySelector('#auto-block-mode').value=s.autoBlockMode||'MANUAL';
  document.querySelector('#remote-sync-status').textContent=s.remoteSync?.error?'Đồng bộ điện thoại: '+s.remoteSync.error:'';
  const toggle=document.querySelector("#toggle");
  const auto=document.querySelector("#auto");
  auto.textContent=s.autoEnabled?"AUTO BLOCK: ON":"AUTO BLOCK: OFF";
  auto.className=s.autoEnabled?"on":"off";
  toggle.textContent=s.monitoringEnabled?"MONITORING: ON":"MONITORING: OFF";
  toggle.className=s.monitoringEnabled?"on":"off";

  const important=importantAlerts(s).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong render. */ a=>!dismissedImportant.has(a.id));
  const importantMarkup=important.length?`<div class="card bad" role="alert"><b>CẢNH BÁO CẦN XỬ LÝ</b>${important.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ a=>`<div data-important-alert style="padding:12px 0;border-bottom:1px solid #ffffff20"><button type="button" class="secondary" data-important-dismiss="${esc(a.id)}" style="float:right;padding:4px 10px">Đã xem</button><b>${esc(a.fs||'Hệ thống')} · ${esc(a.title)}</b><div>${esc(a.detail)}</div><small class="muted">${a.at?esc(new Date(a.at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})):''}</small></div>`).join('')}</div>`:'';
  const specialWarnings=(s.cdrWarnings||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong render. */ w=>w.at>Date.now()-15000&&!dismissedCdrWarnings.has(cdrWarningKey(w))).slice(0,8);
  const specialMarkup=specialWarnings.length?`<div class="card warning"><b>CẢNH BÁO CDR ĐẶC BIỆT</b>${specialWarnings.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ w=>`<p data-cdr-warning><button type="button" class="secondary" data-dismiss-cdr="${esc(cdrWarningKey(w))}" aria-label="Đóng cảnh báo CDR" style="float:right;padding:2px 10px">×</button><b>${esc(w.fs)} · ${w.group==='99.153'?'Collection':'Sale'}</b> · ${esc(w.ip)}<br><b>${esc(w.pattern)}</b> · ${esc(w.count)} cuộc liên tiếp · ${esc(new Date(w.at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}</p>`).join('')}</div>`:'';
  const alerts=s.alerts||[];
  const blocked=Object.entries(s.fsStates||{}).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong render. */ ([key,f])=>f.state==='SUSPECTED'&&!alerts.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong render. */ a=>`${a.group}|${a.fs}|${a.ip}`===key));
  const blockedNotice=blocked.length?`<div class="card warning"><b>FS SUSPECTED đang chờ xử lý</b>${blocked.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ ([key,f])=>`<p><b>${esc(f.fs)}</b> · ${esc(s.processingStatus?.[key]||f.actionError||'Chưa đủ dữ liệu/điều kiện xử lý; kiểm tra Group ID và trang THAY FS.')}</p>`).join('')}</div>`:'';
  const schedules=s.schedule?.groups||{};
  const pauseNotice=['99.153','99.155'].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ group=>{
    const g=schedules[group],name=group==='99.153'?'Collection':'Sale';
    if(!g?.paused)return '';
    return `<div class="card watching"><b>${name} · ${g.phase==='DAY_END'?`dừng qua đêm ${esc(g.startAt)}–08:00`:`tạm nghỉ ${esc(g.startAt)}–13:00`} (giờ Việt Nam)</b><div>${g.phase==='DAY_END'?'Nhóm này đã ngừng theo lịch; extension không phát hiện/block hoặc yêu cầu xác nhận.':group==='99.155'&&g.phase==='HANDOFF'?'Hệ thống tự động chạy FS08/09/10; extension không tiếp quản.':'Giảm tải theo lịch; không cảnh báo block cho nhóm này.'}</div><div>${g.phase==='DAY_END'?(group==='99.153'?'Dừng Search CDR và đổi số đến 08:00; MONITORING tắt tay vẫn giữ OFF.':'Vẫn đọc Group ID/CDR. Đến 08:00 đánh giá CDR mới; MONITORING tắt tay vẫn giữ OFF.'):'Vẫn đọc Group ID/CDR. Từ 13:00 đánh giá CDR mới.'}</div></div>`;
  }).join('');
  document.querySelector("#summary").innerHTML=importantMarkup+specialMarkup+pauseNotice+(alerts.length
    ? `<div class="card bad"><b>${s.config?.cdrVerificationEnabled?'CDR XÁC NHẬN NGHI BLOCK':'SUSPECTED BLOCK'}</b>${alerts.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ a=>`<div>${esc(a.group)} → ${esc(a.fs)} (${esc(a.ip)})${a.actionPending?' · Đang đổi, chưa hoàn tất':a.actionUncertain?' · Chưa xác minh BLOCKED, cần kiểm tra':''}${s.processingStatus?.[`${a.group}|${a.fs}|${a.ip}`]?`<br>${esc(s.processingStatus[`${a.group}|${a.fs}|${a.ip}`])}`:''}</div>`).join("")}${s.autoEnabled
      ? `<div class="action-note">${s.autoBlockMode==='AUTOMATIC'?'AUTO BLOCK: tự đổi ACTIVE → BLOCKED khi đủ điều kiện.':'AUTO BLOCK: chờ bạn kiểm tra và xác nhận trước khi đổi ACTIVE → BLOCKED.'}</div>`
      : `<div class="action-note">${s.config?.cdrVerificationEnabled?'AUTO BLOCK OFF. Chỉ đổi số khi VT tụt theo baseline và CDR đủ 5 cuộc liên tiếp 480-0-0 / 480-1-0.':'ACTION REQUIRED: change the matching FreeSWITCH number from ACTIVE to BLOCKED manually.'}</div>`}</div>`
    : blocked.length?'':`<div class="card good">${s.monitoringEnabled?"No suspected block detected.":"Monitoring is manually OFF."}</div>`)+blockedNotice;

  renderConfirmation(s);

  let groups="";
  for(const g of ["99.153","99.155"]){
    const os=s.opensips[g]||{};
    groups+=`<div class="card"><div class="node-group-heading"><b>${g==='99.153'?'Collection':'Sale'} · ${g}</b><button class="secondary" data-add-node="${g}">Thêm node</button></div>
    <div class="table-wrap"><table><tr><th>FS</th><th>IP</th><th>VT</th><th>State</th><th>Dãy CDR</th><th>Số lần liên tiếp</th><th>Incident / Recovery</th><th>Profile</th></tr>`;
    for(const n of FsSwitch.displayRows(s,g)){
      const tc=n.trend==="DOWN"?"down":n.trend==="UP"?"up":"";
      const fs=(!n.displayOnly&&!n.ambiguous?s.fsStates?.[`${g}|${n.fs}|${n.ip}`]:null)||{};
      const groupId=n.groupId??fs.groupId;
      const routed=groupId===(g==='99.153'?2:3);
      const rawState=fs.state||'INACTIVE';
      const awaitingCdr=s.config?.cdrVerificationEnabled&&rawState==='SUSPECTED'&&!fs.incident?.locked&&!fs.incident?.manualCdrProof&&!fs.pairedCdrProof&&(!fs.cdr?.locked||Date.now()-fs.cdr.checkedAt>10000);
      const shownState=awaitingCdr?'WAITING_CDR':rawState==='INACTIVE'?(groupId==null?'UNKNOWN_GROUP':routed?
        (s.schedule?.groups?.[g]?.paused?'PAUSED':s.config?.detectionSource==='CDR'?'WAITING_CDR':n.used>0?'LEARNING':'WAITING_VT'):'INACTIVE'):rawState;
      const learningNote=routed&&s.schedule?.groups?.[g]?.paused?`Nhóm nghỉ theo lịch; xét lại VT/CDR từ ${esc(s.schedule.groups[g].resumeAt||s.schedule.groups[g].endAt||'13:00')}`:routed&&fs.scheduledCdrAt&&Date.now()-fs.scheduledCdrAt<=120000&&Math.max(fs.incident?.switchedAt||0,fs.lastIncident?.switchedAt||0)<fs.scheduledCdrAt&&!fs.incident?.autoExecuted&&!fs.incident?.manualExecuted?`Kiểm tra CDR mới sau 13:00 · ${fs.incident?.scheduledResume?fs.incident.cdrConfirmationReads||0:0}/2 lượt lỗi 5/5`:s.config?.cdrRequireVtDrop&&routed&&!fs.baseline?`Đang học baseline VT: ${(fs.healthyHistory||[]).length}/${s.config.baselineSamples||20} mẫu`:s.config?.detectionSource==='CDR'?(rawState==='WAITING_CDR'?'Chờ cuộc gọi CDR mới; không xử lý dữ liệu cũ':''):awaitingCdr?(fs.cdrStatus||'Chờ CDR 5 cuộc mới nhất 480-0-0 / 480-1-0'):rawState==='INACTIVE'&&routed?(s.schedule?.groups?.[g]?.paused?'Nhóm nghỉ theo lịch':
        !s.monitoringEnabled?'MONITOR đang OFF':n.used>0?
        `FS đang bật; học baseline ${fs.healthyHistory?.length||0}/${s.config.baselineSamples??20} mẫu`:'FS đang bật; chờ VT tăng'):
        rawState==='INACTIVE'&&groupId==null?'Chưa đọc được Group ID; không BLOCK':'';
      const stateClass=!fsRoutingActive(s,n.fs,g==='99.153'?'COLLECTION':'TELESALE')?"muted":fs.state==="SUSPECTED"?"bad":fs.state==="HEALTHY"?"good":
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
      const routingNote=n.groupId===0?'':fs.groupId==null?'Chưa đọc được Group ID; không BLOCK':'';
      const os01Note=g==='99.153'&&n.fs==='OS01'&&n.ip==='10.10.99.140'&&!s.schedule?.groups?.[g]?.paused?fs.detectionNote||'OS01: chờ 2 lượt Search liên tiếp lỗi 5/5; không yêu cầu VT tụt':'';
      const status=(n.displayOnly?'Chỉ hiển thị; chưa có cấu hình xử lý cho destination này':'')||(!s.monitoringEnabled?'MONITOR đang OFF; không tự đổi số':'')||s.processingStatus?.[`${g}|${n.fs}|${n.ip}`]||os01Note||learningNote||routingNote||(fs.incident?.actionPending?'Đang chuyển ACTIVE → BLOCKED; chưa hoàn tất':'')||fs.actionError||(queued?`Chờ lượt AUTO · ${Math.ceil((fs.autoQueueUntil-Date.now())/1000)}s`:'')||fs.incident?.actionUncertain&&'Swap result unknown; check manually'||
        (fs.state==='COOLDOWN'?`Locked · ${remaining}s`:fs.state==='RECOVERING'?`Locked · ${fs.recoveryNote||'Chờ CDR mới sau khi đổi số'}`:['WATCHING','WARNING','SUSPECTED'].includes(fs.state)?fs.detectionNote||'':'')||fs.detectionNote||fs.cdrStatus||(routed?'Chờ đủ điều kiện VT và CDR để xử lý':'FS không hoạt động trong nhóm; không tự đổi số');
      const cdr=fs.cdr;
      const heldProof=s.autoBlockMode==='MANUAL'&&fs.state==='SUSPECTED'?fs.incident?.manualCdrProof:null;
      const pairedProof=fs.state==='SUSPECTED'&&Date.now()-(fs.pairedCdrProof?.checkedAt||0)<=15000?fs.pairedCdrProof:null;
      const scoring=heldProof||pairedProof||(s.config?.detectionSource==='CDR'?cdr?.decision:cdr);
      const cdrCount=cdr?`${scoring?.consecutiveTotal??scoring?.count??0}/5 liên tiếp`:fs.cdrStatus?'Đang kiểm tra':'Chưa kiểm tra';
      const cdrRecords=(cdr?.records||[]).slice(0,3).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ r=>`<div><b>${esc(r.sipCode??'?')}-${esc(r.setupTime??'?')}-${esc(r.duration??'?')}</b> <span class="muted">${esc(age(r.time))}</span></div>`).join('');
      const cdrCell=`<td data-label="Dãy CDR" class="cdr-data"><div class="cdr-records">${cdrRecords||'<span class="muted">Chờ dữ liệu CDR…</span>'}</div></td>
        <td data-label="Liên tiếp" class="cdr-count"><b>${esc(cdrCount)}</b><br><span class="muted">${heldProof?`Đã ghi nhận · ${esc(clock(heldProof.checkedAt))} · chờ xác nhận`:pairedProof?`CDR 5/5 đã ghi nhận · ${esc(age(pairedProof.checkedAt))}`:'480-0-0 / 480-1-0'}</span></td>`;

      const backupProfile=g==='99.153'?'COLLECTION':'TELESALE';
      const cachedBackup=s.freeswitch?.backupCounts?.[n.fs];
      const backupCount=cachedBackup?.count??(s.freeswitch?.numbers? s.freeswitch.numbers.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong render. */ row=>row.fs===n.fs&&row.profile===backupProfile&&row.status==='BACKUP').length:null);
      groups+=`<tr><td data-label="FS">${esc(n.fs||"Chưa ghép tên")} (${backupCount??'—'})${n.displayOnly?'':manualStatusControl(s,n.fs,backupProfile)}</td><td data-label="IP">${esc(n.ip)}</td><td data-label="VT">${esc(n.used??fs.currentVt??"—")}/${esc(n.capacity??"—")}</td><td data-label="Trạng thái" class="${stateClass}">${esc(shownState)}<br><span class="muted">Group ID: ${esc(n.groupId??fs.groupId??"—")}</span>${s.config.cdrRequireVtDrop?`<br><span class="muted">Baseline: ${esc(fs.baseline??"—")} · Tụt: ${esc(fs.dropPercent??"—")}%</span>`:""}</td>${routed?cdrCell:'<td data-label="Dãy CDR">FS không hoạt động</td><td data-label="Liên tiếp">—</td>'}<td data-label="Xử lý">${esc(fs.incident?.id||fs.candidateId||"-")}<br>${esc(status)}${fs.baselineRelearnNote?`<br><span class="muted">${esc(fs.baselineRelearnNote)}</span>`:""}${manualButton}${failureButton}${Date.now()-(fs.updatedAt||0)>s.config.staleMs?" · STALE":""}</td><td data-label="Profile">${esc(n.description)}</td></tr>`;
    }
    groups+="</table></div></div>";
  }
  updateGroups(groups);


  const switchButton=document.querySelector('#fs-switch-open');
  switchButton.textContent=`THAY FS: ${s.fsSwitchEnabled?'ON':'OFF'}`;
  switchButton.className=s.fsSwitchEnabled?'on':'off';
  try{const history=await chrome.runtime.sendMessage({type:'HISTORY_READ',date:historyDate});renderHistory(history?.ok&&Array.isArray(history.events)?{...s,events:history.events}:s);document.querySelector('#history-sync-status').textContent=history?.sync?.error?'Mất kết nối Supabase · đang giữ log trên máy và sẽ gửi lại':history?.sync?.source==='SUPABASE'?'Lưu trên Supabase':'Lưu trên máy · chưa kết nối Supabase';}catch(error){renderHistory(s);}
  document.querySelectorAll('[data-failure-key]').forEach(/** Tác dụng: Xử lý lần lượt từng phần tử trong render. */ button=>button.onclick=/** Tác dụng: Gửi xác nhận xử lý tay hoặc kiểm tra lại sự cố và cập nhật bảng. */ async()=>{
    button.disabled=true;
    try{
      const r=await chrome.runtime.sendMessage({type:button.dataset.failureType,key:button.dataset.failureKey,incidentId:button.dataset.incidentId});
      confirmationNotice(r?.ok?'Đã ghi nhận kiểm tra/xử lý.':r?.error||'Không xử lý được yêu cầu.');
    }catch(error){confirmationNotice('Mất kết nối extension; kiểm tra FreeSWITCH.');}
    finally{button.disabled=false;render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong render. */ ()=>{});}
  });
  document.querySelectorAll('[data-manual-key]').forEach(/** Tác dụng: Xử lý lần lượt từng phần tử trong render. */ button=>button.onclick=/** Tác dụng: Ghi nhận người dùng đã thay số tay cho đúng sự cố rồi tải lại bảng. */ async()=>{
    button.disabled=true;
    const r=await chrome.runtime.sendMessage({type:'REPORT_MANUAL_SWAP',key:button.dataset.manualKey,incidentId:button.dataset.incidentId});
    if(!r?.ok)alert(r?.error||'Không ghi nhận được thay số');render();
  });
}
document.querySelector("#auto").onclick=/** Tác dụng: Gửi yêu cầu bật/tắt AUTO BLOCK và cập nhật trạng thái trên dashboard. */ async()=>{
  const s=await getState();
  const result=await chrome.runtime.sendMessage({type:"SET_AUTO",enabled:!s.autoEnabled});
  if(!result?.ok)confirmationNotice(result?.error||'Không bật/tắt được AUTO BLOCK.');
  render();
};
document.querySelector("#toggle").onclick=/** Tác dụng: Gửi yêu cầu bật/tắt giám sát và cập nhật dashboard. */ async()=>{
  const s=await getState();
  await chrome.runtime.sendMessage({type:"SET_MONITORING",enabled:!s.monitoringEnabled});
  render();
};
const clearHistoryDialog=document.querySelector('#clear-history-dialog');
let clearHistoryBusy=false;
document.querySelector('#clear').onclick=/** Tác dụng: Mở hộp chọn thời gian cần xóa lịch sử; chưa xóa dữ liệu tại bước này. */ ()=>{
  document.querySelector('#clear-history-date').value=historyDate||vietnamDate(Date.now());
  document.querySelector('#clear-history-start').value='00:00';
  document.querySelector('#clear-history-end').value='23:59';
  document.querySelector('#clear-history-error').textContent='';
  clearHistoryDialog.showModal();
};
document.querySelector('#clear-history-cancel').onclick=/** Tác dụng: Đóng hộp xóa lịch sử mà không gửi lệnh xóa. */ ()=>{if(!clearHistoryBusy)clearHistoryDialog.close();};
clearHistoryDialog.addEventListener('cancel',/** Tác dụng: Giữ hộp thoại mở khi đang có thao tác ghi; nếu rảnh thì xóa lựa chọn tạm. */ e=>{if(clearHistoryBusy)e.preventDefault();});
document.querySelector('#clear-history-confirm').onclick=/** Tác dụng: Kiểm tra khoảng ngày/giờ và gửi yêu cầu xóa lịch sử đã chọn. */ async()=>{
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
render().catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ ()=>confirmationNotice('Không kết nối được extension. Hãy tải lại dashboard.'));
setInterval(/** Tác dụng: Chạy tác vụ lấy mẫu hoặc cập nhật theo chu kỳ. */ ()=>render().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{}),1000);

const mobileLinkButton=document.querySelector('#create-mobile-link');
mobileLinkButton.onclick=/** Tác dụng: Tạo liên kết đăng nhập mobile dùng một lần và hiển thị để sao chép. */ async()=>{
  mobileLinkButton.disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:'CREATE_MOBILE_LINK'});if(!result?.ok)throw Error(result?.error||'Không tạo được liên kết');document.querySelector('#mobile-link-url').value=result.url;document.querySelector('#mobile-link-dialog').showModal();}
  catch(error){confirmationNotice(error.message);}
  finally{mobileLinkButton.disabled=false;}
};
document.querySelector('#mobile-link-copy').onclick=/** Tác dụng: Sao chép liên kết đăng nhập app một lần vào clipboard. */ async()=>{try{await navigator.clipboard.writeText(document.querySelector('#mobile-link-url').value);confirmationNotice('Đã sao chép liên kết đăng nhập');}catch(error){document.querySelector('#mobile-link-url').select();}};
document.querySelector('#mobile-link-close').onclick=/** Tác dụng: Đóng hộp hiển thị liên kết đăng nhập mobile. */ ()=>document.querySelector('#mobile-link-dialog').close();

document.querySelector('#mobile-password-open').onclick=/** Tác dụng: Mở form đặt mật khẩu truy cập app mobile. */ ()=>document.querySelector('#mobile-password-dialog').showModal();
document.querySelector('#mobile-password-close').onclick=/** Tác dụng: Đóng form mật khẩu app mobile mà không gửi thay đổi. */ ()=>document.querySelector('#mobile-password-dialog').close();
document.querySelector('#mobile-password-form').onsubmit=/** Tác dụng: Kiểm tra hai lần nhập mật khẩu và gửi yêu cầu cập nhật qua handler đã xác thực. */ async event=>{
 event.preventDefault();const first=document.querySelector('#mobile-password-new'),repeat=document.querySelector('#mobile-password-repeat'),error=document.querySelector('#mobile-password-error'),button=document.querySelector('#mobile-password-save');
 if(first.value!==repeat.value){error.textContent='Hai mật khẩu chưa khớp.';return;}
 button.disabled=true;error.textContent='Đang lưu…';
 try{const result=await chrome.runtime.sendMessage({type:'SET_MOBILE_PASSWORD',password:first.value});if(!result?.ok)throw Error(result?.error||'Không lưu được mật khẩu.');first.value='';repeat.value='';error.textContent='';document.querySelector('#mobile-password-dialog').close();confirmationNotice('Đã lưu mật khẩu app điện thoại.');}
 catch(e){error.textContent=e.message;}finally{button.disabled=false;}
};

const historyExportButton=document.querySelector('#history-export');
historyExportButton.onclick=/** Tác dụng: Đọc toàn bộ lịch sử theo bộ lọc và tải file XLSX về máy. */ async()=>{
 if(historyExportButton.disabled)return;const date=historyDate,status=document.querySelector('#history-export-status');
 historyExportButton.disabled=true;status.textContent=' Đang lấy toàn bộ lịch sử…';
 try{
  const result=await chrome.runtime.sendMessage({type:'HISTORY_READ',date});
  if(!result?.ok||!Array.isArray(result.events))throw Error(result?.error||'Không đọc được lịch sử.');
  const file=HistoryExport.workbook(result.events,date);
  if(!file.count){status.textContent=' Không có lượt thay đổi thành công trong ngày đã chọn.';return;}
  const blob=new Blob([file.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`lich-su-thay-so-${date||'tat-ca'}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(/** Tác dụng: Chạy bước tiếp theo sau thời gian chờ. */ ()=>URL.revokeObjectURL(url),60000);
  status.textContent=` Đã xuất ${file.count} lượt${result.sync?.error?' · dữ liệu lưu trên máy, đồng bộ đang lỗi':''}.`;
 }catch(error){status.textContent=' '+error.message;}finally{historyExportButton.disabled=false;}
};
