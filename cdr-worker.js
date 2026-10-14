/* CDR reads run outside the mutation queue; only evidence updates are queued. */
const cdrJobs=new Map();
async function openSipsTabWithRole(group,role){
  const tabs=await chrome.tabs.query({url:`http://10.10.${group}/*`});
  const matches=[];
  for(const t of tabs)if(t.id!=null)try{
    const r=await chrome.tabs.sendMessage(t.id,{type:'OPENSIPS_PAGE_ROLE'});
    if(r?.ok&&r.role===role&&r.group===group)matches.push(t.id);
  }catch(_){}
  if(matches.length!==1)throw Error(`Cần mở đúng một tab ${role==='CDR'?'CDR Viewer':'Load Balancer'} trên 10.10.${group} (đã thấy ${matches.length}).`);
  return matches[0];
}
async function queryCdr(group,fs,ip){
  // A logged-in OpenSIPS tab can fetch CDR directly, regardless of visible tool.
  const tabs=await chrome.tabs.query({url:`http://10.10.${group}/*`});
  const available=[];
  await Promise.allSettled(tabs.filter(t=>t.id!=null&&t.status!=='loading').map(async t=>{
    const role=await chrome.tabs.sendMessage(t.id,{type:'OPENSIPS_PAGE_ROLE'});
    if(role?.ok&&role.group===group)available.push({id:t.id,role:role.role});
  }));
  available.sort((a,b)=>a.id-b.id);
  const tab=(available.find(t=>t.role==='CDR')||available[0])?.id;
  if(tab==null)throw Error('Mở một tab OpenSIPS đã đăng nhập trên 10.10.'+group);
  const r=await chrome.tabs.sendMessage(tab,{type:'CDR_CHECK_FS',group,fs,ip});
  if(!r?.ok||r.group!==group||r.ip!==ip||!Array.isArray(r.records))throw Error(r?.error||'CDR trả kết quả không đúng nhóm/IP.');
  return r.records;
}
function cdrAfter(f,now){return Math.max(now-30000,(f.incident?.startedAt||f.startedAt||now)-5000,f.lastIncident?.switchedAt||0,f.incident?.switchedAt||0);}
function scheduleCdrChecks(state,feature){
  if(!state.config.cdrObservationEnabled&&!state.config.cdrVerificationEnabled)return;
  for(const group of ['99.153','99.155']){
    if(cdrJobs.has(group))continue;
    const candidates=Object.values(state.fsStates).filter(f=>f.group===group&&Cdr.IPS[f.fs]===f.ip&&Detection.isFsActive(state,f,Date.now())&&Date.now()-f.updatedAt<=state.config.staleMs);
    const fresh=candidates.filter(f=>Date.now()-(f.cdr?.checkedAt||0)>=2000)
      .sort((a,b)=>(a.cdr?.checkedAt||0)-(b.cdr?.checkedAt||0)||a.fs.localeCompare(b.fs));
    if(!fresh.length)continue;
    let batch=Promise.resolve(),evidenceUpdates=[];
    for(const f of fresh){
    const profile=group==='99.153'?'COLLECTION':'TELESALE';
    const active=(state.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
    if(active.length!==1&&!state.config.cdrObservationEnabled)continue;
    const request={key:f.key,incidentId:f.incident?.id||f.candidateId,group,fs:f.fs,ip:f.ip,phone:active[0]?.phone,observation:state.config.cdrObservationEnabled,after:state.config.cdrObservationEnabled?Date.now()-30000:cdrAfter(f,Date.now())};
    cdrJobs.set(group,request);f.cdrStatus='Đang Search CDR';
    batch=batch.then(()=>queryCdr(group,f.fs,f.ip)).then(records=>({records}),e=>({error:String(e.message||e)})).then(result=>{
      const receivedAt=Date.now();
      messageQueue=messageQueue.then(async()=>{
        const latest=await getState(),current=latest.fsStates[request.key];
        if(!current||!Detection.isFsActive(latest,current,Date.now())||!request.observation&&(current.incident?.id||current.candidateId||current.lastIncident?.id)!==request.incidentId)return;
        const checkedAt=receivedAt,proof=result.error?{locked:false,count:0,reason:result.error}:
          Cdr.evaluate(result.records,{ip:request.ip,after:request.after,now:checkedAt,observation:request.observation,usedCallIds:request.observation?[]:current.cdrUsedCallIds});
        const decision=result.error?{error:result.error,locked:false,count:0,eligibleCount:0}:
          Cdr.evaluate(result.records,{ip:request.ip,after:Math.max(checkedAt-30000,current.incident?.switchedAt||current.lastIncident?.switchedAt||0,current.cdrEnabledAt||0),now:checkedAt,usedCallIds:current.cdrUsedCallIds});
        Object.assign(decision,{phone:request.phone,group,ip:request.ip,checkedAt,incidentId:current.incident?.id});
        const records=(result.records||[]).filter(r=>r.ip===request.ip);
        const traffic=Cdr.measureTraffic(records,current.cdr?.traffic,{ip:request.ip,now:checkedAt});
        let lastConfirmed=current.cdr?.lastConfirmed;
        if(lastConfirmed?.phone&&request.phone&&lastConfirmed.phone!==request.phone)lastConfirmed=null;
        if(proof.locked&&proof.callIds?.join('|')!==lastConfirmed?.callIds?.join('|'))
          lastConfirmed={at:checkedAt,count:proof.consecutiveTotal,callIds:proof.callIds,phone:request.phone};
        if(lastConfirmed&&!result.error&&!proof.locked&&records.length){
          const clearingChecks=(lastConfirmed.clearingChecks||0)+1;
          lastConfirmed={...lastConfirmed,clearingChecks,firstClearAt:lastConfirmed.firstClearAt||checkedAt};
          if(clearingChecks>=2&&checkedAt-lastConfirmed.firstClearAt>=3000)
            lastConfirmed.clearedAt=checkedAt;
        }else if(proof.locked&&lastConfirmed){
          lastConfirmed={...lastConfirmed,clearingChecks:0,firstClearAt:null,clearedAt:null};
        }
        current.cdr={...proof,decision,lastConfirmed,traffic,records,receivedCalls:records.length,lastCall:records[0]||null,group,ip:request.ip,phone:request.phone,incidentId:request.incidentId,checkedAt};
        current.cdrStatus=proof.reason;
        if(!result.error&&latest.monitoringEnabled&&!Detection.pausedFor(latest,group)){
          const activeNow=(latest.freeswitch?.numbers||[]).filter(n=>n.fs===request.fs&&n.profile===profile&&n.status==='ACTIVE');
          const special=activeNow.length===1&&activeNow[0].phone===request.phone?Cdr.specialWarning(result.records,{ip:request.ip,now:checkedAt,after:Math.max(current.cdrEnabledAt||0,current.incident?.switchedAt||current.lastIncident?.switchedAt||0)}):null;
          latest.cdrWarnings=(latest.cdrWarnings||[]).filter(w=>w.at>Date.now()-3*86400000);
          if(special){
            const episode=`${special.pattern}|${request.phone}`;
            const duplicate=latest.cdrWarnings.some(w=>w.fs===request.fs&&w.group===group&&w.phone===request.phone&&w.callIds?.join('|')===special.callIds.join('|'));
            if(current.cdrSpecialEpisode!==episode&&!duplicate)
              latest.cdrWarnings.unshift({...special,at:checkedAt,group,fs:request.fs,ip:request.ip,phone:request.phone});
            current.cdrSpecialEpisode=episode;
          }else if(result.records?.length)current.cdrSpecialEpisode=null;
        }

        Detection.refreshAlerts(latest,checkedAt);
        await saveState(latest);
        // Observation results never trigger a status write.
        if(latest.config.cdrVerificationEnabled&&!current.incident?.locked&&current.state==='SUSPECTED')await autoBlockNewAlerts(latest);await saveState(latest);
      }).catch(()=>{});
      // Continue Search on the next FS while a queued FreeSWITCH write waits.
      evidenceUpdates.push(messageQueue);
    });
    }
    batch.finally(async()=>{await Promise.allSettled(evidenceUpdates);cdrJobs.delete(group);});
  }
}
