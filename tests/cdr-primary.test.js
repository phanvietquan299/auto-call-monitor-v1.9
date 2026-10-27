const test=require('node:test'),assert=require('node:assert/strict'),D=require('../src/core/detection');
const now=Date.parse('2026-10-11T14:00:00+07:00');
function confirmStartup(s,f,at=now){assert.equal(D.cdrGate(s,f,at).ready,true);f.cdr.decision.checkedAt=at+2000;f.cdr.decision.newestCallTime=at+1000;f.updatedAt=at+2000;f.groupIdAt=at+2000;D.refreshAlerts(s,at+2000);assert.equal(D.cdrGate(s,f,at+2000).ready,true);}
function fixture(){
 const f={key:'99.155|FS05|10.10.101.58',group:'99.155',fs:'FS05',ip:'10.10.101.58',groupId:3,groupIdAt:now,updatedAt:now,state:'HEALTHY',currentVt:600,history:[],cdr:{decision:{locked:true,count:5,consecutiveTotal:5,eligibleCount:5,newestCallTime:now-1000,checkedAt:now,phone:'active',group:'99.155',ip:'10.10.101.58'}}};
 const s={monitoringEnabled:true,config:{...D.CONFIG,detectionSource:'CDR',cdrVerificationEnabled:true},fsStates:{[f.key]:f},freeswitch:{updatedAt:now,numbers:[{fs:'FS05',profile:'TELESALE',phone:'active',status:'ACTIVE'}]},events:[],eventKeys:{},pendingAutoActions:[]};return {s,f};
}
test('CDR primary recovery does not depend on VT rising',()=>{
 const {s,f}=fixture();D.refreshAlerts(s,now);assert.equal(f.state,'SUSPECTED');
 f.incident={...f.incident,locked:true,autoExecuted:true,switchedAt:now-5000};f.currentVt=0;
 Object.assign(f.cdr.decision,{locked:false,count:0,newestCallTime:now-1000});
 D.refreshAlerts(s,now);assert.equal(f.state,'HEALTHY');assert.equal(f.incident,null);
});
test('CDR primary backup needs fresh post-action calls and waits five seconds; never reblocks the same ACTIVE phone',()=>{
 const {s,f}=fixture();D.refreshAlerts(s,now);const oldId=f.incident.id;
 f.incident={...f.incident,locked:true,autoExecuted:true,switchedAt:now-4000,oldPhone:'old'};
 D.refreshAlerts(s,now);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.id,oldId);
 f.incident.switchedAt=now-5000;D.refreshAlerts(s,now);
 assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.isBackup,true);assert.equal(f.incident.previousPhone,'old');
 f.incident={...f.incident,locked:true,autoExecuted:true,switchedAt:now-16000};D.refreshAlerts(s,now);
 assert.equal(f.state,'RECOVERING');assert.equal(f.incident.isBackup,true);
});
test('CDR primary ignores wrong phone, stale response and errors',()=>{
 for(const mutation of [{phone:'other'},{checkedAt:now-16000},{error:'Search failed'}]){
  const {s,f}=fixture();Object.assign(f.cdr.decision,mutation);D.refreshAlerts(s,now);
  assert.equal(f.state,'WAITING_CDR');assert.equal(s.alerts.length,0);
 }
});
test('CDR primary still respects schedule and monitoring OFF',()=>{
 for(const [at,monitor] of [[Date.parse('2026-10-11T17:00:00+07:00'),true],[now,false]]){
  const {s,f}=fixture();s.monitoringEnabled=monitor;f.groupIdAt=at;f.updatedAt=at;f.cdr.decision.checkedAt=at;
  D.refreshAlerts(s,at);assert.equal(s.alerts.length,0);
 }
});
test('CDR requires two distinct positive reads, not dashboard refreshes',()=>{
 const {s,f}=fixture();D.refreshAlerts(s,now);
 assert.equal(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now).ready,false);
 D.refreshAlerts(s,now+1000);assert.equal(f.incident.cdrConfirmationReads,1);
 f.cdr.decision.checkedAt=now+5000;D.refreshAlerts(s,now+5000);
 assert.equal(f.incident.cdrConfirmationReads,2);assert.equal(D.cdrGate(s,f,now+5000).ready,true);
});
test('A below-threshold second read keeps the number unchanged and cancels suspicion',()=>{
 const {s,f}=fixture();D.refreshAlerts(s,now);
 Object.assign(f.cdr.decision,{checkedAt:now+5000,locked:false,count:4});D.refreshAlerts(s,now+5000);
 assert.equal(f.state,'HEALTHY');assert.equal(f.incident,null);assert.equal(D.cdrGate(s,f,now+5000).ready,false);
 assert.equal(s.freeswitch.numbers[0].status,'ACTIVE');
});
test('Failed read interrupts the two-read confirmation',()=>{
 const {s,f}=fixture();D.refreshAlerts(s,now);
 Object.assign(f.cdr.decision,{checkedAt:now+5000,error:'Search failed'});D.refreshAlerts(s,now+5000);
 delete f.cdr.decision.error;f.cdr.decision.checkedAt=now+10000;D.refreshAlerts(s,now+10000);
 assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,now+10000).ready,false);
});
test('Hybrid requires live VT collapse and one qualifying CDR read, not two',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=600;
 D.refreshAlerts(s,now);assert.equal(f.state,'WARNING');assert.equal(f.incident,undefined);
 f.currentVt=100;D.refreshAlerts(s,now);
 assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,now).ready,true);
 f.currentVt=500;D.refreshAlerts(s,now);assert.equal(f.state,'WARNING');assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('Hybrid freezes twenty-sample baseline on a collapse; missing baseline or stale VT cannot trigger',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.opensips={};f.baseline=null;f.cdr=null;
 const node=vt=>({fs:f.fs,ip:f.ip,groupId:3,resource:'vt',used:vt});
 for(let i=0;i<20;i++)D.sample(s,f.group,[node(600)],now+i*1000);
 assert.equal(f.baseline,600);
 D.sample(s,f.group,[node(100)],now+20000);assert.equal(f.baseline,600);
 assert.equal(D.cdrVtDrop(s,f,now+20000),true);
 assert.equal(D.cdrVtDrop(s,f,now+70000),false);
 f.baseline=null;assert.equal(D.cdrVtDrop(s,f,now+20000),false);
});
test('Hybrid ignores positive CDR captured before the current VT collapse',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;f.vtDropAt=now;
 f.cdr.decision.checkedAt=now-1000;D.refreshAlerts(s,now);
 assert.equal(f.state,'WARNING');assert.equal(D.cdrGate(s,f,now).ready,false);
 f.cdr.decision.checkedAt=now;D.refreshAlerts(s,now);assert.equal(D.cdrGate(s,f,now).ready,true);
});
test('Manual hybrid holds 5/5 evidence across negative/error CDR reads, but not VT recovery or phone changes',()=>{
 for(const ending of ['VT','phone','cancel','automatic']){
  const {s,f}=fixture();Object.assign(s,{autoEnabled:true,autoBlockMode:'MANUAL'});s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;
  D.refreshAlerts(s,now);const id=f.incident.id;
  Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:now+2000});f.updatedAt=now+2000;D.refreshAlerts(s,now+2000);
  assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.id,id);assert.equal(D.cdrGate(s,f,now+2000).ready,true);
  f.cdr.decision.error='Search failed';f.updatedAt=now+20000;f.groupIdAt=now+20000;D.refreshAlerts(s,now+20000);
  assert.equal(D.cdrGate(s,f,now+20000).ready,true);
  if(ending==='VT'){f.currentVt=600;D.refreshAlerts(s,now+20000);assert.equal(D.cdrGate(s,f,now+20000).ready,true);continue;}
  if(ending==='phone')s.freeswitch.numbers[0].phone='changed';
  if(ending==='cancel')f.incident.cancelled=true;
  if(ending==='automatic')s.autoBlockMode='AUTOMATIC';
  D.refreshAlerts(s,now+20000);assert.equal(D.cdrGate(s,f,now+20000).ready,false);
 }
});
for(const mode of ['MANUAL','AUTOMATIC'])test(`Hybrid ${mode} stable policy retains earlier CDR through a negative read within fifteen seconds`,()=>{
 const {s,f}=fixture();Object.assign(s,{autoEnabled:true,autoBlockMode:mode});s.config.cdrRequireVtDrop=true;
 f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;
 D.refreshAlerts(s,now);assert.equal(f.state,'WARNING');assert.ok(f.pairedCdrProof);
 Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:now+2000});f.currentVt=100;f.updatedAt=now+2000;f.groupIdAt=now+2000;f.vtDropAt=now+2000;
 D.refreshAlerts(s,now+2000);assert.equal(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now+2000).ready,true);
 assert.equal(f.pairedCdrProof.suspended,undefined);assert.equal(f.pairedCdrProof.checkedAt,now);
 Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:now+4000});f.updatedAt=now+4000;f.groupIdAt=now+4000;
 D.refreshAlerts(s,now+4000);assert.equal(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now+4000).ready,true);
 assert.equal(f.pairedCdrProof.suspended,undefined);if(mode==='MANUAL')assert.ok(f.incident.manualCdrProof);
});
for(const group of ['99.153','99.155'])test(`Hybrid ${group} stable policy keeps held CDR after two negative responses until its expiry`,()=>{
 const {s,f}=fixture();s.autoBlockMode='AUTOMATIC';s.config.cdrRequireVtDrop=true;
 if(group==='99.153'){f.group=group;f.fs='FS01';f.ip='10.10.101.176';f.groupId=2;s.freeswitch.numbers[0].fs=f.fs;s.freeswitch.numbers[0].profile='COLLECTION';Object.assign(f.cdr.decision,{group,ip:f.ip});}
 f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;D.refreshAlerts(s,now);
 Object.assign(f.cdr.decision,{locked:false,count:4,checkedAt:now+2000});f.currentVt=100;f.updatedAt=now+2000;f.groupIdAt=now+2000;
 D.refreshAlerts(s,now+2000);assert.equal(f.pairedCdrProof.clearReads,undefined);
 for(let i=0;i<5;i++)D.refreshAlerts(s,now+2000+i*100);assert.equal(f.pairedCdrProof.clearReads,undefined);
 Object.assign(f.cdr.decision,{checkedAt:now+4000,count:1});f.updatedAt=now+4000;f.groupIdAt=now+4000;
 D.refreshAlerts(s,now+4000);assert.ok(f.pairedCdrProof);assert.equal(D.cdrGate(s,f,now+4000).ready,true);
 f.updatedAt=now+16000;f.groupIdAt=now+16000;D.refreshAlerts(s,now+16000);assert.equal(D.cdrGate(s,f,now+16000).ready,false);
});
for(const kind of ['error','empty','malformed','wrong-phone'])test(`Hybrid does not count ${kind} as a negative CDR read`,()=>{
 const {s,f}=fixture();s.autoBlockMode='AUTOMATIC';s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;D.refreshAlerts(s,now);
 Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:now+2000});
 if(kind==='error')f.cdr.decision.error='Search failed';
 if(kind==='empty')f.cdr.decision.eligibleCount=0;
 if(kind==='malformed')delete f.cdr.decision.eligibleCount;
 if(kind==='wrong-phone')f.cdr.decision.phone='other';
 f.updatedAt=now+2000;f.groupIdAt=now+2000;D.refreshAlerts(s,now+2000);
 assert.ok(f.pairedCdrProof);assert.equal(f.pairedCdrProof.clearReads,undefined);assert.equal(f.pairedCdrProof.suspended,undefined);
});
test('Stable retained proof refreshes on a positive response without introducing negative-read counters',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;D.refreshAlerts(s,now);
 for(const [offset,locked] of [[2000,false],[4000,true],[6000,false]]){Object.assign(f.cdr.decision,{locked,count:locked?5:0,checkedAt:now+offset});f.updatedAt=now+offset;f.groupIdAt=now+offset;D.refreshAlerts(s,now+offset);}
 assert.equal(f.pairedCdrProof.clearReads,undefined);assert.equal(f.pairedCdrProof.suspended,undefined);assert.equal(f.pairedCdrProof.checkedAt,now+4000);
});
for(const reason of ['expiry','recovered','phone','inactive','new-activation'])test(`Earlier CDR proof cannot act after ${reason}`,()=>{
 const {s,f}=fixture();s.autoBlockMode='AUTOMATIC';s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;
 D.refreshAlerts(s,now);assert.ok(f.pairedCdrProof);
 const at=reason==='expiry'?now+16000:now+2000;f.currentVt=100;f.updatedAt=at;f.groupIdAt=at;
 Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:at});
 if(reason==='recovered')f.currentVt=600;
 if(reason==='phone')s.freeswitch.numbers[0].phone='new';
 if(reason==='inactive')f.groupId=0;
 if(reason==='new-activation')f.cdrEnabledAt=at;
 D.refreshAlerts(s,at);assert.equal(D.pairedCdrProof(s,f,at),null);assert.equal(D.cdrGate(s,f,at).ready,false);
});
for(const [vt,locked,expected] of [[600,false,'HEALTHY'],[400,false,'WATCHING'],[250,false,'WARNING'],[0,false,'WARNING'],[600,true,'WARNING'],[100,true,'SUSPECTED']])test(`Hybrid state uses VT ${vt} and CDR ${locked}: ${expected}`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=vt;f.cdr.decision.locked=locked;f.cdr.decision.count=locked?5:0;
 D.refreshAlerts(s,now);assert.equal(f.state,expected);
});
test('Hybrid state marks low VT as warning even when CDR is unavailable',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=0;f.cdr=null;
 D.refreshAlerts(s,now);assert.equal(f.state,'WARNING');assert.match(f.detectionNote,/chờ CDR/);assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('Hybrid relearns settled low traffic with negative CDR, but never learns away a locked FS',()=>{
 for(const locked of [false,true]){
  const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;f.vtDeclineAt=now-130000;
  f.history=Array.from({length:61},(_,i)=>({time:now-60000+i*1000,vt:100}));f.cdr.decision.locked=locked;
  D.relearnHybridBaseline(s,f,now);assert.equal(f.baseline,locked?600:100);
 }
});
test('Hybrid peer needs new locked CDR after group action; old evidence and recovering peer cannot cause a second change',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;D.refreshAlerts(s,now);
 s.groupTrials={[f.group]:{fs:'FS07',completedAt:now+1000,until:now+10000,peers:{[f.key]:100}}};
 const at=now+11000;f.updatedAt=at;f.groupIdAt=at;
 assert.equal(D.groupActionGate(s,f,at).ready,false);
 Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:at});assert.equal(D.groupActionGate(s,f,at).ready,false);
 Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:at,oldestConfirmedCallTime:at-500});D.refreshAlerts(s,at);
 assert.equal(D.groupActionGate(s,f,at).ready,true);
});
test('Baseline relearning explains the actual blocking condition',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=619;f.currentVt=303;f.vtDeclineAt=now-30000;
 f.cdr.decision.locked=false;
 D.relearnHybridBaseline(s,f,now);assert.match(f.baselineRelearnNote,/90s/);assert.equal(f.baseline,619);
 f.cdr.decision.error='Search failed';D.relearnHybridBaseline(s,f,now);assert.match(f.baselineRelearnNote,/CDR mới/);
});
for(const vt of [0,20])test(`Recently activated FS at VT ${vt} can detect locked without baseline after five seconds`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=vt;f.activatedAt=now-6000;f.activationInitialVt=vt;
 f.history=[{time:now-4000,vt},{time:now-1000,vt}];
 D.refreshAlerts(s,now);assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.activationRecovery,true);confirmStartup(s,f);
});
for(const reason of ['no-new-vt','old-calls','old-response'])test(`Activation detection refuses ${reason}`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;f.activatedAt=now-6000;f.activationInitialVt=0;
 f.history=[{time:now-4000,vt:0},{time:now-1000,vt:0}];
 if(reason==='no-new-vt')f.history=[];
 if(reason==='rising')f.currentVt=10;
 if(reason==='old-calls')f.cdr.decision.newestCallTime=now-7000;
 if(reason==='old-response')f.cdr.decision.checkedAt=now-7000;
 D.refreshAlerts(s,now);assert.notEqual(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('Hybrid backup waits five seconds, requires fresh post-swap CDR, and does not reblock the same ACTIVE phone',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;
 f.incident={id:'first',locked:true,autoExecuted:true,switchedAt:now-4000,oldPhone:'old',vtAtSwap:0};
 f.history=[{time:now-4000,vt:0},{time:now-1000,vt:0}];
 D.refreshAlerts(s,now);assert.equal(f.state,'RECOVERING');
 f.incident.switchedAt=now-5000;D.refreshAlerts(s,now);
 assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.isBackup,true);assert.equal(D.cdrGate(s,f,now).ready,true);
 f.incident={...f.incident,locked:true,autoExecuted:true,switchedAt:now-16000,oldPhone:'active'};
 D.refreshAlerts(s,now);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.isBackup,true);
});
test('Hybrid backup waits if VT increased despite fresh locked CDR',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;
 f.incident={id:'first',locked:true,autoExecuted:true,switchedAt:now-16000,oldPhone:'old',vtAtSwap:0};
 f.history=[{time:now-4000,vt:90},{time:now-1000,vt:100}];D.refreshAlerts(s,now);
 assert.equal(f.state,'RECOVERING');assert.equal(f.incident.id,'first');assert.equal(D.cdrGate(s,f,now).ready,false);
});

