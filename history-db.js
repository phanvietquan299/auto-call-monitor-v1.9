/* Durable audit history, separate from live monitoring state. */
(()=>{
 const types=new Set(['AUTO_BLOCKED','MANUAL_SWITCH','BLOCKED_OBSERVED','FS_TRANSFERRED','FS_ENABLED','FS_DISABLED']);
 let opening;const saved=new Map();
 const open=()=>opening||(opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open('auto-call-history',1);
  r.onupgradeneeded=()=>{const store=r.result.createObjectStore('events',{keyPath:'id'});store.createIndex('at','at');};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=null;reject(r.error);};
 }));
 async function transaction(mode,run){const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('events',mode);let result;
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('History transaction aborted'));
  run(tx.objectStore('events'),value=>{result=value;});
 });}
 async function append(events){
  const pending=(events||[]).filter(e=>types.has(e.type)&&e.incidentId&&e.fs).map(e=>({...e,id:`${e.group}|${e.fs}|${e.incidentId}|${e.type}`})).filter(e=>saved.get(e.id)!==JSON.stringify(e));
  if(!pending.length)return;
  await transaction('readwrite',store=>{for(const e of pending)store.put(e);});
  for(const e of pending)saved.set(e.id,JSON.stringify(e));
  if(saved.size>500)saved.clear();
 }
 async function read(date){
  const start=date?Date.parse(date+'T00:00:00+07:00'):null;
  if(date&&!Number.isFinite(start))throw Error('Ngày không hợp lệ');
  return transaction('readonly',(store,done)=>{
   const rows=[];const range=date?IDBKeyRange.bound(start,start+86400000,false,true):null;
   const r=store.index('at').openCursor(range,'prev');r.onsuccess=()=>{const c=r.result;if(!c){done(rows);return;}rows.push(c.value);c.continue();};
  });
 }
 async function remove(start,end){return transaction('readwrite',(store,done)=>{
  let count=0;const r=store.index('at').openCursor(IDBKeyRange.bound(start,end,false,true));
  r.onsuccess=()=>{const c=r.result;if(!c){done(count);return;}c.delete();count++;c.continue();};
 });}
 async function pending(limit=100){return transaction('readonly',(store,done)=>{
  const rows=[],r=store.openCursor();r.onsuccess=()=>{const c=r.result;if(!c||rows.length>=limit){done(rows);return;}if(!c.value.synced)rows.push(c.value);c.continue();};
 });}
 async function markSynced(events){return transaction('readwrite',store=>{for(const event of events){
  const r=store.get(event.id);r.onsuccess=()=>{if(r.result&&JSON.stringify({...r.result,synced:undefined})===JSON.stringify({...event,synced:undefined}))store.put({...r.result,synced:true});};
 }});}
 globalThis.HistoryDB={append,read,remove,pending,markSynced};
})();
