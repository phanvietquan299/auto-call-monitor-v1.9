/* Inline manual status control, using only the inventory bound by this server. */
(function(){
 const busy=new Set(),notes=new Map();
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=node=>JSON.stringify([node.id,node.host,node.profile]);
 const api=window.MonitorNumberStatus={
  isBusy:value=>busy.has(value),
  render(node,snapshot,routed){
   const identity=key(node),data=snapshot?.nodes?.find(row=>row.id===node.id&&row.ip===node.host&&row.profile===node.profile);
   const fresh=snapshot&&Date.now()-snapshot.at<=10000,row=fresh?data:null;
   const note=notes.get(identity),message=note&&Date.now()<note.until?note:null;
   const label=row?.error||(!row?.phone?'Chờ cập nhật số':'');
   return `<div class="monitor-phone-status mt-1"><span class="block text-xs text-slate-500">${escape(row?.phone||'Chờ số điện thoại')}</span><select aria-label="Trạng thái số ${escape(node.id)}" data-monitor-number-status data-key="${escape(identity)}" data-node-id="${escape(node.id)}" data-ip="${escape(node.host)}" data-profile="${escape(node.profile)}" data-phone="${escape(row?.phone||'')}" data-expected="${escape(row?.status||'')}" class="mt-2 w-full border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white" ${!row?.phone||row?.error||busy.has(identity)?'disabled':''}>${!row?.phone?'<option value="">Chờ cập nhật số…</option>':''}${['ACTIVE','BACKUP','BLOCKED'].map(status=>`<option value="${status}" ${status===row?.status?'selected':''}>${{ACTIVE:routed?'🟢':'⚪',BACKUP:'🔵',BLOCKED:'🔴'}[status]} ${status}</option>`).join('')}</select>${busy.has(identity)?'<small class="block text-slate-500">Đang đổi…</small>':message?`<small class="block ${message.error?'text-red-600':'text-emerald-700'}">${escape(message.text)}</small>`:label?`<small class="block text-slate-500">${escape(label)}</small>`:''}</div>`;
  }
 };
 document.addEventListener('change',async event=>{
  const select=event.target.closest('[data-monitor-number-status]');if(!select)return;
  const {key:identity,nodeId,ip,profile,phone,expected}=select.dataset,status=select.value;
  if(!phone||status===expected||busy.has(identity))return;
  busy.add(identity);select.disabled=true;
  try{
   const response=await fetch('/api/monitor/number-status',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodeId,ip,profile,phone,expectedStatus:expected,status}),signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(!response.ok||!result.success)throw Error(result.error||'Không đổi được trạng thái');
   notes.set(identity,{text:`Đã đổi ${phone} → ${status}`,until:Date.now()+30000});
  }catch(error){select.value=expected;notes.set(identity,{error:true,text:['TimeoutError','TypeError'].includes(error.name)?'Chưa xác minh; chờ đọc lại trạng thái':error.message,until:Date.now()+30000});}
  finally{busy.delete(identity);select.disabled=false;select.blur();if(typeof window.fetchMonitor==='function')await window.fetchMonitor();}
 });
})();
