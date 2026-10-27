(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ () => {
  /** Tác dụng: Gửi snapshot số/backup về background nếu extension vẫn còn hoạt động. */
  function send(msg) {
    try { if (chrome?.runtime?.id) chrome.runtime.sendMessage(msg).catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{}); } catch (_) {}
  }

  /** Tác dụng: Đọc số điện thoại, tên node, profile và trạng thái select từ bảng FreeSWITCH. */
  function parseNumbers() {
    const tbody=document.querySelector("#numbers-tbody");
    if(!tbody) return [];
    const out=[];
    for(const tr of [...tbody.querySelectorAll(":scope > tr")]){
      const td=[...tr.children].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong parseNumbers. */ x=>x.tagName==="TD");
      if(td.length<4) continue;
      const phone=(td[0].innerText||"").trim();
      const fs=(td[1].innerText||"").trim().toUpperCase();
      const profile=(td[2].innerText||"").trim().toUpperCase();
      const select=td[3].querySelector("select");
      const status=(select?.value||"").trim().toUpperCase();

      if(phone&&/^(?:FS|OS)\d+$/i.test(fs)) out.push({phone,fs,profile,status,hasStatusControl:!!select&&!select.disabled});
    }
    return out;
  }

  /** Tác dụng: Đọc số lượng BACKUP theo NODE ID từ bảng tổng hợp FreeSWITCH. */
  function parseBackupSummary(){
    const nodes=[];
    for(const table of document.querySelectorAll('table')){
      if(typeof table.querySelectorAll!=='function')continue;
      const rows=[...table.querySelectorAll('tr')];
      const header=rows.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong parseBackupSummary. */ r=>/BACKUP/i.test(r.innerText||r.textContent||'')&&/NODE\s*ID/i.test(r.innerText||r.textContent||''));
      if(!header)continue;
      const labels=[...header.children].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseBackupSummary. */ c=>(c.innerText||c.textContent||'').trim().toUpperCase());
      const fsIndex=labels.findIndex(/** Tác dụng: Tìm vị trí phần tử khớp điều kiện trong parseBackupSummary. */ x=>/^NODE\s*ID$/.test(x)),backupIndex=labels.indexOf('BACKUP');
      if(fsIndex<0||backupIndex<0)continue;
      for(const row of rows){
        const cells=[...row.children],name=(cells[fsIndex]?.innerText||cells[fsIndex]?.textContent||'').trim().toUpperCase();
        const value=(cells[backupIndex]?.innerText||cells[backupIndex]?.textContent||'').trim();
        if(/^(?:FS|OS)\d+$/.test(name)&&/^\d+$/.test(value))nodes.push({fs:name,backups:Number(value)});
      }
    }
    return nodes;
  }
  /** Tác dụng: Ghép tên FS/OS với IP khi bảng FreeSWITCH cung cấp rõ cột NODE ID và IP. */
  function parseNodeMappings(){
    const mappings=[];
    for(const table of document.querySelectorAll('table')){
      if(typeof table.querySelectorAll!=='function')continue;
      const rows=[...table.querySelectorAll('tr')];
      const header=rows.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong parseNodeMappings. */ r=>/NODE\s*ID/i.test(r.innerText||r.textContent||''));if(!header)continue;
      const labels=[...header.children].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parseNodeMappings. */ c=>(c.innerText||c.textContent||'').trim().toUpperCase());
      const nameIndex=labels.findIndex(/** Tác dụng: Tìm vị trí phần tử khớp điều kiện trong parseNodeMappings. */ x=>/^NODE\s*ID$/.test(x));
      const ipIndex=labels.findIndex(/** Tác dụng: Tìm vị trí phần tử khớp điều kiện trong parseNodeMappings. */ x=>/^(?:IP|IP ADDRESS|SIP URI|HOST|HOSTNAME)$/.test(x));
      if(nameIndex<0||ipIndex<0)continue;
      for(const row of rows){
        const cells=[...row.children],name=(cells[nameIndex]?.innerText||cells[nameIndex]?.textContent||'').trim().toUpperCase();
        const ip=(cells[ipIndex]?.innerText||cells[ipIndex]?.textContent||'').match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
        if(/^(?:FS|OS)\d+$/.test(name)&&ip)mappings.push({fs:name,ip});
      }
    }
    return mappings;
  }
  /** Tác dụng: Đọc inventory, tổng hợp BACKUP và map node/IP rồi gửi snapshot FreeSWITCH về background. */
  function publish(){
    send({type:"FREESWITCH_SAMPLE",data:{numbers:parseNumbers(),backupSummary:parseBackupSummary(),nodeMappings:parseNodeMappings()}});
  }

  chrome.runtime.onMessage.addListener(/** Tác dụng: Nhận message extension, phân biệt loại lệnh và trả kết quả đồng bộ hoặc bất đồng bộ. */ (msg,_sender,sendResponse)=>{
    if(msg.type==="READ_FS_NUMBERS"){sendResponse({ok:true,numbers:parseNumbers()});return;}
    if(!['AUTO_BLOCK_FS','MANUAL_FS_STATUS'].includes(msg.type)) return;
    const manual=msg.type==='MANUAL_FS_STATUS';
    const expectedStatus=manual?msg.expectedStatus:'ACTIVE',nextStatus=manual?msg.status:'BLOCKED';
    if(!['ACTIVE','BACKUP','BLOCKED'].includes(expectedStatus)||!['ACTIVE','BACKUP','BLOCKED'].includes(nextStatus)){
      sendResponse({ok:false,attempted:false,error:'Trạng thái không hợp lệ'});return;
    }

    const fs=String(msg.fs||"").toUpperCase();
    const profile=String(msg.profile||"").toUpperCase();
    const expectedPhone=String(msg.phone||"").trim();
    const rows=[...document.querySelectorAll("#numbers-tbody > tr")];
    const matches=[];

    for(const tr of rows){
      const td=[...tr.children].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra. */ x=>x.tagName==="TD");
      if(td.length<4) continue;
      const phone=(td[0].innerText||"").trim();
      const rowFs=(td[1].innerText||"").trim().toUpperCase();
      const rowProfile=(td[2].innerText||"").trim().toUpperCase();
      const status=(td[3].querySelector("select")?.value||"").trim().toUpperCase();
      const select=td[3].querySelector("select");
      if(rowFs===fs && rowProfile===profile && status===expectedStatus && (!manual||phone===expectedPhone)){
        matches.push({tr,phone,select});
      }
    }

    // Fail closed: exactly one ACTIVE number must match the target FS/profile.
    if(matches.length!==1){
      sendResponse({ok:false,attempted:false,errorCode:'ACTIVE_COUNT',error:`Expected exactly 1 ${expectedStatus} ${profile} number for ${fs}; found ${matches.length}`});
      return;
    }

    const target=matches[0];
    if(!expectedPhone||target.phone!==expectedPhone||!target.select){
      sendResponse({ok:false,attempted:false,errorCode:"TARGET_CHANGED",error:"ACTIVE phone changed or status control missing"});return;
    }
    const blocked=[...target.select.options].find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện. */ o=>o.value.toUpperCase()===nextStatus);
    if(!blocked||target.select.disabled){
      sendResponse({ok:false,attempted:false,errorCode:"STATUS_UNAVAILABLE",error:`${nextStatus} status unavailable`});return;
    }
    // Use the page's existing status-change handler. Do not invoke swap.
    target.select.value=blocked.value;
    target.select.dispatchEvent(new Event('change',{bubbles:true}));
    const deadline=Date.now()+10000;
    let timer=null,finished=false;
    /** Tác dụng: Đối chiếu trạng thái select trên DOM sau change; đây không phải xác nhận transaction backend. */
    function check(){
      if(finished)return;
      const numbers=parseNumbers();
      const old=numbers.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong check. */ n=>n.phone===target.phone&&n.fs===fs&&n.profile===profile);
      if(old?.status===nextStatus||Date.now()>=deadline){
        finished=true;if(timer!==null)clearInterval(timer);
        const ok=old?.status===nextStatus;
        sendResponse(ok?{ok:true,attempted:true,phone:target.phone,fs,profile,status:nextStatus}:
          {ok:false,attempted:true,errorCode:'STATUS_TIMEOUT',error:`${nextStatus} status not observed within 10s; check FreeSWITCH manually`});
        publish();
      }
    }
    // Most pages update the select synchronously. Respond without waiting for
    // a timer that browsers may throttle when the FreeSWITCH tab is hidden.
    check();
    if(!finished)timer=setInterval(check,250);
    return true;
  });

  publish();
  const timer=setInterval(/** Tác dụng: Chạy tác vụ lấy mẫu hoặc cập nhật theo chu kỳ. */ ()=>{
    if(!chrome?.runtime?.id){clearInterval(timer);return;}
    publish();
  },1500);
})();