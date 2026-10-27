const $=/** Tác dụng: Lấy phần tử giao diện theo ID. */ id=>document.getElementById(id);
const escapeText=/** Tác dụng: Escape dữ liệu trước khi ghép vào HTML trang thay FS. */ s=>String(s??'').replace(/[&<>"]/g,/** Tác dụng: Thay ký tự hoặc đoạn khớp biểu thức bằng nội dung đã chuyển đổi trong escapeText. */ c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let snapshot=null,selected=null,busy=false,testPreview=null,lastShownTest=null;
/** Tác dụng: Gửi lệnh thay FS tới worker và từ chối kết quả không thành công. */
async function send(msg){const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'Mất kết nối extension');return r;}
/** Tác dụng: Dựng nội dung mô tả kế hoạch để người dùng kiểm tra trước khi xác nhận thay FS. */
function detail(p){return `<p><b>${escapeText(p.source.fs)} → ${escapeText(p.target.fs)} · ${escapeText(p.profile)}</b></p><p>BACKUP nguồn: ${p.source.backups} · đích: ${p.target.backups}</p><ol><li>Tắt ${escapeText(p.source.fs)}: Group ID ${p.groupId} → 0, Save + Reload + refresh và xác minh.</li><li>Bật ${escapeText(p.target.fs)}: Group ID 0 → ${p.groupId}, Save + Reload + refresh và xác minh.</li><li>Theo dõi 5 giây; nếu VT đích không tăng thì BLOCK số ACTIVE của đích. Các FS khác tiếp tục AUTO BLOCK.</li></ol>`;}
/** Tác dụng: Lấy state thay FS rồi dựng ứng viên, tiến độ, khóa và các control của trang riêng. */
async function render(type='FS_SWITCH_STATE'){
  if(busy)return;
  try{
    snapshot=await send({type});const f=snapshot.feature;
    $('backup-threshold').textContent=snapshot.threshold??FsSwitch.BACKUP_THRESHOLD??10;
    $('diagnostics').innerHTML=(snapshot.diagnostics||[]).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ d=>`<div class="card"><b>${escapeText(d.fs)} · ${d.group==='99.153'?'Collection':'Sale'}</b> · BACKUP ${d.backups} · Group ID ${escapeText(d.groupId??'—')} · ${escapeText(d.state)}<p>${escapeText(d.reason)}</p></div>`).join('');
    $('enabled').textContent='Thay FS: '+(f.enabled?'ON':'OFF');$('mode').value=f.mode;
        for(const id of ['test-enable','test-disable'])$(id).disabled=busy;
    if(f.lastTest&&lastShownTest!==`${f.lastTest.id}|${f.lastTest.status}`){lastShownTest=`${f.lastTest.id}|${f.lastTest.status}`;$('test-status').textContent=`${f.lastTest.node.fs}: ${f.lastTest.expected} → ${f.lastTest.value} · ${f.lastTest.status}${f.lastTest.error?' · '+f.lastTest.error:f.lastTest.status==='DONE'?' · Đã Save + Reload + refresh trang thành công':''}`;}
    $('release').hidden=f.enabled||!['FAILED','DONE'].includes(f.operation?.status);
    $('status').textContent=f.operation?`${f.operation.plan.source.fs} → ${f.operation.plan.target.fs}: ${f.operation.status} · ${f.operation.stage}${f.operation.error?'\n'+f.operation.error:''}`:'Chưa có lượt chuyển. Mở một tab OpenSIPS cho mỗi nhóm và một tab FreeSWITCH.';
    $('candidates').innerHTML=snapshot.candidates.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ (p,index)=>`<div class="card">${detail(p)}<button data-plan="${index}" ${!f.enabled||f.mode!=='MANUAL'?'disabled':''}>Kiểm tra và xác nhận</button></div>`).join('')||'<p class="muted">Chưa có FS đủ điều kiện chuyển. Không có đích phù hợp: AUTO BLOCK nguồn tiếp tục theo chế độ hiện tại; sẽ xét lại lần nghi block sau.</p>';
    $('history').innerHTML=(f.history||[]).slice(0,20).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong render. */ op=>`<div class="card"><b>${escapeText(op.plan.source.fs)} → ${escapeText(op.plan.target.fs)}</b> · ${escapeText(op.status)}<p>${new Date(op.startedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} · ${escapeText(op.stage)}</p>${op.error?`<p>${escapeText(op.error)}</p>`:''}</div>`).join('')||'<p class="muted">Chưa có lịch sử.</p>';
  }catch(e){$('status').textContent=e.message;}
}
/** Tác dụng: Gửi cấu hình bật/tắt hoặc chế độ xử lý qua handler đã kiểm tra. */
async function settings(enabled,mode){try{await send({type:'FS_SWITCH_SETTINGS',enabled,mode});await render();}catch(e){$('status').textContent=e.message;}}
$('release').onclick=/** Tác dụng: Gửi yêu cầu mở khóa thay FS sau khi người dùng xác nhận đã kiểm tra routing và số thực tế. */ async()=>{
  if(!snapshot?.feature.operation)return;
  if(!confirm('Bạn đã kiểm tra Group ID trên OpenSIPS sau Reload và trạng thái số FreeSWITCH, đồng thời xử lý lượt đang dở? Mở khóa chỉ cho phép đánh giá lại, không tự sửa trạng thái.'))return;
  try{await send({type:'FS_SWITCH_RELEASE',operationId:snapshot.feature.operation.id});await render();}catch(e){$('status').textContent=e.message;}
};
$('enabled').onclick=/** Tác dụng: Đổi trạng thái bật/tắt thay FS theo cấu hình đang hiển thị. */ ()=>{if(snapshot)settings(!snapshot.feature.enabled,snapshot.feature.mode);};
$('mode').onchange=/** Tác dụng: Mở xác nhận bật tự động hoặc gửi chuyển chế độ thay FS về xác nhận tay. */ ()=>{if($('mode').value==='AUTOMATIC'){$('automatic').showModal();}else if(snapshot)settings(snapshot.feature.enabled,'MANUAL');};
$('auto-cancel').onclick=/** Tác dụng: Hủy chuyển sang chế độ tự động và khôi phục lựa chọn hiện tại. */ ()=>{$('automatic').close();$('mode').value=snapshot.feature.mode;};
$('auto-accept').onclick=/** Tác dụng: Xác nhận chế độ tự động rồi gửi cấu hình thay FS. */ ()=>{$('automatic').close();settings(snapshot.feature.enabled,'AUTOMATIC');};
$('refresh').onclick=/** Tác dụng: Yêu cầu worker đánh giá lại kế hoạch thay FS rồi tải snapshot mới. */ ()=>render('FS_SWITCH_TICK');
$('candidates').onclick=/** Tác dụng: Chọn kế hoạch từ danh sách ứng viên và mở hộp kiểm tra trước thực thi. */ e=>{const button=e.target.closest('[data-plan]');if(!button||button.disabled)return;selected=snapshot.candidates[Number(button.dataset.plan)];$('details').innerHTML=detail(selected);$('confirm').showModal();};
$('cancel').onclick=/** Tác dụng: Đóng hộp xác nhận kế hoạch thay FS mà không gửi thao tác. */ ()=>{$('confirm').close();selected=null;};
$('execute').onclick=/** Tác dụng: Gửi kế hoạch thay FS đã xác nhận, khóa nút khi chờ và báo kết quả thực thi. */ async()=>{
  if(busy||!selected)return;busy=true;$('execute').disabled=true;$('status').textContent='Đang chuyển FS, chưa hoàn tất…';
  try{await send({type:'FS_SWITCH_CONFIRM',identity:FsSwitch.identity(selected)});$('confirm').close();}catch(e){$('status').textContent=e.message;}
  finally{busy=false;$('execute').disabled=false;await render();}
};
/** Tác dụng: Yêu cầu preview test Group ID rồi mở hộp xác nhận, chưa ghi thay đổi lên OpenSIPS. */
async function previewTest(value){
  if(busy)return;busy=true;$('test-status').textContent='Đang đọc Group ID từ OpenSIPS…';
  try{
    const r=await send({type:'FS_SWITCH_TEST_PREVIEW',fs:$('test-node').value,value});testPreview=r.preview;
    $('test-opensips-details').innerHTML=`<p><b>${escapeText(testPreview.node.fs)} · ${escapeText(testPreview.node.ip)}</b></p><p>Group ID <b>${testPreview.expected} → ${testPreview.value}</b></p><p>Save → Reload on Server → xác minh Group ID. Chỉ OpenSIPS, không ACTIVE → BLOCKED.</p>`;
    $('test-opensips-dialog').showModal();$('test-status').textContent='Đang chờ bạn xác nhận.';
  }catch(e){$('test-status').textContent=e.message;}finally{busy=false;}
}
$('test-enable').onclick=/** Tác dụng: Tạo preview test bật node với Group ID hoạt động, chưa thực hiện ghi. */ ()=>previewTest(2);$('test-disable').onclick=/** Tác dụng: Tạo preview test tắt node bằng Group ID 0, chưa thực hiện ghi. */ ()=>previewTest(0);
$('test-opensips-cancel').onclick=/** Tác dụng: Xóa preview test và đóng hộp thoại mà không ghi lên OpenSIPS. */ ()=>{testPreview=null;$('test-opensips-dialog').close();$('test-status').textContent='Đã hủy test, chưa ghi thay đổi.';};
$('test-opensips-confirm').onclick=/** Tác dụng: Gửi test Group ID đã preview rồi báo kết quả Save/Reload và xác minh. */ async()=>{
  if(busy||!testPreview)return;busy=true;$('test-opensips-confirm').disabled=true;$('test-status').textContent='Đang Save + Reload; chưa hoàn tất…';
  try{await send({type:'FS_SWITCH_TEST_CONFIRM',testId:testPreview.id});testPreview=null;$('test-opensips-dialog').close();}
  catch(e){$('test-status').textContent=e.message;}
  finally{testPreview=null;$('test-opensips-dialog').close();busy=false;$('test-opensips-confirm').disabled=false;await render();}
};
render();setInterval(/** Tác dụng: Chạy tác vụ lấy mẫu hoặc cập nhật theo chu kỳ. */ ()=>render('FS_SWITCH_TICK'),10000);
