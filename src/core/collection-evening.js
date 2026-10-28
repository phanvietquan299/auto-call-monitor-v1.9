/* Collection final-change window: 18:00–18:05; hard stop after 18:05. */
(/** Tác dụng: Khởi tạo module, đóng gói state nội bộ và đăng ký API/listener của thành phần này. */ function(root){
 const members=['FS01','FS02','FS03','FS04','OS01'];
 const detection=root.Detection||(typeof require==='function'?require('./detection'):null);
 const ips=root.Cdr?.IPS||(typeof require==='function'?require('./cdr').IPS:{});
 /** Tác dụng: Chỉ cho lịch Collection quản lý các node đã được tick trên bản extension này. */
 const selected=(state,node)=>!detection||detection.isNodeSelected(state,{group:'99.153',ip:node.ip||ips[node.fs]});
 /** Tác dụng: Tính ngày và phút trong ngày theo giờ Việt Nam cho lịch Collection. */
 function phase(now){
  const local=new Date(now+25200000),minute=local.getUTCHours()*60+local.getUTCMinutes();
  return {date:local.toISOString().slice(0,10),minute,previousDate:new Date(local.getTime()-86400000).toISOString().slice(0,10)};
 }
 /** Tác dụng: Xác định ngày của phiên nghỉ đêm, kể cả thời gian sau nửa đêm. */
 function eveningDate(now){const t=phase(now);return t.minute>=1080?t.date:t.minute<480?t.previousDate:null;}
 /** Tác dụng: Tìm lần đổi số Collection đã xác nhận sau 18:00 làm mốc kết thúc ngày. */
 function finalChange(state,now){
  const date=eveningDate(now);if(!date||detection.collectionHardStop('99.153',now))return null;
  const saved=state.collectionEvening;
  if(saved?.date===date&&['RUNNING','FINAL_CONFIRMED','NIGHT','FAILED'].includes(saved.status)&&saved.policy===27)return null;
  const end=Date.parse(date+'T18:00:00+07:00');
  const changes=Object.values(state.fsStates||{}).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong finalChange. */ f=>f.group==='99.153'&&members.includes(f.fs)&&selected(state,f)).flatMap(/** Tác dụng: Chuyển và gộp các phần tử vào một danh sách trong finalChange. */ f=>[f.incident,f.lastIncident]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong finalChange. */ i=>i&&(i.autoExecuted||i.manualExecuted)&&!i.actionUncertain&&!i.actionPending&&i.switchedAt>=end&&i.switchedAt<=now);
  changes.sort(/** Tác dụng: So sánh hai phần tử để xác định thứ tự ưu tiên trong finalChange. */ (a,b)=>a.switchedAt-b.switchedAt);
  return changes.length?{date,incidentId:changes[0].id,at:changes[0].switchedAt}:null;
 }
 /** Tác dụng: Lập công việc tắt đêm hoặc khôi phục sáng khi có đủ node và dữ liệu Group ID mới. */
 function next(state,now){
  if(!state.monitoringEnabled)return null;
  const saved=state.collectionEvening,time=phase(now),data=state.opensips?.['99.153'];
  if(!saved||!data||now-data.updatedAt<0||now-data.updatedAt>45000)return null;
  const expected=members.filter(fs=>selected(state,{fs,ip:ips[fs]}));
  if(!expected.length)return null;
  const nodes=(data.nodes||[]).filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong next. */ n=>expected.includes(n.fs)&&selected(state,n)&&n.resource==='vt');
  if(nodes.length!==expected.length||new Set(nodes.map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong next. */ n=>n.fs)).size!==expected.length||nodes.some(/** Tác dụng: Kiểm tra có phần tử nào thỏa điều kiện trong next. */ n=>![0,2].includes(n.groupId)||!Number.isInteger(n.destinationId)||n.destinationId<=0))return null;
  const active=nodes.filter(/** Tác dụng: Giữ các phần tử thỏa điều kiện kiểm tra trong next. */ n=>n.groupId===2).map(/** Tác dụng: Chuyển từng phần tử sang cấu trúc kết quả cần dùng trong next. */ n=>({...n,id:n.destinationId}));
  if(saved.policy===27&&saved.status==='FINAL_CONFIRMED')return {kind:'NIGHT',date:saved.date,enable:[],disable:active,resumeNodes:saved.resumeNodes||active};
  if(saved.status==='NIGHT'&&saved.date===time.previousDate&&time.minute>=480&&time.minute<1080){
   const resume=(saved.resumeNodes||(saved.selected?[saved.selected]:[])).filter(n=>selected(state,n));
   if(!resume.length)return null;
   const enable=[];
   for(const n of resume){const row=nodes.find(/** Tác dụng: Tìm phần tử đầu tiên khớp điều kiện trong next. */ x=>x.fs===n.fs&&x.ip===n.ip&&x.destinationId===n.id);if(!row)return null;if(row.groupId===0)enable.push(n);}
   return {kind:'MORNING',date:saved.date,enable,disable:[],resumeNodes:resume};
  }
  return null;
 }
 /** Tác dụng: Lưu trạng thái RUNNING, bật/tắt các node trong công việc đêm/sáng và ghi DONE hoặc FAILED. */
 async function execute(state,job,deps){
  state.collectionEvening={...state.collectionEvening,policy:27,date:job.date,resumeNodes:job.resumeNodes,status:'RUNNING',stage:job.kind,startedAt:deps.now()};await deps.save(state);
  try{
   for(const n of job.enable)if(selected(state,n))await deps.setGroup(n,0,2);
   for(const n of job.disable)if(selected(state,n))await deps.setGroup(n,2,0);
   state.collectionEvening={...state.collectionEvening,status:job.kind==='NIGHT'?'NIGHT':'RESUMED',finishedAt:deps.now()};
  }catch(error){state.collectionEvening={...state.collectionEvening,status:'FAILED',error:String(error.message||error),failedAt:deps.now()};}
  await deps.save(state);return state.collectionEvening;
 }
 const api={phase,eveningDate,finalChange,next,execute};if(typeof module!=='undefined')module.exports=api;else root.CollectionEvening=api;
})(globalThis);
