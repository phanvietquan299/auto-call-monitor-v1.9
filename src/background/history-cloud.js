/* Supabase is authoritative; IndexedDB retains migration data and offline outbox. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ ()=>{
 const local=globalThis.HistoryDB,config=globalThis.SupabaseHistoryConfig;
 if(!local||!config?.url||!config?.anonKey||!config?.historyToken)throw Error('Missing Supabase history config');
 let syncing=null,retryAt=0,lastError='',lastSync=0,lastPrune=0,mutation=Promise.resolve();
 const cache=new Map();
 /** Tác dụng: Gọi RPC lịch sử Supabase với token cấu hình và timeout; không ghi credential vào log. */
 async function rpc(action,args={}){
  const response=await fetch(config.url+'/rest/v1/rpc/call_monitor_history',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:action,...args}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Supabase history HTTP '+response.status);
  return response.json();
 }
 /** Tác dụng: Nối công việc vào hàng đợi để đồng bộ/xóa lịch sử không chạy chồng nhau. */
 function exclusive(fn){const next=mutation.then(fn);mutation=next.catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong exclusive. */ ()=>{});return next;}
 /** Tác dụng: Đẩy từng batch log chưa đồng bộ lên Supabase; giữ log khi lỗi và dọn bản local đã đồng bộ quá hạn. */
 function flush(){
  if(syncing||Date.now()<retryAt)return syncing||Promise.resolve();
  syncing=exclusive(/** Tác dụng: Thực thi công việc đồng bộ theo thứ tự của hàng đợi lịch sử. */ async()=>{
   for(let batch=await local.pending();batch.length;batch=await local.pending()){
    await rpc('append',{p_events:batch});await local.markSynced(batch);cache.clear();
   }
   const now=Date.now();
   if(local.pruneSynced&&now-lastPrune>=3600000){await local.pruneSynced(now-30*86400000);lastPrune=now;}
   lastError='';lastSync=now;
  }).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ trong flush. */ error=>{lastError=String(error.message||error);retryAt=Date.now()+15000;}).finally(/** Tác dụng: Dọn cờ hoặc trạng thái sau bước bất đồng bộ, kể cả khi lỗi trong flush. */ ()=>{syncing=null;});
  return syncing;
 }
 /** Tác dụng: Ghi các sự kiện cần lưu, chống trùng theo định danh và kích hoạt đồng bộ khi có cấu hình cloud. */
 async function append(events){await local.append(events);flush();}
 /** Tác dụng: Đọc lịch sử cloud theo trang, gộp log offline chưa đồng bộ và cache ngắn hạn. */
 async function read(date){
  flush();
  for(const [key,value] of cache)if(Date.now()-value.at>=5000)cache.delete(key);
  const cached=cache.get(date);
  if(cached&&Date.now()-cached.at<5000)return cached.events;
  try{
   const start=date?Date.parse(date+'T00:00:00+07:00'):null;
   if(date&&!Number.isFinite(start))throw Error('Invalid date');
   const events=[];
   for(let offset=0;;offset+=500){const page=await rpc('read',{p_start:start,p_end:start==null?null:start+86400000,p_offset:offset});if(!Array.isArray(page))throw Error('Invalid history response');events.push(...page);if(page.length<500)break;}
   const pending=(await local.read(date)).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra. */ e=>!e.synced);
   const merged=[...new Map([...events,...pending].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng. */ e=>[e.id,e])).values()].sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên. */ (a,b)=>b.at-a.at);
   cache.clear();if(merged.length<=1000)cache.set(date,{at:Date.now(),events:merged});lastError='';return merged;
  }catch(error){lastError=String(error.message||error);return local.read(date);}
 }
 /** Tác dụng: Đồng bộ outbox trước rồi xóa log cloud/local theo khoảng người dùng yêu cầu. */
 async function remove(start,end){
  return exclusive(/** Tác dụng: Thực thi công việc đồng bộ theo thứ tự của hàng đợi lịch sử. */ async()=>{
   // Flush outstanding logs before deleting, so an offline log cannot reappear.
   for(let batch=await local.pending();batch.length;batch=await local.pending()){
    await rpc('append',{p_events:batch});await local.markSynced(batch);
   }
   const result=await rpc('delete',{p_start:start,p_end:end});
   const count=await local.remove(start,end);cache.clear();return Math.max(count,result.deleted||0);
  });
 }
 globalThis.LocalHistoryDB=local;
 globalThis.HistoryDB={append,read,remove};
 globalThis.CloudHistory={flush,status:/** Tác dụng: Trả nguồn lịch sử, thời điểm đồng bộ và lỗi gần nhất để giao diện hiển thị. */ ()=>({source:'SUPABASE',lastSync,error:lastError})};
 chrome.alarms.onAlarm.addListener(/** Tác dụng: Xử lý alarm đúng tên để đánh thức đồng bộ, refresh hoặc theo dõi đang chờ. */ alarm=>{if(alarm.name==='history-cloud-sync')flush();});
 chrome.alarms.create('history-cloud-sync',{periodInMinutes:0.5});
 flush();
})();
