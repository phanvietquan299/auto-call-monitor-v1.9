(() => {
  const el=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let snapshot,selected,busy=false;
  async function send(msg){const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'Mất kết nối extension');return r;}
  async function refresh(){
    if(busy)return;
    try{
      snapshot=await send({type:'FS_SWITCH_STATE'});
      const f=snapshot.feature;
      el('fs-switch-open').textContent=`THAY FS: ${f.enabled?'ON':'OFF'}`;
      el('fs-switch-open').className=f.enabled?'on':'off';
      el('fs-switch-mode').value=f.mode;
      el('fs-switch-status').textContent=f.operation?`${f.operation.plan.source.fs} → ${f.operation.plan.target.fs}: ${f.operation.status} · ${f.operation.stage}${f.operation.error?' · '+f.operation.error:''}`:'Chưa có lượt chuyển.';
      el('fs-switch-release').hidden=f.enabled||!['FAILED','DONE'].includes(f.operation?.status);
      el('fs-switch-plans').innerHTML=snapshot.candidates.map((p,i)=>`<p>${escape(p.source.fs)} → ${escape(p.target.fs)} · ${escape(p.profile)} · BACKUP ${p.source.backups} → ${p.target.backups} <button data-switch-plan="${i}" ${!f.enabled||f.mode!=='MANUAL'?'disabled':''}>Xác nhận chuyển</button></p>`).join('')||'<p>Chưa có đích phù hợp. AUTO BLOCK nguồn tiếp tục theo chế độ hiện tại; sẽ xét lại lần nghi block sau.</p>';
    }catch(e){el('fs-switch-status').textContent=e.message;}
  }
  async function settings(enabled,mode){
    if(busy)return;busy=true;
    try{await send({type:'FS_SWITCH_SETTINGS',enabled,mode});}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;await refresh();}
  }
  el('fs-switch-open').onclick=async()=>{if(busy)return;await refresh();if(snapshot)await settings(!snapshot.feature.enabled,snapshot.feature.mode);};
  el('fs-switch-mode').onchange=()=>{if(!snapshot)return;if(el('fs-switch-mode').value==='AUTOMATIC')el('fs-switch-automatic').showModal();else settings(snapshot.feature.enabled,'MANUAL');};
  el('fs-switch-auto-cancel').onclick=()=>{el('fs-switch-automatic').close();el('fs-switch-mode').value=snapshot.feature.mode;};
  el('fs-switch-auto-confirm').onclick=()=>{el('fs-switch-automatic').close();settings(snapshot.feature.enabled,'AUTOMATIC');};
  el('fs-switch-plans').onclick=e=>{
    const button=e.target.closest('[data-switch-plan]');if(busy||!button||button.disabled)return;
    selected=snapshot.candidates[Number(button.dataset.switchPlan)];
    el('fs-switch-details').innerHTML=`<p><b>${escape(selected.source.fs)} → ${escape(selected.target.fs)} · ${escape(selected.profile)}</b></p><p>BACKUP nguồn ${selected.source.backups}, đích ${selected.target.backups}.</p><ol><li>Tắt nguồn: ${selected.groupId} → 0; Save, Reload, tải lại và xác minh.</li><li>Bật đích: 0 → ${selected.groupId}; Save, Reload, tải lại và xác minh.</li><li>Theo dõi 5 giây; nếu VT đích không tăng thì BLOCK số ACTIVE của đích. Các FS khác tiếp tục AUTO BLOCK.</li></ol>`;
    el('fs-switch-confirm').showModal();
  };
  el('fs-switch-cancel').onclick=()=>{selected=null;el('fs-switch-confirm').close();};
  el('fs-switch-execute').onclick=async()=>{
    if(busy||!selected)return;busy=true;el('fs-switch-execute').disabled=true;
    el('fs-switch-status').textContent='Đang chuyển FS…';
    try{await send({type:'FS_SWITCH_CONFIRM',identity:FsSwitch.identity(selected)});}
    catch(e){confirmationNotice(e.message);}
    finally{selected=null;el('fs-switch-confirm').close();busy=false;el('fs-switch-execute').disabled=false;await refresh();}
  };
  el('fs-switch-release').onclick=async()=>{
    if(busy||!snapshot?.feature.operation)return;
    if(!confirm('Đã kiểm tra và xử lý Group ID OpenSIPS, trạng thái số FreeSWITCH của lượt chuyển đang dở?'))return;
    busy=true;
    try{await send({type:'FS_SWITCH_RELEASE',operationId:snapshot.feature.operation.id});}
    catch(e){confirmationNotice(e.message);}
    finally{busy=false;await refresh();}
  };
  refresh();setInterval(refresh,5000);
})();
