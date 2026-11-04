/* Manual commands only. Preview mutates its own inventory and never calls infrastructure. */
const {key}=require('./monitor-selection');
const statuses=new Set(['ACTIVE','BACKUP','BLOCKED']);
function createMonitorNumberStatus(connection,{sandbox,getSelection,onProductionBlock,notify=()=>{}}){
 const all=(sql,p=[])=>new Promise((resolve,reject)=>connection.all(sql,p,(e,rows)=>e?reject(e):resolve(rows)));
 const get=(sql,p=[])=>new Promise((resolve,reject)=>connection.get(sql,p,(e,row)=>e?reject(e):resolve(row)));
 const run=(sql,p=[])=>new Promise((resolve,reject)=>connection.run(sql,p,function(e){e?reject(e):resolve(this.changes);}));
 let queue=Promise.resolve();const displayed=new Map();
 async function target(input){
  if(!input||typeof input.nodeId!=='string'||typeof input.ip!=='string'||!['COLLECTION','TELESALE'].includes(input.profile))throw Error('FS không hợp lệ');
  const node=await get('SELECT id,host,profile FROM nodes WHERE id=?',[input.nodeId]);
  if(!node||node.host!==input.ip||node.profile!==input.profile)throw Error('FS/IP/profile đã thay đổi; tải lại bảng');
  const group=node.profile==='COLLECTION'?'99.153':'99.155';
  if(!getSelection().groups[group]?.includes(key(node)))throw Error('Node chưa được chọn Monitor');
  return node;
 }
 return {async snapshot(){
  const nodes=await all('SELECT id,host,profile FROM nodes'),numbers=await all('SELECT phone,node_id,profile,status FROM numbers');
  const selected=getSelection();
  return {mode:sandbox?'SANDBOX':'PRODUCTION',at:Date.now(),nodes:nodes.filter(node=>selected.groups[node.profile==='COLLECTION'?'99.153':'99.155']?.includes(key(node))).map(node=>{
   const rows=numbers.filter(row=>row.node_id===node.id&&row.profile===node.profile),active=rows.filter(row=>row.status==='ACTIVE');
   const row=active.length===1?active[0]:active.length===0?rows.find(row=>row.phone===displayed.get(node.id)):null;
   return {id:node.id,ip:node.host,profile:node.profile,phone:row?.phone||null,status:row?.status||null,error:active.length>1?'Nhiều số ACTIVE; kiểm tra kho số':null};
  })};
 },change(input,operator){
  const task=queue.then(async()=>{
   const node=await target(input);
   if(!/^0\d{9}$/.test(input.phone||'')||!statuses.has(input.status)||!statuses.has(input.expectedStatus)||input.status===input.expectedStatus)throw Error('Số hoặc trạng thái không hợp lệ');
   const current=await get('SELECT phone,status FROM numbers WHERE phone=? AND node_id=? AND profile=?',[input.phone,node.id,node.profile]);
   if(!current||current.status!==input.expectedStatus)throw Error('Số hoặc trạng thái đã thay đổi; đọc lại trước khi thao tác');
   if(!sandbox&&current.status==='ACTIVE'&&input.status==='BLOCKED'){
    if(!onProductionBlock)throw Error('Chưa cấu hình đổi số production');
    const result=await onProductionBlock({nodeId:node.id,phone:input.phone,type:'MANUAL',operator,expectedPhoneState:{profile:node.profile,status:input.expectedStatus}});
    displayed.set(node.id,result.newPhone||input.phone);return {...result,mode:'PRODUCTION'};
   }
   await run('BEGIN IMMEDIATE');
   let newPhone=null;
   try{
    // Validate again inside the transaction, including the current node selection.
    await target(input);
    const row=await get('SELECT status FROM numbers WHERE phone=? AND node_id=? AND profile=?',[input.phone,node.id,node.profile]);
    if(!row||row.status!==input.expectedStatus)throw Error('Số hoặc trạng thái đã thay đổi; đọc lại trước khi thao tác');
    if(input.status==='ACTIVE'&&(await get("SELECT phone FROM numbers WHERE node_id=? AND profile=? AND status='ACTIVE' AND phone<>?",[node.id,node.profile,input.phone])))throw Error('FS đã có số ACTIVE khác; không tạo thêm số ACTIVE');
    if(row.status==='ACTIVE'&&input.status==='BLOCKED'){
     const backup=await get("SELECT phone FROM numbers WHERE node_id=? AND profile=? AND status='BACKUP' ORDER BY id LIMIT 1",[node.id,node.profile]);
     if(!backup)throw Error('FS không còn số BACKUP');newPhone=backup.phone;
    }
    const changed=await run('UPDATE numbers SET status=? WHERE phone=? AND node_id=? AND profile=? AND status=?',[input.status,input.phone,node.id,node.profile,input.expectedStatus]);
    if(changed!==1)throw Error('Trạng thái đã thay đổi; chưa thực hiện');
    if(newPhone)await run("UPDATE numbers SET status='ACTIVE' WHERE phone=? AND node_id=? AND profile=? AND status='BACKUP'",[newPhone,node.id,node.profile]);
    await run('COMMIT');
   }catch(error){await run('ROLLBACK').catch(()=>{});throw error;}
   displayed.set(node.id,newPhone||input.phone);try{notify();}catch(_){}
   return {success:true,mode:sandbox?'SANDBOX':'PRODUCTION',phone:input.phone,status:input.status,newPhone};
  });queue=task.catch(()=>{});return task;
 }};
}
module.exports={createMonitorNumberStatus};