test('Hybrid backup keeps checking after many CDR reads below threshold and later triggers with fresh 5/5',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;
 f.incident={id:'first',locked:true,autoExecuted:true,switchedAt:now-8000,oldPhone:'old',vtAtSwap:0};
 for(let step=0;step<12;step++){
  const at=now+step*2000;f.updatedAt=at;f.groupIdAt=at;
  f.history=[{time:at-2000,vt:0},{time:at-1000,vt:0}];
  Object.assign(f.cdr.decision,{locked:false,count:step%5,checkedAt:at,newestCallTime:at-500});
  D.refreshAlerts(s,at);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.id,'first');
 }
 const at=now+24000;f.updatedAt=at;f.groupIdAt=at;
 Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:at,newestCallTime:at-500});
 D.refreshAlerts(s,at);assert.equal(f.incident.isBackup,true);assert.equal(f.state,'SUSPECTED');
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Hybrid ${mode} does not wait for group trial when VT and CDR qualify`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.autoEnabled=true;s.autoBlockMode=mode;
 f.baseline=600;f.currentVt=100;D.refreshAlerts(s,now);
 s.groupTrials={[f.group]:{fs:'FS07',completedAt:now-1000,until:now+8000,peers:{[f.key]:100}}};
 f.cdr.decision.oldestConfirmedCallTime=now-500;
 assert.equal(D.groupActionGate(s,f,now).ready,true);
});

test('Stable newly enabled FS accepts one qualifying CDR read without a fixed five-second delay',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;
 f.activatedAt=now-2000;f.activationInitialVt=0;f.history=[{time:now-1000,vt:0}];
 D.refreshAlerts(s,now);assert.equal(f.state,'SUSPECTED');confirmStartup(s,f);
});
test('Verified hybrid FS rotation does not add thirty seconds to number backup wait',()=>{
 const {s,f}=fixture();f.incident={isBackup:true};
 s.rotationBarriers=D.rotationBarriers({operation:{status:'DONE',stage:'ROUTING_VERIFIED',startedAt:now-2000,finishedAt:now-1000,plan:{group:f.group}}});
 assert.equal(D.backupReady(s,f,now),true);
});
for(const blocked of ['stale-response','old-calls','uncertain','pending','same-phone','monitor-off','inactive'])test('Repeated backup does not run with '+blocked,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.currentVt=0;
 f.incident={id:'second',isBackup:true,attemptedPhones:['first'],oldPhone:'second',autoExecuted:true,locked:true,switchedAt:now-6000,vtAtSwap:0};
 f.history=[{time:now-4000,vt:0},{time:now-1000,vt:0}];
 if(blocked==='stale-response')f.cdr.decision.checkedAt=now-20000;
 if(blocked==='old-calls')f.cdr.decision.newestCallTime=now-7000;
 if(blocked==='uncertain')f.incident.actionUncertain=true;
 if(blocked==='pending')f.incident.actionPending=true;
 if(blocked==='vt-rise')f.currentVt=10;
 if(blocked==='same-phone')f.cdr.decision.phone=s.freeswitch.numbers[0].phone='second';
 if(blocked==='monitor-off')s.monitoringEnabled=false;
 if(blocked==='inactive')f.groupId=0;
 D.refreshAlerts(s,now);assert.equal(f.incident.id,'second');
});
for(const kind of ['missing','error','stale','valid'])test('Post-swap retry does not use held failure proof instead of latest '+kind+' CDR',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=0;f.vtDeclineAt=now-20000;
 f.incident={id:'changed',locked:true,autoExecuted:true,switchedAt:now-6000,oldPhone:'old',vtAtSwap:0};
 f.pairedCdrProof={...f.cdr.decision,group:f.group,ip:f.ip};
 if(kind==='missing')f.cdr.decision=null;
 if(kind==='error')f.cdr.decision.error='CDR failed';
 if(kind==='stale')f.cdr.decision.checkedAt=now-20000;
 if(kind==='valid')Object.assign(f.cdr.decision,{locked:false,count:0});
 D.refreshAlerts(s,now);assert.equal(f.incident.id,'changed');assert.equal(f.state,'RECOVERING');
});
for(const mode of ['MANUAL','AUTOMATIC'])test(`Post-swap ${mode}: closed recovery requires a new VT drop before another CDR-triggered change`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.autoEnabled=true;s.autoBlockMode=mode;
 f.incident={id:'confirmed',oldPhone:'old',autoExecuted:true,locked:true,switchedAt:now-10000,vtAtSwap:0};
 f.currentVt=400;Object.assign(f.cdr.decision,{locked:false,count:0});
 D.refreshAlerts(s,now);assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,null);assert.equal(f.postSwapWatch,null);
 Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:now+1000,newestCallTime:now+500});f.currentVt=500;f.updatedAt=f.groupIdAt=s.freeswitch.updatedAt=now+1000;
 D.refreshAlerts(s,now+1000);assert.equal(f.incident,null);assert.equal(D.cdrGate(s,f,now+1000).ready,false);
});
test('ACTIVE-only inventory permits confirmed backup; missing proof or contradicting old row blocks it',()=>{
 const {s,f}=fixture();f.incident={isBackup:true,oldPhone:'active',previousPhone:'old',attemptedPhones:['old']};
 assert.equal(D.backupTargetValid(s,f,now),false);
 f.lastIncident={oldPhone:'old',autoExecuted:true,switchedAt:now-10000};assert.equal(D.backupTargetValid(s,f,now),true);
 s.freeswitch.numbers.push({fs:f.fs,profile:'TELESALE',phone:'old',status:'BACKUP'});assert.equal(D.backupTargetValid(s,f,now),false);
});
test('Old perpetual watcher from a previous version cannot trigger a CDR-only new change',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=500;
 f.lastIncident={id:'done',oldPhone:'old',autoExecuted:true,closed:true,switchedAt:now-10000};
 f.postSwapWatch={confirmed:true,activePhone:'active',previousPhone:'old',switchedAt:now-10000,parentIncidentId:'done'};
 D.refreshAlerts(s,now);assert.equal(f.incident,undefined);assert.equal(f.postSwapWatch,null);assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('A queued backup from a closed recovery is retired and cannot bypass initial VT conditions',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=500;
 f.lastIncident={id:'done',oldPhone:'old',autoExecuted:true,closed:true,switchedAt:now-10000};
 f.incident={id:'wrong-backup',parentIncidentId:'done',oldPhone:'active',previousPhone:'old',isBackup:true,postSwapCdrFailure:true};
 D.refreshAlerts(s,now);assert.equal(f.incident,null);assert.equal(D.cdrGate(s,f,now).ready,false);
});
for(const mode of ['MANUAL','AUTOMATIC'])test(`Backup ${mode}: rising VT withdraws a queued backup even with latched CDR proof`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.autoEnabled=true;s.autoBlockMode=mode;f.baseline=600;f.currentVt=100;
 const parent={id:'parent',oldPhone:'old',autoExecuted:true,locked:true,switchedAt:now-10000,vtAtSwap:0};
 f.lastIncident=parent;f.incident={id:'queued',parentIncidentId:'parent',isBackup:true,postSwapCdrFailure:true,vtAtSwap:0,oldPhone:'active',previousPhone:'old'};
 f.cdr.decision.incidentId='queued';f.incident.manualCdrProof={...f.cdr.decision};
 D.refreshAlerts(s,now);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.id,'parent');assert.equal(D.cdrGate(s,f,now).ready,false);
});

test('Stable action gate permits valid retained proof despite a newer negative response',()=>{
 const {s,f}=fixture();s.autoBlockMode='AUTOMATIC';s.autoEnabled=true;s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;f.vtDeclineAt=now;D.refreshAlerts(s,now);assert.equal(D.cdrGate(s,f,now).ready,true);
 Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:now+2000});f.updatedAt=now+2000;f.groupIdAt=now+2000;
 assert.equal(D.groupActionGate(s,f,now+2000).ready,true);assert.equal(f.pairedCdrProof.suspended,undefined);
});

test('Stable startup refuses CDR-only blocking when VT increases from zero',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.activatedAt=now-3000;f.activationInitialVt=0;f.currentVt=20;f.baseline=null;f.history=[{time:now-1000,vt:20}];D.refreshAlerts(s,now);assert.notEqual(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('Stable healthy high VT continues to reject CDR-only incidents',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.activatedAt=now-3000;f.activationInitialVt=0;f.currentVt=600;f.baseline=600;f.history=[{time:now-1000,vt:600}];Object.assign(f.cdr.decision,{locked:false,count:0});D.refreshAlerts(s,now);assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,600);Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:now+2000});f.updatedAt=now+2000;f.groupIdAt=now+2000;D.refreshAlerts(s,now+2000);assert.notEqual(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now+2000).ready,false);
});
for(const group of ['99.153','99.155'])test(`13:00 ${group} 13:00 checks fresh CDR twice without changing ordinary activation metadata`,()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.autoEnabled=true;s.autoBlockMode='AUTOMATIC';
 if(group==='99.153'){f.group=group;f.fs='FS01';f.ip='10.10.101.176';f.groupId=2;s.freeswitch.numbers[0].fs=f.fs;s.freeswitch.numbers[0].profile='COLLECTION';}
 const at=Date.parse('2026-10-22T13:00:00+07:00');f.updatedAt=at-1000;f.groupIdAt=at;f.currentVt=1;f.baseline=600;f.activatedAt=at-3600000;f.activationInitialVt=0;
 s.schedule={groups:{[group]:{...D.scheduleAt(at-1000,s.config,group)}}};D.applySchedule(s,at);assert.equal(f.activatedAt,at-3600000);assert.equal(f.cdrEnabledAt,at);assert.equal(f.scheduledCdrAt,at);assert.equal(f.cdr,null);assert.equal(f.baseline,null);
 f.history=[{time:at+1000,vt:2}];f.currentVt=2;f.updatedAt=at+2000;f.groupIdAt=at+2000;f.cdr={decision:{locked:true,count:5,eligibleCount:5,newestCallTime:at-1000,checkedAt:at+2000,phone:'active',group,ip:f.ip}};D.refreshAlerts(s,at+2000);assert.notEqual(f.state,'SUSPECTED');
 f.cdr.decision.newestCallTime=at+1000;D.refreshAlerts(s,at+2000);assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,at+2000).ready,false);
 Object.assign(f.cdr.decision,{checkedAt:at+4000,newestCallTime:at+3000});f.updatedAt=at+4000;f.groupIdAt=at+4000;D.refreshAlerts(s,at+4000);assert.equal(f.incident.cdrConfirmationReads,2);assert.equal(D.cdrGate(s,f,at+4000).ready,true);
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Stable startup ${mode} qualifies on one fresh 5/5 read while VT stays at its initial level`,()=>{
 const {s,f}=fixture();s.autoEnabled=true;s.autoBlockMode=mode;s.config.cdrRequireVtDrop=true;f.activatedAt=now-3000;f.activationInitialVt=1;f.baseline=null;f.currentVt=1;f.history=[{time:now-1000,vt:1}];D.refreshAlerts(s,now);
 assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,now).ready,true);
 for(let i=0;i<5;i++)D.refreshAlerts(s,now+i*100);assert.equal(f.incident.cdrConfirmationReads,1);
 if(mode==='MANUAL')assert.ok(f.incident.manualCdrProof);
 else {Object.assign(f.cdr.decision,{locked:false,count:0,checkedAt:now+2000});f.updatedAt=now+2000;f.groupIdAt=now+2000;D.refreshAlerts(s,now+2000);assert.equal(D.cdrGate(s,f,now+2000).ready,false);}
});

