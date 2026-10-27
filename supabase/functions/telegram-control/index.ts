const env=(name:string)=>Deno.env.get(name)||'';
const token=env('TELEGRAM_BOT_TOKEN'),chat=env('TELEGRAM_CHAT_ID'),secret=env('TELEGRAM_WEBHOOK_SECRET'),access=env('CALL_MONITOR_HISTORY_TOKEN');
async function rpc(name:string,args:object){
 const r=await fetch(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:'Bearer '+env('SUPABASE_ANON_KEY'),'Content-Type':'application/json'},body:JSON.stringify({p_token:access,...args})});
 if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.message||'Database không phản hồi');}return r.json();
}
const remote=(action:string,payload:object={})=>rpc('call_monitor_remote',{p_action:action,p_payload:payload});
async function tg(method:string,payload:object){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!data.ok){if(method==='editMessageText'&&data.description?.includes('message is not modified'))return {};throw Error('Không gửi được Telegram');}return data.result;}
const escapeHtml=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function markup(text:string){const lines=escapeHtml(text.slice(0,3900)).split('\n');lines[0]=`<b>${lines[0]}</b>`;return lines.join('\n').replace(/^(COLLECTION|SALE)$/gm,'<b>$1</b>');}
const send=(text:string,rows:any[]=[],messageId?:number)=>tg(messageId?'editMessageText':'sendMessage',{chat_id:chat,...(messageId?{message_id:messageId}:{}),text:markup(text),parse_mode:'HTML',reply_markup:{inline_keyboard:rows}});
const btn=(text:string,data:string)=>({text,callback_data:data});
const cmdBtn=(text:string,command:string)=>btn(text,'cmd:'+command);
const todayVN=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const eventLabel=(type:string)=>({AUTO_BLOCKED:'Đã đổi số',MANUAL_SWITCH:'Đã xử lý tay',BLOCKED_OBSERVED:'Đã xác minh BLOCK',FS_TRANSFERRED:'Đã chuyển FS',FS_ENABLED:'Đã bật FS',FS_DISABLED:'Đã tắt FS'}[type]||type);
const actionLabel=(type:string)=>({SET_MONITORING:'Bật/tắt Monitor',SET_AUTO:'Bật/tắt AUTO BLOCK',SET_AUTO_BLOCK_MODE:'Chế độ BLOCK',FS_SWITCH_SETTINGS:'Chế độ Thay FS',FS_SWITCH_THRESHOLD:'Ngưỡng BACKUP',FS_SWITCH_PRESET:'Đặt FS',FS_SWITCH_RELOAD:'Reload on Server',FS_SWITCH_TOGGLE_NODE:'Bật/tắt FS',FS_SWITCH_CONFIRM:'Chuyển FS',FS_SWITCH_RELEASE:'Mở khóa Thay FS',CONFIRM_AUTO_BLOCK:'Đổi số',CANCEL_AUTO_BLOCK:'Hủy BLOCK',RECHECK_AUTO_BLOCK:'Kiểm tra lại',ACK_MANUAL_AFTER_FAILURE:'Xác nhận xử lý tay',REPORT_MANUAL_SWAP:'Ghi nhận đổi số tay',CLEAR_HISTORY:'Xóa log',DISMISS_CDR_WARNING:'Đóng cảnh báo CDR'}[type]||'Thao tác');
const modeLabel=(mode:string)=>mode==='AUTOMATIC'?'Tự động':'Xác nhận tay';
const help=`AUTO CALL MONITOR\n/app — mở app điện thoại\n/status — trạng thái, VT/CDR, BACKUP\n/pending — yêu cầu BLOCK/Thay FS\n/cdr — dãy CDR mới\n/warnings — cảnh báo đặc biệt\n/dismiss 7 — đóng cảnh báo CDR\n/history YYYY-MM-DD|all [trang]\n/stats YYYY-MM-DD|all\n/monitor on|off\n/block on|off|manual|auto\n/switch on|off|manual|auto\n/threshold 6\n/fs 7 on|off\n/preset sale 6 7 (0 = bỏ qua)\n/preset col clear\n/reload col|sale\n/recheck 7\n/confirm 7 — xác nhận BLOCK\n/cancel 7 — hủy BLOCK\n/rotate 7 — xác nhận Thay FS nguồn 7\n/ack 7 — đã xử lý tay sau lỗi\n/report 7 — đã đổi số tay\n/release — mở khóa Thay FS sau kiểm tra tay\n/clear YYYY-MM-DD HH:mm HH:mm\nMọi thay đổi cần bấm Xác nhận; yêu cầu hết hạn sau 90s.`;
const menu=[[btn('📱 App điện thoại','cmd:/app')],[{text:'Trạng thái',callback_data:'view:status'},{text:'Chờ xác nhận',callback_data:'view:pending'}],[{text:'Log hôm nay',callback_data:'view:history'},{text:'Thống kê',callback_data:'view:stats'}],[{text:'Điều khiển',callback_data:'view:controls'},{text:'Bật / tắt FS',callback_data:'view:nodes'}],[{text:'Hướng dẫn',callback_data:'view:help'}]];
const group=(s:string)=>s==='col'?'99.153':s==='sale'?'99.155':(()=>{throw Error('Nhóm phải col hoặc sale');})();
const fsName=(s:string)=>{const n=Number(s);if(!Number.isInteger(n)||n<1||n>7)throw Error('FS từ 1 đến 7');return 'FS'+String(n).padStart(2,'0');};
function fsState(snapshot:any,name:string){const f=snapshot.fs.find((x:any)=>x.fs===name);if(!f)throw Error('FS chưa có dữ liệu');return f;}
function dateRange(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Ngày YYYY-MM-DD');const start=Date.parse(date+'T00:00:00+07:00');if(!Number.isFinite(start)||new Date(start+7*3600000).toISOString().slice(0,10)!==date)throw Error('Ngày không hợp lệ');return start;}
async function history(date:string,page=1,stats=false,messageId?:number){
 const display=(text:string,rows:any[]=[])=>send(text,rows,messageId);
 const start=date==='all'?null:dateRange(date),events:any[]=[];for(let offset=0;;offset+=500){const rows=await rpc('call_monitor_history',{p_action:'read',p_start:start,p_end:start==null?null:start+86400000,p_offset:offset});events.push(...rows);if(rows.length<500)break;}
 const seen=new Set();const logs=events.filter(e=>{const k=`${e.group}|${e.fs}|${e.incidentId}`;if(seen.has(k))return false;seen.add(k);return true;});
 if(stats){const counts:Record<string,number>={};for(const e of logs)counts[e.fs]=(counts[e.fs]||0)+1;await display(`${date} · ${logs.length} lượt thành công\n`+Object.entries(counts).map(([f,n])=>`${f}: ${n}`).join('\n'),menu);return;}
 const pages=Math.max(1,Math.ceil(logs.length/8));page=Math.max(1,Math.min(pages,page));
 await display(`${date} · trang ${page}/${pages}\n`+logs.slice((page-1)*8,page*8).map(e=>`${new Date(e.at).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} ${e.fs}${e.targetFs?' → '+e.targetFs:''} · ${eventLabel(e.type)}${e.phone?' · '+e.phone:''}`).join('\n'),[[{text:'Trang đầu',callback_data:`hist:${date}:1`},{text:'‹',callback_data:`hist:${date}:${Math.max(1,page-1)}`},{text:'›',callback_data:`hist:${date}:${Math.min(pages,page+1)}`}],[cmdBtn('🗑 Xóa log hôm nay',`/clear ${todayVN()} 00:00 23:59`),btn('📊 Thống kê','view:stats')],[btn('Hôm nay','view:history'),btn('Tất cả','hist:all:1'),btn('🏠 Bảng điều khiển','view:status')]]);
}
async function view(name:string,messageId?:number){
 const display=(text:string,rows:any[]=[])=>send(text,rows,messageId);
 if(name==='help'){await display(help,menu);return;}
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 if(name==='history'||name==='stats'){await history(today,1,name==='stats',messageId);return;}
 const state=await remote('snapshot'),s=state.snapshot;
 if(!s){await display('Chưa có trạng thái. Mở Chrome, reload extension trên máy.',menu);return;}
 if(name==='controls'){
  const button=(text:string,command:string)=>({text,callback_data:'cmd:'+command});
  await display(`⚙️ CÀI ĐẶT\nMONITOR ${s.monitoring?'ON':'OFF'} · BLOCK ${s.auto?'ON':'OFF'}\nThay FS ${s.feature.enabled?'ON':'OFF'}\nBACKUP ≤ ${s.feature.backupThreshold??10}`,[
   [button('Monitor ON','/monitor on'),button('Monitor OFF','/monitor off')],
   [button('BLOCK ON','/block on'),button('BLOCK OFF','/block off')],
   [button('BLOCK tay','/block manual'),button('BLOCK tự động','/block auto')],
   [button('Thay FS ON','/switch on'),button('Thay FS OFF','/switch off')],
   [button('Thay FS tay','/switch manual'),button('Thay FS tự động','/switch auto')],
   [button('Reload Col','/reload col'),button('Reload Sale','/reload sale')],
   [btn('Ngưỡng BACKUP','view:threshold'),btn('Đặt FS','view:preset')],
   [btn('🏠 Bảng điều khiển','view:status')]
  ]);return;
 }
 if(name==='threshold'){
  const value=s.feature.backupThreshold??10;
  await display(`🎯 NGƯỠNG BACKUP\nHiện tại: ≤ ${value}\nChọn ngưỡng mới hoặc gửi /threshold số`,[
   [3,5,6,10,15,20].map(n=>cmdBtn(`${n===value?'✓ ':''}${n}`,`/threshold ${n}`)),
   [cmdBtn('−1',`/threshold ${Math.max(0,value-1)}`),cmdBtn('+1',`/threshold ${value+1}`)],
   [btn('← Cài đặt','view:controls')]
  ]);return;
 }
 if(name==='preset'){
  await display('🔁 ĐẶT LẦN LOCKED TIẾP THEO\nChọn nhóm để đặt FS cần tắt/bật.',[
   [btn('Collection','preset:col:source'),btn('Sale','preset:sale:source')],
   [cmdBtn('Hủy đặt Col','/preset col clear'),cmdBtn('Hủy đặt Sale','/preset sale clear')],
   [btn('🏠 Bảng điều khiển','view:status')]
  ]);return;
 }
 if(name==='nodes'){
  const buttons=(g:string)=>s.fs.filter((f:any)=>f.group===g).sort((a:any,b:any)=>a.fs.localeCompare(b.fs)).map((f:any)=>cmdBtn(`${f.groupId===0?'🔴':'🟢'} ${Number(f.fs.slice(2))}`,`/fs ${Number(f.fs.slice(2))} ${f.groupId===0?'on':'off'}`));
  await display(`🔌 BẬT / TẮT FS\n${state.online?'Máy đang kết nối':'Máy offline · trạng thái cũ'}\n\nCOLLECTION\nFS01–04 · 🟢 chạy / 🔴 tắt\n\nSALE\nFS05–07 · bấm số để bật/tắt`,[
   buttons('99.153'),[cmdBtn('↻ Reload Collection','/reload col')],buttons('99.155'),[cmdBtn('↻ Reload Sale','/reload sale')],[btn('🏠 Bảng điều khiển','view:status')]
  ]);return;
 }
 if(name==='cdr'){await display(s.fs.map((f:any)=>`${f.fs} · VT ${f.vt??'?'} · ${f.cdrCount??0}/5\n${(f.records||[]).join(' · ')||'Chưa có CDR'}`).join('\n'),menu);return;}
 if(name==='warnings'){await display((s.warnings||[]).map((w:any)=>`${w.fs} ${w.pattern} · ${w.count} cuộc`).join('\n')||'Không có cảnh báo đặc biệt',menu);return;}
 if(name==='pending'){
  const pending=s.pending||[],plans=s.candidates||[];
  const lines=[...pending.map((a:any)=>`⚠️ ${a.fs} · đổi số ${a.phone}`),...plans.map((p:any)=>`🔁 ${p.source.fs} → ${p.target.fs}`)];
  const rows=[...pending.map((a:any)=>[cmdBtn(`✓ BLOCK ${a.fs}`,`/confirm ${Number(a.fs.slice(2))}`),cmdBtn('Bỏ qua',`/cancel ${Number(a.fs.slice(2))}`)]),...plans.map((p:any)=>[cmdBtn(`✓ ${p.source.fs} → ${p.target.fs}`,`/rotate ${Number(p.source.fs.slice(2))}`)]),[btn('↻ Cập nhật','view:pending'),btn('🏠 Trang chính','view:status')]];
  await display('⏳ CHỜ XÁC NHẬN\n'+(state.online?'':'Máy offline\n')+(lines.join('\n')||'Không có yêu cầu chờ.'),rows);return;
 }
 const fsLines=(g:string)=>s.fs.filter((f:any)=>f.group===g).sort((a:any,b:any)=>a.fs.localeCompare(b.fs)).map((f:any)=>`${f.groupId===0?'⚪':f.state==='SUSPECTED'?'🔴':'🟢'} ${f.fs}  ·  VT ${f.vt??'—'}  ·  CDR ${f.cdrCount??0}/5  ·  BK ${f.backups??'—'}`).join('\n')||'Chưa có dữ liệu';
 const pendingCount=(s.pending||[]).length+(s.candidates||[]).length;
 await display(`📞 AUTO CALL MONITOR\n${state.online?'🟢 Đang kết nối':'🔴 Máy offline'} · ${new Date(state.at||Date.now()).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}\n\nCOLLECTION\n${fsLines('99.153')}\n\nSALE\n${fsLines('99.155')}\n\nBACKUP ≤ ${s.feature.backupThreshold??10} · ${pendingCount} yêu cầu chờ`,[
  [btn('📱 Mở app điện thoại','cmd:/app')],
  [cmdBtn(`${s.monitoring?'🟢':'🔴'} MONITOR`,s.monitoring?'/monitor off':'/monitor on'),btn('📋 Log','view:history')],
  [cmdBtn(`${s.auto?'🟢':'🔴'} AUTO BLOCK`,s.auto?'/block off':'/block on'),cmdBtn(modeLabel(s.blockMode),s.blockMode==='AUTOMATIC'?'/block manual':'/block auto')],
  [cmdBtn(`${s.feature.enabled?'🟢':'🔴'} THAY FS`,s.feature.enabled?'/switch off':'/switch on'),cmdBtn(modeLabel(s.feature.mode),s.feature.mode==='AUTOMATIC'?'/switch manual':'/switch auto')],
  [btn('🎯 Ngưỡng BACKUP','view:threshold'),btn('🔁 Đặt FS','view:preset')],
  [btn('🔌 Bật / tắt FS','view:nodes'),btn(`⏳ Xác nhận (${pendingCount})`,'view:pending')],
  [btn('📡 CDR','view:cdr'),btn('⚠️ Cảnh báo','view:warnings')],
  [btn('📊 Thống kê','view:stats'),btn('↻ Cập nhật','view:status')],
  [btn('⚙️ Cài đặt','view:controls'),btn('Hướng dẫn','view:help')]
 ]);
}

async function command(text:string,dedupe:string,messageId?:number){
 const [raw,...args]=text.trim().split(/\s+/),name=raw.split('@')[0].replace(/^\//,'').toLowerCase();
 if(name==='app'||name==='start'&&args[0]==='app'){
  const code=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
  await rpc('call_monitor_mobile_link',{p_code:code});
  await send('📱 APP AUTO CALL MONITOR\nGiao diện như tool trên máy. Liên kết đăng nhập dùng một lần, hết hạn sau 5 phút.',[[{text:'📱 Mở app',url:'https://callcenter-coral.vercel.app/#code='+code}]]);return;
 }
 if(['start','menu','help','status','pending','cdr','warnings'].includes(name)){await view(['start','menu'].includes(name)?'status':name,messageId);return;}
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 if(name==='history'||name==='stats'){const page=Number(args[1]||1);if(!Number.isInteger(page)||page<1)throw Error('Trang phải ≥1');await history(args[0]||today,page,name==='stats',messageId);return;}
 const live=await remote('snapshot');if(!live.online)throw Error('Máy offline; mở Chrome và extension trước');const s=live.snapshot;
 let payload:any;
 if(name==='dismiss')payload={type:'DISMISS_CDR_WARNING',fs:fsName(args[0])};
 if(name==='monitor'&&['on','off'].includes(args[0]))payload={type:'SET_MONITORING',enabled:args[0]==='on'};
 if(name==='block'){
  if(['on','off'].includes(args[0]))payload={type:'SET_AUTO',enabled:args[0]==='on'};
  if(['manual','auto'].includes(args[0]))payload={type:'SET_AUTO_BLOCK_MODE',mode:args[0]==='auto'?'AUTOMATIC':'MANUAL'};
 }
 if(name==='switch'&&['on','off','manual','auto'].includes(args[0]))payload={type:'FS_SWITCH_SETTINGS',enabled:['on','off'].includes(args[0])?args[0]==='on':s.feature.enabled,mode:['manual','auto'].includes(args[0])?(args[0]==='auto'?'AUTOMATIC':'MANUAL'):s.feature.mode};
 if(name==='threshold'&&/^\d+$/.test(args[0]||''))payload={type:'FS_SWITCH_THRESHOLD',value:Number(args[0])};
 if(name==='fs'&&['on','off'].includes(args[1])){const f=fsState(s,fsName(args[0]));const wanted=args[1]==='on'?(f.group==='99.153'?2:3):0;if(f.groupId===wanted)throw Error('FS đã ở trạng thái yêu cầu');payload={type:'FS_SWITCH_TOGGLE_NODE',group:f.group,fs:f.fs,expected:f.groupId};}
 if(name==='preset'){const g=group(args[0]);payload=args[1]==='clear'?{type:'FS_SWITCH_PRESET',group:g,clear:true}:{type:'FS_SWITCH_PRESET',group:g,source:args[1]==='0'?'':fsName(args[1]),target:args[2]==='0'?'':fsName(args[2])};}
 if(name==='reload')payload={type:'FS_SWITCH_RELOAD',group:group(args[0])};
 if(['confirm','cancel'].includes(name)){const a=s.pending.find((a:any)=>a.fs===fsName(args[0]));if(!a)throw Error('FS không có yêu cầu BLOCK chờ');payload={type:name==='confirm'?'CONFIRM_AUTO_BLOCK':'CANCEL_AUTO_BLOCK',key:a.key,incidentId:a.incidentId,phone:a.phone};}
 if(['recheck','ack','report'].includes(name)){const f=fsState(s,fsName(args[0]));payload={type:name==='recheck'?'RECHECK_AUTO_BLOCK':name==='ack'?'ACK_MANUAL_AFTER_FAILURE':'REPORT_MANUAL_SWAP',key:f.key,incidentId:f.incidentId};}
 if(name==='rotate'){const p=s.candidates.find((p:any)=>p.source.fs===fsName(args[0]));if(!p)throw Error('Không có kế hoạch Thay FS hợp lệ');payload={type:'FS_SWITCH_CONFIRM',identity:p.identity};}
 if(name==='release'){if(!s.feature.operation)throw Error('Không có lượt cần mở khóa');payload={type:'FS_SWITCH_RELEASE',operationId:s.feature.operation.id};}
 if(name==='clear'){const [date,startTime,endTime]=args;dateRange(date);if(![startTime,endTime].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||''))||startTime>endTime)throw Error('Khung giờ HH:mm không hợp lệ');payload={type:'CLEAR_HISTORY',date,startTime,endTime};}
 if(!payload){await send(help,menu);return;}
 const prepared=await remote('prepare',{dedupe,command:payload});
 const details=name==='monitor'||name==='block'||name==='switch'?`${args[0]==='on'?'Bật':args[0]==='off'?'Tắt':args[0]==='auto'?'Tự động':'Xác nhận tay'}`:name==='fs'?`${fsName(args[0])} · ${args[1]==='on'?'Bật':'Tắt'}`:name==='preset'?`${args[0]==='col'?'Collection':'Sale'} · ${args[1]==='clear'?'Hủy đặt':`${args[1]==='0'?'—':fsName(args[1])} → ${args[2]==='0'?'—':fsName(args[2])}`}`:args.join(' · ');
 await send(`✅ XÁC NHẬN THAO TÁC\n${actionLabel(payload.type)} · ${details}\n${name==='release'?'Chỉ xác nhận sau khi đã kiểm tra thao tác đang dở.\n':''}Hết hạn sau 90 giây.`,[[{text:'✅ Xác nhận',callback_data:'ok:'+prepared.id},{text:'Hủy',callback_data:'no:'+prepared.id}]],messageId);
}
Deno.serve(async request=>{
 try{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const path=new URL(request.url).pathname;
  if(path.endsWith('/device')){
   if(request.headers.get('authorization')!=='Bearer '+access)return new Response('Denied',{status:401});
   const body=await request.json();
   if(body.action==='result-notify'){
    const command=await remote('command-result',{id:body.id,device:body.device});
    if(!command)return Response.json({ok:true});
    const notice=await remote('notice',{id:'result:'+command.id});
    if(notice.new)try{await send(`${command.result.ok?'✅ Hoàn tất':'❌ Chưa hoàn tất'}: ${actionLabel(command.payload.type)}${command.result.error?'\n'+command.result.error:''}`,menu);}catch{await remote('unnotice',{id:'result:'+command.id});}
    return Response.json({ok:true});
   }
   if(body.action==='complete'){
    const accepted=await remote('complete',{id:body.id,device:body.device,result:body.result});
    if(accepted.accepted)await send(`${body.result.ok?'✅ Hoàn tất':'❌ Chưa hoàn tất'}: ${actionLabel(body.label)}${body.result.error?'\n'+body.result.error:''}`,menu);
    return Response.json(accepted);
   }
   if(!body.device||!body.snapshot)return new Response('Invalid payload',{status:400});
   const cmd=body.action==='notify'?null:await remote('heartbeat',{device:body.device,snapshot:body.snapshot});
   const s=body.snapshot;
   const notices=[...(s.alerts||[]).filter((a:any)=>!(s.pending||[]).some((p:any)=>p.incidentId===a.incidentId)).map((a:any)=>({id:'alert:'+a.incidentId,text:`⚠️ ${a.fs} nghi locked · xem /status`})),...(s.pending||[]).map((a:any)=>({id:'block:'+a.incidentId,text:`⚠️ ${a.fs} nghi locked · ${a.phone}\n/confirm ${Number(a.fs.slice(2))} để xác nhận BLOCK`})),...(s.candidates||[]).map((p:any)=>({id:'switch:'+p.key,text:`⚠️ Thay FS: ${p.source.fs} → ${p.target.fs}\n/rotate ${Number(p.source.fs.slice(2))}`})),...(s.warnings||[]).map((w:any)=>({id:`cdr:${w.group}:${w.fs}:${w.at}`,text:`⚠️ CDR ${w.fs}: ${w.pattern} · ${w.count} cuộc`})),...(s.events||[]).map((e:any)=>({id:`event:${e.incidentId}:${e.type}`,text:`✅ ${e.fs}${e.targetFs?' → '+e.targetFs:''} · ${eventLabel(e.type)}`}))];
   for(const n of notices.slice(0,12)){const result=await remote('notice',{id:n.id});if(result.new)try{await send(n.text,[[btn('⏳ Xác nhận','view:pending'),btn('🏠 Bảng điều khiển','view:status')]]);}catch{await remote('unnotice',{id:n.id});}}
   return Response.json({command:cmd});
  }
  if(request.headers.get('x-telegram-bot-api-secret-token')!==secret)return new Response('Denied',{status:401});
  const update=await request.json(),cb=update.callback_query,m=cb?.message||update.message,user=cb?.from||update.message?.from;
  if(String(user?.id)!==chat||String(m?.chat?.id)!==chat)return new Response('Forbidden',{status:403});
  if(cb){await tg('answerCallbackQuery',{callback_query_id:cb.id});const data=cb.data||'';
   if(data.startsWith('ok:')){await remote('confirm',{id:data.slice(3)});await send('⏳ ĐANG THỰC HIỆN\nĐã gửi tới máy. Chờ kết quả xác minh.',[[btn('🏠 Bảng điều khiển','view:status')]],m.message_id);}
   else if(data.startsWith('no:')){await remote('cancel',{id:data.slice(3)});await view('status',m.message_id);}
   else if(data.startsWith('cmd:'))await command(data.slice(4),'telegram-callback:'+cb.id,m.message_id);
   else if(data.startsWith('preset:')){
    const [,g,stage,source]=data.split(':');group(g);const numbers=g==='col'?[1,2,3,4]:[5,6,7];
    if(stage==='source')await send(`🔁 ${g==='col'?'COLLECTION':'SALE'} · CHỌN FS TẮT\nChọn — nếu chỉ muốn bật thêm FS.`,[
     numbers.map(n=>btn(`Tắt ${n}`,`preset:${g}:target:${n}`)),[btn('— Chỉ bật',`preset:${g}:target:0`)], [btn('← Chọn nhóm','view:preset')]
    ],m.message_id);
    else if(stage==='target'&&['0',...numbers.map(String)].includes(source))await send(`🔁 CHỌN FS BẬT\nTắt: ${source==='0'?'—':fsName(source)}\nChọn — nếu chỉ muốn tắt.`,[
     numbers.filter(n=>String(n)!==source).map(n=>cmdBtn(`Bật ${n}`,`/preset ${g} ${source} ${n}`)),...(source!=='0'?[[cmdBtn('— Chỉ tắt',`/preset ${g} ${source} 0`)]]:[]),[btn('← Chọn FS tắt',`preset:${g}:source`)]
    ],m.message_id);
   }
   else if(data.startsWith('view:'))await view(data.slice(5),m.message_id);
   else if(data.startsWith('hist:')){const [,date,page]=data.split(':');await history(date,Number(page),false,m.message_id);}
  }else if(m?.text)await command(m.text,'telegram:'+update.update_id);
  return Response.json({ok:true});
 }catch(error){console.error('Telegram control request failed');try{await send('Không thực hiện: '+String(error.message||error));}catch{}return Response.json({ok:false});}
});
