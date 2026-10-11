async function state() {
  const r = await chrome.storage.local.get("state");
  return r.state || null;
}
function age(ts){return ts ? Math.round((Date.now()-ts)/1000)+"s ago" : "-";}
function esc(s){return String(s ?? "").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

async function render(){
  const s=await state();
  const app=document.querySelector("#app");
  if(!s){app.innerHTML='<div class="card">Open Grafana, OpenSIPS .153/.155 and FreeSWITCH tabs first.</div>';return;}

  let html="";
  for(const g of ["99.153","99.155"]){
    const gr=s.grafana[g]||{}, os=s.opensips[g]||{};
    html+=`<div class="card"><b>${g}</b> Traffic: <b>${gr.value ?? "-"}</b>
      <span class="muted">(${age(gr.updatedAt)})</span><table>
      <tr><th>FS</th><th>IP</th><th>VT</th><th>Profile</th></tr>`;
    for(const n of os.nodes||[]){
      html+=`<tr><td>${esc(n.fs||"?")}</td><td>${esc(n.ip)}</td><td>${n.used}/${n.capacity}</td><td>${esc(n.description)}</td></tr>`;
    }
    html+="</table></div>";
  }

  if((s.alerts||[]).length){
    html+=`<div class="card bad"><b>SUSPECTED BLOCK</b>`;
    for(const a of s.alerts){
      const active=(s.freeswitch?.numbers||[]).find(n=>n.fs===a.fs && n.status==="ACTIVE");
      html+=`<div>${a.group} → ${a.fs} (${a.ip}) VT=${a.currentVt}`+
        (active?` → ACTIVE ${esc(active.phone)}`:" → ACTIVE number not found")+`</div>`;
    }
    html+="</div>";
  } else {
    html+=`<div class="card good">No suspected block detected.</div>`;
  }
  app.innerHTML=html;
}
document.querySelector("#clear").onclick=async()=>{await chrome.runtime.sendMessage({type:"CLEAR"});render();};
render(); setInterval(render,2000);