/* Read-only Search requests; never changes Load Balancer or FreeSWITCH. */
(()=>{
  const group=location.hostname==='10.10.99.153'?'99.153':location.hostname==='10.10.99.155'?'99.155':null;
  if(!group)return;let busy=false,cached=null;
  const endpoint=location.origin+'/cp/tools/system/cdrviewer/cdrviewer.php';
  async function context(force){
    if(!force){
      const doc=OpenSipsPage.documents().find(d=>OpenSipsPage.cdrForm(d));
      if(doc)return {doc,form:OpenSipsPage.cdrForm(doc),base:doc.baseURI||doc.URL,live:true};
      if(cached&&Date.now()-cached.at<60000)return cached;
    }
    const response=await fetch(endpoint,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok||new URL(response.url||endpoint).origin!==location.origin)throw Error('Không tải được form CDR; kiểm tra đăng nhập OpenSIPS.');
    const doc=new DOMParser().parseFromString(await response.text(),'text/html'),form=OpenSipsPage.cdrForm(doc);
    if(!form)throw Error('Trang CDR không có form Search; cần đăng nhập lại OpenSIPS.');
    cached={doc,form,base:response.url||endpoint,live:false,at:Date.now()};return cached;
  }
  async function search(msg){
    try{return await searchOnce(msg,false);}catch(first){cached=null;return searchOnce(msg,true);}
  }
  async function searchOnce(msg,force){
    if(msg.group!==group||Cdr.IPS[msg.fs]!==msg.ip||(group==='99.153')!==(msg.fs==='OS01'||Number(msg.fs.slice(2))<=4))throw Error('FS/IP không thuộc máy chủ CDR này.');
    const {doc,form,base,live}=await context(force);
    const action=new URL(form.getAttribute('action')||base,base);
    if(action.origin!==location.origin||!action.pathname.endsWith('/cdrviewer.php')||action.searchParams.get('action')!=='search')throw Error('Không xác định được endpoint Search CDR.');
    const body=new URLSearchParams();
    for(const el of form.elements){
      if(!el.name||el.disabled||['submit','button','reset','file'].includes(el.type)||['checkbox','radio'].includes(el.type)&&!el.checked)continue;
      body.set(el.name,el.value);
    }
    body.set('cdr_field','dst_ip');body.set('search_regexp',msg.ip);body.set('search','Search');
    // Query the current date, regardless of a previous manual date filter.
    const vn=new Date(Date.now()+7*3600000);
    for(const prefix of ['start','end']){
      body.set(prefix+'_year',String(vn.getUTCFullYear()));body.set(prefix+'_month',String(vn.getUTCMonth()+1).padStart(2,'0'));
      body.set(prefix+'_day',String(vn.getUTCDate()).padStart(2,'0'));
      for(const [unit,v] of [['hour',prefix==='start'?'00':'23'],['minute',prefix==='start'?'00':'59'],['second',prefix==='start'?'00':'59']])body.set(prefix+'_'+unit,v);
    }
    const res=await fetch(action.href,{method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString()});
    if(!res.ok||new URL(res.url||action.href).origin!==location.origin)throw Error('Search CDR lỗi HTTP/đăng nhập');
    const parsed=new DOMParser().parseFromString(await res.text(),'text/html'),records=Cdr.parseDocument(parsed);
    // Show the queried destination and returned table without navigating frames.
    if(live&&doc.isConnected!==false&&OpenSipsPage.cdrForm(doc)===form){
      form.querySelector('[name="cdr_field"]').value='dst_ip';form.querySelector('[name="search_regexp"]').value=msg.ip;
      const old=doc.querySelector('table.ttable'),table=parsed.querySelector('table.ttable');
      if(old&&table)old.replaceWith(doc.importNode(table,true));
    }
    return {ok:true,group,ip:msg.ip,records,queriedAt:Date.now()};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg.type!=='CDR_CHECK_FS')return;
    if(busy){reply({ok:false,error:'CDR Search đang chạy; chờ truy vấn trước.'});return;}
    busy=true;globalThis.cdrReadBusy=true;search(msg).then(reply).catch(e=>reply({ok:false,error:String(e.message||e)})).finally(()=>{busy=false;globalThis.cdrReadBusy=false;OpenSipsPage.flushRefresh?.();});return true;
  });
})();
