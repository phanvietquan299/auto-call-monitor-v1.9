const $=id=>document.getElementById(id);
const escapeText=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let snapshot=null,selected=null,busy=false,testPreview=null,lastShownTest=null;
async function send(msg){const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'Mất kết nối extension');return r;}
function detail(p){return `<p><b>${escapeText(p.source.fs)} → ${escapeText(p.target.fs)} · ${escapeText(p.profile)}</b></p><p>BACKUP nguồn: ${p.source.backups} · đích: ${p.target.backups}</p><ol><li>Tắt ${escapeText(p.source.fs)}: Group ID ${p.groupId} → 0, Save + Reload + refresh và xác minh.</li><li>Bật ${escapeText(p.target.fs)}: Group ID 0 → ${p.groupId}, Save + Reload + refresh và xác minh.</li><li>Theo dõi 5 giây; nếu VT đích không tăng thì BLOCK số ACTIVE của đích. Các FS khác tiếp tục AUTO BLOCK.</li></ol>`;}
async function render(type='FS_SWITCH_STATE'){
  if(busy)return;
  try{
    snapshot=await send({type});const f=snapshot.feature;
    $('backup-threshold').textContent=snapshot.threshold??FsSwitch.BACKUP_THRESHOLD??10;
    $('diagnostics').innerHTML=(snapshot.diagnostics||[]).map(d=>`<div class="card"><b>${escapeText(d.fs)} · ${d.group==='99.153'?'Collection':'Sale'}</b> · BACKUP ${d.backups} · Group ID ${escapeText(d.groupId??'—')} · ${escapeText(d.state)}<p>${escapeText(d.reason)}</p></div>`).join('');
    $('enabled').textContent='Thay FS: '+(f.enabled?'ON':'OFF');$('mode').value=f.mode;
        for(const id of ['test-enable','test-disable'])$(id).disabled=busy;
    if(f.lastTest&&lastShownTest!==`${f.lastTest.id}|${f.lastTest.status}`){lastShownTest=`${f.lastTest.id}|${f.lastTest.status}`;$('test-status').textContent=`${f.lastTest.node.fs}: ${f.lastTest.expected} → ${f.lastTest.value} · ${f.lastTest.status}${f.lastTest.error?' · '+f.lastTest.error:f.lastTest.status==='DONE'?' · Đã Save + Reload + refresh trang thành công':''}`;}
    $('release').hidden=f.enabled||!['FAILED','DONE'].includes(f.operation?.status);
    $('status').textContent=f.operation?`${f.operation.plan.source.fs} → ${f.operation.plan.target.fs}: ${f.operation.status} · ${f.operation.stage}${f.operation.error?'\n'+f.operation.error:''}`:'Chưa có lượt chuyển. Mở một tab OpenSIPS cho mỗi nhóm và một tab FreeSWITCH.';
    $('candidates').innerHTML=snapshot.candidates.map((p,index)=>`<div class="card">${detail(p)}<button data-plan="${index}" ${!f.enabled||f.mode!=='MANUAL'?'disabled':''}>Kiểm tra và xác nhận</button></div>`).join('')||'<p class="muted">Chưa có FS đủ điều kiện chuyển. Không có đích phù hợp: AUTO BLOCK nguồn tiếp tục theo chế độ hiện tại; sẽ xét lại lần nghi block sau.</p>';
    $('history').innerHTML=(f.history||[]).slice(0,20).map(op=>`<div class="card"><b>${escapeText(op.plan.source.fs)} → ${escapeText(op.plan.target.fs)}</b> · ${escapeText(op.status)}<p>${new Date(op.startedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} · ${escapeText(op.stage)}</p>${op.error?`<p>${escapeText(op.error)}</p>`:''}</div>`).join('')||'<p class="muted">Chưa có lịch sử.</p>';
  }catch(e){$('status').textContent=e.message;}
}
async function settings(enabled,mode){try{await send({type:'FS_SWITCH_SETTINGS',enabled,mode});await render();}catch(e){$('status').textContent=e.message;}}
$('release').onclick=async()=>{
  if(!snapshot?.feature.operation)return;
  if(!confirm('Bạn đã kiểm tra Group ID trên OpenSIPS sau Reload và trạng thái số FreeSWITCH, đồng thời xử lý lượt đang dở? Mở khóa chỉ cho phép đánh giá lại, không tự sửa trạng thái.'))return;
  try{await send({type:'FS_SWITCH_RELEASE',operationId:snapshot.feature.operation.id});await render();}catch(e){$('status').textContent=e.message;}
};
$('enabled').onclick=()=>{if(snapshot)settings(!snapshot.feature.enabled,snapshot.feature.mode);};
$('mode').onchange=()=>{if($('mode').value==='AUTOMATIC'){$('automatic').showModal();}else if(snapshot)settings(snapshot.feature.enabled,'MANUAL');};
$('auto-cancel').onclick=()=>{$('automatic').close();$('mode').value=snapshot.feature.mode;};
$('auto-accept').onclick=()=>{$('automatic').close();settings(snapshot.feature.enabled,'AUTOMATIC');};
$('refresh').onclick=()=>render('FS_SWITCH_TICK');
$('candidates').onclick=e=>{const button=e.target.closest('[data-plan]');if(!button||button.disabled)return;selected=snapshot.candidates[Number(button.dataset.plan)];$('details').innerHTML=detail(selected);$('confirm').showModal();};
$('cancel').onclick=()=>{$('confirm').close();selected=null;};
$('execute').onclick=async()=>{
  if(busy||!selected)return;busy=true;$('execute').disabled=true;$('status').textContent='Đang chuyển FS, chưa hoàn tất…';
  try{await send({type:'FS_SWITCH_CONFIRM',identity:FsSwitch.identity(selected)});$('confirm').close();}catch(e){$('status').textContent=e.message;}
  finally{busy=false;$('execute').disabled=false;await render();}
};
async function previewTest(value){
  if(busy)return;busy=true;$('test-status').textContent='Đang đọc Group ID từ OpenSIPS…';
  try{
    const r=await send({type:'FS_SWITCH_TEST_PREVIEW',fs:$('test-node').value,value});testPreview=r.preview;
    $('test-opensips-details').innerHTML=`<p><b>${escapeText(testPreview.node.fs)} · ${escapeText(testPreview.node.ip)}</b></p><p>Group ID <b>${testPreview.expected} → ${testPreview.value}</b></p><p>Save → Reload on Server → xác minh Group ID. Chỉ OpenSIPS, không ACTIVE → BLOCKED.</p>`;
    $('test-opensips-dialog').showModal();$('test-status').textContent='Đang chờ bạn xác nhận.';
  }catch(e){$('test-status').textContent=e.message;}finally{busy=false;}
}
$('test-enable').onclick=()=>previewTest(2);$('test-disable').onclick=()=>previewTest(0);
$('test-opensips-cancel').onclick=()=>{testPreview=null;$('test-opensips-dialog').close();$('test-status').textContent='Đã hủy test, chưa ghi thay đổi.';};
$('test-opensips-confirm').onclick=async()=>{
  if(busy||!testPreview)return;busy=true;$('test-opensips-confirm').disabled=true;$('test-status').textContent='Đang Save + Reload; chưa hoàn tất…';
  try{await send({type:'FS_SWITCH_TEST_CONFIRM',testId:testPreview.id});testPreview=null;$('test-opensips-dialog').close();}
  catch(e){$('test-status').textContent=e.message;}
  finally{testPreview=null;$('test-opensips-dialog').close();busy=false;$('test-opensips-confirm').disabled=false;await render();}
};
render();setInterval(()=>render('FS_SWITCH_TICK'),10000);
