/* Independent FS rotation policy. No AUTO BLOCK incidents are modified here. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ function(root){
  const detection=root.Detection||(typeof require==='function'?require('./detection'):null);
  const groups={
    '99.153':{profile:'COLLECTION',groupId:2,fs:['FS01','FS02','FS03','FS04','OS01']},
    '99.155':{profile:'TELESALE',groupId:3,fs:['FS05','FS06','FS07']}
  };
  const BACKUP_THRESHOLD=10;
  const threshold=/** Tác dụng: Lấy ngưỡng BACKUP hợp lệ hoặc dùng giá trị mặc định. */ feature=>Number.isSafeInteger(feature.backupThreshold)&&feature.backupThreshold>=0?feature.backupThreshold:BACKUP_THRESHOLD;
  const fresh=/** Tác dụng: Kiểm tra timestamp còn nằm trong cửa sổ dữ liệu mới cho phép. */ (at,now)=>Number.isFinite(at)&&now-at>=0&&now-at<=45000;
  /** Tác dụng: Lấy số BACKUP từ tổng hợp mới hoặc đếm inventory theo đúng FS và profile. */
  function backupCount(state,fs,profile,now){
    const cached=state.freeswitch?.backupCounts?.[fs];
    if(cached?.source==='SUMMARY'&&fresh(cached.updatedAt,now)&&Number.isSafeInteger(cached.count)&&cached.count>=0)return cached.count;
    const count=(state.freeswitch?.numbers||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong backupCount. */ n=>n.fs===fs&&n.profile===profile&&n.status==='BACKUP').length;
    if(cached?.source==='SUMMARY'&&!fresh(cached.updatedAt,now)&&count===0)return null;
    return count;
  }
  /** Tác dụng: Lập các kế hoạch bật/tắt/chuyển FS đủ điều kiện theo routing, BACKUP, preset và khóa. */
  function plans(state,feature,now){
    if(!state.monitoringEnabled||['FAILED','RUNNING'].includes(feature.operation?.status))return [];
    const out=[];
    for(const [group,p] of Object.entries(groups)){
      if(state.schedule?.groups?.[group]?.paused||!fresh(state.opensips?.[group]?.updatedAt,now)||!fresh(state.freeswitch?.updatedAt,now))continue;
      const nodes=(state.opensips[group].nodes||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong plans. */ n=>p.fs.includes(n.fs)&&(!detection||detection.isNodeSelected(state,{group,ip:n.ip}))&&n.resource==='vt'&&Number.isInteger(n.destinationId)&&n.destinationId>0&&n.groupId!=null);
      const rows=state.freeswitch.numbers||[];
      const preset=feature.nextSwitch?.[group];
      const backups=/** Tác dụng: Lấy số lượng BACKUP hiện tại của node trong phạm vi nhóm đang xét. */ fs=>backupCount(state,fs,p.profile,now);
      const active=/** Tác dụng: Lấy các số ACTIVE thuộc đúng FS và profile đang xét. */ fs=>rows.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong active. */ n=>n.fs===fs&&n.profile===p.profile&&n.status==='ACTIVE');
      for(const source of nodes){
        if(preset?.source&&source.fs!==preset.source)continue;
        const f=Object.values(state.fsStates||{}).find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong plans. */ f=>f.group===group&&f.fs===source.fs&&f.ip===source.ip);
        if(state.fsTestExclusions?.[`${group}|${source.fs}`]||source.groupId!==p.groupId||f?.state!=='SUSPECTED'||!f.incident||f.incident.locked||f.incident.cancelled||!fresh(f.updatedAt,now))continue;
        if(detection&&!detection.groupActionGate(state,f,now).ready)continue;
        if(detection&&!detection.backupReady({...state,rotationBarriers:detection.rotationBarriers(feature)},f,now))continue;
        const key=`${group}|${source.fs}|${f.incident.id}`;
        if(feature.handled?.[key]||feature.quarantined?.[`${group}|${source.fs}`])continue;
        const count=backups(source.fs);
        if((!preset&&(count==null||count>threshold(feature)))||active(source.fs).length!==1)continue;
        const targets=nodes.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong plans. */ n=>n.fs!==source.fs&&(!preset||n.fs===preset.target)&&n.groupId===0&&!state.fsTestExclusions?.[`${group}|${n.fs}`]&&
          !feature.quarantined?.[`${group}|${n.fs}`]&&(preset||(backups(n.fs)!=null&&backups(n.fs)>count))&&active(n.fs).length===1&&active(n.fs)[0].hasStatusControl)
          .sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong plans. */ (a,b)=>backups(b.fs)-backups(a.fs)||a.fs.localeCompare(b.fs));
        const action=preset&&!preset.target?'DISABLE':preset&&!preset.source?'ENABLE':'SWITCH';
        const target=action==='DISABLE'?source:targets[0];if(!target)continue;
        if(nodes.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong plans. */ n=>n.fs===source.fs).length!==1||nodes.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong plans. */ n=>n.fs===target.fs).length!==1)continue;
        out.push({key,action,presetSource:preset?.source||'',preset:!!preset,group,profile:p.profile,groupId:p.groupId,source:{fs:source.fs,ip:source.ip,id:source.destinationId,backups:count,baseline:f.baseline},
          target:{fs:target.fs,ip:target.ip,id:target.destinationId,backups:backups(target.fs),phone:active(target.fs)[0].phone},incidentId:f.incident.id});
      }
    }
    // Prioritize the most depleted eligible source, regardless of table order.
    return out.sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong plans. */ (a,b)=>a.source.backups-b.source.backups||
      a.group.localeCompare(b.group)||a.source.fs.localeCompare(b.source.fs));
  }
  /** Tác dụng: Tạo danh sách lý do khiến chưa có kế hoạch thay FS hợp lệ. */
  function diagnostics(state,feature,now){
    const available=plans(state,feature,now),out=[];
    for(const [group,p] of Object.entries(groups)){
      const nodes=state.opensips?.[group]?.nodes||[],numbers=state.freeswitch?.numbers||[];
      for(const fs of p.fs){
        const rows=numbers.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ n=>n.fs===fs&&n.profile===p.profile),count=backupCount(state,fs,p.profile,now);
        const node=nodes.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong diagnostics. */ n=>n.fs===fs&&n.resource==='vt');
        const f=Object.values(state.fsStates||{}).find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong diagnostics. */ x=>x.group===group&&x.fs===fs&&x.ip===node?.ip);
        const plan=available.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong diagnostics. */ x=>x.group===group&&x.source.fs===fs);
        let reason;
        if(node&&detection&&!detection.isNodeSelected(state,{group,ip:node.ip}))reason='Node không được chọn monitor; không can thiệp.';
        else if(!feature.enabled)reason='THAY FS đang OFF; bật tính năng trước.';
        else if(!state.monitoringEnabled)reason='MONITOR đang OFF.';
        else if(state.schedule?.groups?.[group]?.paused)reason='Nhóm đang nghỉ theo lịch.';
        else if(['FAILED','RUNNING'].includes(feature.operation?.status))reason=feature.operation.status==='FAILED'?'Lượt chuyển trước bị lỗi; kiểm tra và mở khóa trước khi chạy tiếp.':'Đang có lượt chuyển FS.';
        else if(!fresh(state.opensips?.[group]?.updatedAt,now))reason='Dữ liệu OpenSIPS chưa có hoặc quá 45 giây; kiểm tra tab OpenSIPS.';
        else if(!fresh(state.freeswitch?.updatedAt,now))reason='Dữ liệu FreeSWITCH chưa có hoặc quá 45 giây; kiểm tra tab FreeSWITCH.';
        else if(!node||!Number.isInteger(node.destinationId)||node.destinationId<=0||node.groupId==null)reason='Chưa đọc được destination ID / Group ID; refresh tab OpenSIPS.';
        else if(node.groupId!==p.groupId)reason=`FS chưa chạy trong nhóm này (Group ID ${node.groupId}; cần ${p.groupId}).`;
        else if(state.fsTestExclusions?.[`${group}|${fs}`])reason='FS còn nằm trong khóa test OpenSIPS; trả về Group ID 0 bằng test tắt trước.';
        else if(!f||!fresh(f.updatedAt,now))reason='Chưa có VT mới để đánh giá sự cố.';
        else if(!plan&&feature.nextSwitch?.[group])reason=`Đặt trước ${feature.nextSwitch[group].source} → ${feature.nextSwitch[group].target}: chờ nguồn locked, đích Group ID 0 và dữ liệu hợp lệ.`;
        else if(count==null)reason='Số BACKUP tổng quan đã cũ; chờ FreeSWITCH cập nhật.';
        else if(count>threshold(feature)&&!plan)reason=`BACKUP ${count} > ngưỡng ${threshold(feature)}.`;
        else if(f.state!=='SUSPECTED')reason=`BACKUP đã ≤ ${threshold(feature)}, nhưng trạng thái ${f.state}; chỉ thay tại lượt nghi block.`;
        else if(!f.incident||f.incident.locked||f.incident.cancelled)reason='Sự cố đã xử lý/đang khóa hoặc đã hủy; không chuyển lại.';
        else if(feature.quarantined?.[`${group}|${fs}`]||feature.handled?.[`${group}|${fs}|${f.incident.id}`])reason='FS/sự cố còn khóa từ lượt chuyển trước.';
        else if(rows.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ n=>n.status==='ACTIVE').length!==1)reason='FS nguồn không có đúng một số ACTIVE.';
        else if(!plan){
          const details=p.fs.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ other=>other!==fs).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong diagnostics. */ other=>{
            const candidates=nodes.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ n=>n.fs===other&&n.resource==='vt'),n=candidates[0];
            const list=numbers.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ x=>x.fs===other&&x.profile===p.profile),backups=backupCount(state,other,p.profile,now);
            const active=list.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong diagnostics. */ x=>x.status==='ACTIVE');
            let why=candidates.length!==1?'thiếu hoặc trùng destination':n.groupId!==0?`Group ID ${n.groupId??'chưa rõ'}, cần 0`:backups==null?'BACKUP chưa có dữ liệu mới':backups<=count?`BACKUP ${backups}, cần > ${count}`:
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
  /** Tác dụng: Kiểm tra node có đang được giữ bởi thao tác thay FS hoặc kế hoạch đang chờ hay không. */
  function holds(state,feature,f,now){
    const key=`${f.group}|${f.fs}`;
    if(feature.quarantined?.[key]){
      const id=feature.quarantined[key],op=[feature.operation,...(feature.history||[])].find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong holds. */ x=>x?.id===id);
      return !(op?.status==='DONE'&&op.plan.target.fs===f.fs&&op.plan.group===f.group);
    }
    if(!feature.enabled||!state.monitoringEnabled||state.schedule?.groups?.[f.group]?.paused)return false;
    const p=groups[f.group];
    if(!p?.fs.includes(f.fs)||f.state!=='SUSPECTED'||!f.incident||f.incident.locked)return false;
    if(!fresh(state.freeswitch?.updatedAt,now)||!fresh(state.opensips?.[f.group]?.updatedAt,now))return false;
    // Reserve the source only when a valid rotation is available. Without a
    // target, normal BLOCK can continue; later incidents recompute all counts.
    return plans(state,feature,now).some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong holds. */ plan=>plan.group===f.group&&plan.source.fs===f.fs&&plan.source.ip===f.ip&&plan.incidentId===f.incident.id);
  }
  const identity=/** Tác dụng: Tạo định danh kế hoạch để xác nhận đúng snapshot và phát hiện kế hoạch đã thay đổi. */ p=>JSON.stringify([p.action,!!p.preset,p.key,p.source.id,p.source.backups,p.target.fs,p.target.id,p.target.backups,p.target.phone]);
  /** Tác dụng: Lưu reservation, xác minh lại kế hoạch rồi tắt nguồn/bật đích/theo dõi; giữ lỗi và lịch sử nếu thất bại. */
  async function execute(plan,feature,deps){
    if(feature.operation?.status==='RUNNING')throw Error('Đang có lượt chuyển FS.');
    const op={id:`switch-${deps.now()}`,plan,status:'RUNNING',stage:'VALIDATING',startedAt:deps.now()};
    feature.operation=op;feature.handled={...feature.handled,[plan.key]:op.id};
    feature.quarantined={...feature.quarantined,[`${plan.group}|${plan.source.fs}`]:op.id,[`${plan.group}|${plan.target.fs}`]:op.id};
    await deps.save(feature);
    try{
      await deps.validate(plan);
      op.stage='DISABLE_SOURCE';await deps.save(feature);
      if(plan.action!=='ENABLE')await deps.setGroup(plan.group,plan.source,plan.groupId,0);
      op.stage='ENABLE_TARGET';await deps.save(feature);
      if(plan.action!=='DISABLE')await deps.setGroup(plan.group,plan.target,0,plan.groupId);
      op.stage='MONITORING_TARGET';await deps.save(feature);
      if(deps.monitorTarget&&(!plan.action||plan.action==='SWITCH'))await deps.monitorTarget(plan);else op.stage='ROUTING_VERIFIED';
      op.status='DONE';op.finishedAt=deps.now();
      if(plan.preset&&(feature.nextSwitch?.[plan.group]?.source||'')===(plan.presetSource??plan.source.fs)&&(feature.nextSwitch[plan.group].target||'')===(plan.action==='DISABLE'?'':plan.target.fs))delete feature.nextSwitch[plan.group];
    }catch(error){op.status='FAILED';op.error=String(error.message||error);op.finishedAt=deps.now();}
    feature.history=[op,...(feature.history||[])].filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong execute. */ x=>x.startedAt>deps.now()-3*86400000);
    await deps.save(feature);return op;
  }
  // A destination is identified by ID, while the dashboard shows one row per IP.
  /** Tác dụng: Gộp destination cùng IP, ưu tiên Group ID của nhóm và đánh dấu trường hợp chưa phân biệt được. */
  function catalogRows(rows,group){
    const expected=group==='99.153'?2:3,buckets=new Map();
    for(const n of rows||[]){if(!n.ip)continue;const list=buckets.get(n.ip)||[];
      if(!list.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong catalogRows. */ x=>x.destinationId===n.destinationId&&x.groupId===n.groupId))list.push(n);buckets.set(n.ip,list);}
    return [...buckets.values()].map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong catalogRows. */ list=>{
      const rank=/** Tác dụng: Ưu tiên destination đúng Group ID của nhóm, kế đến Group ID 0, rồi các nhóm khác. */ n=>n.groupId===expected?0:n.groupId===0?1:2;
      list.sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong catalogRows. */ (a,b)=>rank(a)-rank(b)||(b.capacity||0)-(a.capacity||0)||(a.destinationId||0)-(b.destinationId||0));
      const first=list[0],ambiguous=!!first.ambiguous||list.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong catalogRows. */ n=>rank(n)===rank(first)).length>1;
      return {...first,ambiguous,destinations:list.flatMap(/** Tác dụng: Chuyển và gộp các phần tử vào một danh sách trong catalogRows. */ n=>n.destinations||[{id:n.destinationId,groupId:n.groupId,capacity:n.capacity}])};
    });
  }
  /** Tác dụng: Tạo catalog node của nhóm, ghép tên từ FreeSWITCH và đánh dấu node chỉ được hiển thị. */
  function nodeCatalog(state,group){
    const data=state.opensips?.[group]||{},profile=groups[group]?.profile;
    const inventory=(state.freeswitch?.numbers||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong nodeCatalog. */ n=>n.profile===profile);
    return catalogRows(data.catalog||data.nodes,group).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong nodeCatalog. */ n=>{
      const matches=(state.freeswitch?.nodeMappings||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong nodeCatalog. */ x=>x.ip===n.ip&&(!x.profile||x.profile===profile));
      const names=[...new Set(matches.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong nodeCatalog. */ x=>x.fs))];
      const fs=names.length===1?names[0]:n.fs||(inventory.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong nodeCatalog. */ x=>x.fs===n.fsHint)?n.fsHint:null);
      return {...n,fs,displayOnly:!!n.ambiguous||!(data.nodes||[]).some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong nodeCatalog. */ x=>x.ip===n.ip&&x.fs===fs)};
    });
  }
  /** Tác dụng: Lọc catalog theo các IP người dùng đã tick để hiển thị trên bảng của nhóm. */
  function displayRows(state,group){
    const data=state.opensips?.[group]||{},selected=state.nodeDisplay?.[group];
    const rows=nodeCatalog(state,group);
    return rows.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong displayRows. */ n=>Array.isArray(selected)?selected.includes(n.ip):(data.nodes||[]).some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong displayRows. */ x=>x.ip===n.ip));
  }
  /** Tác dụng: Kiểm tra danh sách IP hiển thị thuộc catalog của đúng nhóm, khử trùng và giữ lựa chọn tạm vắng. */
  function validateDisplayIps(state,group,ips,previous=[]){
    if(!groups[group]||!Array.isArray(ips)||ips.length>500)throw Error('Danh sách node không hợp lệ');
    const allowed=new Set([...nodeCatalog(state,group).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong validateDisplayIps. */ n=>n.ip),...previous]);
    if(ips.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong validateDisplayIps. */ ip=>typeof ip!=='string'||!allowed.has(ip)))throw Error('Node chưa có trong danh sách OpenSIPS của nhóm');
    return [...new Set(ips)];
  }
  const api={catalogRows,nodeCatalog,displayRows,validateDisplayIps,backupCount,threshold,BACKUP_THRESHOLD,groups,plans,diagnostics,holds,identity,execute};
  if(typeof module!=='undefined')module.exports=api;else root.FsSwitch=api;
})(globalThis);
