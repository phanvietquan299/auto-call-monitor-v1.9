const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
test('Durable history keeps older logs across worker restart, deduplicates migration, filters VN date, deletes only selected interval',async()=>{
 const indexedDB=new IDBFactory();
 function worker(){const ctx={indexedDB,IDBKeyRange};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/history-db.js','utf8'),ctx);return ctx.HistoryDB;}
 let db=worker();const at=Date.parse('2026-09-01T10:00:00+07:00');
 const events=[{type:'AUTO_BLOCKED',incidentId:'a',fs:'FS01',group:'99.153',at},{type:'FS_TRANSFERRED',incidentId:'b',fs:'FS02',targetFs:'FS03',group:'99.153',at:at+86400000},{type:'AUTO_FAILED',incidentId:'c',fs:'FS01',at}];
 await db.append(events);await db.append(events);assert.equal((await db.read('')).length,2);
 db=worker();await db.append(events);assert.equal((await db.read('')).length,2);
 assert.equal((await db.read('2026-09-01')).length,1);
 assert.equal(await db.remove(at,at+1),1);assert.equal((await db.read('')).length,1);
 assert.equal((await db.read('2026-09-02'))[0].targetFs,'FS03');
});
test('Outbox sync markers persist and never mark a newer event revision synced',async()=>{
 const indexedDB=new IDBFactory(),ctx={indexedDB,IDBKeyRange};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/history-db.js','utf8'),ctx);
 const event={type:'AUTO_BLOCKED',incidentId:'one',fs:'FS01',group:'99.153',at:1};
 await ctx.HistoryDB.append([event]);const first=await ctx.HistoryDB.pending();assert.equal(first.length,1);
 await ctx.HistoryDB.append([{...event,targetFs:'FS02'}]);await ctx.HistoryDB.markSynced(first);assert.equal((await ctx.HistoryDB.pending()).length,1);
 await ctx.HistoryDB.markSynced(await ctx.HistoryDB.pending());assert.equal((await ctx.HistoryDB.pending()).length,0);
 const restarted={indexedDB,IDBKeyRange};vm.createContext(restarted);vm.runInContext(fs.readFileSync('src/background/history-db.js','utf8'),restarted);
 assert.equal((await restarted.HistoryDB.pending()).length,0);
});
