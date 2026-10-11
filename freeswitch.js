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

  function publish(){
    send({type:"FREESWITCH_SAMPLE",data:{numbers:parseNumbers()}});
  }

  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg.type==="READ_FS_NUMBERS"){sendResponse({ok:true,numbers:parseNumbers()});return;}
    if(msg.type!=="AUTO_BLOCK_FS") return;

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
      if(rowFs===fs && rowProfile===profile && status==="ACTIVE"){
        matches.push({tr,phone,select});
      }
    }

    // Fail closed: exactly one ACTIVE number must match the target FS/profile.
    if(matches.length!==1){
      sendResponse({ok:false,attempted:false,errorCode:'ACTIVE_COUNT',error:`Expected exactly 1 ACTIVE ${profile} number for ${fs}; found ${matches.length}`});
      return;
    }

    const target=matches[0];
    if(!expectedPhone||target.phone!==expectedPhone||!target.select){
      sendResponse({ok:false,attempted:false,errorCode:"TARGET_CHANGED",error:"ACTIVE phone changed or status control missing"});return;
    }
    const blocked=[...target.select.options].find(o=>o.value.toUpperCase()==='BLOCKED');
    if(!blocked||target.select.disabled){
      sendResponse({ok:false,attempted:false,errorCode:"STATUS_UNAVAILABLE",error:"BLOCKED status unavailable"});return;
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
      if(old?.status==='BLOCKED'||Date.now()>=deadline){
        finished=true;if(timer!==null)clearInterval(timer);
        const ok=old?.status==='BLOCKED';
        sendResponse(ok?{ok:true,attempted:true,phone:target.phone,fs,profile}:
          {ok:false,attempted:true,errorCode:'STATUS_TIMEOUT',error:'BLOCKED status not observed within 10s; check FreeSWITCH manually'});
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