const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const text=fs.readFileSync('src/ui/dashboard.js','utf8'),ctx={Date};vm.createContext(ctx);vm.runInContext(text.slice(text.indexOf('function importantAlerts('),text.indexOf('let seenImportant=')),ctx);
const now=Date.now();
function recovering(){return {group:'99.155',groupId:3,fs:'FS06',updatedAt:now,currentVt:0,state:'RECOVERING',incident:{id:'second',isBackup:true,attemptedPhones:['old'],oldPhone:'new',autoExecuted:true,switchedAt:now-6000,vtAtSwap:10},cdr:{checkedAt:now,decision:{locked:true,newestCallTime:now}}};}
test('Ordinary successful changes and normal recovering produce no important alert',()=>{
 const f=recovering();f.currentVt=100;f.cdr.decision.locked=false;assert.equal(ctx.importantAlerts({fsStates:{a:f}},now).length,0);f.cdr.decision.locked=true;
 f.currentVt=0;f.incident.attemptedPhones=[];assert.equal(ctx.importantAlerts({fsStates:{a:f}},now).length,0);
});
test('Two failed recovery changes with fresh CDR and no VT growth alert immediately after 5s',()=>{const f=recovering();const r=ctx.importantAlerts({fsStates:{a:f}},now);assert.equal(r.length,1);assert.match(r[0].title,/2 số/);});
for(const kind of ['stale','oldCalls','inactive','paused','waiting'])test('No false recovery alert from '+kind,()=>{
 const f=recovering(),s={fsStates:{a:f}};
 if(kind==='stale')f.cdr.checkedAt=now-20000;
 if(kind==='oldCalls')f.cdr.decision.newestCallTime=now-10000;
 if(kind==='inactive')f.groupId=0;
 if(kind==='paused')s.schedule={groups:{'99.155':{paused:true}}};
 if(kind==='waiting')f.incident.switchedAt=now-2000;
 assert.equal(ctx.importantAlerts(s,now).length,0);
});
test('Failures and uncertain writes are alerts; success messages are not',()=>{
 const s={fsStates:{a:{fs:'FS01',incident:{id:'a',actionUncertain:true},actionError:'timeout'}},fsSwitchOperation:{id:'b',status:'FAILED',error:'reload failed',plan:{source:{fs:'FS05'}}}};
 assert.equal(ctx.importantAlerts(s,now).length,2);
 assert.equal(ctx.importantAlerts({importantFailures:[{id:'manual',at:now,title:'failed'}]},now).length,1);
});
