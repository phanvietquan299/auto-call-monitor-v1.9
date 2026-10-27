const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),D=require('../src/core/detection'),P=require('../src/core/collection-evening');
test('Full evening worker: verified routing, final successful BLOCK, then next-day restart; no FreeSWITCH writes',async()=>{
 let now=Date.parse('2026-10-21T17:00:00+07:00');const commands=[],reloads=[];
 const nodes=['FS01','FS02','FS03','FS04','OS01'].map((name,i)=>({fs:name,ip:'10.10.101.'+(170+i),resource:'vt',destinationId:100+i,groupId:i<2?2:0,used:100,capacity:1000}));
 const physical=new Map(nodes.map(n=>[n.fs,n.groupId]));
 const s={monitoringEnabled:true,config:{...D.CONFIG,detectionSource:'CDR',cdrRequireVtDrop:true},opensips:{'99.153':{updatedAt:now,nodes}},freeswitch:{updatedAt:now,backupCounts:Object.fromEntries(nodes.map((n,i)=>[n.fs,{source:'SUMMARY',updatedAt:now,count:[5,10,30,20,15][i]}]))},fsStates:{},events:[],eventKeys:{},pendingAutoActions:[]};
 const ctx={CollectionEvening:P,Detection:D,Date:class extends Date{static now(){return now;}},chrome:{storage:{local:{get:async()=>({})}}},saveState:async()=>{},switchTab:async()=>1,switchCommand:async(tab,msg)=>{commands.push(msg.type);if(msg.type==='READ_FS_NUMBERS')return {numbers:[{fs:'FS02',profile:'COLLECTION',status:'ACTIVE'}]};if(msg.type==='FS_SWITCH_READ_NODE')return {groupId:physical.get(msg.node.fs)};assert.equal(msg.type,'FS_SWITCH_SET_GROUP');assert.equal(physical.get(msg.node.fs),msg.expected);physical.set(msg.node.fs,msg.value);return {pageId:'old',ok:true};},refreshSwitchPage:async(tab,n,value)=>{assert.equal(physical.get(n.fs),value);reloads.push(n.fs);}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/collection-evening-worker.js','utf8'),ctx);
 await ctx.runCollectionEvening(s);assert.equal(s.collectionEvening,undefined);assert.equal(reloads.length,0);
 now=Date.parse('2026-10-21T18:01:00+07:00');s.opensips['99.153'].updatedAt=now;
 s.fsStates.a={group:'99.153',fs:'FS01',incident:{id:'last',autoExecuted:true,locked:true,switchedAt:now},state:'COOLDOWN'};
 await ctx.runCollectionEvening(s);assert.equal(s.collectionEvening.status,'NIGHT');assert.ok([...physical.values()].every(id=>id===0));assert.equal(s.schedule.groups['99.153'].paused,true);
 now=Date.parse('2026-10-22T08:00:00+07:00');s.opensips['99.153'].updatedAt=now;
 await ctx.runCollectionEvening(s);assert.equal(s.collectionEvening.status,'RESUMED');assert.deepEqual([...physical.values()],[2,2,0,0,0]);assert.equal(s.schedule.groups['99.153'].paused,false);
 assert.ok(commands.every(c=>c==='READ_FS_NUMBERS'||c==='FS_SWITCH_READ_NODE'||c==='FS_SWITCH_SET_GROUP'));
});
