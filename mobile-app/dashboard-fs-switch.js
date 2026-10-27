(/** Tác dụng: Giữ hộp thoại mở khi đang có thao tác ghi; nếu rảnh thì xóa lựa chọn tạm. */ () => {
  const el=/** Tác dụng: Lấy phần tử giao diện theo ID. */ id=>document.getElementById(id);
  const escape=/** Tác dụng: Escape nội dung trước khi ghép vào HTML của giao diện. */ s=>String(s??'').replace(/[&<>"]/g,/** Tác dụng: Thay ký tự hoặc đoạn khớp biểu thức bằng nội dung đã chuyển đổi trong escape. */ c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let snapshot,selected,nodeSelected,busy=false,thresholdDirty=false;
  /** Tác dụng: Gửi message tới extension và báo lỗi nếu handler không xác nhận thành công. */
  async function send(msg){const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'Mất kết nối extension');return r;}
  /** Tác dụng: Đọc snapshot thay FS và cập nhật control/preset khi không có thao tác giao diện đang bận. */
  async function refresh(){
    if(busy)return;
    try{
      snapshot=await send({type:'FS_SWITCH_STATE'});
      const f=snapshot.feature;
      el('fs-switch-open').textContent=`THAY FS: ${f.enabled?'ON':'OFF'}`;
      el('fs-switch-open').className=f.enabled?'on':'off';
      if(!el('fs-switch-automatic').open)el('fs-switch-mode').value=f.mode;
      renderNodes();
      renderPresetOptions();
      if(!thresholdDirty&&document.activeElement!==el("fs-backup-threshold"))el("fs-backup-threshold").value=snapshot.threshold??10;
      for(const group of Object.keys(FsSwitch.groups)){const key=group.replace(".","-"),p=f.nextSwitch?.[group];el("preset-status-"+key).textContent=p?`Đã đặt: ${p.source?'Tắt '+p.source:''}${p.source&&p.target?' · ':''}${p.target?'Bật '+p.target:''}`:"Tự chọn theo BACKUP";}
      el('fs-switch-status').textContent=f.operation?`${f.operation.plan.source.fs} → ${f.operation.plan.target.fs}: ${f.operation.status==='DONE'?'Đã chuyển':f.operation.status==='RUNNING'?'Đang chuyển':f.operation.status==='FAILED'?'Cần kiểm tra':'Đã xử lý'}`:'';
      el('fs-switch-status').title=f.operation?.error||'';
      el('fs-switch-release').hidden=f.enabled||!['FAILED','DONE'].includes(f.operation?.status);
      el('fs-switch-plans').innerHTML=snapshot.candidates.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng. */ (p,i)=>`<p>${p.action==='ENABLE'?'Bật '+escape(p.target.fs):p.action==='DISABLE'?'Tắt '+escape(p.source.fs):escape(p.source.fs)+' → '+escape(p.target.fs)} · ${escape(p.profile)} · BACKUP ${p.source.backups} → ${p.target.backups} <button data-switch-plan="${i}" ${!f.enabled||f.mode!=='MANUAL'?'disabled':''}>Xác nhận chuyển</button></p>`).join('')||'';
    }catch(e){el('fs-switch-status').textContent=e.message;}
  }
  /** Tác dụng: Dựng các lựa chọn nguồn/đích theo node, Group ID và preset đang có. */
  function renderPresetOptions(){
    const now=Date.now();
    for(const [group,policy] of Object.entries(FsSwitch.groups)){
      const data=snapshot.nodes?.[group],age=now-(data?.updatedAt||0);
      const fresh=Number.isFinite(age)&&age>=0&&age<45000;
      for(const [kind,groupId] of [['source',policy.groupId],['target',0]]){
        const select=el(`preset-${kind}-${group.replace('.','-')}`),previous=select.value;
        const allowed=fresh?policy.fs.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderPresetOptions. */ fs=>{
          const rows=(data.nodes||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderPresetOptions. */ n=>n.fs===fs);
          return rows.length===1&&rows[0].groupId===groupId&&(!Array.isArray(snapshot.feature?.displayNodes?.[group])||snapshot.feature.displayNodes[group].includes(rows[0].ip));
        }):[];
        const html='<option value="">—</option>'+allowed.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderPresetOptions. */ fs=>`<option value="${fs}">${fs}</option>`).join('');
        if(select.innerHTML!==html){
          select.innerHTML=html;
          select.value=allowed.includes(previous)?previous:'';
        }
      }
    }
  }
  /** Tác dụng: Dựng các nút bật/tắt node theo routing mới nhất và khóa thao tác đang chạy. */
  function renderNodes(){
    const html=Object.entries(FsSwitch.groups).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderNodes. */ ([group,policy])=>{return `<div class="fs-node-group"><strong>${group==='99.153'?'Collection':'Sale'}</strong>${policy.fs.filter(/** Tác dụng: Chỉ dựng nút bật/tắt cho node đã chọn quản lý. */ fs=>{const ips=snapshot.feature?.displayNodes?.[group];return !Array.isArray(ips)||(snapshot.nodes?.[group]?.nodes||[]).some(n=>n.fs===fs&&ips.includes(n.ip));}).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong renderNodes. */ fs=>{
      const rows=(snapshot.nodes?.[group]?.nodes||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong renderNodes. */ n=>n.fs===fs);
      const age=Date.now()-(snapshot.nodes?.[group]?.updatedAt||0),fresh=age>=0&&age<45000;
      const id=rows.length===1?rows[0].groupId:null;
      const known=fresh&&[0,policy.groupId].includes(id),active=known&&id===policy.groupId;
      return `<button type="button" data-node-fs="${fs}" data-node-group="${group}" data-node-expected="${id}" class="${known?(active?'on':'off'):'secondary'}" aria-label="${fs}: ${known?(active?'đang hoạt động, bấm để tắt':'đang tắt, bấm để bật'):'chưa xác minh'}" aria-pressed="${active}" ${!known||busy?'disabled':''}>${fs==='OS01'?'OS01':Number(fs.slice(2))}</button>`;
    }).join('')}<button type="button" class="secondary" data-node-reload="${group}" ${busy?'disabled':''}>Reload on Server</button></div>`;}).join('');
    const target=el('fs-node-buttons');if(target.innerHTML!==html)target.innerHTML=html;
  }
  el('fs-node-buttons').onclick=/** Tác dụng: Xử lý nút bật/tắt node hoặc Reload on Server của đúng nhóm. */ e=>{
    const reload=e.target.closest('[data-node-reload]');
    if(reload&&!reload.disabled&&!busy){reloadGroup(reload.dataset.nodeReload);return;}
    const button=e.target.closest('[data-node-fs]');if(busy||!button||button.disabled)return;
    nodeSelected={group:button.dataset.nodeGroup,fs:button.dataset.nodeFs,expected:Number(button.dataset.nodeExpected)};
    const value=nodeSelected.expected===0?FsSwitch.groups[nodeSelected.group].groupId:0;
    el('fs-node-details').innerHTML=`<p><b>${escape(nodeSelected.fs)} · ${nodeSelected.group==='99.153'?'Collection':'Sale'}</b></p><p>Group ID ${nodeSelected.expected} → ${value}</p><p>Save → Reload on Server → tải lại trang và xác minh.</p>`;
    el('fs-node-dialog').showModal();
  };
  /** Tác dụng: Yêu cầu Reload on Server cho đúng nhóm rồi làm mới snapshot giao diện. */
  async function reloadGroup(group){
    busy=true;renderNodes();
    confirmationNotice(`Đang Reload on Server · ${group==='99.153'?'Collection':'Sale'}…`);
    try{await send({type:'FS_SWITCH_RELOAD',group});confirmationNotice(`Reload on Server thành công · ${group==='99.153'?'Collection':'Sale'}.`);}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;await refresh();}
  }
  el('fs-node-cancel').onclick=/** Tác dụng: Đóng hộp xác nhận bật/tắt node, không gửi thay đổi Group ID. */ ()=>{if(!busy){nodeSelected=null;el('fs-node-dialog').close();}};
  el('fs-node-dialog').addEventListener('cancel',/** Tác dụng: Giữ hộp thoại mở khi đang có thao tác ghi; nếu rảnh thì xóa lựa chọn tạm. */ e=>{if(busy)e.preventDefault();else nodeSelected=null;});
  el('fs-node-confirm').onclick=/** Tác dụng: Gửi lệnh bật/tắt Group ID đã xác nhận và cập nhật giao diện sau kết quả. */ async()=>{
    if(busy||!nodeSelected)return;busy=true;el('fs-node-confirm').disabled=true;renderNodes();
    try{const result=await send({type:'FS_SWITCH_TOGGLE_NODE',...nodeSelected});confirmationNotice(`${result.fs}: đã ${result.groupId===0?'tắt':'bật'} sau Save + Reload.`);}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;nodeSelected=null;el('fs-node-confirm').disabled=false;el('fs-node-dialog').close();await refresh();}
  };
  /** Tác dụng: Gửi cấu hình bật/tắt hoặc chế độ xử lý qua handler đã kiểm tra. */
  async function settings(enabled,mode){
    if(busy)return;busy=true;
    try{await send({type:'FS_SWITCH_SETTINGS',enabled,mode});}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;await refresh();}
  }
  el('fs-switch-open').onclick=/** Tác dụng: Bật/tắt chức năng thay FS theo chế độ hiện tại, có xác nhận khi bật tự động. */ async()=>{if(busy)return;await refresh();if(snapshot)await settings(!snapshot.feature.enabled,snapshot.feature.mode);};
  el('fs-switch-mode').onchange=/** Tác dụng: Đổi chế độ thay FS; yêu cầu xác nhận trước khi dùng chế độ tự động. */ ()=>{if(!snapshot)return;if(el('fs-switch-mode').value==='AUTOMATIC')el('fs-switch-automatic').showModal();else settings(snapshot.feature.enabled,'MANUAL');};
  el('fs-switch-auto-cancel').onclick=/** Tác dụng: Hủy việc bật thay FS tự động và khôi phục lựa chọn chế độ. */ ()=>{el('fs-switch-automatic').close();el('fs-switch-mode').value=snapshot.feature.mode;};
  el('fs-switch-auto-confirm').onclick=/** Tác dụng: Xác nhận bật thay FS tự động rồi lưu cấu hình. */ ()=>{el('fs-switch-automatic').close();settings(snapshot.feature.enabled,'AUTOMATIC');};
  el('fs-switch-plans').onclick=/** Tác dụng: Chọn kế hoạch thay FS và mở phần kiểm tra trước thực thi. */ e=>{
    const button=e.target.closest('[data-switch-plan]');if(busy||!button||button.disabled)return;
    selected=snapshot.candidates[Number(button.dataset.switchPlan)];
    el('fs-switch-details').innerHTML=`<p><b>${escape(selected.source.fs)} → ${escape(selected.target.fs)} · ${escape(selected.profile)}</b></p><p>BACKUP nguồn ${selected.source.backups}, đích ${selected.target.backups}.</p><ol><li>Tắt nguồn: ${selected.groupId} → 0; Save, Reload, tải lại và xác minh.</li><li>Bật đích: 0 → ${selected.groupId}; Save, Reload, tải lại và xác minh.</li><li>Theo dõi 5 giây; nếu VT đích không tăng thì BLOCK số ACTIVE của đích. Các FS khác tiếp tục AUTO BLOCK.</li></ol>`;
    if(selected.action==='ENABLE'||selected.action==='DISABLE')el('fs-switch-details').innerHTML=`<p><b>${selected.action==='ENABLE'?'Bật '+escape(selected.target.fs):'Tắt '+escape(selected.source.fs)}</b></p><p>Save → Reload on Server → xác minh.</p>`;
    el('fs-switch-confirm').showModal();
  };
  el('fs-switch-cancel').onclick=/** Tác dụng: Đóng hộp xác nhận kế hoạch thay FS mà không thực hiện. */ ()=>{selected=null;el('fs-switch-confirm').close();};
  el('fs-switch-execute').onclick=/** Tác dụng: Thực thi đúng kế hoạch thay FS người dùng vừa xác nhận. */ async()=>{
    if(busy||!selected)return;busy=true;el('fs-switch-execute').disabled=true;
    el('fs-switch-status').textContent='Đang chuyển FS…';
    try{await send({type:'FS_SWITCH_CONFIRM',identity:FsSwitch.identity(selected)});}
    catch(e){confirmationNotice(e.message);}
    finally{selected=null;el('fs-switch-confirm').close();busy=false;el('fs-switch-execute').disabled=false;await refresh();}
  };
  el('fs-switch-release').onclick=/** Tác dụng: Gửi xác nhận đã kiểm tra tay để giải phóng khóa thao tác thay FS. */ async()=>{
    if(busy||!snapshot?.feature.operation)return;
    if(!confirm('Đã kiểm tra và xử lý Group ID OpenSIPS, trạng thái số FreeSWITCH của lượt chuyển đang dở?'))return;
    busy=true;
    try{await send({type:'FS_SWITCH_RELEASE',operationId:snapshot.feature.operation.id});}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;await refresh();}
  };
  for(const group of Object.keys(FsSwitch.groups)){
    const key=group.replace('.','-');
    /** Tác dụng: Gửi hoặc xóa lựa chọn FS nguồn/đích đặt trước của nhóm. */
    async function preset(clear){
      if(busy)return;busy=true;
      try{await send({type:'FS_SWITCH_PRESET',group,clear,source:el('preset-source-'+key).value,target:el('preset-target-'+key).value});}
      catch(e){confirmationNotice(e.message);}
      finally{busy=false;await refresh();}
    }
    el('preset-save-'+key).onclick=/** Tác dụng: Lưu FS nguồn/đích đang được đặt trước cho nhóm này. */ ()=>preset(false);
    el('preset-clear-'+key).onclick=/** Tác dụng: Xóa lựa chọn FS nguồn/đích đặt trước của nhóm này. */ ()=>preset(true);
  }
  el('fs-backup-threshold').oninput=/** Tác dụng: Đánh dấu ngưỡng BACKUP đang được sửa để refresh không ghi đè giá trị nhập. */ ()=>{thresholdDirty=true;el('fs-threshold-status').textContent='Chưa lưu';};
  el('fs-threshold-save').onclick=/** Tác dụng: Kiểm tra và lưu ngưỡng BACKUP dùng để lập kế hoạch thay FS. */ async()=>{
    if(busy)return;
    const raw=el('fs-backup-threshold').value,value=Number(raw);
    if(raw===''||!Number.isSafeInteger(value)||value<0){el('fs-threshold-status').textContent='Nhập số nguyên ≥ 0';return;}
    busy=true;
    try{await send({type:'FS_SWITCH_THRESHOLD',value});thresholdDirty=false;el('fs-threshold-status').textContent=`Đã lưu: ≤ ${value}`;}
    catch(e){el('fs-threshold-status').textContent=e.message;}
    finally{busy=false;await refresh();}
  };
  refresh();setInterval(refresh,5000);
})();
