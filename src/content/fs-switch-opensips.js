/* Read the site's actual forms/links; preserve every field except Group ID. */
(() => {
  const group=location.hostname==='10.10.99.153'?'99.153':location.hostname==='10.10.99.155'?'99.155':null;
  if(!group)return;
  const listing=new URL('/cp/tools/system/loadbalancer/loadbalancer.php?action=add',location.origin).href;
  const pageId=`${Date.now()}-${Math.random()}`;
  let running=false,stage='VALIDATING';
  const text=el=>(el?.value||el?.textContent||el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();
  function url(value,base){const u=new URL(value,base);if(u.origin!==location.origin||!/^https?:$/.test(u.protocol))throw Error('Liên kết không thuộc OpenSIPS hiện tại.');return u.href;}
  async function request(href,options={}){
    const res=await fetch(url(href,listing),{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(12000),...options});
    if(!res.ok)throw Error('OpenSIPS HTTP '+res.status);
    const html=await res.text(),doc=new DOMParser().parseFromString(html,'text/html');
    if(/SQLITE_ERROR|cannot start a transaction|fatal error/i.test(html))throw Error('OpenSIPS trả lỗi backend.');
    return {doc,html,href:res.url||href};
  }
  function row(page,node){
    const matches=[...page.doc.querySelectorAll('table.ttable tr')].filter(r=>{
      const cells=[...r.querySelectorAll('td')];
      return cells[0]?.textContent.trim()===String(node.id)&&cells[2]?.textContent.trim().match(/^sip:([\d.]+):\d+$/i)?.[1]===node.ip;
    });
    if(matches.length!==1)throw Error('Không tìm thấy đúng một destination '+node.fs);
    return matches[0];
  }
  function readGroup(r){const value=r.querySelectorAll('td')[1]?.textContent.trim();if(value==null||!/^\d*$/.test(value))throw Error('Group ID không hợp lệ.');return Number(value);}
  function readVt(r){const value=r.querySelectorAll('td')[3]?.textContent||'';const m=value.match(/\bvt\s*=\s*(\d+)\s*\/\s*\d+/i);return m?Number(m[1]):null;}
  const controls=doc=>[...doc.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,a,[role=button]')];
  function findButton(doc,label){const matches=controls(doc).filter(el=>text(el).toLowerCase()===label.toLowerCase());if(matches.length!==1)throw Error('Không xác định được nút '+label+'; cần kiểm tra HTML trang.');return matches[0];}
  async function submit(page,button,change){
    if(button.tagName==='A')return request(url(button.getAttribute('href'),page.href));
    const form=button.closest('form');if(!form)throw Error('Nút không thuộc form; chưa hỗ trợ handler JavaScript này.');
    const body=new URLSearchParams();
    for(const el of [...form.elements]){
      if(!el.name||el.disabled||['submit','button','reset','file'].includes(el.type)||['checkbox','radio'].includes(el.type)&&!el.checked)continue;
      if(el.tagName==='SELECT'&&el.multiple){for(const o of el.selectedOptions)body.append(el.name,o.value);}else body.append(el.name,el.value);
    }
    if(change)body.set(change.name,change.value);
    if(button.name)body.set(button.name,button.value||text(button));
    const action=url(form.getAttribute('action')||page.href,page.href);
    if((form.getAttribute('method')||'get').toLowerCase()==='get'){
      const u=new URL(action);for(const [k,v] of body)u.searchParams.set(k,v);return request(u.href);
    }
    return request(action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString()});
  }
  async function reloadServer(page,button){
    const handler=button?.getAttribute?.('onclick')||'';
    let result;
    if(!button||/\bapply_changes\s*\(/.test(handler)){
      // OpenSIPS CP 8.3.2's button performs this GET, not a form submit.
      result=await request(url('apply_changes.php',page.href));
    }else if(button.type==='button'){
      throw Error('Nút Reload dùng JavaScript chưa nhận diện; không coi Save là thành công.');
    }else result=await submit(page,button);
    const message=(result.doc.body?.textContent||result.html||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const replies=[...message.matchAll(/Sending to\s+(.+?)(?=Sending to\s+|$)/gi)].map(m=>m[1]);
    if(!/Sending MI command:\s*lb_reload\b/i.test(message)||!replies.length||
      replies.some(reply=>!/:\s*Success\s*$/i.test(reply))||
      /\b(error|failed|failure|exception)\b/i.test(message))
      throw Error('Reload on Server chưa xác nhận lb_reload Success: '+message.slice(0,240));
    return result;
  }
  async function refresh(){return request(listing,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'refresh='+encodeURIComponent('Refresh from Server')});}
  async function change(msg){
    const allowed=group==='99.153'?['FS01','FS02','FS03','FS04','OS01']:['FS05','FS06','FS07'];

    const ips={OS01:'10.10.99.140',FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88'};

    const active=group==='99.153'?2:3;

    if(msg.group!==group||!allowed.includes(msg.node?.fs)||ips[msg.node.fs]!==msg.node.ip||
      ![[0,active],[active,0]].some(([a,b])=>a===msg.expected&&b===msg.value))throw Error('Yêu cầu chuyển FS không hợp lệ.');
    let page=await refresh();const r=row(page,msg.node);
    if(readGroup(r)!==msg.expected)throw Error('Group ID nguồn đã thay đổi; không ghi đè.');
    // Edit is the pen column immediately before Delete, never guess by destination ID.
    const cells=[...r.querySelectorAll('td')],link=cells[cells.length-2]?.querySelector('a[href]');
    if(!link)throw Error('Không tìm thấy link Edit; cần HTML của dòng OpenSIPS.');
    page=await request(url(link.getAttribute('href'),page.href));
    const inputs=[...page.doc.querySelectorAll('input')];
    const sip=inputs.filter(el=>el.value?.trim()===`sip:${msg.node.ip}:5060`);
    if(sip.length!==1)throw Error('Form Edit không khớp SIP URI của FS.');
    const form=sip[0].closest('form');if(!form)throw Error('Thiếu form Edit.');
    const groupInputs=[...form.elements].filter(el=>/^(group_?id|grp_?id|group)$/i.test(el.name||el.id||''));
    if(groupInputs.length!==1)throw Error('Không nhận diện được input Group ID; cần HTML form Edit.');
    const input=groupInputs[0];if(!/^\d*$/.test(input.value.trim())||Number(input.value)!==msg.expected)throw Error('Group ID trong Edit không khớp.');
    stage='SAVING';
    page=await submit(page,findButton(form,'Save'),{name:input.name,value:String(msg.value)});
    stage='SAVED';
    // Some edit handlers return the Edit page or a success fragment, rather
    // than redirecting fetch to the list. Load the list without repeating Save.
    let reload;
    try{reload=findButton(page.doc,'Reload on Server');}
    catch{page=await request(listing);reload=findButton(page.doc,'Reload on Server');}
    // Save alone is never considered applied.
    page=await reloadServer(page,reload);
    stage='RELOADED';
    // Refresh from Server verifies the applied runtime group, not the optimistic form.
    page=await refresh();
    if(readGroup(row(page,msg.node))!==msg.value)throw Error('Reload chưa xác nhận Group ID mới. Kiểm tra OpenSIPS.');
    return {ok:true,fs:msg.node.fs,groupId:msg.value,reloaded:true,pageId};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(['FS_SWITCH_READ_TEST','FS_SWITCH_READ_NODE'].includes(msg.type)){
      if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
      const ips={OS01:'10.10.99.140',FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88'};
      const allowed=group==='99.153'?['FS01','FS02','FS03','FS04','OS01']:['FS05','FS06','FS07'];
      if(!allowed.includes(msg.node?.fs)||ips[msg.node.fs]!==msg.node.ip||
        msg.type==='FS_SWITCH_READ_TEST'&&(group!=='99.153'||!['FS03','FS04'].includes(msg.node.fs))){
        reply({ok:false,error:'FS không thuộc phạm vi được phép trên trang này.'});return;
      }
      refresh().then(page=>reply({ok:true,groupId:readGroup(row(page,msg.node)),used:readVt(row(page,msg.node)),pageId})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
    }
    if(msg.type==='FS_SWITCH_RELOAD_SERVER'){
      if(msg.group!==group){reply({ok:false,error:'Nhóm OpenSIPS không khớp.'});return;}
      if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
      running=true;globalThis.fsSwitchBusy=true;
      // CP's standalone Reload is the known MI endpoint; listing variants may omit the button.
      reloadServer({href:listing},null).then(()=>refresh())
        .then(()=>reply({ok:true,reloaded:true,group})).catch(error=>reply({ok:false,error:String(error.message||error)}))
        .finally(()=>{running=false;globalThis.fsSwitchBusy=false;});return true;
    }
    if(msg.type!=='FS_SWITCH_SET_GROUP')return;
    if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
    running=true;stage='VALIDATING';globalThis.fsSwitchBusy=true;
    change(msg).then(reply).catch(error=>reply({ok:false,stage,error:(stage==='SAVED'?'Đã Save Group ID, nhưng chưa hoàn tất Reload on Server: ':stage==='RELOADED'?'Đã gửi Reload, nhưng chưa xác minh Group ID: ':'')+String(error.message||error)})).finally(()=>{running=false;globalThis.fsSwitchBusy=false;});return true;
  });
})();
