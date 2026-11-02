/* Reuse the desktop dashboard through a remote transport; no admin credential. */
(/** Tác dụng: Giữ hộp thoại mở khi đang có thao tác ghi; nếu rảnh thì xóa lựa chọn tạm. */ ()=>{
 const project='https://ygxifobrqndflyeupxhj.supabase.co';
 const config=globalThis.MobileConfig;
 const historyCache=new Map();
 let commandPending=false,noticeTimer;
 const commandJobs=[];let queueRunning=false,jobSequence=0;
 const notice=document.createElement('div');
 notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
 notice.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:200;max-width:90vw;padding:12px 18px;border-radius:12px;background:#243850;color:#fff;box-shadow:0 4px 20px #0006;font-size:14px;pointer-events:none';
 notice.hidden=true;document.body.appendChild(notice);
 /** Tác dụng: Hiện thông báo trạng thái lệnh mobile và tự ẩn khi không còn thao tác chờ. */
 function commandNotice(text){clearTimeout(noticeTimer);notice.textContent=text;notice.hidden=false;if(!commandPending)noticeTimer=setTimeout(/** Tác dụng: Chạy bước tiếp theo sau thời gian chờ trong commandNotice. */ ()=>{notice.hidden=true;},5000);}

 let session=localStorage.getItem('monitor-session')||'',cached,pending,lastRead=0;
 const pause=/** Tác dụng: Tạo Promise chờ một khoảng thời gian trước khi thử đọc kết quả tiếp. */ ms=>new Promise(/** Tác dụng: Nối callback của API bất đồng bộ vào Promise và trả kết quả hoặc lỗi trong pause. */ r=>setTimeout(r,ms));
 const login=document.getElementById('mobile-login');
 const badge=document.getElementById('mobile-connection');
 /** Tác dụng: Gọi RPC mobile Supabase; xóa phiên và mở đăng nhập lại khi server từ chối xác thực. */
 async function rpc(action,payload={},access=session){
  const r=await fetch(project+'/rest/v1/rpc/call_monitor_mobile?apikey='+encodeURIComponent(config.anonKey),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:access,p_action:action,p_payload:payload}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok){if(r.status===401||r.status===403){session='';localStorage.removeItem('monitor-session');login.hidden=false;}throw Error(data.message||'Không kết nối được máy');}return data;
 }
 /** Tác dụng: Đọc snapshot mobile với cache ngắn, gộp yêu cầu trùng và hiển thị độ trễ/online. */
 async function state(){
  if(!session){login.hidden=false;return null;}
  if(cached&&Date.now()-lastRead<900)return cached;
  if(pending)return pending;
  pending=rpc('state').then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất trong state. */ data=>{cached=data;lastRead=Date.now();const lag=data.at?Math.max(0,Math.round((Date.now()-(data.snapshot?.capturedAt||data.at))/1000)):null;badge.textContent=data.online?`● Máy online · dữ liệu ${lag}s trước`:'● Máy offline · đang xem dữ liệu cũ';badge.className=data.online?'good':'bad';return data;}).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ trong state. */ error=>{badge.textContent='Mất mạng · dữ liệu có thể đã cũ';badge.className='bad';if(cached)cached={...cached,online:false};return cached||null;}).finally(/** Tác dụng: Dọn cờ hoặc trạng thái sau bước bất đồng bộ, kể cả khi lỗi trong state. */ ()=>{pending=null;});return pending;
 }
 const initial=(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ async()=>{
  const code=new URLSearchParams(location.hash.slice(1)).get('code');
  if(code){history.replaceState(null,'',location.pathname);try{const auth=await rpc('exchange',{},code);session=auth.session;localStorage.setItem('monitor-session',session);login.hidden=true;}catch(error){document.getElementById('mobile-login-error').textContent=error.message;}}
  if(session)login.hidden=true;
 })();
 /** Tác dụng: Chuyển message giao diện sang đọc snapshot hoặc gửi lệnh remote rồi chờ kết quả. */
 async function sendMessage(message){
  await initial;
  if(message.type==='SET_MOBILE_PASSWORD')return rpc('set_password',{password:message.password});
  if(message.type==='GET_STATE'){const data=cached||await state();state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong sendMessage. */ ()=>{});return {ok:true,state:data?.snapshot?.dashboard||null};}
  if(message.type==='FS_SWITCH_STATE'){const data=cached||await state();state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong sendMessage. */ ()=>{});const s=data?.snapshot;if(!s)throw Error('Chưa có dữ liệu máy');return {ok:true,feature:s.feature,candidates:s.candidates||[],nodes:s.dashboard?.opensips,threshold:s.feature.backupThreshold??10};}
  if(message.type==='HISTORY_READ'){
   for(const [key,value] of historyCache)if(Date.now()-value.at>=5000)historyCache.delete(key);
   const previous=historyCache.get(message.date||'');if(previous&&Date.now()-previous.at<5000)return previous.result;
   const start=message.date?Date.parse(message.date+'T00:00:00+07:00'):null,events=[];
   for(let offset=0;;offset+=500){const rows=await rpc('history',{start,end:start==null?null:start+86400000,offset});events.push(...rows);if(rows.length<500)break;}
   const result={ok:true,events,sync:{source:'SUPABASE'}};historyCache.clear();if(events.length<=1000)historyCache.set(message.date||'',{at:Date.now(),result});return result;
  }
  return enqueueCommand(message);
 }
 /** Send one command at a time; unrelated UI operations can join the local queue. */
 async function executeRemote(message,report){
  try{
   const live=cached&&Date.now()-lastRead<5000?cached:await state();
   if(!live?.online){report('Máy offline. Mở Chrome và extension trên máy.');return {ok:false,error:'Máy offline. Mở Chrome và extension trên máy.'};}
   if(message.type?.startsWith('PHONE_IMPORT_')&&live.snapshot?.capabilities?.phoneImport!==true)return {ok:false,error:'Cần cập nhật và reload extension trên máy nguồn để nạp Excel.'};
   if(message.type==='PHONE_IMPORT_PREVIEW'&&message.selectedSheet==='both'&&live.snapshot?.capabilities?.phoneImportBoth!==true)return {ok:false,error:'Cần cập nhật và reload extension 1.17.43 trên máy nguồn để chọn cả COLL và TLS.'};
   if(message.type==='PHONE_EXPORT'&&live.snapshot?.capabilities?.phoneExport!==true)return {ok:false,error:'Cần cập nhật và reload extension trên máy nguồn để xuất số.'};
   const queued=await rpc('command',{id:message.type?.startsWith('PHONE_IMPORT_')?message.requestId||crypto.randomUUID():crypto.randomUUID(),command:message});
   report('Đã gửi · đang chờ máy tính xử lý…');
   const deadline=Date.now()+120000;
   do{
    const result=await rpc('result',{id:queued.id});
    if(result.status==='DONE'){
     historyCache.clear();lastRead=0;
     const r=result.result||{ok:false,error:'Chưa có kết quả'};
     report(r.ok?'Đã thực hiện · đang cập nhật dữ liệu':r.error||'Thao tác không thành công');
     if(r.nodePicker&&cached?.snapshot?.dashboard){
      const dashboard=cached.snapshot.dashboard,picker=r.nodePicker;
      dashboard.nodeDisplay=picker.nodeDisplay;
      if(dashboard.opensips?.[picker.group])dashboard.opensips[picker.group].catalog=picker.catalog;
     }
     state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính trong sendMessage. */ ()=>{});
     return {...r,state:cached?.snapshot?.dashboard};
    }
    if(result.status==='RUNNING')report('Máy tính đang thực hiện thao tác…','RUNNING');
    if(result.status==='EXPIRED'||result.status==='CANCELLED'){
     report('Yêu cầu đã hết hạn; chưa thực hiện.');
     return {ok:false,error:'Yêu cầu đã hết hạn; chưa thực hiện.'};
    }
    await pause(500);
   }while(Date.now()<deadline);
   report('Chưa có kết quả. Kiểm tra trạng thái trước khi bấm lại.');
   return {ok:false,error:'Chưa nhận được kết quả. Kiểm tra trạng thái trước khi thực hiện lại.'};
  }catch(error){report(error.message);throw error;}
 }
 function commandLabel(message){
  const labels={SET_MONITORING:'Monitor',SET_AUTO:'AUTO',SET_AUTO_BLOCK_MODE:'Chế độ đổi số',MANUAL_FS_STATUS:'Trạng thái số',FS_SWITCH_TOGGLE_NODE:'Bật/tắt FS',FS_SWITCH_RELOAD:'Reload OpenSIPS',PHONE_EXPORT:'Xuất số',PHONE_IMPORT_PREVIEW:'Kiểm tra Excel',PHONE_IMPORT_EXECUTE:'Nạp số',CONFIRM_AUTO_BLOCK:'Xác nhận đổi số',FS_SWITCH_SETTINGS:'Cấu hình FS',FS_SWITCH_CONFIRM:'Thay FS',FS_SWITCH_PRESET:'Đặt trước FS',CLEAR_HISTORY:'Xóa lịch sử'};
  return `${labels[message.type]||'Thao tác'}${message.fs?' · '+message.fs:message.group?' · '+(message.group==='99.153'?'Collection':'Sale'):''}`;
 }
 function enqueueCommand(message){
  const key=JSON.stringify({...message,requestId:undefined}),existing=commandJobs.find(job=>!job.finished&&job.key===key);
  if(existing)return existing.promise;
  if(commandJobs.filter(job=>!job.finished).length>=10){const error='Đã có 10 yêu cầu chờ; đợi bớt thao tác trước khi gửi thêm.';commandNotice(error);return Promise.resolve({ok:false,error});}
  const job={sequence:++jobSequence,key,message,owner:session,createdAt:Date.now(),label:commandLabel(message),phase:'WAITING',detail:'Chờ thao tác trước hoàn tất',finished:false};
  job.promise=new Promise(resolve=>{job.resolve=resolve;});commandJobs.push(job);commandPending=true;if(queueRunning)commandNotice(`${job.label}: đã xếp hàng, chờ thao tác trước.`);pumpCommands();return job.promise;
 }
 async function pumpCommands(){
  if(queueRunning)return;queueRunning=true;
  try{
   for(const job of commandJobs.filter(job=>!job.finished)){
    job.phase='SENDING';job.detail='Đang gửi yêu cầu tới máy tính…';commandNotice(`${job.label}: ${job.detail}`);
    try{
     if(!session||job.owner!==session)job.result={ok:false,error:'Phiên đăng nhập đã thay đổi; yêu cầu chưa gửi đã được hủy.'};
     else if(Date.now()-job.createdAt>90000)job.result={ok:false,error:'Yêu cầu chờ quá 90 giây, chưa được gửi; kiểm tra trạng thái rồi thực hiện lại.'};
     else job.result=await executeRemote(job.message,(text,phase)=>{job.detail=text;if(phase)job.phase=phase;commandNotice(text);});
    }catch(error){job.result={ok:false,error:String(error.message||error)};}
    job.finished=true;job.detail=job.result?.ok?'Đã thực hiện':job.result?.error||'Chưa có kết quả';job.resolve(job.result);
   }
  }finally{
   queueRunning=false;commandPending=commandJobs.some(job=>!job.finished);
   if(commandPending)pumpCommands();else commandNotice(commandJobs.at(-1)?.detail||'Đã xử lý xong');
   while(commandJobs.length>20&&commandJobs[0].finished)commandJobs.shift();
  }
 }

 globalThis.chrome={runtime:{sendMessage}};
 /** Tác dụng: Đọc snapshot định kỳ khi app đang hiển thị và đã có phiên đăng nhập. */
 async function poll(){await initial;if(document.visibilityState!=='hidden'&&session){await state();}setTimeout(poll,1000);}
 document.addEventListener('visibilitychange',/** Tác dụng: Lấy snapshot mới khi người dùng quay lại app mobile. */ ()=>{if(document.visibilityState!=='hidden'){lastRead=0;state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});}});
 window.addEventListener('online',/** Tác dụng: Lấy lại snapshot khi trình duyệt báo kết nối mạng đã phục hồi. */ ()=>{lastRead=0;state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});});
 poll();
 const passwordForm=document.getElementById('mobile-password-login-form');
 if(passwordForm)passwordForm.onsubmit=/** Tác dụng: Đăng nhập mobile bằng mật khẩu và lưu phiên được RPC cấp. */ async event=>{
  event.preventDefault();const input=document.getElementById('mobile-login-password'),error=document.getElementById('mobile-password-login-error'),button=document.getElementById('mobile-password-login-submit');
  button.disabled=true;error.textContent='Đang đăng nhập…';
  try{
   const auth=await rpc('password_login',{password:input.value},'');
   if(!auth.ok||!auth.session)throw Error(auth.error||'Không đăng nhập được.');
   session=auth.session;localStorage.setItem('monitor-session',session);input.value='';cached=null;lastRead=0;login.hidden=true;error.textContent='';state().catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});
  }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
 };
 document.getElementById('mobile-login-form').onsubmit=/** Tác dụng: Đổi liên kết đăng nhập một lần lấy phiên mobile và lưu phiên ở máy hiện tại. */ async event=>{event.preventDefault();const input=document.getElementById('mobile-login-link');let code=input.value.trim();try{if(code.startsWith('https://'))code=new URLSearchParams(new URL(code).hash.slice(1)).get('code')||'';if(!/^[a-f0-9]{64}$/.test(code))throw Error('Dán đúng liên kết đăng nhập do bot gửi');const auth=await rpc('exchange',{},code);session=auth.session;localStorage.setItem('monitor-session',session);input.value='';cached=null;login.hidden=true;}catch(error){document.getElementById('mobile-login-error').textContent=error.message;}};
 document.getElementById('mobile-logout').onclick=/** Tác dụng: Xóa phiên đăng nhập mobile ở máy hiện tại và mở màn hình đăng nhập. */ ()=>{session='';localStorage.removeItem('monitor-session');cached=null;login.hidden=false;};
 const updateButton=document.getElementById('mobile-update');
 if(updateButton)updateButton.onclick=/** Tác dụng: Xóa cache app cũ, cập nhật service worker và tải lại URL có mã làm mới. */ async()=>{
  if(commandPending){commandNotice('Chờ thao tác hoàn tất rồi cập nhật app.');return;}
  updateButton.disabled=true;updateButton.textContent='Đang cập nhật…';
  try{
   if('caches'in globalThis){const keys=await caches.keys();await Promise.all(keys.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra. */ key=>key.startsWith('monitor-mobile-')).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng. */ key=>caches.delete(key)));}
   if('serviceWorker'in navigator){const registration=await navigator.serviceWorker.getRegistration();if(registration)await registration.update();}
   const url=new URL(location.href);url.searchParams.set('refresh',Date.now());location.replace(url.href);
  }catch(error){updateButton.disabled=false;updateButton.textContent='Cập nhật app';commandNotice(error.message);}
 };
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ reg=>reg.update()).catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});
})();
