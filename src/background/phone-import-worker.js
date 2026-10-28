/* Import commands use a separate serial queue; monitoring writes are not held by Excel parsing. */
(function(root){
  let queue=Promise.resolve();
  const PREVIEW='phoneImportPreview',RECEIPTS='phoneImportReceipts';
  const fail=message=>{throw Error(message);};
  async function tab(){
    const tabs=await chrome.tabs.query({url:'http://10.10.101.67:5003/*'});
    if(tabs.length!==1||tabs[0].id==null)fail('Cần đúng một tab FreeSWITCH đã đăng nhập trên máy chạy extension');
    return tabs[0].id;
  }
  async function request(id,message){
    const response=await chrome.tabs.sendMessage(id,message);
    if(!response?.ok)fail(response?.error||'Không nhận được kết quả từ FreeSWITCH; tải lại tab nguồn');
    return response;
  }
  async function selected(){return (await chrome.storage.local.get('fsSwitch')).fsSwitch?.displayNodes;}
  /** Rebuild the plan from phone/public IP input, never trust caller-selected FS or profile. */
  async function process(message){
    const now=Date.now();
    if(message.type==='PHONE_IMPORT_PREVIEW'){
      if(!['coll','tls','both'].includes(message.selectedSheet)||!Array.isArray(message.entries)||!message.entries.length||message.entries.length>10000)fail('Danh sách nạp không hợp lệ');
      if(JSON.stringify(message.entries).length>250000)fail('Danh sách quá lớn; tối đa 10.000 số mỗi lần');
      const rows=message.entries.map((entry,index)=>({row:index+1,values:[entry.phone,entry.publicIp]}));
      const sheets=message.selectedSheet==='both'?{coll:[],tls:[]}:{[message.selectedSheet]:rows};
      if(message.selectedSheet==='both')for(const row of rows){
        const target=PhoneImport.targets.find(t=>t.publicIp===String(row.values[1]).trim());
        if(!target)fail('IP public chưa được map');
        sheets[target.profile==='COLLECTION'?'coll':'tls'].push(row);
      }
      const plan=PhoneImport.prepare(sheets,message.selectedSheet);
      if(plan.errors.length)fail(plan.errors.slice(0,15).join('\n'));
      const id=await tab(),data=await request(id,{type:'PHONE_IMPORT_INVENTORY'}),scope=await selected(),groups=[],batches=[];
      for(const batch of plan.batches){
        PhoneImport.validateTarget(batch,data.nodes,scope);
        const pending=PhoneImport.pending(batch,data.numbers);
        groups.push({fs:batch.fs,count:pending.length,existing:batch.phones.length-pending.length,total:batch.phones.length,pendingIndexes:pending.map(phone=>batch.phones.indexOf(phone))});
        batches.push({...batch,phones:pending});
      }
      const preview={id:crypto.randomUUID(),at:now,expiresAt:now+10*60000,selectedSheet:plan.selectedSheet,batches,groups};
      await chrome.storage.local.set({[PREVIEW]:preview});
      return {ok:true,phoneImport:{previewId:preview.id,selectedSheet:preview.selectedSheet,expiresAt:preview.expiresAt,groups}};
    }
    if(message.type!=='PHONE_IMPORT_EXECUTE')fail('Lệnh nạp số không hợp lệ');
    const stored=await chrome.storage.local.get([PREVIEW,RECEIPTS]),preview=stored[PREVIEW];
    if(!preview||preview.id!==message.previewId||now>preview.expiresAt)fail('Bảng xem trước đã đổi hoặc hết hạn; chọn lại file để kiểm tra');
    const batch=preview.batches.find(b=>b.fs===message.fs);if(!batch)fail('FS không thuộc bảng xem trước đã xác nhận');
    const key=preview.id+':'+batch.fs,receipts=stored[RECEIPTS]||{};
    if(receipts[key])return receipts[key].result||{ok:false,error:'Lượt nạp đang chạy hoặc bị gián đoạn; kiểm tra kho số, không gửi lại'};
    const id=await tab(),data=await request(id,{type:'PHONE_IMPORT_INVENTORY'});
    PhoneImport.validateTarget(batch,data.nodes,await selected());
    const phones=PhoneImport.pending(batch,data.numbers);
    if(!phones.length)return {ok:true,phoneImport:{fs:batch.fs,added:0,existing:batch.phones.length,verified:true}};
    for(const [old,value] of Object.entries(receipts))if(now-value.at>86400000)delete receipts[old];
    if(Object.keys(receipts).length>=100)fail('Có quá nhiều lượt nạp trong ngày; kiểm tra lịch sử trước khi tiếp tục');
    receipts[key]={at:now,status:'RUNNING'};
    await chrome.storage.local.set({[RECEIPTS]:receipts});
    let result;
    try{
      const response=await request(id,{type:'PHONE_IMPORT_ADD_BATCH',batch:{...batch,phones}});
      if(!response.phoneImport?.verified)fail('Chưa xác minh đủ số trên server');
      result={ok:true,phoneImport:{...response.phoneImport,existing:batch.phones.length-phones.length}};
    }catch(error){result={ok:false,error:String(error.message||error)};}
    receipts[key]={at:now,status:result.ok?'DONE':'UNCERTAIN',result};
    await chrome.storage.local.set({[RECEIPTS]:receipts});
    return result;
  }
  root.PhoneImportWorker={handle(message){
    const work=queue.then(()=>process(message)).catch(error=>({ok:false,error:String(error.message||error)}));
    queue=work.then(()=>{});return work;
  }};
})(globalThis);
