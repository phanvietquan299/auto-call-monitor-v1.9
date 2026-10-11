/* Independent FS rotation policy. No AUTO BLOCK incidents are modified here. */
(function(root){
  const detection=root.Detection||(typeof require==='function'?require('./detection'):null);
  const groups={
    '99.153':{profile:'COLLECTION',groupId:2,fs:['FS01','FS02','FS03','FS04']},
    '99.155':{profile:'TELESALE',groupId:3,fs:['FS05','FS06','FS07']}
  };
  const BACKUP_THRESHOLD=10;
  const fresh=(at,now)=>Number.isFinite(at)&&now-at>=0&&now-at<=45000;
  function plans(state,feature,now){
    if(!state.monitoringEnabled||['FAILED','RUNNING'].includes(feature.operation?.status))return [];
    const out=[];
    for(const [group,p] of Object.entries(groups)){
      if(state.schedule?.groups?.[group]?.paused||!fresh(state.opensips?.[group]?.updatedAt,now)||!fresh(state.freeswitch?.updatedAt,now))continue;
      const nodes=(state.opensips[group].nodes||[]).filter(n=>p.fs.includes(n.fs)&&n.resource==='vt'&&Number.isInteger(n.destinationId)&&n.destinationId>0&&n.groupId!=null);
      const rows=state.freeswitch.numbers||[];
      const backups=fs=>rows.filter(n=>n.fs===fs&&n.profile===p.profile&&n.status==='BACKUP').length;
      const active=fs=>rows.filter(n=>n.fs===fs&&n.profile===p.profile&&n.status==='ACTIVE');
      for(const source of nodes){
        const f=Object.values(state.fsStates||{}).find(f=>f.group===group&&f.fs===source.fs&&f.ip===source.ip);
        if(state.fsTestExclusions?.[`${group}|${source.fs}`]||source.groupId!==p.groupId||f?.state!=='SUSPECTED'||!f.incident||f.incident.locked||f.incident.cancelled||!fresh(f.updatedAt,now))continue;
        if(detection&&!detection.groupActionGate(state,f,now).ready)continue;
        if(detection&&!detection.backupReady({...state,rotationBarriers:detection.rotationBarriers(feature)},f,now))continue;
        const key=`${group}|${source.fs}|${f.incident.id}`;
        if(feature.handled?.[key]||feature.quarantined?.[`${group}|${source.fs}`])continue;
        const count=backups(source.fs);
        if(count>BACKUP_THRESHOLD||active(source.fs).length!==1)continue;
        const targets=nodes.filter(n=>n.fs!==source.fs&&n.groupId===0&&!state.fsTestExclusions?.[`${group}|${n.fs}`]&&
          !feature.quarantined?.[`${group}|${n.fs}`]&&backups(n.fs)>count&&active(n.fs).length===1&&active(n.fs)[0].hasStatusControl)
          .sort((a,b)=>backups(b.fs)-backups(a.fs)||a.fs.localeCompare(b.fs));
        const target=targets[0];if(!target)continue;
        if(nodes.filter(n=>n.fs===source.fs).length!==1||nodes.filter(n=>n.fs===target.fs).length!==1)continue;
        out.push({key,group,profile:p.profile,groupId:p.groupId,source:{fs:source.fs,ip:source.ip,id:source.destinationId,backups:count,baseline:f.baseline},
          target:{fs:target.fs,ip:target.ip,id:target.destinationId,backups:backups(target.fs),phone:active(target.fs)[0].phone},incidentId:f.incident.id});
      }
    }
    // Prioritize the most depleted eligible source, regardless of table order.
    return out.sort((a,b)=>a.source.backups-b.source.backups||
      a.group.localeCompare(b.group)||a.source.fs.localeCompare(b.source.fs));
  }
  function diagnostics(state,feature,now){
    const available=plans(state,feature,now),out=[];
    for(const [group,p] of Object.entries(groups)){
      const nodes=state.opensips?.[group]?.nodes||[],numbers=state.freeswitch?.numbers||[];
      for(const fs of p.fs){
        const rows=numbers.filter(n=>n.fs===fs&&n.profile===p.profile),count=rows.filter(n=>n.status==='BACKUP').length;
        const node=nodes.find(n=>n.fs===fs&&n.resource==='vt');
        const f=Object.values(state.fsStates||{}).find(x=>x.group===group&&x.fs===fs&&x.ip===node?.ip);
        const plan=available.find(x=>x.group===group&&x.source.fs===fs);
        let reason;
        if(!feature.enabled)reason='THAY FS đang OFF; bật tính năng trước.';
        else if(!state.monitoringEnabled)reason='MONITOR đang OFF.';
        else if(state.schedule?.groups?.[group]?.paused)reason='Nhóm đang nghỉ theo lịch.';
        else if(['FAILED','RUNNING'].includes(feature.operation?.status))reason=feature.operation.status==='FAILED'?'Lượt chuyển trước bị lỗi; kiểm tra và mở khóa trước khi chạy tiếp.':'Đang có lượt chuyển FS.';
        else if(!fresh(state.opensips?.[group]?.updatedAt,now))reason='Dữ liệu OpenSIPS chưa có hoặc quá 45 giây; kiểm tra tab OpenSIPS.';
        else if(!fresh(state.freeswitch?.updatedAt,now))reason='Dữ liệu FreeSWITCH chưa có hoặc quá 45 giây; kiểm tra tab FreeSWITCH.';
        else if(!node||!Number.isInteger(node.destinationId)||node.destinationId<=0||node.groupId==null)reason='Chưa đọc được destination ID / Group ID; refresh tab OpenSIPS.';
        else if(node.groupId!==p.groupId)reason=`FS chưa chạy trong nhóm này (Group ID ${node.groupId}; cần ${p.groupId}).`;
        else if(state.fsTestExclusions?.[`${group}|${fs}`])reason='FS còn nằm trong khóa test OpenSIPS; trả về Group ID 0 bằng test tắt trước.';
        else if(!f||!fresh(f.updatedAt,now))reason='Chưa có VT mới để đánh giá sự cố.';
        else if(count>BACKUP_THRESHOLD)reason=`BACKUP ${count} > ngưỡng ${BACKUP_THRESHOLD}.`;
        else if(f.state!=='SUSPECTED')reason=`BACKUP đã ≤ ${BACKUP_THRESHOLD}, nhưng trạng thái ${f.state}; chỉ thay tại lượt nghi block.`;
        else if(!f.incident||f.incident.locked||f.incident.cancelled)reason='Sự cố đã xử lý/đang khóa hoặc đã hủy; không chuyển lại.';
        else if(feature.quarantined?.[`${group}|${fs}`]||feature.handled?.[`${group}|${fs}|${f.incident.id}`])reason='FS/sự cố còn khóa từ lượt chuyển trước.';
        else if(rows.filter(n=>n.status==='ACTIVE').length!==1)reason='FS nguồn không có đúng một số ACTIVE.';
        else if(!plan){
          const details=p.fs.filter(other=>other!==fs).map(other=>{
            const candidates=nodes.filter(n=>n.fs===other&&n.resource==='vt'),n=candidates[0];
            const list=numbers.filter(x=>x.fs===other&&x.profile===p.profile),backups=list.filter(x=>x.status==='BACKUP').length;
            const active=list.filter(x=>x.status==='ACTIVE');
            let why=candidates.length!==1?'thiếu hoặc trùng destination':n.groupId!==0?`Group ID ${n.groupId??'chưa rõ'}, cần 0`:backups<=count?`BACKUP ${backups}, cần > ${count}`:
              state.fsTestExclusions?.[`${group}|${other}`]?'khóa test':feature.quarantined?.[`${group}|${other}`]?'khóa lượt chuyển':
              active.length!==1?'không có đúng một số ACTIVE':!active[0].hasStatusControl?'ACTIVE không có điều khiển trạng thái':!Number.isInteger(n.destinationId)||n.destinationId<=0?'thiếu destination ID':'kiểm tra dữ liệu destination';
            return `${other}: ${why}`;
          });
          reason='Không có FS đích đủ điều kiện. '+details.join('; ');
        }else reason=feature.mode==='AUTOMATIC'?`Đủ điều kiện → ${plan.target.fs}; chờ lượt tự động.`:`Đủ điều kiện → ${plan.target.fs}; bấm Kiểm tra và xác nhận.`;
        out.push({group,fs,backups:count,groupId:node?.groupId??null,state:f?.state||'CHƯA CÓ DỮ LIỆU',eligible:!!plan,reason});
      }
    }
    return out;
  }
  function holds(state,feature,f,now){
    const key=`${f.group}|${f.fs}`;
    if(feature.quarantined?.[key]){
      const id=feature.quarantined[key],op=[feature.operation,...(feature.history||[])].find(x=>x?.id===id);
      return !(op?.status==='DONE'&&op.plan.target.fs===f.fs&&op.plan.group===f.group);
    }
    if(!feature.enabled||!state.monitoringEnabled||state.schedule?.groups?.[f.group]?.paused)return false;
    const p=groups[f.group];
    if(!p?.fs.includes(f.fs)||f.state!=='SUSPECTED'||!f.incident||f.incident.locked)return false;
    if(!fresh(state.freeswitch?.updatedAt,now)||!fresh(state.opensips?.[f.group]?.updatedAt,now))return false;
    // Reserve the source only when a valid rotation is available. Without a
    // target, normal BLOCK can continue; later incidents recompute all counts.
    return plans(state,feature,now).some(plan=>plan.group===f.group&&plan.source.fs===f.fs&&plan.source.ip===f.ip&&plan.incidentId===f.incident.id);
  }
  const identity=p=>JSON.stringify([p.key,p.source.id,p.source.backups,p.target.fs,p.target.id,p.target.backups,p.target.phone]);
  async function execute(plan,feature,deps){
    if(feature.operation?.status==='RUNNING')throw Error('Đang có lượt chuyển FS.');
    const op={id:`switch-${deps.now()}`,plan,status:'RUNNING',stage:'VALIDATING',startedAt:deps.now()};
    feature.operation=op;feature.handled={...feature.handled,[plan.key]:op.id};
    feature.quarantined={...feature.quarantined,[`${plan.group}|${plan.source.fs}`]:op.id,[`${plan.group}|${plan.target.fs}`]:op.id};
    await deps.save(feature);
    try{
      await deps.validate(plan);
      op.stage='DISABLE_SOURCE';await deps.save(feature);
      await deps.setGroup(plan.group,plan.source,plan.groupId,0);
      op.stage='ENABLE_TARGET';await deps.save(feature);
      await deps.setGroup(plan.group,plan.target,0,plan.groupId);
      op.stage='MONITORING_TARGET';await deps.save(feature);
      if(deps.monitorTarget)await deps.monitorTarget(plan);
      op.status='DONE';op.finishedAt=deps.now();
    }catch(error){op.status='FAILED';op.error=String(error.message||error);op.finishedAt=deps.now();}
    feature.history=[op,...(feature.history||[])].filter(x=>x.startedAt>deps.now()-3*86400000);
    await deps.save(feature);return op;
  }
  const api={BACKUP_THRESHOLD,groups,plans,diagnostics,holds,identity,execute};
  if(typeof module!=='undefined')module.exports=api;else root.FsSwitch=api;
})(globalThis);
