/* Compatibility for stored Collection night jobs. Scheduling never changes routing. */
(function(root){
 const detection=root.Detection||(typeof require==='function'?require('./detection'):null);
 /** Giờ Việt Nam dùng cho lịch dừng giám sát, độc lập timezone máy. */
 function phase(now){
  const local=new Date(now+25200000);
  return {date:local.toISOString().slice(0,10),minute:local.getUTCHours()*60+local.getUTCMinutes(),previousDate:new Date(local.getTime()-86400000).toISOString().slice(0,10)};
 }
 function eveningDate(now){const t=phase(now);return t.minute>=1085?t.date:t.minute<480?t.previousDate:null;}
 // Never generate a routing job, including from persisted NIGHT/FINAL_CONFIRMED state.
 function finalChange(){return null;}
 function next(){return null;}
 /** Hủy công việc lịch cũ mà không bật/tắt bất kỳ node nào. */
 async function execute(state,_job,deps){
  state.collectionEvening=null;
  if(detection)detection.applySchedule(state,deps.now());
  await deps.save(state);
  return {status:'RETIRED'};
 }
 const api={phase,eveningDate,finalChange,next,execute};
 if(typeof module!=='undefined')module.exports=api;else root.CollectionEvening=api;
})(globalThis);