for(const group of ['99.153','99.155'])test(`Hybrid ${group} stable policy evaluates peers independently without a post-peer cutoff or nine-second wait`,()=>{
 const {s,f}=fixture();s.autoBlockMode='AUTOMATIC';s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;
 if(group==='99.153'){f.group=group;f.fs='FS01';f.ip='10.10.101.176';f.groupId=2;s.freeswitch.numbers[0].fs=f.fs;s.freeswitch.numbers[0].profile='COLLECTION';Object.assign(f.cdr.decision,{group,ip:f.ip});}
 D.refreshAlerts(s,now);s.groupTrials={[group]:{fs:group==='99.153'?'FS03':'FS07',completedAt:now-1000,until:now+8000}};
 Object.assign(f.cdr.decision,{newestCallTime:now-100,oldestConfirmedCallTime:now-2000});assert.equal(D.groupActionGate(s,f,now).ready,true);
 f.cdr.decision.oldestConfirmedCallTime=now-500;assert.equal(D.groupActionGate(s,f,now).ready,true);
 f.cdr.decision.locked=false;f.cdr.decision.count=0;assert.equal(D.groupActionGate(s,f,now).ready,false);
});
test('Another group action does not delay an independently qualified FS',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=600;f.currentVt=100;D.refreshAlerts(s,now);s.groupTrials={'99.153':{fs:'FS03',completedAt:now,until:now+9000}};assert.equal(D.groupActionGate(s,f,now).ready,true);
});
test('Stable peer action records trial without retiring independent CDR proof',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;s.autoBlockMode='AUTOMATIC';f.baseline=600;f.currentVt=300;f.vtDeclineAt=now;D.refreshAlerts(s,now);assert.ok(f.pairedCdrProof);
 const peer={key:'99.155|FS07|10.10.101.88',group:'99.155',fs:'FS07',ip:'10.10.101.88',groupId:3,groupIdAt:now,updatedAt:now,currentVt:0,incident:{id:'seven'}};s.fsStates[peer.key]=peer;
 f.incident={id:'startup',activationRecovery:true,cdrConfirmationReads:1,cdrLastConfirmationAt:now};D.recordGroupAction(s,peer,now+500);
 assert.ok(f.pairedCdrProof);assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(s.groupTrials[f.group].completedAt,now+500);
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`13:00 ${mode} resets the first confirmation on a negative CDR read and ignores repeated VT ticks`,()=>{
 const {s,f}=fixture();s.autoEnabled=true;s.autoBlockMode=mode;s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;f.scheduledCdrAt=now-2000;f.cdrEnabledAt=now-2000;f.history=[{time:now-1000,vt:0}];D.refreshAlerts(s,now);assert.equal(f.incident.scheduledResume,true);assert.equal(f.incident.cdrConfirmationReads,1);
 for(let i=0;i<5;i++)D.refreshAlerts(s,now+i*100);assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,now+400).ready,false);assert.equal(f.incident.manualCdrProof,undefined);
 Object.assign(f.cdr.decision,{locked:false,count:1,checkedAt:now+2000});f.updatedAt=now+2000;f.groupIdAt=now+2000;D.refreshAlerts(s,now+2000);assert.equal(D.cdrGate(s,f,now+2000).ready,false);
 Object.assign(f.cdr.decision,{locked:true,count:5,checkedAt:now+4000,newestCallTime:now+3000});f.updatedAt=now+4000;f.groupIdAt=now+4000;D.refreshAlerts(s,now+4000);assert.equal(f.incident.cdrConfirmationReads,1);assert.equal(D.cdrGate(s,f,now+4000).ready,false);
 Object.assign(f.cdr.decision,{checkedAt:now+6000,newestCallTime:now+5000});f.updatedAt=now+6000;f.groupIdAt=now+6000;D.refreshAlerts(s,now+6000);assert.equal(D.cdrGate(s,f,now+6000).ready,true);if(mode==='MANUAL')assert.ok(f.incident.manualCdrProof);
});
test('13:00-only exception expires without authorizing CDR-only changes throughout the afternoon',()=>{
 const {s,f}=fixture();s.config.cdrRequireVtDrop=true;f.baseline=null;f.currentVt=0;f.scheduledCdrAt=now-121000;f.history=[{time:now-1000,vt:0}];D.refreshAlerts(s,now);assert.notEqual(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now).ready,false);
});
