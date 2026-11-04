/* Authenticated inventory reads only; no business write endpoints are exposed. */
const fs=require('fs');
function createMonitorInventory({baseUrl='http://127.0.0.1:5003',accessFile='/etc/freeswitch-automation-monitor-inventory.json',request=options=>require('axios')(options),now=Date.now}={}){
 if(baseUrl!=='http://127.0.0.1:5003')throw Error('Monitor inventory endpoint must be local production');
 let last=null,pending=null,lastAttempt=0,cookie='',authBlocked=false,authRevision=0;
 const revision=()=>{try{return fs.statSync(accessFile).mtimeMs;}catch(_){return 0;}};
 async function send(route,method='GET',data){
  if(!['/api/nodes','/api/numbers','/api/login'].includes(route)||method!==(route==='/api/login'?'POST':'GET'))throw Error('Inventory request not permitted');
  return request({url:baseUrl+route,method,data,headers:cookie?{Cookie:cookie}:{},timeout:4000,maxRedirects:0,maxContentLength:2000000,proxy:false,validateStatus:()=>true});
 }
 async function readRows(){
  if(authBlocked&&authRevision===revision())throw Error('Inventory login requires updated credentials');
  let response=await send('/api/nodes');
  if(response.status===401){
   const access=JSON.parse(fs.readFileSync(accessFile,'utf8'));
   if(!access.username||!access.password)throw Error('Inventory credentials missing');
   const login=await send('/api/login','POST',{username:access.username,password:access.password});
   if(login.status!==200||!login.data?.success){authBlocked=true;authRevision=revision();cookie='';throw Error('Inventory authentication failed');}
   const cookies=login.headers?.['set-cookie']||[];cookie=(Array.isArray(cookies)?cookies:[cookies]).map(value=>String(value).split(';')[0]).join('; ');
   if(!cookie)throw Error('Inventory login did not create a session');
   authBlocked=false;response=await send('/api/nodes');
  }
  if(response.status!==200||!Array.isArray(response.data))throw Error('Inventory nodes unavailable');
  const numbers=await send('/api/numbers');
  if(numbers.status!==200||!Array.isArray(numbers.data))throw Error('Inventory numbers unavailable');
  return response.data.map(node=>({id:node.id,host:node.host,profile:node.profile,active_num:Number(node.active_num)||0,backup_num:Number(node.backup_num)||0,blocked_num:Number(node.blocked_num)||0,total_num:Number(node.total_num)||0,
   activePhones:numbers.data.filter(row=>row.node_id===node.id&&row.profile===node.profile&&row.status==='ACTIVE').map(row=>String(row.phone))}));
 }
 return {async read(){
  if(pending)return pending;
  if(last&&now()-lastAttempt<2000)return {...last,fresh:last.fresh&&now()-last.at<=10000};
  lastAttempt=now();
  pending=(async()=>{try{last={source:'5003',at:now(),fresh:true,error:null,nodes:await readRows()};last.at=now();}
   catch(_){last={source:'5003',at:last?.at||null,nodes:last?.nodes||[],fresh:false,error:'Không đọc được kho số 5003'};}
   return last;
  })();
  try{return await pending;}finally{pending=null;}
 }};
}
module.exports={createMonitorInventory};
