/* Supabase is authoritative; IndexedDB retains migration data and offline outbox. */
(()=>{
 const local=globalThis.HistoryDB,config=globalThis.SupabaseHistoryConfig;
 if(!local||!config?.url||!config?.anonKey||!config?.historyToken)throw Error('Missing Supabase history config');
 let syncing=null,retryAt=0,lastError='',lastSync=0,lastPrune=0,mutation=Promise.resolve();
 const cache=new Map();
 async function rpc(action,args={}){
  const response=await fetch(config.url+'/rest/v1/rpc/call_monitor_history',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.historyToken,p_action:action,...args}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Supabase history HTTP '+response.status);
  return response.json();
 }
 function exclusive(fn){const next=mutation.then(fn);mutation=next.catch(()=>{});return next;}
 function flush(){
  if(syncing||Date.now()<retryAt)return syncing||Promise.resolve();
  syncing=exclusive(async()=>{
   for(let batch=await local.pending();batch.length;batch=await local.pending()){
    await rpc('append',{p_events:batch});await local.markSynced(batch);cache.clear();
   }
   const now=Date.now();
   if(local.pruneSynced&&now-lastPrune>=3600000){await local.pruneSynced(now-30*86400000);lastPrune=now;}
   lastError='';lastSync=now;
  }).catch(error=>{lastError=String(error.message||error);retryAt=Date.now()+15000;}).finally(()=>{syncing=null;});
  return syncing;
 }
 async function append(events){await local.append(events);flush();}
 async function read(date){
  flush();
  for(const [key,value] of cache)if(Date.now()-value.at>=5000)cache.delete(key);
  const cached=cache.get(date);
  if(cached&&Date.now()-cached.at<5000)return cached.events;
  try{
   const start=date?Date.parse(date+'T00:00:00+07:00'):null;
   if(date&&!Number.isFinite(start))throw Error('Invalid date');
   const events=[];
   for(let offset=0;;offset+=500){const page=await rpc('read',{p_start:start,p_end:start==null?null:start+86400000,p_offset:offset});if(!Array.isArray(page))throw Error('Invalid history response');events.push(...page);if(page.length<500)break;}
   const pending=(await local.read(date)).filter(e=>!e.synced);
   const merged=[...new Map([...events,...pending].map(e=>[e.id,e])).values()].sort((a,b)=>b.at-a.at);
   cache.clear();if(merged.length<=1000)cache.set(date,{at:Date.now(),events:merged});lastError='';return merged;
  }catch(error){lastError=String(error.message||error);return local.read(date);}
 }
 async function remove(start,end){
  return exclusive(async()=>{
   // Flush outstanding logs before deleting, so an offline log cannot reappear.
   for(let batch=await local.pending();batch.length;batch=await local.pending()){
    await rpc('append',{p_events:batch});await local.markSynced(batch);
   }
   const result=await rpc('delete',{p_start:start,p_end:end});
   const count=await local.remove(start,end);cache.clear();return Math.max(count,result.deleted||0);
  });
 }
 globalThis.LocalHistoryDB=local;
 globalThis.HistoryDB={append,read,remove};
 globalThis.CloudHistory={flush,status:()=>({source:'SUPABASE',lastSync,error:lastError})};
 chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='history-cloud-sync')flush();});
 chrome.alarms.create('history-cloud-sync',{periodInMinutes:0.5});
 flush();
})();
