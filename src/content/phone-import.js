/* Uses the same authenticated /api/numbers/add contract as the site's Nạp Số form. */
(function(){
  if(location.origin!=='http://10.10.101.67:5003'||!globalThis.PhoneImport)return;
  const JOURNAL='phoneImportPending';
  /** Chỉ gọi API cùng origin; không retry lệnh POST. */
  async function api(path,body){
    if(!chrome.runtime.id)throw Error('Extension đã reload; tải lại tab FreeSWITCH');
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`FreeSWITCH HTTP ${response.status}; kiểm tra đăng nhập`);
    return response.json();
  }
  async function scope(){return (await chrome.storage.local.get('fsSwitch')).fsSwitch?.displayNodes;}
  /** Đọc inventory server đầy đủ, không dùng bảng DOM đang lọc ACTIVE. */
  async function inventory(){
    const [nodes,numbers]=await Promise.all([api('/api/nodes'),api('/api/numbers')]);
    if(!Array.isArray(nodes)||!Array.isArray(numbers))throw Error('Không đọc được danh sách FS/số; kiểm tra đăng nhập');
    return {nodes,numbers};
  }
  /** Giữ khóa một batch chưa xác minh qua reload; chỉ gỡ khi server trả đủ số đúng đích. */
  async function reconcile(numbers){
    const journal=(await chrome.storage.local.get(JOURNAL))[JOURNAL];if(!journal)return;
    if(journal.phones.every(phone=>numbers.some(n=>String(n.phone)===phone&&String(n.node_id)===journal.fs&&n.profile===journal.profile))){await chrome.storage.local.remove(JOURNAL);return;}
    throw Error(`${journal.fs}: lượt nạp trước chưa xác minh đủ số. Đã khóa gửi lại để tránh nạp lặp; kiểm tra kho số trên FreeSWITCH rồi chọn Đọc lại kết quả.`);
  }

  let busy=false;
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['PHONE_IMPORT_INVENTORY','PHONE_IMPORT_ADD_BATCH','PHONE_EXPORT_INVENTORY'].includes(message.type))return;
    if(sender.id!==chrome.runtime.id){reply({ok:false,error:'Nguồn yêu cầu không hợp lệ'});return;}
    if(busy){reply({ok:false,error:'Đang nạp số; chờ hoàn tất'});return;}
    busy=true;
    (async()=>{
      const data=await inventory();
      if(message.type==='PHONE_EXPORT_INVENTORY')return {ok:true,...data};
      await reconcile(data.numbers);
      if(message.type==='PHONE_IMPORT_INVENTORY')return {ok:true,...data};
      const batch=message.batch;PhoneImport.validateTarget(batch,data.nodes,await scope());
      const phones=PhoneImport.pending(batch,data.numbers);
      if(!phones.length)return {ok:true,phoneImport:{fs:batch.fs,added:0,verified:true}};
      if(phones.length>10000||phones.some(p=>PhoneImport.phone(p)!==p))throw Error('Danh sách số không hợp lệ');
      await chrome.storage.local.set({[JOURNAL]:{fs:batch.fs,profile:batch.profile,phones,at:Date.now()}});
      try{PhoneImport.validateTarget(batch,data.nodes,await scope());}catch(error){await chrome.storage.local.remove(JOURNAL);throw error;}
      const result=await api('/api/numbers/add',{nodeId:batch.fs,phones});
      if(result.success!==true)throw Error('Server chưa xác nhận nạp; không tự gửi lại');
      const numbers=await api('/api/numbers');if(!Array.isArray(numbers))throw Error('Không đọc được kết quả nạp');
      await reconcile(numbers);
      return {ok:true,phoneImport:{fs:batch.fs,added:phones.length,verified:true}};
    })().then(reply,error=>reply({ok:false,error:String(error.message||error)})).finally(()=>{busy=false;});
    return true;
  });
})();
