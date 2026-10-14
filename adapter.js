/* Reuse the desktop dashboard through a remote transport; no admin credential. */
(()=>{
 const project='https://ygxifobrqndflyeupxhj.supabase.co';
 const config=globalThis.MobileConfig;
 const historyCache=new Map();
 let session=localStorage.getItem('monitor-session')||'',cached,pending,lastRead=0;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const login=document.getElementById('mobile-login');
 const badge=document.getElementById('mobile-connection');
 async function rpc(action,payload={},access=session){
  const r=await fetch(project+'/rest/v1/rpc/call_monitor_mobile?apikey='+encodeURIComponent(config.anonKey),{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:access,p_action:action,p_payload:payload}),signal:AbortSignal.timeout(10000)});
  const data=await r.json();if(!r.ok){if(r.status===401||r.status===403){session='';localStorage.removeItem('monitor-session');login.hidden=false;}throw Error(data.message||'Không kết nối được máy');}return data;
 }
 async function state(){
  if(!session){login.hidden=false;return null;}
  if(cached&&Date.now()-lastRead<900)return cached;
  if(pending)return pending;
  pending=rpc('state').then(data=>{cached=data;lastRead=Date.now();const lag=data.at?Math.max(0,Math.round((Date.now()-(data.snapshot?.capturedAt||data.at))/1000)):null;badge.textContent=data.online?`● Máy online · dữ liệu ${lag}s trước`:'● Máy offline · đang xem dữ liệu cũ';badge.className=data.online?'good':'bad';return data;}).catch(error=>{badge.textContent='Mất mạng · dữ liệu có thể đã cũ';badge.className='bad';if(cached)cached={...cached,online:false};return cached||null;}).finally(()=>{pending=null;});return pending;
 }
 const initial=(async()=>{
  const code=new URLSearchParams(location.hash.slice(1)).get('code');
  if(code){history.replaceState(null,'',location.pathname);try{const auth=await rpc('exchange',{},code);session=auth.session;localStorage.setItem('monitor-session',session);login.hidden=true;}catch(error){document.getElementById('mobile-login-error').textContent=error.message;}}
  if(session)login.hidden=true;
 })();
 async function sendMessage(message){
  await initial;
  if(message.type==='GET_STATE'){const data=cached||await state();state().catch(()=>{});return {ok:true,state:data?.snapshot?.dashboard||null};}
  if(message.type==='FS_SWITCH_STATE'){const data=cached||await state();state().catch(()=>{});const s=data?.snapshot;if(!s)throw Error('Chưa có dữ liệu máy');return {ok:true,feature:s.feature,candidates:s.candidates||[],nodes:s.dashboard?.opensips,threshold:s.feature.backupThreshold??10};}
  if(message.type==='HISTORY_READ'){
   const previous=historyCache.get(message.date||'');if(previous&&Date.now()-previous.at<5000)return previous.result;
   const start=message.date?Date.parse(message.date+'T00:00:00+07:00'):null,events=[];
   for(let offset=0;;offset+=500){const rows=await rpc('history',{start,end:start==null?null:start+86400000,offset});events.push(...rows);if(rows.length<500)break;}
   const result={ok:true,events,sync:{source:'SUPABASE'}};historyCache.set(message.date||'',{at:Date.now(),result});return result;
  }
  const live=await state();if(!live?.online)return {ok:false,error:'Máy offline. Mở Chrome và extension trên máy.'};
  const queued=await rpc('command',{id:crypto.randomUUID(),command:message});
  badge.textContent='Đang chờ máy xử lý…';
  const deadline=Date.now()+120000;
  do{
   await pause(1000);const result=await rpc('result',{id:queued.id});
   if(result.status==='DONE'){cached=null;historyCache.clear();const r=result.result||{ok:false,error:'Chưa có kết quả'};return {...r,state:(await state())?.snapshot?.dashboard};}
   if(result.status==='EXPIRED'||result.status==='CANCELLED')return {ok:false,error:'Yêu cầu đã hết hạn; chưa thực hiện.'};
  }while(Date.now()<deadline);
  return {ok:false,error:'Chưa nhận được kết quả. Kiểm tra trạng thái trước khi thực hiện lại.'};
 }
 globalThis.chrome={runtime:{sendMessage}};
 async function poll(){await initial;if(document.visibilityState!=='hidden'&&session)await state();setTimeout(poll,1000);}
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden'){lastRead=0;state().catch(()=>{});}});
 window.addEventListener('online',()=>{lastRead=0;state().catch(()=>{});});
 poll();
 document.getElementById('mobile-login-form').onsubmit=async event=>{event.preventDefault();const input=document.getElementById('mobile-login-link');let code=input.value.trim();try{if(code.startsWith('https://'))code=new URLSearchParams(new URL(code).hash.slice(1)).get('code')||'';if(!/^[a-f0-9]{64}$/.test(code))throw Error('Dán đúng liên kết đăng nhập do bot gửi');const auth=await rpc('exchange',{},code);session=auth.session;localStorage.setItem('monitor-session',session);input.value='';cached=null;login.hidden=true;}catch(error){document.getElementById('mobile-login-error').textContent=error.message;}};
 document.getElementById('mobile-logout').onclick=()=>{session='';localStorage.removeItem('monitor-session');cached=null;login.hidden=false;};
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');
})();
