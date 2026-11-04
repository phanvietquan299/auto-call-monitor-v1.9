/* Production Monitor adapter: only SELECTs on the application's existing inventory. */
function createLocalMonitorInventory({all,now=Date.now}){
 let last=null,pending=null,lastAttempt=0;
 const sql=`SELECT n.id,n.host,n.profile,COUNT(num.id) AS total_num,
 SUM(CASE WHEN num.status='ACTIVE' THEN 1 ELSE 0 END) AS active_num,
 SUM(CASE WHEN num.status='BACKUP' THEN 1 ELSE 0 END) AS backup_num,
 SUM(CASE WHEN num.status='BLOCKED' THEN 1 ELSE 0 END) AS blocked_num,
 GROUP_CONCAT(CASE WHEN num.status='ACTIVE' THEN num.phone END) AS active_phones
 FROM nodes n LEFT JOIN numbers num ON num.node_id=n.id AND num.profile=n.profile GROUP BY n.id ORDER BY n.id`;
 return {async read(){
  if(pending)return pending;
  if(last&&now()-lastAttempt<2000)return {...last,fresh:last.fresh&&now()-last.at<=10000};
  lastAttempt=now();pending=(async()=>{
   try {const rows=await all(sql);last={source:'5003',fresh:true,at:now(),error:null,nodes:rows.map(row=>({id:row.id,host:row.host,profile:row.profile,total_num:Number(row.total_num)||0,active_num:Number(row.active_num)||0,backup_num:Number(row.backup_num)||0,blocked_num:Number(row.blocked_num)||0,activePhones:row.active_phones?row.active_phones.split(','):[]}))};}
   catch(_){last={source:'5003',fresh:false,at:last?.at||null,nodes:last?.nodes||[],error:'Không đọc được kho số'};}
   return last;
  })();try{return await pending;}finally{pending=null;}
 }};
}
module.exports={createLocalMonitorInventory};
