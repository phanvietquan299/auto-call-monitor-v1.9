/* Read the site's actual forms/links; preserve every field except Group ID. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ () => {
  const group=location.hostname==='10.10.99.153'?'99.153':location.hostname==='10.10.99.155'?'99.155':null;
  if(!group)return;
  const listing=new URL('/cp/tools/system/loadbalancer/loadbalancer.php?action=add',location.origin).href;
  const pageId=`${Date.now()}-${Math.random()}`;
  let running=false,stage='VALIDATING';
  const text=/** Tác dụng: Chuẩn hóa nhãn nút hoặc nội dung control để nhận diện thao tác trên trang. */ el=>(el?.value||el?.textContent||el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();
  /** Tác dụng: Chuyển liên kết tương đối thành URL và từ chối liên kết ngoài OpenSIPS hiện tại. */
  function url(value,base){const u=new URL(value,base);if(u.origin!==location.origin||!/^https?:$/.test(u.protocol))throw Error('Liên kết không thuộc OpenSIPS hiện tại.');return u.href;}
  /** Tác dụng: Gửi HTTP cùng cookie tới OpenSIPS hiện tại, phân tích HTML và từ chối lỗi HTTP/backend. */
  async function request(href,options={}){
    const res=await fetch(url(href,listing),{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(12000),...options});
    if(!res.ok)throw Error('OpenSIPS HTTP '+res.status);
    const html=await res.text(),doc=new DOMParser().parseFromString(html,'text/html');
    if(/SQLITE_ERROR|cannot start a transaction|fatal error/i.test(html))throw Error('OpenSIPS trả lỗi backend.');
    return {doc,html,href:res.url||href};
  }
  /** Tác dụng: Tìm đúng một destination theo ID và SIP IP; báo lỗi nếu thiếu hoặc trùng. */
  function row(page,node){
    const matches=[...page.doc.querySelectorAll('table.ttable tr')].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong row. */ r=>{
      const cells=[...r.querySelectorAll('td')];
      return cells[0]?.textContent.trim()===String(node.id)&&cells[2]?.textContent.trim().match(/^sip:([\d.]+):\d+$/i)?.[1]===node.ip;
    });
    if(matches.length!==1)throw Error('Không tìm thấy đúng một destination '+node.fs);
    return matches[0];
  }
  /** Tác dụng: Đọc và kiểm tra Group ID của một dòng destination. */
  function readGroup(r){const value=r.querySelectorAll('td')[1]?.textContent.trim();if(value==null||!/^\d*$/.test(value))throw Error('Group ID không hợp lệ.');return Number(value);}
  /** Tác dụng: Đọc số VT đang dùng từ cột resource của destination, trả null nếu không đọc được. */
  function readVt(r){const value=r.querySelectorAll('td')[3]?.textContent||'';const m=value.match(/\bvt\s*=\s*(\d+)\s*\/\s*\d+/i);return m?Number(m[1]):null;}
  const controls=/** Tác dụng: Liệt kê các nút/liên kết có thể là control Save hoặc Reload trên trang. */ doc=>[...doc.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,a,[role=button]')];
  /** Tác dụng: Tìm chính xác một control theo nhãn; báo lỗi khi không xác định được nút duy nhất. */
  function findButton(doc,label){const matches=controls(doc).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong findButton. */ el=>text(el).toLowerCase()===label.toLowerCase());if(matches.length!==1)throw Error('Không xác định được nút '+label+'; cần kiểm tra HTML trang.');return matches[0];}
  /** Tác dụng: Gửi form/link thực tế, giữ các trường còn lại và chỉ thay trường được chỉ định. */
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
  /** Tác dụng: Gửi Reload on Server và kiểm tra phản hồi MI lb_reload đều báo Success. */
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
    const replies=[...message.matchAll(/Sending to\s+(.+?)(?=Sending to\s+|$)/gi)].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong reloadServer. */ m=>m[1]);
    if(!/Sending MI command:\s*lb_reload\b/i.test(message)||!replies.length||
      replies.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong reloadServer. */ reply=>!/:\s*Success\s*$/i.test(reply))||
      /\b(error|failed|failure|exception)\b/i.test(message))
      throw Error('Reload on Server chưa xác nhận lb_reload Success: '+message.slice(0,240));
    return result;
  }
  /** Tác dụng: Yêu cầu Refresh from Server để lấy Group ID và VT từ runtime OpenSIPS. */
  async function refresh(){return request(listing,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'refresh='+encodeURIComponent('Refresh from Server')});}
  /** Tác dụng: Kiểm tra FS và Group ID cũ, sửa đúng form, Save rồi Reload và đọc lại runtime Group ID. */
  async function change(msg){
    const allowed=group==='99.153'?['FS01','FS02','FS03','FS04','OS01']:['FS05','FS06','FS07'];

    const ips={OS01:'10.10.99.140',FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88'};

    const active=group==='99.153'?2:3;

    if(msg.group!==group||!allowed.includes(msg.node?.fs)||ips[msg.node.fs]!==msg.node.ip||
      ![[0,active],[active,0]].some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong change. */ ([a,b])=>a===msg.expected&&b===msg.value))throw Error('Yêu cầu chuyển FS không hợp lệ.');
    let page=await refresh();const r=row(page,msg.node);
    if(readGroup(r)!==msg.expected)throw Error('Group ID nguồn đã thay đổi; không ghi đè.');
    // Edit is the pen column immediately before Delete, never guess by destination ID.
    const cells=[...r.querySelectorAll('td')],link=cells[cells.length-2]?.querySelector('a[href]');
    if(!link)throw Error('Không tìm thấy link Edit; cần HTML của dòng OpenSIPS.');
    page=await request(url(link.getAttribute('href'),page.href));
    const inputs=[...page.doc.querySelectorAll('input')];
    const sip=inputs.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong change. */ el=>el.value?.trim()===`sip:${msg.node.ip}:5060`);
    if(sip.length!==1)throw Error('Form Edit không khớp SIP URI của FS.');
    const form=sip[0].closest('form');if(!form)throw Error('Thiếu form Edit.');
    const groupInputs=[...form.elements].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong change. */ el=>/^(group_?id|grp_?id|group)$/i.test(el.name||el.id||''));
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
  chrome.runtime.onMessage.addListener(/** Tác dụng: Nhận message extension, phân biệt loại lệnh và trả kết quả đồng bộ hoặc bất đồng bộ. */ (msg,_sender,reply)=>{
    if(['FS_SWITCH_READ_TEST','FS_SWITCH_READ_NODE'].includes(msg.type)){
      if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
      const ips={OS01:'10.10.99.140',FS01:'10.10.101.176',FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS05:'10.10.101.58',FS06:'10.10.101.87',FS07:'10.10.101.88'};
      const allowed=group==='99.153'?['FS01','FS02','FS03','FS04','OS01']:['FS05','FS06','FS07'];
      if(!allowed.includes(msg.node?.fs)||ips[msg.node.fs]!==msg.node.ip||
        msg.type==='FS_SWITCH_READ_TEST'&&(group!=='99.153'||!['FS03','FS04'].includes(msg.node.fs))){
        reply({ok:false,error:'FS không thuộc phạm vi được phép trên trang này.'});return;
      }
      refresh().then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ page=>reply({ok:true,groupId:readGroup(row(page,msg.node)),used:readVt(row(page,msg.node)),pageId})).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ e=>reply({ok:false,error:String(e.message||e)}));return true;
    }
    if(msg.type==='FS_SWITCH_RELOAD_SERVER'){
      if(msg.group!==group){reply({ok:false,error:'Nhóm OpenSIPS không khớp.'});return;}
      if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
      running=true;globalThis.fsSwitchBusy=true;
      // CP's standalone Reload is the known MI endpoint; listing variants may omit the button.
      reloadServer({href:listing},null).then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ ()=>refresh())
        .then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ ()=>reply({ok:true,reloaded:true,group})).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ error=>reply({ok:false,error:String(error.message||error)}))
        .finally(/** Tác dụng: Dọn cờ hoặc trạng thái sau bước bất đồng bộ, kể cả khi lỗi. */ ()=>{running=false;globalThis.fsSwitchBusy=false;});return true;
    }
    if(msg.type!=='FS_SWITCH_SET_GROUP')return;
    if(running){reply({ok:false,error:'OpenSIPS đang chuyển FS.'});return;}
    running=true;stage='VALIDATING';globalThis.fsSwitchBusy=true;
    change(msg).then(reply).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ error=>reply({ok:false,stage,error:(stage==='SAVED'?'Đã Save Group ID, nhưng chưa hoàn tất Reload on Server: ':stage==='RELOADED'?'Đã gửi Reload, nhưng chưa xác minh Group ID: ':'')+String(error.message||error)})).finally(/** Tác dụng: Dọn cờ hoặc trạng thái sau bước bất đồng bộ, kể cả khi lỗi. */ ()=>{running=false;globalThis.fsSwitchBusy=false;});return true;
  });
})();
