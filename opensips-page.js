/* main.php keeps its URL while same-origin frames display different tools. */
(()=>{
  function documents(doc=document,seen=new Set()){
    if(!doc||seen.has(doc))return [];seen.add(doc);const out=[doc];
    for(const frame of doc.querySelectorAll('iframe,frame'))try{out.push(...documents(frame.contentDocument,seen));}catch(_){}
    return out;
  }
  function cdrForm(doc){return [...doc.querySelectorAll('form')].find(f=>f.querySelector('[name="cdr_field"]')&&f.querySelector('[name="search_regexp"]'));}
  function role(){
    const docs=documents();if(docs.some(cdrForm))return 'CDR';
    if(docs.some(d=>/\/loadbalancer\//i.test(d.URL||'')||
      [...d.querySelectorAll('table.ttable th')].some(h=>h.textContent.replace(/\s+/g,' ').trim()==='SIP URI')||d.querySelector('[name="group_id"]')))return 'LOAD_BALANCER';
    return 'UNKNOWN';
  }
  let pendingRefresh=null;
  function refreshTool(target){
    if(!['LOAD_BALANCER','CDR'].includes(target))return {ok:false};
    if(globalThis.fsSwitchBusy||globalThis.cdrReadBusy){pendingRefresh=target;return {ok:false,skipped:true,queued:true};}
    const current=role(),docs=documents();
    const doc=docs.find(d=>target==='CDR'?cdrForm(d):/\/loadbalancer\//i.test(d.URL||'')||[...d.querySelectorAll('table.ttable th')].some(h=>h.textContent.trim()==='SIP URI'))||docs.at(-1);
    if(!doc?.defaultView)return {ok:false,error:'Không tìm thấy trang công cụ để reload'};
    const fallback=target==='CDR'?'/cp/tools/system/cdrviewer/cdrviewer.php':'/cp/tools/system/loadbalancer/loadbalancer.php';
    const url=new URL(doc.URL||fallback,location.origin);
    if(url.origin!==location.origin)return {ok:false};
    pendingRefresh=null;
    // Run now: background tabs throttle setTimeout, and Search could start
    // before a delayed callback and cause every reload to be silently skipped.
    if(current!==target||url.pathname.endsWith('/main.php'))doc.defaultView.location.replace(location.origin+fallback);
    else doc.defaultView.location.reload();
    return {ok:true,role:target};
  }
  function flushRefresh(){if(pendingRefresh)try{return refreshTool(pendingRefresh);}catch(e){return {ok:false,error:String(e)};}}
  globalThis.OpenSipsPage={documents,cdrForm,role,refreshTool,flushRefresh};
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg.type==='OPENSIPS_REFRESH_TOOL'){try{reply(refreshTool(msg.role));}catch(e){reply({ok:false,error:String(e)});}return;}
    if(msg.type==='OPENSIPS_PAGE_ROLE')reply({ok:true,role:role(),group:location.hostname==='10.10.99.153'?'99.153':'99.155'});
  });
})();
