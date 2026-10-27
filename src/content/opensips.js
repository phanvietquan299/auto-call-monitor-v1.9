(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ () => {
  const GROUP = location.hostname === "10.10.99.153" ? "99.153" :
                location.hostname === "10.10.99.155" ? "99.155" : null;
  if (!GROUP) return;

  const ENDPOINT =
    `${location.protocol}//${location.host}/cp/tools/system/loadbalancer/loadbalancer.php?action=add`;

  const IP_TO_FS = {
    "10.10.99.140":"OS01",
    "10.10.101.176":"FS01","10.10.101.170":"FS02",
    "10.10.101.184":"FS03","10.10.101.180":"FS04",
    "10.10.101.58":"FS05","10.10.101.87":"FS06",
    "10.10.101.88":"FS07","10.10.101.171":"FS08",
    "10.10.101.89":"FS09","10.10.101.90":"FS10"
  };

  const TARGET = GROUP === "99.153"
    ? new Set(["10.10.99.140","10.10.101.176","10.10.101.170","10.10.101.184","10.10.101.180"])
    : new Set(["10.10.101.58","10.10.101.87","10.10.101.88","10.10.101.89","10.10.101.90"]);

  const histories = new Map();
  let busy = false;
  let monitoringEnabled = true;

  /** Tác dụng: Gửi mẫu OpenSIPS hoặc chẩn đoán lỗi về background, bỏ qua runtime đã bị reload. */
  function send(msg) {
    try {
      if (chrome?.runtime?.id) chrome.runtime.sendMessage(msg).catch(/** Tác dụng: Bỏ qua lỗi phụ của bước này để không ngắt luồng chính. */ ()=>{});
    } catch (_) {}
  }

  /** Tác dụng: Phân tích HTML Load Balancer thành catalog IP/destination và các node VT được giám sát. */
  function parse(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table.ttable");
    if (!table) return {nodes:[], tableFound:false, rows:0};

    const nodes=[],catalog=[];
    for (const row of [...table.rows]) {
      const text=(row.cells?[...row.cells].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong parse. */ c=>c.textContent||'').join(' '):(row.textContent||"" )).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
      const im=text.match(/sip:((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?/i);
      const vm=text.match(/\bvt\s*=\s*(\d+)\s*\/\s*(\d+)/i);
      if (!im) continue;

      const ip=im[1], used=vm?Number(vm[1]):null, capacity=vm?Number(vm[2]):null;
      const historyKey=ip+'|'+(row.cells?.[0]?.textContent||'');
      const h=histories.get(historyKey)||[];
      h.push(used);
      while(h.length>12) h.shift();
      histories.set(historyKey,h);

      let trend="STABLE";
      if(h.length>=4){
        const a=h.slice(-4);
        const d=a[a.length-1]-a[0];
        if(d<=-Math.max(20,capacity*.05)) trend="DOWN";
        else if(d>=Math.max(20,capacity*.05)) trend="UP";
      }

      catalog.push({
        fs:IP_TO_FS[ip]||null, fsHint:text.match(/\b(?:FS|OS)\d+\b/i)?.[0]?.toUpperCase()||null, ip, used, capacity, resource:vm?"vt":null,
        destinationId:/^\d+$/.test((row.cells?.[0]?.textContent||'').trim())?Number(row.cells[0].textContent.trim()):null,
        groupId:/^\d*$/.test((row.cells?.[1]?.textContent??'invalid').trim())?Number(row.cells[1].textContent.trim()):null,
        description:GROUP==="99.153"?"Collection":"TeleSale",
        trend, history:[...h]
      });
    }
    for(const n of catalog)if(TARGET.has(n.ip)&&n.resource==='vt')nodes.push(n);
    return {nodes,catalog, tableFound:true, rows:table.rows.length};
  }

  /** Tác dụng: Lấy mẫu định kỳ khi không bận, gửi kết quả hoặc chẩn đoán lỗi về bộ điều phối. */
  async function poll(){
    if(busy||globalThis.fsSwitchBusy||globalThis.OpenSipsPage&&OpenSipsPage.role()==='CDR') return;
    busy=true;
    try{
      // Exact legacy form action:
      // POST loadbalancer.php?action=add
      // refresh=Refresh from Server
      const res=await fetch(ENDPOINT,{
        method:"POST",
        credentials:"include",
        cache:"no-store",
        signal:AbortSignal.timeout(8000),
        headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
        body:"refresh="+encodeURIComponent("Refresh from Server")
      });
      const html=await res.text();
      const parsed=parse(html);

      send({
        type:"OPENSIPS_SAMPLE",
        group:GROUP,
        nodes:parsed.nodes,
        catalog:parsed.catalog,
        diagnostic:{
          version:"1.5.0",
          httpStatus:res.status,
          responseUrl:res.url,
          tableFound:parsed.tableFound,
          tableRows:parsed.rows,
          parsedNodes:parsed.nodes.length,
          endpoint:ENDPOINT,
          at:Date.now()
        }
      });
    }catch(e){
      send({
        type:"OPENSIPS_SAMPLE", group:GROUP, nodes:[],
        diagnostic:{version:"1.5.0",error:String(e),endpoint:ENDPOINT,at:Date.now()}
      });
    }finally{busy=false;}
  }

  chrome.storage.local.get("state").then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ r => {
    monitoringEnabled = r.state?.monitoringEnabled !== false;
    poll();
  }).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ ()=>{ poll(); });

  chrome.runtime.onMessage.addListener(/** Tác dụng: Nhận message extension, phân biệt loại lệnh và trả kết quả đồng bộ hoặc bất đồng bộ. */ (msg,_sender,reply) => {
    if(msg.type==='OPENSIPS_LIST_NODES'){
      if(globalThis.fsSwitchBusy){reply({ok:false,error:'Đang chuyển FS; thử tải lại sau'});return;}
      fetch(ENDPOINT,{method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'refresh='+encodeURIComponent('Refresh from Server')})
        .then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ async res=>{if(!res.ok)throw Error('OpenSIPS HTTP '+res.status);const parsed=parse(await res.text());if(!parsed.tableFound)throw Error('Không đọc được bảng Load Balancer; kiểm tra đăng nhập');return {ok:true,group:GROUP,catalog:parsed.catalog};})
        .then(reply).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ error=>reply({ok:false,error:String(error.message||error)}));return true;
    }

    if(msg.type==="OPENSIPS_POLL_NOW"){
      poll().then(/** Tác dụng: Tiếp tục xử lý sau khi bước bất đồng bộ hoàn tất. */ ()=>reply({ok:true})).catch(/** Tác dụng: Xử lý lỗi của bước bất đồng bộ theo chính sách tại chỗ. */ e=>reply({ok:false,error:String(e)}));return true;
    }
    if (msg.type === "MONITORING_CHANGED") {
      monitoringEnabled = !!msg.enabled;
      if (monitoringEnabled) poll();
    }
  });

  const timer=setInterval(poll,1000);
  addEventListener("beforeunload",/** Tác dụng: Dừng timer lấy mẫu khi tab đang rời trang. */ ()=>{clearInterval(timer);},{once:true});
})();