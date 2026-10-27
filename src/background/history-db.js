/* Durable audit history, separate from live monitoring state. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ ()=>{
 const types=new Set(['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED']);
 let opening;const saved=new Map();
 const open=/** Tác dụng: Mở hoặc tái sử dụng kết nối IndexedDB và tạo kho sự kiện khi nâng phiên bản. */ ()=>opening||(opening=new Promise(/** Tác dụng: Nối callback của API bất đồng bộ vào Promise và trả kết quả hoặc lỗi trong open. */ (resolve,reject)=>{
  const r=indexedDB.open('auto-call-history',1);
  r.onupgradeneeded=/** Tác dụng: Tạo object store sự kiện cùng index thời gian khi khởi tạo database. */ ()=>{const store=r.result.createObjectStore('events',{keyPath:'id'});store.createIndex('at','at');};
  r.onsuccess=/** Tác dụng: Nhận kết quả IndexedDB thành công và tiếp tục luồng đang chờ. */ ()=>resolve(r.result);r.onerror=/** Tác dụng: Trả lỗi IndexedDB và giải phóng trạng thái khởi tạo nếu cần để lần sau thử lại. */ ()=>{opening=null;reject(r.error);};
 }));
 /** Tác dụng: Mở transaction IndexedDB và chỉ trả kết quả khi transaction hoàn tất hoặc báo lỗi. */
 async function transaction(mode,run){const db=await open();return new Promise(/** Tác dụng: Nối callback của API bất đồng bộ vào Promise và trả kết quả hoặc lỗi trong transaction. */ (resolve,reject)=>{
  const tx=db.transaction('events',mode);let result;
  tx.oncomplete=/** Tác dụng: Trả kết quả khi transaction IndexedDB đã hoàn tất thành công. */ ()=>resolve(result);tx.onerror=/** Tác dụng: Trả lỗi IndexedDB và giải phóng trạng thái khởi tạo nếu cần để lần sau thử lại. */ ()=>reject(tx.error);tx.onabort=/** Tác dụng: Trả lỗi IndexedDB và giải phóng trạng thái khởi tạo nếu cần để lần sau thử lại. */ ()=>reject(tx.error||Error('History transaction aborted'));
  run(tx.objectStore('events'),/** Tác dụng: Giữ kết quả của thao tác IndexedDB để trả sau khi transaction hoàn tất. */ value=>{result=value;});
 });}
 /** Tác dụng: Lưu sự kiện nghiệp vụ theo khóa duy nhất vào IndexedDB và giữ cache chống ghi lặp nhỏ. */
 async function append(events){
  const pending=(events||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong append. */ e=>types.has(e.type)&&e.incidentId&&e.fs).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong append. */ e=>({...e,id:`${e.group}|${e.fs}|${e.incidentId}|${e.type}`})).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong append. */ e=>saved.get(e.id)!==JSON.stringify(e));
  if(!pending.length)return;
  await transaction('readwrite',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở trong append. */ store=>{for(const e of pending)store.put(e);});
  for(const e of pending)saved.set(e.id,JSON.stringify(e));
  if(saved.size>500)saved.clear();
 }
 /** Tác dụng: Đọc lịch sử IndexedDB theo ngày Việt Nam, mới nhất trước; không tự cắt mất bản ghi. */
 async function read(date){
  const start=date?Date.parse(date+'T00:00:00+07:00'):null;
  if(date&&!Number.isFinite(start))throw Error('Ngày không hợp lệ');
  return transaction('readonly',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở. */ (store,done)=>{
   const rows=[];const range=date?IDBKeyRange.bound(start,start+86400000,false,true):null;
   const r=store.index('at').openCursor(range,'prev');r.onsuccess=/** Tác dụng: Đọc từng bản ghi từ cursor vào kết quả và tiếp tục tới khi hết hoặc đủ batch. */ ()=>{const c=r.result;if(!c){done(rows);return;}rows.push(c.value);c.continue();};
  });
 }
 /** Tác dụng: Xóa log IndexedDB trong khoảng thời gian được người dùng chọn. */
 async function remove(start,end){return transaction('readwrite',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở. */ (store,done)=>{
  let count=0;const r=store.index('at').openCursor(IDBKeyRange.bound(start,end,false,true));
  r.onsuccess=/** Tác dụng: Duyệt cursor và xóa các bản ghi thỏa điều kiện dọn dữ liệu. */ ()=>{const c=r.result;if(!c){done(count);return;}c.delete();count++;c.continue();};
 });}
 /** Tác dụng: Lấy một batch sự kiện local chưa đồng bộ, không xóa log khỏi hàng đợi. */
 async function pending(limit=100){return transaction('readonly',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở trong pending. */ (store,done)=>{
  const rows=[],r=store.openCursor();r.onsuccess=/** Tác dụng: Đọc từng bản ghi từ cursor vào kết quả và tiếp tục tới khi hết hoặc đủ batch. */ ()=>{const c=r.result;if(!c||rows.length>=limit){done(rows);return;}if(!c.value.synced)rows.push(c.value);c.continue();};
 });}
 /** Tác dụng: Đánh dấu log đã đồng bộ nếu nội dung hiện tại vẫn khớp batch vừa gửi. */
 async function markSynced(events){return transaction('readwrite',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở trong markSynced. */ store=>{for(const event of events){
  const r=store.get(event.id);r.onsuccess=/** Tác dụng: Chỉ đánh dấu đồng bộ nếu log vẫn khớp nội dung vừa gửi. */ ()=>{if(r.result&&JSON.stringify({...r.result,synced:undefined})===JSON.stringify({...event,synced:undefined}))store.put({...r.result,synced:true});};
 }});}
 /** Tác dụng: Chỉ xóa lịch sử local đã đánh dấu đồng bộ và cũ hơn mốc được truyền vào. */
 async function pruneSynced(before){return transaction('readwrite',/** Tác dụng: Thực hiện thao tác IndexedDB trong transaction đã được mở trong pruneSynced. */ (store,done)=>{
  let count=0;const r=store.index('at').openCursor(IDBKeyRange.upperBound(before,true));
  r.onsuccess=/** Tác dụng: Duyệt cursor và xóa các bản ghi thỏa điều kiện dọn dữ liệu. */ ()=>{const c=r.result;if(!c){done(count);return;}if(c.value.synced===true){c.delete();saved.delete(c.value.id);count++;}c.continue();};
 });}
 globalThis.HistoryDB={append,read,remove,pending,markSynced,pruneSynced};
})();
