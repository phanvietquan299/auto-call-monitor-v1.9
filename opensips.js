(() => {
  const GROUP = location.hostname === "10.10.99.153" ? "99.153" :
                location.hostname === "10.10.99.155" ? "99.155" : null;
  if (!GROUP) return;

  const ENDPOINT =
    `${location.protocol}//${location.host}/cp/tools/system/loadbalancer/loadbalancer.php?action=add`;

  const IP_TO_FS = {
    "10.10.101.176":"FS01","10.10.101.170":"FS02",
    "10.10.101.184":"FS03","10.10.101.180":"FS04",
    "10.10.101.58":"FS05","10.10.101.87":"FS06",
    "10.10.101.88":"FS07","10.10.101.171":"FS08",
    "10.10.101.89":"FS09","10.10.101.90":"FS10"
  };

  const TARGET = GROUP === "99.153"
    ? new Set(["10.10.101.176","10.10.101.170","10.10.101.184","10.10.101.180"])
    : new Set(["10.10.101.58","10.10.101.87","10.10.101.88","10.10.101.89","10.10.101.90"]);

  const histories = new Map();
  let busy = false;
  let monitoringEnabled = true;

  function send(msg) {
    try {
      if (chrome?.runtime?.id) chrome.runtime.sendMessage(msg).catch(()=>{});
    } catch (_) {}
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table.ttable");
    if (!table) return {nodes:[], tableFound:false, rows:0};

    const nodes=[];
    for (const row of [...table.rows]) {
      const text=(row.textContent||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
      const im=text.match(/sip:(10\.10\.101\.\d+)(?::\d+)?/i);
      const vm=text.match(/\bvt\s*=\s*(\d+)\s*\/\s*(\d+)/i);
      if (!im || !vm || !TARGET.has(im[1])) continue;

      const ip=im[1], used=Number(vm[1]), capacity=Number(vm[2]);
      const h=histories.get(ip)||[];
      h.push(used);
      while(h.length>12) h.shift();
      histories.set(ip,h);

      let trend="STABLE";
      if(h.length>=4){
        const a=h.slice(-4);
        const d=a[a.length-1]-a[0];
        if(d<=-Math.max(20,capacity*.05)) trend="DOWN";
        else if(d>=Math.max(20,capacity*.05)) trend="UP";
      }

      nodes.push({
        fs:IP_TO_FS[ip]||null, ip, used, capacity, resource:"vt",
        destinationId:/^\d+$/.test((row.cells?.[0]?.textContent||'').trim())?Number(row.cells[0].textContent.trim()):null,
        groupId:/^\d*$/.test((row.cells?.[1]?.textContent??'invalid').trim())?Number(row.cells[1].textContent.trim()):null,
        description:GROUP==="99.153"?"Collection":"TeleSale",
        trend, history:[...h]
      });
    }
    return {nodes, tableFound:true, rows:table.rows.length};
  }

  async function poll(){
    if(busy||globalThis.fsSwitchBusy) return;
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

  chrome.storage.local.get("state").then(r => {
    monitoringEnabled = r.state?.monitoringEnabled !== false;
    poll();
  }).catch(()=>{ poll(); });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "MONITORING_CHANGED") {
      monitoringEnabled = !!msg.enabled;
      if (monitoringEnabled) poll();
    }
  });

  const timer=setInterval(poll,1000);
  addEventListener("beforeunload",()=>{clearInterval(timer);},{once:true});
})();