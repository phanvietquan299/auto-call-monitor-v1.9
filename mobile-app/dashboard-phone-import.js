/* Shared desktop/PWA UI: Excel stays in the browser; transport only sends selected phone/IP entries. */
(function(){
  if(!globalThis.PhoneImport)return;
  async function send(message){const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw Error(response?.error||'Không nhận được kết quả nạp số');return response;}
  function mount(){
    const container=document.getElementById('phone-import-controls');
    if(!container||document.getElementById('monitor-phone-import'))return;
    const host=document.createElement('span');host.id='monitor-phone-import';container.append(host);
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>
      :host{display:inline-block;font:14px system-ui,sans-serif;color:#19283b}*{box-sizing:border-box}
      button{font:inherit;border:0;border-radius:8px;padding:10px 14px;min-height:44px;line-height:1.3;white-space:normal;cursor:pointer;background:#087e9b;color:white;font-weight:650}button:disabled{opacity:.5;cursor:default}button.done:disabled{opacity:1;background:#187542;color:white}fieldset{border:1px solid #c9d6e3;border-radius:10px;margin:0 0 14px;padding:12px;display:flex;gap:18px;flex-wrap:wrap}fieldset label{cursor:pointer;display:flex;align-items:center;gap:10px;min-height:44px}input[type=checkbox]{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:23px;height:23px;flex:0 0 23px;margin:0;border:2px solid #60758a;border-radius:4px;background:#fff;display:grid;place-content:center;cursor:pointer}input[type=checkbox]::before{content:'';width:6px;height:11px;border:solid white;border-width:0 3px 3px 0;transform:rotate(45deg) scale(0)}input[type=checkbox]:checked{background:#087e9b;border-color:#087e9b}input[type=checkbox]:checked::before{transform:rotate(45deg) scale(1)}input[type=checkbox]:focus-visible{outline:3px solid #70c9e4;outline-offset:3px}input[type=checkbox]:disabled{opacity:.5;cursor:default}#completion{background:#e6f5eb;color:#125b31;border:1px solid #8dc9a2;border-radius:10px;padding:12px;margin-top:14px;font-weight:700}#completion[hidden]{display:none}#results>p.success{background:#e6f5eb;color:#125b31;border:1px solid #8dc9a2}#results>p.error{background:#fff0f1;color:#a31524}#footer{position:sticky;bottom:-24px;background:#fff;padding:8px 0 0;margin-top:12px}
      dialog{width:min(850px,calc(100vw - 24px));max-height:90vh;border:0;border-radius:16px;padding:24px;background:#fff;color:#19283b;overflow:auto}dialog::backdrop{background:#0d172b99}
      h2{margin:0 0 12px;font-size:22px}p{line-height:1.5}input{max-width:100%}.drop{border:2px dashed #7e9bb5;border-radius:12px;padding:18px;display:grid;gap:10px}.drop.over{background:#e8f5fa}
      .actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.actions>button{width:100%;min-width:0}.secondary{background:#e8edf3;color:#19283b}
      #status{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:14px 0}#status.error{color:#a31524}#status.ok{color:#12683b}
      .table{overflow:auto;margin-top:14px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #dbe3ed;white-space:nowrap}details{margin-top:12px}pre{max-height:170px;overflow:auto;background:#f2f5f8;padding:12px}#results>p{padding:10px;background:#f2f5f8;border-radius:8px}
      @media(max-width:600px){dialog{padding:16px}h2{font-size:19px}.actions{grid-template-columns:repeat(2,minmax(0,1fr))}#submit{grid-column:1/-1}#footer{bottom:-16px}.drop{padding:12px}table{table-layout:fixed}th,td{padding:8px 4px;white-space:normal;overflow-wrap:anywhere;font-size:12px}th:nth-child(1){width:44px}th:nth-child(2){width:84px}th:nth-child(4){width:54px}}
    </style>
    <button id="open" type="button">Nạp số</button>
    <dialog aria-labelledby="heading"><h2 id="heading">Nạp số</h2>
      <p>Tick COLL, TLS hoặc cả hai; chỉ đọc và nạp các sheet được tick. Cột A: số điện thoại; cột B: IP public. Tự thêm 0 đầu nếu số có 9 chữ số.</p>
      <fieldset><legend>Nhóm cần nạp (bắt buộc chọn)</legend><label><input type="checkbox" name="sheet" value="coll"> COLL · Collection</label><label><input type="checkbox" name="sheet" value="tls"> TLS · Sale</label></fieldset>
      <label class="drop" id="drop">Kéo thả file .xlsx vào đây hoặc chọn file<input id="file" type="file" accept=".xlsx" disabled></label>
      <div id="status" role="status" aria-live="polite"></div><div id="preview"></div><div id="results"></div>
      <div id="footer"><div id="completion" role="status" aria-live="polite" hidden></div><div class="actions"><button class="secondary" id="close" type="button">Đóng</button><button class="secondary" id="reload" type="button">Chọn lại file</button><button id="submit" type="button" disabled>Nạp số</button></div></div>
    </dialog>`;
    const el=id=>root.getElementById(id),dialog=root.querySelector('dialog');
    let plan=null,busy=false,completed=false,hasFile=false,selectedSheet='';
    const label=sheet=>sheet==='both'?'COLL + TLS':sheet.toUpperCase();
    const message=(text,error=false)=>{el('status').textContent=text;el('status').className=error?'error':'ok';};
    const lock=value=>{busy=value;el('file').disabled=value||!selectedSheet;for(const radio of root.querySelectorAll('[name=sheet]'))radio.disabled=value;el('close').disabled=value;el('reload').disabled=value||!hasFile;el('submit').disabled=value||!plan||completed;el('submit').setAttribute('aria-busy',String(value));};
    const finish=text=>{completed=true;el('submit').className='done';el('completion').textContent=text;el('completion').hidden=false;};
    /** Reset file, preview and results together; retain the chosen group. */
    function resetFile(){
      plan=null;completed=false;hasFile=false;el('file').value='';
      el('preview').replaceChildren();el('results').replaceChildren();el('completion').hidden=true;el('submit').className='';lock(false);
    }
    for(const radio of root.querySelectorAll('[name=sheet]'))radio.onchange=()=>{
      if(busy)return;const checked=[...root.querySelectorAll('[name=sheet]:checked')].map(input=>input.value);selectedSheet=checked.length===2?'both':checked[0]||'';resetFile();
      message(selectedSheet?`Đã chọn ${label(selectedSheet)}. Chọn hoặc thả file Excel.`:'Chọn ít nhất một nhóm trước khi chọn file.');
    };
    el('open').onclick=()=>dialog.showModal();el('close').onclick=()=>dialog.close();
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    /** Xem trước giữ nguyên mapping nguồn và chỉ hiển thị số chưa có trên đúng FS. */
    async function preview(file){
      if(busy)return;if(!file){resetFile();message('Chọn file Excel để xem trước.');return;}if(!selectedSheet){message('Chọn COLL hoặc TLS trước khi thả file',true);return;}hasFile=true;plan=null;completed=false;el('completion').hidden=true;el('submit').className='';lock(true);el('preview').replaceChildren();el('results').replaceChildren();
      try{
        if(!/\.xlsx$/i.test(file.name))throw Error('Chỉ nhận file .xlsx; lưu lại Excel thành .xlsx trước khi chọn');
        if(file.size>10*1024*1024)throw Error('File vượt 10 MB');
        message('Đang đọc Excel và đối chiếu FreeSWITCH…');
        const parsed=await PhoneImport.readXlsx(await file.arrayBuffer(),selectedSheet);
        if(parsed.errors.length)throw Error(parsed.errors.slice(0,20).join('\n')+(parsed.errors.length>20?'\n… còn lỗi khác; cần kiểm tra file':''));
        const entries=parsed.batches.flatMap(batch=>batch.phones.map(phone=>({phone,publicIp:batch.publicIp})));
        const response=await send({type:'PHONE_IMPORT_PREVIEW',selectedSheet,entries,requestId:crypto.randomUUID()});
        const remote=response.phoneImport;
        if(!remote?.previewId||remote.selectedSheet!==selectedSheet)throw Error('Kết quả xem trước không đúng nhóm');
        parsed.previewId=remote.previewId;
        const rows=parsed.batches.map(batch=>{
          const group=remote.groups.find(g=>g.fs===batch.fs);
          if(!group||!Array.isArray(group.pendingIndexes)||group.pendingIndexes.length!==group.count)throw Error('Cần reload extension trên máy nguồn để cập nhật bảng xem trước.');
          const indexes=group.pendingIndexes;
          if(new Set(indexes).size!==indexes.length||indexes.some(index=>!Number.isInteger(index)||index<0||index>=batch.phones.length))throw Error('Danh sách số cần nạp không hợp lệ');
          return {batch:{...batch,phones:indexes.map(index=>batch.phones[index])},count:group.count,existing:group.existing};
        });
        const pendingRows=rows.filter(row=>row.count>0);
        const wrap=document.createElement('div');wrap.className='table';const table=document.createElement('table');
        const header=table.createTHead().insertRow();for(const title of ['FS','Profile','IP public → nội bộ','Số cần nạp']){const th=document.createElement('th');th.textContent=title;header.append(th);}
        for(const row of pendingRows){const tr=table.insertRow();for(const text of [row.batch.fs,row.batch.profile,`${row.batch.publicIp} → ${row.batch.ip}`,row.count])tr.insertCell().textContent=String(text);}
        if(pendingRows.length){wrap.append(table);el('preview').append(wrap);}
        for(const {batch} of pendingRows){const detail=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('pre');summary.textContent=`${batch.fs}: xem ${batch.phones.length} số cần nạp`;list.textContent=batch.phones.join('\n');detail.append(summary,list);el('preview').append(detail);}
        plan={...parsed,batches:pendingRows.map(row=>row.batch)};const count=rows.reduce((n,r)=>n+r.count,0);completed=!count;
        message(`${label(selectedSheet)} · ${file.name}\n${count} số cần nạp · ${rows.reduce((n,row)=>n+row.existing,0)} số đã có${parsed.duplicates?` · ${parsed.duplicates} dòng trùng`:''}.`);
        if(!count)finish('Không cần nạp thêm: tất cả số của sheet đã chọn đã có trên đúng FS.');
      }catch(error){plan=null;message(error.message,true);}finally{lock(false);}
    }
    el('file').onchange=()=>preview(el('file').files[0]);
    for(const type of ['dragenter','dragover'])el('drop').addEventListener(type,event=>{event.preventDefault();el('drop').classList.add('over');});
    for(const type of ['dragleave','drop'])el('drop').addEventListener(type,event=>{event.preventDefault();el('drop').classList.remove('over');});
    el('drop').addEventListener('drop',event=>{const files=event.dataTransfer.files;if(files.length===1)preview(files[0]);else if(!busy)message('Chọn đúng một file Excel',true);});
    el('reload').onclick=()=>{
      if(busy)return;resetFile();message('Chọn lại file Excel để xem trước.');
    };
    lock(false);
    /** Nạp tuần tự, đọc lại scope/mapping trước mỗi batch và xác minh bằng API server sau POST. */
    el('submit').onclick=async()=>{
      if(busy||!plan||completed||plan.selectedSheet!==selectedSheet)return;lock(true);el('results').replaceChildren();let total=0;
      try{
        for(const batch of plan.batches){
          const row=document.createElement('p');el('results').append(row);row.textContent=`${batch.fs}: đang chờ máy tính nạp và xác minh…`;
          const response=await send({type:'PHONE_IMPORT_EXECUTE',previewId:plan.previewId,fs:batch.fs,requestId:crypto.randomUUID()});
          const result=response.phoneImport;if(!result?.verified||result.fs!==batch.fs)throw Error('Chưa xác minh được kết quả '+batch.fs);
          total+=result.added;row.className='success';row.textContent=result.added?`${batch.fs}: xác minh đủ ${result.added} số mới trên server.`:`${batch.fs}: tất cả số đã có, bỏ qua.`;
        }
        finish(`Đã hoàn tất ${label(selectedSheet)}: nạp và xác minh ${total} số mới.`);message(`Hoàn tất: đã nạp và xác minh ${total} số mới. Kết quả đã được máy tính xác minh trên FreeSWITCH.`);el('footer').scrollIntoView({block:'nearest'});
      }catch(error){completed=true;el('submit').className='';el('completion').hidden=true;const last=el('results').lastElementChild;if(last&&!last.className)last.className='error';message(`${error.message}\nĐã dừng các FS còn lại; không tự retry. Các FS xác minh thành công phía trên đã được nạp.`,true);}
      finally{lock(false);}
    };
  }
  mount();
})();
