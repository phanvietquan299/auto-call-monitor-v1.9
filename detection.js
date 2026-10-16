/* Shared by the extension worker and the deterministic Node simulations. */
(function(root){
  const CONFIG={sampleIntervalMs:1000,opensipsReloadMs:30000,baselineSamples:20,recentSamples:5,historySamples:120,
    cdrObservationEnabled:true,cdrVerificationEnabled:false,groupObserveMs:9000,activeVtMin:10,watchRatio:0.70,warningRatio:0.50,suspectRatio:0.35,
    healthyRatio:0.85,grafanaBaselineSamples:20,grafanaRecentSamples:3,
    staleMs:45000,sampleGapMs:75000,maxCollapseMs:120000,minLowSamples:3,suspectWindows:3,
    freeSwitchActionGapMs:3000,freeSwitchAutomaticGapMs:3000,autoValidationRetryMs:15000,maxAutoValidationRetries:3,autoCooldownMs:180000,recoverySamples:12,recoveryMinVt:10,
    collectionRecoveryTrafficFloor:11,collectionCooldownMs:30000,collectionRecoverySamples:8,collectionRecoveryStableMs:10000,
    saleCooldownMs:30000,saleRecoverySamples:8,saleRecoveryStableMs:20000,
    saleRecoveryMinVt:0,saleRecoveryTrafficFloor:4,saleRecoveryRangeFloor:2,
    recoveryRangeRatio:0.35,recoveryTrafficFloor:50,recoveryStableMs:60000,recoveryDelayedMs:300000,backupBlockWaitMs:5000,rotationBackupGraceMs:30000,slowBaselineStableMs:60000,
    workdayStartMinute:480,collectionDayEndMinute:1080,saleDayEndMinute:1020,collectionPauseStartMinute:730,scheduledPauseStartMinute:700,scheduledHandoffMinute:700,scheduledPauseEndMinute:780};
  const median=values=>{const a=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);const i=Math.floor(a.length/2);return a.length?(a.length%2?a[i]:(a[i-1]+a[i])/2):null;};
  const keyOf=a=>`${a.group}|${a.fs}|${a.ip}`;
  function event(s,type,f,now,detail){
    const id=f.incident?.id||f.candidateId||f.key;
    const key=`${id}|${type}`;
    s.eventKeys=s.eventKeys||{};
    if(s.eventKeys[key])return;
    s.eventKeys[key]=now;
    s.events.unshift({type,at:now,group:f.group,fs:f.fs,ip:f.ip,incidentId:f.incident?.id||f.candidateId,
      phone:f.incident?.oldPhone,isBackup:!!f.incident?.isBackup,baselineVt:f.baseline,recentMedian:f.recentMedian,dropPercent:f.dropPercent,detail});
    s.events=s.events.filter(e=>e.at>now-3*86400000);
    // Keep audit identities separate from the visible event buffer.
  }
  function transition(s,f,next,now,detail){if(f.state!==next){f.state=next;event(s,next,f,now,detail);}}
  // Vietnam uses UTC+7 throughout the year, independent of the host timezone.
  function scheduleAt(now,c=CONFIG,group='99.155'){
    const local=new Date(now+7*60*60*1000),minute=local.getUTCHours()*60+local.getUTCMinutes();
    const date=local.toISOString().slice(0,10);
    const start=group==='99.153'?c.collectionPauseStartMinute:c.scheduledPauseStartMinute;
    const eveningEnd=group==='99.153'?(c.collectionDayEndMinute??1080):(c.saleDayEndMinute??1020);
    const earlyMorning=minute<(c.workdayStartMinute??480);
    const dayEnd=earlyMorning||minute>=eveningEnd;
    const nightDate=earlyMorning?new Date(local.getTime()-86400000).toISOString().slice(0,10):date;
    return {paused:dayEnd||minute>=start&&minute<c.scheduledPauseEndMinute,
      startAt:dayEnd?(group==='99.153'?'18:00':'17:00'):group==='99.153'?'12:10':'11:40',
      endAt:dayEnd?'08:00':'13:00',
      phase:dayEnd?'DAY_END':group==='99.155'&&minute>=c.scheduledHandoffMinute?'HANDOFF':'LUNCH',
      cycle:dayEnd?`${nightDate}|DAY_END`:`${date}|${minute>=c.scheduledPauseEndMinute?'AFTER':'BEFORE'}`,
      pauseId:`${dayEnd?nightDate:date}|${dayEnd?'DAY_END':'LUNCH'}`};
  }
  const pausedFor=(s,group)=>!!s.schedule?.groups?.[group]?.paused;
  function isFsActive(s,f,now){
    const expected=f.group==='99.153'?2:3;
    return !s.fsTestExclusions?.[`${f.group}|${f.fs}`]&&f.groupId===expected&&Number.isFinite(f.groupIdAt)&&now-f.groupIdAt<=s.config.staleMs;
  }
  function applySchedule(s,now){
    const c={...CONFIG,...s.config},groups={};
    for(const group of ['99.153','99.155']){
      const current=scheduleAt(now,c,group),previous=s.schedule?.groups?.[group];
      const entering=current.paused&&(!previous?.paused||previous.pauseId!==current.pauseId);
      const resuming=!current.paused&&(previous?.paused||previous&&previous.cycle!==current.cycle);
      for(const f of Object.values(s.fsStates||{})){
        if(f.group!==group)continue;
        const missed=!previous&&!current.paused&&f.updatedAt&&scheduleAt(f.updatedAt,c,group).cycle!==current.cycle;
        if(!entering&&!resuming&&!missed)continue;
        if(f.incident?.locked||f.incident?.autoExecuted||['COOLDOWN','RECOVERING'].includes(f.state)){
          f.history=[];if(f.incident)f.incident.stableSince=null;
        }else resetBaseline(s,f,now,current.paused?'Scheduled lunch/handoff: detection paused':'Schedule ended: learning a fresh baseline');
      }
      groups[group]={...current,resumeAt:current.endAt};
    }
    s.schedule={groups,timezone:'Asia/Ho_Chi_Minh'};
    s.alerts=(s.alerts||[]).filter(a=>!pausedFor(s,a.group));
    s.pendingAutoActions=(s.pendingAutoActions||[]).filter(a=>!pausedFor(s,a.group));
  }
  function grafana(s,group,value,now){
    if(!Number.isFinite(value)||value<0)return;
    const c=s.config,g=s.grafana[group];
    g.history=[...(g.history||[]),value].slice(-c.historySamples);g.value=value;g.updatedAt=now;
    const frozen=Object.values(s.fsStates||{}).some(f=>f.group===group&&f.candidateId);
    if(!frozen){g.healthyHistory=[...(g.healthyHistory||[]),value].slice(-c.grafanaBaselineSamples);
      if(g.healthyHistory.length>=c.grafanaBaselineSamples)g.baseline=median(g.healthyHistory);}
  }
  function recoveryPolicy(group,c){
    return group==='99.153'?{
      cooldownMs:c.collectionCooldownMs??30000,samples:c.collectionRecoverySamples??8,stableMs:c.collectionRecoveryStableMs??10000
    }:{cooldownMs:c.saleCooldownMs??30000,samples:c.saleRecoverySamples??8,stableMs:c.saleRecoveryStableMs??20000};
  }
  // Derived from persisted rotation operations, independently for each group.
  function rotationBarriers(feature){
    const result={};
    for(const op of [feature?.operation,...(feature?.history||[])].filter(Boolean)){
      const group=op.plan?.group||op.group;
      if(!group||!['RUNNING','FAILED','DONE','ACKNOWLEDGED'].includes(op.status))continue;
      if(result[group]&&(result[group].startedAt||0)>=(op.startedAt||0))continue;
      result[group]={startedAt:op.startedAt,status:op.status,routingVerified:op.status==='DONE'&&op.stage==='ROUTING_VERIFIED',
        finishedAt:op.status==='ACKNOWLEDGED'?op.acknowledgedAt:op.finishedAt};
    }
    return result;
  }
  function backupAssessment(s,f,now){
    const b=s.rotationBarriers?.[f.group];
    if(!b)return {waiting:false,after:0};
    if(['RUNNING','FAILED'].includes(b.status))return {waiting:true,after:Infinity};
    const after=(b.finishedAt||0)+(s.config.rotationBackupGraceMs??30000);
    const samples=recoveryPolicy(f.group,s.config).samples;
    return {after,waiting:now<after||f.history.filter(x=>x.time>after).length<samples};
  }
  function backupReady(s,f,now){
    if(!f.incident?.isBackup)return true;
    if(cdrPrimary(s)){const b=s.rotationBarriers?.[f.group];return !b||b.routingVerified||!['RUNNING','FAILED'].includes(b.status)&&now>=(b.finishedAt||0)+(s.config.rotationBackupGraceMs??30000);}
    const a=backupAssessment(s,f,now);
    if(a.waiting)return false;
    if(!a.after)return true;
    const values=f.history.filter(x=>x.time>a.after).slice(-recoveryPolicy(f.group,s.config).samples).map(x=>x.vt);
    // A queued backup must still be falling after the group has settled.
    return values.every(v=>v<=f.baseline*s.config.suspectRatio)&&
      median(values.slice(-4))<=median(values.slice(0,4))&&!recoveryStable(s,f,values);
  }
  function recoveryStable(s,f,values){
    const c=s.config,sale=f.group==='99.155',m=median(values);
    return values.length===recoveryPolicy(f.group,c).samples&&
      Math.min(...values)>(sale?c.saleRecoveryMinVt:c.recoveryMinVt)&&
      m>=(sale?c.saleRecoveryTrafficFloor:(c.collectionRecoveryTrafficFloor??11))&&
      Math.max(...values)-Math.min(...values)<=Math.max(sale?c.saleRecoveryRangeFloor:0,m*c.recoveryRangeRatio)&&
      median(values.slice(-4))>=median(values.slice(0,4))*0.85;
  }
  const groupScope={'99.153':['FS01','FS02','FS03','FS04'],'99.155':['FS05','FS06','FS07']};
  function groupMembers(s,group,now){return Object.values(s.fsStates||{}).filter(f=>
    f.group===group&&groupScope[group]?.includes(f.fs)&&isFsActive(s,f,now)&&now-f.updatedAt<=s.config.staleMs);}
  function groupRebounding(s,f,now){
    const trial=s.groupTrials?.[f.group],before=trial?.peers?.[f.key];
    if(!trial||before==null||now<trial.until||now-trial.completedAt>s.config.maxCollapseMs)return false;
    const values=f.history.filter(x=>x.time>trial.completedAt).map(x=>x.vt);
    const floor=f.group==='99.155'?s.config.saleRecoveryTrafficFloor:(s.config.collectionRecoveryTrafficFloor??11);
    return values.length>=2&&f.currentVt>before&&Math.min(...values.slice(-2))>=floor&&
      Math.min(...values.slice(-2))>before&&
      f.currentVt>=Math.max(...values.slice(-4))*0.85&&
      (values.length<4||median(values.slice(-2))>=median(values.slice(-4,-2))*0.95);
  }
  function preBlockRebounding(s,f){
    if(f.incident?.locked||f.incident?.isBackup||!f.baseline)return false;
    const recent=(f.history||[]).slice(-6);
    let start=0;for(let i=0;i<recent.length;i++)if(recent[i].vt>f.baseline*s.config.suspectRatio)start=i+1;
    const points=recent.slice(start);
    if(points.length<4||points.at(-1).time-points[0].time<3*s.config.sampleIntervalMs)return false;
    const v=points.map(x=>x.vt),half=Math.floor(v.length/2),early=median(v.slice(0,half)),late=median(v.slice(-half));
    // Multiple fresh points, net growth, and no renewed collapse at the tail.
    return early>0&&late-early>=Math.max(2,early*0.05)&&v.at(-1)>=late&&
      median(v.slice(-2))>=median(v.slice(-4,-2))*0.95;
  }
  const cdrPrimary=s=>s.config?.detectionSource==='CDR';
  function cdrVtDrop(s,f,now){
    return !s.config?.cdrRequireVtDrop||(Number.isFinite(f.baseline)&&f.baseline>0&&Number.isFinite(f.currentVt)&&
      now-f.updatedAt>=0&&now-f.updatedAt<=s.config.staleMs&&f.currentVt<=f.baseline*s.config.suspectRatio);
  }
  function activationBlockReady(s,f,now){
    const at=f.activatedAt,initial=f.activationInitialVt,e=f.cdr?.decision;
    if(!s.config?.cdrRequireVtDrop||!at||(f.lastIncident?.switchedAt||f.incident?.switchedAt||0)>=at||now-at<0||now-at>120000||!Number.isFinite(initial)||
      !Number.isFinite(f.currentVt)||now-f.updatedAt<0||now-f.updatedAt>s.config.staleMs||!e?.locked||e.error||
      e.checkedAt<at||e.newestCallTime<=at)return false;
    const points=(f.history||[]).filter(x=>x.time>=at+1000);
    return points.length>=1&&f.currentVt<=initial&&median(points.slice(-3).map(x=>x.vt))<=initial;
  }
  function hybridVtReady(s,f,now){
    return cdrVtDrop(s,f,now)||activationBlockReady(s,f,now)||!!(f.incident?.isBackup&&f.incident.noVtGrowth&&
      Number.isFinite(f.currentVt)&&f.currentVt<=f.incident.vtAtSwap&&now-f.updatedAt<=s.config.staleMs);
  }
  function relearnHybridBaseline(s,f,now){
    const c=s.config,e=f.cdr?.decision;
    f.baselineRelearnNote=null;
    if(!c.cdrRequireVtDrop||!f.baseline||!f.vtDeclineAt)return;
    if(f.incident){f.baselineRelearnNote='Giữ baseline khi sự cố đang chờ xử lý/phục hồi';return;}
    if(!e||e.error||!e.eligibleCount||now-e.checkedAt<0||now-e.checkedAt>15000){f.baselineRelearnNote='Chưa học lại: cần CDR mới đọc được';return;}
    if(e.locked||pairedCdrProof(s,f,now)){f.baselineRelearnNote='Giữ baseline: CDR đang có bằng chứng 5/5';return;}
    const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    const active=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
    if(active.length!==1||active[0].phone!==e.phone){f.baselineRelearnNote='Chưa học lại: cần CDR đúng số ACTIVE';return;}
    const wait=Math.max(0,c.maxCollapseMs-(now-f.vtDeclineAt));
    if(now-f.vtDeclineAt<=c.maxCollapseMs){f.baselineRelearnNote=`Học lại mức thấp điểm sau ${Math.ceil(wait/1000)}s nếu VT ổn định và CDR không lỗi`;return;}
    const points=f.history.filter(x=>x.time>=now-c.slowBaselineStableMs),values=points.map(x=>x.vt),m=median(values);
    if(points.length<c.baselineSamples||points[0].time>now-c.slowBaselineStableMs+c.sampleIntervalMs){f.baselineRelearnNote='Chờ đủ cửa sổ VT ổn định 60s để học lại';return;}
    if(Math.min(...values)<=c.activeVtMin){f.baselineRelearnNote='Giữ baseline: VT quá thấp, chưa xác nhận mức thấp điểm';return;}
    if(Math.max(...values)-Math.min(...values)>m*c.recoveryRangeRatio){f.baselineRelearnNote='Chờ VT bớt dao động để học lại baseline';return;}
    f.baseline=m;f.baselineVt=m;f.healthyHistory=values.slice(-c.baselineSamples);f.vtDeclineAt=null;f.vtDropAt=null;f.pairedCdrProof=null;
    f.baselineRelearnNote='Đã học lại baseline theo mức VT thấp ổn định';
    f.detectionNote='VT thấp ổn định và CDR không xác nhận block; đã học lại baseline thấp điểm';
  }
  function hybridObservationState(s,f,now,e){
    if(!s.config?.cdrRequireVtDrop)return e?'HEALTHY':'WAITING_CDR';
    if(!Number.isFinite(f.currentVt)||now-f.updatedAt<0||now-f.updatedAt>s.config.staleMs){f.detectionNote='Chờ VT mới; chưa đánh giá kết hợp';return 'WAITING_VT';}
    if(!Number.isFinite(f.baseline)||f.baseline<=0){f.detectionNote='Đang học baseline VT trước khi đánh giá kết hợp';return 'LEARNING';}
    const ratio=f.currentVt/f.baseline;
    if(ratio<=s.config.warningRatio){f.detectionNote=e?'VT giảm mạnh; CDR chưa đủ 5/5 để kết luận nghi block':'VT giảm mạnh; chờ CDR mới để xác minh';return 'WARNING';}
    if(e?.locked){f.detectionNote='CDR đã đủ 5/5 nhưng VT chưa tới ngưỡng; tiếp tục theo dõi';return 'WARNING';}
    if(ratio<=s.config.watchRatio){f.detectionNote='VT đang giảm; theo dõi kết hợp CDR';return 'WATCHING';}
    if(!e){f.detectionNote='VT chưa giảm mạnh; chờ CDR mới để xác minh';return 'WAITING_CDR';}
    f.detectionNote=null;return 'HEALTHY';
  }
  function pairedCdrProof(s,f,now){
    const e=f.pairedCdrProof;
    if(!s.config?.cdrRequireVtDrop||!e||now-e.checkedAt<0||now-e.checkedAt>15000||e.checkedAt<(f.cdrEnabledAt||0)||e.newestCallTime<=(f.incident?.switchedAt||f.lastIncident?.switchedAt||0)||
      !Number.isFinite(f.baseline)||f.currentVt>=f.baseline*s.config.healthyRatio||!isFsActive(s,f,now))return null;
    const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    const active=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
    return active.length===1&&active[0].phone===e.phone&&e.group===f.group&&e.ip===f.ip?e:null;
  }
  function manualCdrProof(s,f){
    const i=f.incident,e=i?.manualCdrProof;
    if(!s.config?.cdrRequireVtDrop||s.autoBlockMode!=='MANUAL'||!s.autoEnabled||!s.monitoringEnabled||!e||i.locked||i.cancelled||i.autoExecuted||i.manualExecuted)return null;
    const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    const active=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
    return e.incidentId===i.id&&e.group===f.group&&e.ip===f.ip&&active.length===1&&e.phone===active[0].phone?e:null;
  }
  function updateCdrStates(s,now){
    if(!cdrPrimary(s))return;
    for(const f of Object.values(s.fsStates||{})){
      if(!isFsActive(s,f,now)||pausedFor(s,f.group)||!s.monitoringEnabled)continue;
      if(f.incident?.actionPending||f.incident?.actionUncertain)continue;
      let e=f.cdr?.decision;
      const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
      const active=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
      const fresh=e&&!e.error&&now-e.checkedAt>=0&&now-e.checkedAt<=15000&&active.length===1&&e.phone===active[0].phone;
      if(s.config.cdrRequireVtDrop){
        if(!pairedCdrProof(s,f,now))f.pairedCdrProof=null;
        if(fresh&&e.locked&&e.count===5&&f.vtDeclineAt&&e.checkedAt>=f.vtDeclineAt&&
          f.currentVt<f.baseline*s.config.healthyRatio&&e.checkedAt>=(f.cdrEnabledAt||0))
          f.pairedCdrProof={...e,callIds:[...(e.callIds||[])]};
        e=pairedCdrProof(s,f,now)||e;
      }
      if(f.incident?.manualCdrProof&&!f.incident.locked&&!f.incident.cancelled){
        if(manualCdrProof(s,f)){f.state='SUSPECTED';continue;}
        f.lastIncident={...f.incident,closed:true,closedAt:now};f.incident=null;f.candidateId=null;
      }
      if((!fresh&&!pairedCdrProof(s,f,now))||!e.eligibleCount){if(!f.incident?.locked){f.state=hybridObservationState(s,f,now,null);if(f.incident)f.incident.cdrConfirmationReads=0;}continue;}
      const handled=f.incident?.autoExecuted||f.incident?.manualExecuted;
      if(handled){
        const i=f.incident;
        if(e.newestCallTime<=i.switchedAt){f.state='RECOVERING';continue;}
        if(!e.locked&&s.config.cdrRequireVtDrop&&Number.isFinite(i.vtAtSwap)&&f.currentVt<=i.vtAtSwap){f.state='RECOVERING';continue;}
        if(!e.locked){f.lastIncident={...i,closed:true,closedAt:now};f.incident=null;f.candidateId=null;f.state='HEALTHY';if(s.config.cdrRequireVtDrop){f.baseline=null;f.baselineVt=null;f.healthyHistory=[];f.vtDropAt=null;}continue;}
        f.state='RECOVERING';
        if(i.isBackup||now-i.switchedAt<(s.config.backupBlockWaitMs??5000))continue;
        if(s.config.cdrRequireVtDrop){
          const values=(f.history||[]).filter(x=>x.time>i.switchedAt).slice(-3).map(x=>x.vt);
          if(!Number.isFinite(i.vtAtSwap)||values.length<2||f.currentVt>i.vtAtSwap||median(values)>i.vtAtSwap)continue;
        }
        f.lastIncident=i;f.incident=null;
        f.cdrBackup={noVtGrowth:true,vtAtSwap:i.vtAtSwap,previousPhone:i.oldPhone,attemptedPhones:[...(i.attemptedPhones||[]),i.oldPhone]};
      }
      const activation=activationBlockReady(s,f,now),backupNoGrowth=f.cdrBackup?.noVtGrowth;
      if(e.locked&&(hybridVtReady(s,f,now)||backupNoGrowth)&&(!s.config.cdrRequireVtDrop||activation||backupNoGrowth||(pairedCdrProof(s,f,now)||e.checkedAt>=(f.vtDropAt||0)))){
        if(f.incident?.cancelled&&f.incident.rejectedCdrCalls===e.callIds?.join('|')){f.state='WARNING';continue;}
        if(!f.incident||f.incident.cancelled){
          const backup=f.cdrBackup;
          f.incident={id:`${f.group}-${f.fs}-cdr-${now}`,startedAt:now,oldPhone:e.phone,locked:false,autoExecuted:false,actionCount:0,
            activationRecovery:activation,...(backup?{isBackup:true,noVtGrowth:backup.noVtGrowth,vtAtSwap:backup.vtAtSwap,previousPhone:backup.previousPhone,attemptedPhones:backup.attemptedPhones}:{})};
          f.cdrBackup=null;f.candidateId=f.incident.id;f.startedAt=now;f.autoValidationFailures=0;f.autoRetryAfter=null;
        }
        const i=f.incident;
        // Only a new Search response counts; dashboard/VT refreshes reuse checkedAt.
        if(i.cdrLastConfirmationAt!==e.checkedAt){
          i.cdrConfirmationReads=Math.min(2,(i.cdrConfirmationReads||0)+1);
          i.cdrLastConfirmationAt=e.checkedAt;
        }
        e.incidentId=i.id;f.cdr.incidentId=i.id;f.activeBeforeIncident=true;f.state='SUSPECTED';f.detectionNote='VT đã tới ngưỡng và CDR đủ 5/5; nghi block được xác nhận bởi cả hai tín hiệu';
        if(s.config.cdrRequireVtDrop&&s.autoBlockMode==='MANUAL'&&s.autoEnabled&&(now-e.checkedAt<=10000||pairedCdrProof(s,f,now)))i.manualCdrProof={...e,callIds:[...(e.callIds||[])]};
      }else{
        if(f.incident&&!f.incident.locked){f.lastIncident={...f.incident,cancelled:true,closed:true,closedAt:now};f.incident=null;f.candidateId=null;}
        if(!f.incident?.locked)f.state=hybridObservationState(s,f,now,e);
      }
    }
  }
  function cdrGate(s,f,now){
    if(!cdrPrimary(s)&&s.config?.cdrVerificationEnabled!==true)return {ready:true};
    const held=cdrPrimary(s)?manualCdrProof(s,f):null;
    const paired=cdrPrimary(s)?pairedCdrProof(s,f,now):null;
    const e=held||paired||(cdrPrimary(s)?f.cdr?.decision:f.cdr),profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    const active=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
    const confirmed=!cdrPrimary(s)||s.config?.cdrRequireVtDrop||(f.incident?.cdrConfirmationReads||0)>=2;
    if(cdrPrimary(s)&&!held&&!hybridVtReady(s,f,now))return {ready:false,reason:'Chờ VT tụt theo baseline và CDR đủ 5/5'};
    const ready=!!(confirmed&&(held||activationBlockReady(s,f,now)||f.incident?.noVtGrowth||!s.config?.cdrRequireVtDrop||(paired||e?.checkedAt>=(f.vtDropAt||0)))&&e?.locked&&!e.observation&&e.count===5&&e.incidentId===f.incident?.id&&e.group===f.group&&e.ip===f.ip&&
      (held||paired||now-e.checkedAt>=0&&now-e.checkedAt<=10000)&&active.length===1&&e.phone===active[0].phone);
    if(!confirmed)return {ready:false,reason:'SUSPECTED: chờ lượt đọc CDR kế tiếp vẫn đủ 5 cuộc liên tiếp'};
    return {ready,reason:held&&ready?'Đã ghi nhận CDR 5/5; chờ bạn xác nhận khi VT vẫn thấp':ready?'CDR xác nhận 5 cuộc liên tiếp 480-0-0 / 480-1-0':f.cdrStatus||'Chờ CDR xác nhận 5 cuộc mới nhất liên tiếp 480-0-0 / 480-1-0'};
  }
  function groupCandidates(s,group,now){
    if(cdrPrimary(s))return groupMembers(s,group,now).filter(f=>f.state==='SUSPECTED'&&f.incident&&!f.incident.locked&&!f.incident.cancelled&&!f.incident.autoExecuted&&cdrGate(s,f,now).ready).sort((a,b)=>(s.config.cdrRequireVtDrop?a.currentVt-b.currentVt:0)||(b.cdr?.decision?.consecutiveTotal||0)-(a.cdr?.decision?.consecutiveTotal||0)||a.fs.localeCompare(b.fs));
    return groupMembers(s,group,now).filter(f=>f.state==='SUSPECTED'&&f.incident&&
      !f.rotationError&&!f.incident.isBackup&&!f.incident.locked&&!f.incident.cancelled&&!f.incident.autoExecuted&&
      cdrGate(s,f,now).ready&&f.activeBeforeIncident&&f.currentVt<=f.baseline*s.config.suspectRatio&&f.recentMedian<=f.baseline*s.config.suspectRatio&&!preBlockRebounding(s,f)&&!groupRebounding(s,f,now))
      .sort((a,b)=>{
        const falling=f=>{const v=(f.history||[]).slice(-6).map(x=>x.vt),half=Math.floor(v.length/2);
          return v.length>=4&&median(v.slice(-half))<median(v.slice(0,half));};
        return a.currentVt-b.currentVt||Number(falling(b))-Number(falling(a))||
          (s.fsSwitchEnabled?((s.freeswitch?.numbers||[]).filter(n=>n.fs===a.fs&&n.status==='BACKUP').length-(s.freeswitch?.numbers||[]).filter(n=>n.fs===b.fs&&n.status==='BACKUP').length):0)||
          (a.startedAt||a.incident.startedAt||0)-(b.startedAt||b.incident.startedAt||0)||a.fs.localeCompare(b.fs);
      });
  }
  function groupActionGate(s,f,now){
    const cdr=cdrGate(s,f,now);if(!cdr.ready)return cdr;
    if(cdrPrimary(s))return {ready:true};
    if(preBlockRebounding(s,f))return {ready:false,reason:'VT đang tăng qua nhiều mẫu trước xử lý; tiếp tục theo dõi, chưa đổi số'};
    if(f.state==='SUSPECTED'&&!f.incident?.locked&&Number.isFinite(f.currentVt)&&f.currentVt>f.baseline*s.config.suspectRatio)
      return {ready:false,reason:'VT hiện tại đã vượt ngưỡng nghi block; chờ mẫu mới, chưa đổi số'};
    if(!groupScope[f.group]?.includes(f.fs))return {ready:true};
    const trial=s.groupTrials?.[f.group];
    if(trial){
      if(now<trial.until)return {ready:false,reason:`Chờ đánh giá VT nhóm sau ${trial.fs}: ${Math.ceil((trial.until-now)/1000)}s`};
      if(trial.peers?.[f.key]!=null&&f.history.filter(x=>x.time>trial.completedAt).length<2)
        return {ready:false,reason:'Chờ ít nhất 2 mẫu VT mới sau lượt xử lý nhóm'};
      if(!f.incident?.isBackup&&groupRebounding(s,f,now))
        return {ready:false,reason:'VT đã tăng sau xử lý FS khác; theo dõi hồi phục, chưa đổi số'};
    }
    const candidates=groupCandidates(s,f.group,now);
    if(f.incident?.isBackup&&candidates.length)return {ready:false,reason:'Xử lý FS nghi block chưa đổi số trước lượt BLOCK dự phòng'};
    if(!f.incident?.isBackup&&candidates.length&&candidates[0].key!==f.key)
      return {ready:false,reason:`Ưu tiên ${candidates[0].fs}: VT thấp nhất/xu hướng giảm`};
    return {ready:true};
  }
  function recordGroupAction(s,f,now){
    const members=groupMembers(s,f.group,now);
    if(!groupScope[f.group]?.includes(f.fs)||members.length<2)return;
    s.groupTrials=s.groupTrials||{};
    s.groupTrials[f.group]={fs:f.fs,incidentId:f.incident?.id,completedAt:now,
      until:now+(s.config.groupObserveMs??9000),peers:Object.fromEntries(members.filter(x=>x.key!==f.key).map(x=>[x.key,x.currentVt]))};
  }
  function backupTargetValid(s,f,now){
    const i=f.incident,profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    if(!i?.isBackup)return true;
    const rows=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile);
    const active=rows.filter(n=>n.status==='ACTIVE');
    return now-(s.freeswitch?.updatedAt||0)<=s.config.staleMs&&
      rows.some(n=>n.phone===i.previousPhone&&n.status==='BLOCKED')&&
      active.length===1&&active[0].phone===i.oldPhone&&!(i.attemptedPhones||[]).includes(active[0].phone);
  }
  function prepareBackup(s,f,now,switched,recovery,policy){
    const i=f.incident,c=s.config,assessment=backupAssessment(s,f,now);
    if(assessment.waiting){f.recoveryNote="Đang chờ thay FS hoàn tất và mẫu VT mới sau khi ổn định tải";return false;}
    // Evaluate the replacement's own samples, excluding traffic from the old phone.
    recovery=f.history.filter(x=>x.time>=Math.max(switched,i.backupActiveSince||switched,assessment.after+1)).slice(-policy.samples).map(x=>x.vt);
    const sale=f.group==='99.155',m=median(recovery);
    const stable=recovery.length===policy.samples&&Math.min(...recovery)>(sale?c.saleRecoveryMinVt:c.recoveryMinVt)&&
      m>=(sale?c.saleRecoveryTrafficFloor:(c.collectionRecoveryTrafficFloor??11))&&
      Math.max(...recovery)-Math.min(...recovery)<=Math.max(sale?c.saleRecoveryRangeFloor:0,m*c.recoveryRangeRatio)&&
      median(recovery.slice(-4))>=median(recovery.slice(0,4))*0.85;
    if(stable)return false;
    if(i.isBackup||i.backupUsed||!i.oldPhone||!(i.autoExecuted||i.manualExecuted)||i.actionPending||i.actionUncertain||
      now-switched<(c.backupBlockWaitMs??5000)||recovery.length!==policy.samples||
      !recovery.every(v=>v<=f.baseline*c.suspectRatio)||
      median(recovery.slice(-4))>median(recovery.slice(0,4)))return false;
    const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
    const rows=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile);
    const active=rows.filter(n=>n.status==='ACTIVE');
    if(now-(s.freeswitch?.updatedAt||0)>c.staleMs||active.length!==1||active[0].phone===i.oldPhone||
      !rows.some(n=>n.phone===i.oldPhone&&n.status==='BLOCKED'))return false;
    i.backupUsed=true;f.lastIncident=i;
    f.incident={id:`${i.id}-backup-${now}`,parentIncidentId:i.id,isBackup:true,previousPhone:i.oldPhone,
      attemptedPhones:[i.oldPhone],oldPhone:active[0].phone,baseline:f.baseline,startedAt:now,
      locked:false,autoExecuted:false,actionCount:0};
    f.candidateId=f.incident.id;f.switchedAt=null;f.autoValidationFailures=0;f.autoRetryAfter=null;f.actionError=null;
    f.recoveryNote=null;f.detectionNote='BLOCK dự phòng (lần 2/2): VT chưa hồi phục';
    transition(s,f,'SUSPECTED',now,f.detectionNote);event(s,'BACKUP_REQUIRED',f,now,f.detectionNote);
    return true;
  }
  function sample(s,group,nodes,now){
    applySchedule(s,now);
    const paused=pausedFor(s,group);
    const c=s.config;s.fsStates=s.fsStates||{};
    for(const n of nodes){
      if(n.resource!=='vt'||!n.fs||!Number.isFinite(n.used)||n.used<0)continue;
      const key=keyOf({...n,group});
      const f=s.fsStates[key]||(s.fsStates[key]={key,group,fs:n.fs,ip:n.ip,state:'INACTIVE',history:[],healthyHistory:[],incident:null});
      f.key=key;f.group=group;f.fs=n.fs;f.ip=n.ip;
      const oldGroup=f.groupId;
      f.groupId=Number.isInteger(n.groupId)?n.groupId:null;f.groupIdAt=now;
      const expected=group==='99.153'?2:3;
      if(f.groupId===expected&&oldGroup!=null&&oldGroup!==expected){f.activatedAt=now;f.activationInitialVt=n.used;f.cdrEnabledAt=now;}
      else if(f.groupId!==expected){f.activatedAt=null;f.activationInitialVt=null;}
      if(f.groupId!==null&&f.groupId!==expected){
        if(f.state!=='INACTIVE'||f.incident||f.baseline!=null){
          if(f.incident){f.incident.cancelled=true;f.incident.closeReason='OpenSIPS Group ID disabled';}
          resetBaseline(s,f,now,'FS đã tắt trên OpenSIPS; bỏ qua VT còn treo');
        }
      }else if(f.groupId===expected&&oldGroup!=null&&oldGroup!==expected){
        resetBaseline(s,f,now,'FS bật lại trên OpenSIPS; chờ dữ liệu mới');f.cdrEnabledAt=now;
      }

      if(f.updatedAt&&now-f.updatedAt>c.sampleGapMs){f.history=[];f.severeWindows=0;f.healthyHistory=[];if(f.incident)f.incident.stableSince=null;}
      f.history=[...(f.history||[]),{time:now,vt:n.used}].slice(-c.historySamples);f.currentVt=n.used;f.updatedAt=now;
      const recent=f.history.slice(-c.recentSamples).map(x=>x.vt);
      f.recentMedian=median(recent);f.baselineVt=f.baseline;
      f.dropPercent=f.baseline>0?Math.round((1-f.recentMedian/f.baseline)*100):null;
      if(cdrPrimary(s)){
        if(!isFsActive(s,f,now))f.state='INACTIVE';
        else if(!paused&&s.monitoringEnabled&&s.config.cdrRequireVtDrop&&!f.incident){
          // Learn twenty live samples; freeze the old baseline before a collapse.
          if(n.used>c.activeVtMin&&(!f.baseline||n.used>f.baseline*c.watchRatio)){
            f.healthyHistory=[...(f.healthyHistory||[]),n.used].slice(-c.baselineSamples);
            if(f.healthyHistory.length>=c.baselineSamples)f.baseline=median(f.healthyHistory);
          }else if(!f.baseline)f.healthyHistory=[];
          relearnHybridBaseline(s,f,now);
          f.baselineVt=f.baseline;f.dropPercent=f.baseline>0?Math.round((1-n.used/f.baseline)*100):null;
        }
        if(s.config.cdrRequireVtDrop){
          if(f.baseline&&n.used<f.baseline*c.healthyRatio){
            if(!f.vtDeclineAt){
              const lastHigh=f.history.findLastIndex(x=>x.vt>=f.baseline*c.healthyRatio);
              f.vtDeclineAt=f.history[lastHigh+1]?.time||now;
            }
          }
          else {f.vtDeclineAt=null;f.pairedCdrProof=null;f.baselineRelearnNote=null;}
          if(cdrVtDrop(s,f,now))f.vtDropAt=f.vtDropAt||now;else f.vtDropAt=null;
        }
        if(isFsActive(s,f,now)&&!f.incident&&!f.cdr?.decision)f.state='WAITING_CDR';continue;
      }
      if(paused||!s.monitoringEnabled||!isFsActive(s,f,now))continue;
      if(f.incident?.isBackup&&!f.incident.locked&&s.rotationBarriers?.[group]){
        const a=backupAssessment(s,f,now);
        if(a.waiting){f.recoveryNote='Chờ nhóm thay FS xong và ổn định tải trước khi BLOCK dự phòng';continue;}
        const values=f.history.filter(x=>x.time>a.after).slice(-recoveryPolicy(group,c).samples).map(x=>x.vt);
        if(recoveryStable(s,f,values)){
          f.incident.cancelled=true;f.incident.closed=true;f.incident.closedAt=now;f.lastIncident=f.incident;
          f.incident=null;f.candidateId=null;f.baseline=median(values);f.baselineVt=f.baseline;
          f.healthyHistory=values;f.severeWindows=0;f.recoveryNote=null;
          transition(s,f,'HEALTHY',now,'Recovered after FS rotation; backup cancelled');continue;
        }
      }
      if(['SUSPECTED','WATCHING','WARNING'].includes(f.state)&&!f.incident?.locked&&!f.incident?.isBackup&&groupRebounding(s,f,now)){
        const trial=s.groupTrials[group],count=Math.max(recoveryPolicy(group,c).samples,Math.ceil(c.groupObserveMs/c.sampleIntervalMs)+1),
          points=f.history.filter(x=>x.time>trial.completedAt).slice(-count),values=points.map(x=>x.vt);
        if(recoveryStable(s,f,values.slice(-recoveryPolicy(group,c).samples))&&points.at(-1).time-points[0].time>=c.groupObserveMs&&
          median(values.slice(-4))>=median(values.slice(0,4))*0.95){
          if(f.incident){f.incident.cancelled=true;f.incident.closed=true;f.incident.closedAt=now;f.incident.closeReason='Group VT recovered after another FS action';
            f.lastIncident=f.incident;}f.incident=null;f.candidateId=null;f.severeWindows=0;
          f.baseline=median(values);f.baselineVt=f.baseline;f.healthyHistory=values;
          transition(s,f,'HEALTHY',now,'VT nhóm hồi phục; không đổi số FS này');continue;
        }
      }
      if(f.incident?.locked&&f.state==='SUSPECTED')continue;
      if(f.incident?.locked || ['COOLDOWN','RECOVERING'].includes(f.state)){
        // Preserve locks even at zero VT, on missing nodes, and across restarts.
        if(!f.incident){f.incident={id:`${group}-${n.fs}-${now}`,locked:true,autoExecuted:true};}
        f.incident.locked=true;
        const policy=recoveryPolicy(group,c);
        const switched=f.incident.switchedAt||f.switchedAt||now;
        const assessment=backupAssessment(s,f,now);
        const recoveryPoints=f.history.filter(x=>x.time>Math.max(switched,assessment.after)).slice(-policy.samples);
        const recovery=recoveryPoints.map(x=>x.vt);
        if(f.state==='COOLDOWN'&&now-switched>=policy.cooldownMs)transition(s,f,'RECOVERING',now);
        if(f.state==='RECOVERING'||f.state==='COOLDOWN'){
          const m=median(recovery),sale=group==='99.155';
          const minVt=sale?c.saleRecoveryMinVt:c.recoveryMinVt;
          const floor=sale?c.saleRecoveryTrafficFloor:(c.collectionRecoveryTrafficFloor??11);
          const range=Math.max(sale?c.saleRecoveryRangeFloor:0,m*c.recoveryRangeRatio);
          const stable=!assessment.waiting&&recovery.length===policy.samples&&Math.min(...recovery)>minVt&&
            m>=floor&&
            Math.max(...recovery)-Math.min(...recovery)<=range&&
            median(recovery.slice(-4))>=median(recovery.slice(0,4))*0.85;
          if(stable&&f.state==='RECOVERING'){
            // Require continuous stable windows before allowing a new incident.
            f.incident.stableSince=f.incident.stableSince||now;
          }else f.incident.stableSince=null;
          f.recoveryNote=stable?`Traffic stable; ${Math.max(0,Math.ceil((policy.stableMs-(now-f.incident.stableSince))/1000))}s before new baseline`:
            recovery.length<policy.samples?'Waiting for fresh recovery samples':`Waiting for stable VT; median >= ${floor}, all samples > ${minVt}`;
          if(f.state==='RECOVERING'&&stable&&now-f.incident.stableSince>=policy.stableMs){f.baseline=m;f.baselineVt=m;f.healthyHistory=recovery.slice();
            f.incident.locked=false;f.incident.closed=true;f.incident.closedAt=now;
            transition(s,f,'HEALTHY',now,'Recovered; new baseline learned');f.lastIncident=f.incident;f.incident=null;f.candidateId=null;f.severeWindows=0;f.recoveryNote=null;
          }else if(!stable&&prepareBackup(s,f,now,switched,recovery,policy)){}
          else if(now-switched>=c.recoveryDelayedMs)event(s,'RECOVERY_DELAYED',f,now,'Traffic has not recovered; AUTO remains locked');
        }
        continue;
      }
      if(f.state==='INACTIVE'){
        const sale=group==='99.155',minimum=sale?c.saleRecoveryMinVt:c.activeVtMin;
        const floor=sale?c.saleRecoveryTrafficFloor:c.activeVtMin;
        if(n.used>minimum){f.healthyHistory=[...(f.healthyHistory||[]),n.used].slice(-c.baselineSamples);
          if(f.healthyHistory.length>=c.baselineSamples&&median(f.healthyHistory)>=floor){f.baseline=median(f.healthyHistory);f.activeBeforeIncident=true;transition(s,f,'HEALTHY',now);}}
        else f.healthyHistory=[];
        continue;
      }
      // An unhandled suspicion must follow fresh traffic, not remain sticky
      // until 85% of the old baseline. Require both live VT and the window
      // above the suspect threshold; keep the baseline for a renewed collapse.
      if(f.state==='SUSPECTED'&&f.incident&&!f.incident.locked&&!f.incident.isBackup&&
        f.currentVt>f.baseline*c.suspectRatio&&f.recentMedian>f.baseline*c.suspectRatio){
        f.incident.cancelled=true;f.incident.closed=true;f.incident.closedAt=now;
        f.incident.closeReason='Fresh VT no longer sustains the suspect threshold';
        f.lastIncident=f.incident;f.incident=null;f.severeWindows=0;
        s.pendingAutoActions=(s.pendingAutoActions||[]).filter(a=>a.key!==f.key);
        transition(s,f,f.recentMedian<=f.baseline*c.warningRatio?'WARNING':'WATCHING',now,
          'VT đã hồi khỏi ngưỡng nghi block; hủy yêu cầu đổi số');
      }
      // Compare BEFORE learning: the first low window never contaminates baseline.
      const ratio=f.recentMedian/f.baseline;
      if(f.state==='HEALTHY'&&recent.length===c.recentSamples&&ratio<=c.watchRatio){
        f.candidateId=`${group}-${n.fs}-${now}`;f.startedAt=now;f.incidentBaseline=f.baseline;
        f.activeBeforeIncident=true;
        transition(s,f,'WATCHING',now);
      }else if(f.state==='HEALTHY'){
        f.healthyHistory=[...(f.healthyHistory||[]),n.used].slice(-c.baselineSamples);
        if(f.healthyHistory.length>=c.baselineSamples)f.baseline=median(f.healthyHistory);f.baselineVt=f.baseline;continue;
      }
      if(ratio>=c.healthyRatio){transition(s,f,'HEALTHY',now,'VT recovered before action');
        f.lastIncident=f.incident;f.incident=null;f.candidateId=null;f.severeWindows=0;continue;}
      // A slow decline may settle at a new off-peak level. Never re-arm a
      // confirmed incident or a zero-VT node from traffic alone.
      if(['WATCHING','WARNING'].includes(f.state)&&now-f.startedAt>c.maxCollapseMs){
        const points=f.history.filter(x=>x.time>=now-c.slowBaselineStableMs);
        const values=points.map(x=>x.vt), m=median(values);
        const stable=points.length>=c.baselineSamples&&
          points[0].time<=now-c.slowBaselineStableMs+c.sampleIntervalMs&&
          Math.min(...values)>c.activeVtMin&&
          Math.max(...values)-Math.min(...values)<=m*c.recoveryRangeRatio;
        if(stable){resetBaseline(s,f,now,'Slow decline settled; off-peak baseline learned');
          f.baseline=m;f.baselineVt=m;f.healthyHistory=values.slice(-c.baselineSamples);
          f.activeBeforeIncident=true;transition(s,f,'HEALTHY',now);continue;}
      }
      if(!f.incident?.isBackup&&preBlockRebounding(s,f)){
        if(f.incident){f.incident.cancelled=true;f.incident.closed=true;f.incident.closedAt=now;
          f.incident.closeReason='Sustained VT rebound before any status change';f.lastIncident=f.incident;f.incident=null;}
        s.pendingAutoActions=(s.pendingAutoActions||[]).filter(a=>a.key!==f.key);
        f.severeWindows=0;
        if(['SUSPECTED','WATCHING'].includes(f.state))transition(s,f,'WARNING',now,'VT đang hồi trước AUTO BLOCK; giữ baseline cũ');
        f.detectionNote='VT đang tăng qua nhiều mẫu; chưa đổi số, tiếp tục theo dõi';
        continue;
      }
      const lows=recent.filter(v=>v<=f.baseline*c.suspectRatio).length;
      f.severeWindows=ratio<=c.suspectRatio&&lows>=c.minLowSamples?(f.severeWindows||0)+1:0;
      f.detectionNote=f.state==='SUSPECTED'?'Sustained VT collapse; check number status':now-f.startedAt>c.maxCollapseMs?'Slow decline: manual review required':'Confirming sustained VT collapse';
      if(f.state==='WATCHING'&&ratio<=c.warningRatio)transition(s,f,'WARNING',now);
      if(f.state==='WARNING'&&f.activeBeforeIncident&&f.severeWindows>=c.suspectWindows&&now-f.startedAt<=c.maxCollapseMs){
        f.autoValidationFailures=0;f.autoRetryAfter=null;f.actionError=null;
        f.incident={id:f.candidateId,baseline:f.baseline,startedAt:f.startedAt,locked:false,autoExecuted:false,actionCount:0};
        const profile=group==='99.153'?'COLLECTION':'TELESALE';
        const numbers=(s.freeswitch?.numbers||[]).filter(n=>n.fs===f.fs&&n.profile===profile);
        const active=numbers.filter(n=>n.status==='ACTIVE');
        if(active.length===1){f.incident.oldPhone=active[0].phone;
          f.incident.backupPhones=numbers.filter(n=>n.status==='BACKUP').map(n=>n.phone);}
        transition(s,f,'SUSPECTED',now);
      }
    }
    refreshAlerts(s,now);
  }
  function refreshAlerts(s,now){applySchedule(s,now);updateCdrStates(s,now);s.alerts=s.monitoringEnabled?Object.values(s.fsStates||{}).filter(f=>isFsActive(s,f,now)&&!pausedFor(s,f.group)&&f.state==='SUSPECTED'&&!f.incident?.autoExecuted&&now-f.updatedAt<=s.config.staleMs).map(f=>({
    group:f.group,fs:f.fs,ip:f.ip,currentVt:f.currentVt,phone:f.incident?.oldPhone,isBackup:!!f.incident?.isBackup,baselineVt:f.baseline,recentMedian:f.recentMedian,dropPercent:f.dropPercent,
    incidentId:f.incident?.id,isBackup:!!f.incident?.isBackup,actionPending:!!f.incident?.actionPending,actionUncertain:!!f.incident?.actionUncertain})):[];}
  function recordManualSwap(s,f,now,detail,newPhone){
    applySchedule(s,now);
    if(!isFsActive(s,f,now)||pausedFor(s,f.group)||f.state!=='SUSPECTED'||!f.incident||f.incident.locked||f.incident.autoExecuted)return false;
    f.cdrUsedCallIds=[...new Set([...(f.cdrUsedCallIds||[]),...(f.cdr?.callIds||[])])].slice(-64);
    Object.assign(f.incident,{locked:true,manualExecuted:true,actionCount:1,switchedAt:now,newPhone});
    f.switchedAt=now;
    transition(s,f,'COOLDOWN',now,detail);
    event(s,'MANUAL_SWITCH',f,now,detail);
    recordGroupAction(s,f,now);
    s.pendingAutoActions=(s.pendingAutoActions||[]).filter(a=>a.incidentId!==f.incident.id);
    refreshAlerts(s,now);return true;
  }
  function resetBaseline(s,f,now,detail){
    if(f.incident){f.incident.closed=true;f.incident.closedAt=now;f.lastIncident=f.incident;}
    event(s,'CONFIG_CHANGED',f,now,detail);
    s.pendingAutoActions=(s.pendingAutoActions||[]).filter(a=>a.key!==f.key);
    Object.assign(f,{state:'INACTIVE',history:[],healthyHistory:[],baseline:null,baselineVt:null,
      recentMedian:null,dropPercent:null,incident:null,candidateId:null,severeWindows:0,
      startedAt:null,switchedAt:null,activeBeforeIncident:false,actionError:null,autoValidationFailures:0,autoRetryAfter:null,detectionNote:detail});
  }
  function observeManualSwaps(s,numbers,now,previous=[]){
    applySchedule(s,now);
    for(const f of Object.values(s.fsStates||{})){
      if(!isFsActive(s,f,now)||pausedFor(s,f.group))continue;
      const profile=f.group==='99.153'?'COLLECTION':'TELESALE';
      const rows=numbers.filter(n=>n.fs===f.fs&&n.profile===profile);
      const active=rows.filter(n=>n.status==='ACTIVE');
      const before=previous.filter(n=>n.fs===f.fs&&n.profile===profile&&n.status==='ACTIVE');
      const oldPhone=f.incident?.oldPhone||f.activePhone||(before.length===1?before[0].phone:null);
      const old=rows.find(n=>n.phone===oldPhone);
      if(f.state==='SUSPECTED'&&f.incident?.locked&&old?.status==='BLOCKED'){
        f.incident.actionPending=false;f.incident.actionUncertain=false;
        f.incident.manualExecuted=true;f.incident.switchedAt=now;f.switchedAt=now;
        f.actionError=null;
        transition(s,f,'COOLDOWN',now,'Matching phone observed BLOCKED on FreeSWITCH');
        event(s,'BLOCKED_OBSERVED',f,now,`${oldPhone} BLOCKED observed; recovery starts`);
        recordGroupAction(s,f,now);
      }
      const moved=oldPhone&&numbers.some(n=>n.phone===oldPhone&&n.profile===profile&&n.fs!==f.fs);
      if(oldPhone&&active.length===0&&(moved||old?.status==='BACKUP')){
        resetBaseline(s,f,now,'ACTIVE number moved/withdrawn; waiting for new traffic');
        f.activePhone=null;continue;
      }
      if(oldPhone&&active.length===1&&active[0].phone!==oldPhone){
        if(f.incident?.locked){
          if(f.incident.backupActivePhone!==active[0].phone){f.incident.backupActivePhone=active[0].phone;f.incident.backupActiveSince=now;}
          f.activePhone=active[0].phone;continue;}
        if(f.state==='SUSPECTED'&&old?.status==='BLOCKED'){
          // BACKUP may have been added after the incident began.
          recordManualSwap(s,f,now,'Manual swap observed; incident locked',active[0].phone);
        }else resetBaseline(s,f,now,'ACTIVE number changed; learning new baseline');
      }
      if(active.length===1){
        f.activePhone=active[0].phone;
        if(f.state==='SUSPECTED'&&f.incident&&!f.incident.oldPhone){
          f.incident.oldPhone=active[0].phone;
          f.incident.backupPhones=rows.filter(n=>n.status==='BACKUP').map(n=>n.phone);
        }
      }
    }
    refreshAlerts(s,now);
  }
  const api={activationBlockReady,hybridVtReady,relearnHybridBaseline,pairedCdrProof,manualCdrProof,cdrVtDrop,cdrPrimary,updateCdrStates,preBlockRebounding,cdrGate,groupActionGate,groupCandidates,recordGroupAction,rotationBarriers,backupAssessment,backupReady,isFsActive,backupTargetValid,CONFIG,recoveryPolicy,scheduleAt,applySchedule,pausedFor,median,keyOf,event,transition,grafana,sample,refreshAlerts,recordManualSwap,observeManualSwaps};
  if(typeof module!=='undefined')module.exports=api;else root.Detection=api;
})(globalThis);
