(() => {
  function send(msg) {
    try { if (chrome?.runtime?.id) chrome.runtime.sendMessage(msg).catch(()=>{}); } catch (_) {}
  }

  function parseNumbers() {
    const tbody=document.querySelector("#numbers-tbody");
    if(!tbody) return [];
    const out=[];
    for(const tr of [...tbody.querySelectorAll(":scope > tr")]){
      const td=[...tr.children].filter(x=>x.tagName==="TD");
      if(td.length<4) continue;
      const phone=(td[0].innerText||"").trim();
      const fs=(td[1].innerText||"").trim().toUpperCase();
      const profile=(td[2].innerText||"").trim().toUpperCase();
      const select=td[3].querySelector("select");
      const status=(select?.value||"").trim().toUpperCase();

      if(phone&&/^FS\d+$/i.test(fs)) out.push({phone,fs,profile,status,hasStatusControl:!!select&&!select.disabled});
    }
    return out;
  }

  function parseBackupSummary(){
    const nodes=[];
    for(const table of document.querySelectorAll('table')){
      if(typeof table.querySelectorAll!=='function')continue;
      const rows=[...table.querySelectorAll('tr')];
      const header=rows.find(r=>/BACKUP/i.test(r.innerText||r.textContent||'')&&/NODE\s*ID/i.test(r.innerText||r.textContent||''));
      if(!header)continue;
      const labels=[...header.children].map(c=>(c.innerText||c.textContent||'').trim().toUpperCase());
      const fsIndex=labels.findIndex(x=>/^NODE\s*ID$/.test(x)),backupIndex=labels.indexOf('BACKUP');
      if(fsIndex<0||backupIndex<0)continue;
      for(const row of rows){
        const cells=[...row.children],name=(cells[fsIndex]?.innerText||cells[fsIndex]?.textContent||'').trim().toUpperCase();
        const value=(cells[backupIndex]?.innerText||cells[backupIndex]?.textContent||'').trim();
        if(/^FS\d+$/.test(name)&&/^\d+$/.test(value))nodes.push({fs:name,backups:Number(value)});
      }
    }
    return nodes;
  }
  function publish(){
    send({type:"FREESWITCH_SAMPLE",data:{numbers:parseNumbers(),backupSummary:parseBackupSummary()}});
  }

  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
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
      const td=[...tr.children].filter(x=>x.tagName==="TD");
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
    const blocked=[...target.select.options].find(o=>o.value.toUpperCase()===nextStatus);
    if(!blocked||target.select.disabled){
      sendResponse({ok:false,attempted:false,errorCode:"STATUS_UNAVAILABLE",error:`${nextStatus} status unavailable`});return;
    }
    // Use the page's existing status-change handler. Do not invoke swap.
    target.select.value=blocked.value;
    target.select.dispatchEvent(new Event('change',{bubbles:true}));
    const deadline=Date.now()+10000;
    let timer=null,finished=false;
    function check(){
      if(finished)return;
      const numbers=parseNumbers();
      const old=numbers.find(n=>n.phone===target.phone&&n.fs===fs&&n.profile===profile);
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
  const timer=setInterval(()=>{
    if(!chrome?.runtime?.id){clearInterval(timer);return;}
    publish();
  },1500);
})();