/* main.php keeps its URL while same-origin frames display different tools. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ ()=>{
  /** Tác dụng: Duyệt document hiện tại và các frame cùng origin để tìm công cụ OpenSIPS. */
  function documents(doc=document,seen=new Set()){
    if(!doc||seen.has(doc))return [];seen.add(doc);const out=[doc];
    for(const frame of doc.querySelectorAll('iframe,frame'))try{out.push(...documents(frame.contentDocument,seen));}catch(_){}
    return out;
  }
  /** Tác dụng: Tìm form CDR theo các trường chọn cột và biểu thức tìm kiếm. */
  function cdrForm(doc){return [...doc.querySelectorAll('form')].find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong cdrForm. */ f=>f.querySelector('[name="cdr_field"]')&&f.querySelector('[name="search_regexp"]'));}
  /** Tác dụng: Nhận diện tab đang hiển thị CDR Viewer, Load Balancer hoặc công cụ chưa biết. */
  function role(){
    const docs=documents();if(docs.some(cdrForm))return 'CDR';
    if(docs.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong role. */ d=>/\/loadbalancer\//i.test(d.URL||'')||
      [...d.querySelectorAll('table.ttable th')].some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong role. */ h=>h.textContent.replace(/\s+/g,' ').trim()==='SIP URI')||d.querySelector('[name="group_id"]')))return 'LOAD_BALANCER';
    return 'UNKNOWN';
  }
  let pendingRefresh=null;
  /** Tác dụng: Làm mới đúng công cụ OpenSIPS; hoãn refresh khi đang đọc CDR hoặc chuyển FS. */
  function refreshTool(target){
    if(!['LOAD_BALANCER','CDR'].includes(target))return {ok:false};
    if(globalThis.fsSwitchBusy||globalThis.cdrReadBusy){pendingRefresh=target;return {ok:false,skipped:true,queued:true};}
    const current=role(),docs=documents();
    const doc=docs.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong refreshTool. */ d=>target==='CDR'?cdrForm(d):/\/loadbalancer\//i.test(d.URL||'')||[...d.querySelectorAll('table.ttable th')].some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong refreshTool. */ h=>h.textContent.trim()==='SIP URI'))||docs.at(-1);
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
  /** Tác dụng: Thực hiện yêu cầu refresh đã hoãn sau khi thao tác đang bận kết thúc. */
  function flushRefresh(){if(pendingRefresh)try{return refreshTool(pendingRefresh);}catch(e){return {ok:false,error:String(e)};}}
  globalThis.OpenSipsPage={documents,cdrForm,role,refreshTool,flushRefresh};
  chrome.runtime.onMessage.addListener(/** Tác dụng: Nhận message extension, phân biệt loại lệnh và trả kết quả đồng bộ hoặc bất đồng bộ. */ (msg,_sender,reply)=>{
    if(msg.type==='OPENSIPS_REFRESH_TOOL'){try{reply(refreshTool(msg.role));}catch(e){reply({ok:false,error:String(e)});}return;}
    if(msg.type==='OPENSIPS_PAGE_ROLE')reply({ok:true,role:role(),group:location.hostname==='10.10.99.153'?'99.153':'99.155'});
  });
})();
