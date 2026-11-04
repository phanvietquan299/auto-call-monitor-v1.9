/* Isolated read-only collector: no inventory writes, swaps, SSH, Redis or production API. */
const {execFile}=require('child_process'),path=require('path'),fs=require('fs');
const Cdr=require('./monitor-cdr-policy');
const GROUPS={'99.153':'COLLECTION','99.155':'TELESALE'};
function createLiveMonitor({getNodes,getInventory,getSelection,read,now=Date.now,enabled=false,accessFile,cookieDir}={}) {
  const groups=Object.fromEntries(Object.keys(GROUPS).map(group=>[group,{traffic:null,cdr:{},error:null,trafficBusy:false,cdrBusy:false,retryAt:0}]));
  let stopped=false,timer,epoch=0;const workers=new Set();
  const isOn=()=>enabled&&(!getSelection||getSelection().monitoringEnabled!==false);
  const revision = () => { try {return fs.statSync(accessFile || '/etc/freeswitch-automation-monitor-opensips.json').mtimeMs;} catch (_) {return 0;} };
  const fetch=read||((group,operation,ip)=>new Promise((resolve,reject)=>{
    const child=execFile('python3',[path.join(__dirname,'opensips-reader.py'),group,operation,...(ip?[ip]:[])],{timeout:25000,maxBuffer:1000000,env:{...process.env,...(accessFile?{MONITOR_ACCESS_FILE:accessFile}:{}),...(cookieDir?{MONITOR_COOKIE_DIR:cookieDir}:{})}},(error,stdout)=>{if(error)return reject(Error('Hết thời gian hoặc lỗi bộ đọc OpenSIPS'));try{resolve(JSON.parse(stdout));}catch(_){reject(Error('Bộ đọc trả dữ liệu không hợp lệ'));}});
    workers.add(child);child.once('exit',()=>workers.delete(child));
  }));
  const selectionKey = node => JSON.stringify([node.id,node.host,node.profile]);
  const selected = (group,node) => !getSelection || getSelection().groups[group]?.includes(selectionKey(node));
  const hasSelection = group => !getSelection || !!getSelection().groups[group]?.length;
  function collectionPaused(group,at){const date=new Date(at+7*3600000),minute=date.getUTCHours()*60+date.getUTCMinutes();return group==='99.153'&&(minute>=18*60+5||minute<8*60);}
  function allowed(state) {
    if(!isOn()||stopped)return false;
    if(state.authBlocked){if(state.accessRevision===revision())return false;state.authBlocked=false;state.retryAt=0;}
    return state.retryAt<=now();
  }
  function fail(state,error){state.error=error.message;state.retryAt=now()+30000;if(error.code==='AUTH'){state.authBlocked=true;state.accessRevision=revision();}}
  function checked(result){if(!result.ok){const error=Error(result.error);error.code=result.code;throw error;}return result;}
  async function pollTraffic(group) {
    const state=groups[group];if(!hasSelection(group)||!allowed(state)||state.trafficBusy||state.traffic&&!state.error&&now()-state.traffic.at<1000)return;
    state.trafficBusy=true;const generation=epoch;
    try {const result=checked(await fetch(group,'traffic'));if(generation!==epoch||!isOn())return;state.traffic={at:now(),nodes:result.nodes};for(const ip of Object.keys(state.cdr)){if(result.nodes.filter(row=>row.ip===ip&&row.groupId===(group==='99.153'?2:3)).length!==1)delete state.cdr[ip];}if(!state.authBlocked){state.error=null;state.retryAt=0;}}
    catch(error){if(generation===epoch&&isOn())fail(state,error);}finally{state.trafficBusy=false;}
  }
  async function pollCdr(group) {
    const state=groups[group];if(!hasSelection(group)||!allowed(state)||state.cdrBusy||state.error||!state.traffic||now()-state.traffic.at>15000||collectionPaused(group,now()))return;
    state.cdrBusy=true;const generation=epoch;
    try {
      const nodes=(await getNodes()).filter(n=>n.profile===GROUPS[group]&&Cdr.IPS[n.id]===n.host&&selected(group,n));
      if(generation!==epoch||!isOn()||!state.traffic)return;
      const candidates=nodes.filter(n=>state.traffic.nodes.filter(row=>row.ip===n.host&&row.groupId===(group==='99.153'?2:3)).length===1)
        .filter(n=>now()-(state.cdr[n.host]?.attemptAt||0)>=2000)
        .sort((a,b)=>(state.cdr[a.host]?.attemptAt||0)-(state.cdr[b.host]?.attemptAt||0)||a.id.localeCompare(b.id));
      for(const node of candidates){
        if(generation!==epoch||!allowed(state)||collectionPaused(group,now()))break;
        if(!selected(group,node))continue;
        if(!state.traffic||now()-state.traffic.at>15000||state.traffic.nodes.filter(row=>row.ip===node.host&&row.groupId===(group==='99.153'?2:3)).length!==1)continue;
        const attemptAt=now(),result=await fetch(group,'cdr',node.host);
        if(!result.ok&&result.code==='AUTH')checked(result);
        if(generation!==epoch||!isOn()||!selected(group,node)||!state.traffic||now()-state.traffic.at>15000||state.traffic.nodes.filter(row=>row.ip===node.host&&row.groupId===(group==='99.153'?2:3)).length!==1)continue;
        state.cdr[node.host]=result.ok?{at:now(),attemptAt,records:result.records,error:null}:{...state.cdr[node.host],attemptAt,error:result.error,errorAt:now()};
      }
    }catch(error){if(generation===epoch&&isOn())fail(state,error);}finally{state.cdrBusy=false;}
  }
  async function step(group){const state=groups[group];if(!state.traffic||state.error||now()-state.traffic.at>=1000)await pollTraffic(group);else await pollCdr(group);}
  async function snapshot(){
    const hasNodes=!getSelection || Object.keys(GROUPS).some(hasSelection);
    const inventory=getInventory&&hasNodes?await getInventory():null;
    const nodes=hasNodes?(inventory?inventory.nodes:await getNodes()):[],at=now();
    return {enabled:isOn(),available:enabled,at,inventory,selection:getSelection?getSelection():null,readOnly:true,intervals:{trafficMs:1000,cdrMinIntervalMs:2000},groups:Object.fromEntries(Object.entries(groups).map(([group,state])=>{
      const trafficFresh=isOn()&&!!state.traffic&&!state.error&&at-state.traffic.at<=15000;
      return [group,{trafficAt:state.traffic?.at||null,cdrPaused:collectionPaused(group,at),error:state.error,authBlocked:!!state.authBlocked,retryAt:state.retryAt||null,nodes:nodes.filter(n=>n.profile===GROUPS[group]&&selected(group,n)).map(n=>{
        const matches=(state.traffic?.nodes||[]).filter(r=>r.ip===n.host),active=matches.filter(r=>r.groupId===(group==='99.153'?2:3));
        const row=active.length===1?active[0]:matches.length===1?matches[0]:matches.filter(r=>r.groupId===0).length===1&&active.length===0?matches.find(r=>r.groupId===0):null;
        const ambiguous=active.length>1||(!row&&matches.length>0),cdr=state.cdr[n.host];
        const routed=trafficFresh&&!ambiguous&&row?.groupId===(group==='99.153'?2:3);
        const cdrFresh=routed&&!!cdr&&!cdr.error&&at-cdr.at<=15000&&!collectionPaused(group,at);
        const evidence=cdrFresh?Cdr.evaluate(cdr.records,{ip:n.host,after:at-30000,now:at}):null;
        const observation=cdrFresh?Cdr.evaluate(cdr.records,{ip:n.host,now:at,observation:true}):null;
        let status=!isOn()?'MONITOR đang OFF; đã dừng đọc Traffic/CDR':state.error||(!trafficFresh?'Chờ Traffic mới':ambiguous?'Nhiều destination trùng IP; chưa xác định được':!row?'Không tìm thấy destination VT':!routed?'FS không hoạt động trong nhóm':collectionPaused(group,at)?'Collection nghỉ 18:05–08:00; dừng Search CDR':cdr?.error||(!cdrFresh?'Chờ Search CDR':!evidence?.eligibleCount?'Chưa có CDR mới trong 30 giây':evidence.reason));
        return {id:n.id,ip:n.host,traffic:trafficFresh&&row&&!ambiguous?{used:row.used,capacity:row.capacity,groupId:row.groupId,at:state.traffic.at}:null,
          state:!isOn()?'MONITOR_OFF':!trafficFresh||state.error?'WAITING_TRAFFIC':ambiguous?'AMBIGUOUS':!routed?'INACTIVE':collectionPaused(group,at)?'PAUSED':!cdrFresh?'WAITING_CDR':evidence?.locked?'CDR_ERRORS':evidence?.eligibleCount?'OBSERVING':'WAITING_CDR',
          status,trafficFresh,cdr:{at:cdr?.at||null,fresh:cdrFresh,error:cdr?.error||null,consecutive:cdrFresh?observation?.consecutiveTotal||0:null,decisionConsecutive:cdrFresh?evidence?.consecutiveTotal||0:null,eligible:evidence?.eligibleCount||0,records:(routed?cdr?.records||[]:[]).slice(0,3).map(({time,sipCode,setupTime,duration})=>({time,sipCode,setupTime,duration}))}};
      })}];
    }))};
  }
  function start(){if(!enabled||timer)return;stopped=false;const tick=()=>{for(const group of Object.keys(GROUPS)){pollTraffic(group);pollCdr(group);}};tick();timer=setInterval(tick,1000);timer.unref?.();}
  function reset(){epoch++;for(const child of workers)child.kill();for(const state of Object.values(groups)){state.traffic=null;state.cdr={};if(!state.authBlocked){state.error=null;state.retryAt=0;}}}
  function stop(){stopped=true;clearInterval(timer);timer=null;}
  return {snapshot,start,stop,step,pollTraffic,pollCdr,reset};
}
module.exports={createLiveMonitor};
