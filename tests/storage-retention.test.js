const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');

test('local retention removes only synced old history and preserves offline outbox',async()=>{
 const ctx={indexedDB,IDBKeyRange};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('src/background/history-db.js','utf8'),ctx);
 const db=ctx.HistoryDB,now=Date.now(),day=86400000;
 const rows=[{incidentId:'old-synced',at:now-31*day},{incidentId:'old-pending',at:now-32*day},{incidentId:'recent',at:now-day}].map(e=>({...e,group:'99.153',fs:'FS01',type:'AUTO_BLOCKED'}));
 await db.append(rows);
 const all=await db.read();await db.markSynced(all.filter(e=>e.incidentId!=='old-pending'));
 assert.equal(await db.pruneSynced(now-30*day),1);
 assert.deepEqual(Array.from(await db.read(),e=>e.incidentId),['recent','old-pending']);
 assert.equal((await db.pending())[0].incidentId,'old-pending');
});

test('state pruning preserves live incident deduplication and locks',async()=>{
 const source=fs.readFileSync('src/background/background.js','utf8');
 const save=source.slice(source.indexOf('async function saveState('),source.indexOf('\nconst keyOf=Detection.keyOf'));
 let written;const ctx={chrome:{storage:{local:{set:async value=>{written=value;}}}}};vm.createContext(ctx);vm.runInContext(save,ctx);
 const old=Date.now()-4*86400000,state={fsStates:{a:{key:'node',incident:{id:'live',locked:true}}},eventKeys:{'expired|BLOCK':old,'live|BLOCK':old,'recent|BLOCK':Date.now()},events:[]};
 await ctx.saveState(state);
 assert.equal(state.eventKeys['expired|BLOCK'],undefined);
 assert.equal(state.eventKeys['live|BLOCK'],old);
 assert.ok(state.eventKeys['recent|BLOCK']);assert.equal(written.state.fsStates.a.incident.locked,true);
});
