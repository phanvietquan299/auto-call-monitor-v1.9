const {test}=require('node:test');const assert=require('node:assert/strict');const F=require('../fs-switch');
const now=Date.parse('2026-10-08T10:00:00+07:00');
function fixture(group='99.153'){
  const p=F.groups[group],[source,target,other]=p.fs;
  const nodes=[{fs:source,ip:'source',destinationId:1,groupId:p.groupId,resource:'vt',used:0},
    {fs:target,ip:'target',destinationId:2,groupId:0,resource:'vt',used:200},
    {fs:other,ip:'other',destinationId:3,groupId:0,resource:'vt',used:50}];
  const numbers=[];for(const [fs,count] of [[source,6],[target,10],[other,8]]){
    numbers.push({fs,profile:p.profile,phone:fs+'-active',status:'ACTIVE',hasStatusControl:true});
    for(let i=0;i<count;i++)numbers.push({fs,profile:p.profile,phone:fs+'-'+i,status:'BACKUP'});
  }
  return {feature:{enabled:true,mode:'MANUAL'},state:{monitoringEnabled:true,autoEnabled:false,schedule:{groups:{[group]:{paused:false}}},
    opensips:{[group]:{updatedAt:now,nodes}},freeswitch:{updatedAt:now,numbers},
    fsStates:{source:{group,fs:source,ip:'source',state:'SUSPECTED',updatedAt:now,incident:{id:'incident',locked:false}}}},group,source,target};
}
for(const group of Object.keys(F.groups))test(`Switch ${group}: allowed scope, largest BACKUP, ignores stuck VT`,()=>{
 const r=fixture(group),[p]=F.plans(r.state,r.feature,now);assert.equal(p.source.backups,6);assert.equal(p.target.fs,r.target);
 assert.equal(p.groupId,group==='99.153'?2:3);assert.equal(p.target.backups,10);
 r.state.opensips[group].nodes.push({fs:'FS09',ip:'out',destinationId:99,resource:'vt',groupId:0});
 assert.equal(F.plans(r.state,r.feature,now)[0].target.fs,r.target);
});
for(const change of ['monitor','paused','stale','threshold','group','unknown','duplicate','active','locked','quarantine'])test(`Switch plan rejects ${change}`,()=>{
 const r=fixture(),s=r.state,n=s.opensips[r.group].nodes;
 if(change==='auto')s.autoEnabled=true;
 if(change==='monitor')s.monitoringEnabled=false;
 if(change==='paused')s.schedule.groups[r.group].paused=true;
 if(change==='stale')s.freeswitch.updatedAt=now-45001;
 if(change==='threshold')for(let i=0;i<5;i++)s.freeswitch.numbers.push({fs:r.source,profile:'COLLECTION',status:'BACKUP'});
 if(change==='group'){n[1].groupId=2;n[2].groupId=2;}
 if(change==='unknown'){n[1].groupId=null;n[2].destinationId=null;}
 if(change==='duplicate')n.push({...n[0]});
 if(change==='active')s.freeswitch.numbers=s.freeswitch.numbers.filter(x=>x.status!=='ACTIVE');
 if(change==='locked')s.fsStates.source.incident.locked=true;
 if(change==='quarantine')r.feature.quarantined={[`${r.group}|${r.source}`]:'op'};
 assert.equal(F.plans(s,r.feature,now).length,0);
});
for(const failure of [null,'validate','enable','disable'])test(`Switch staged execution ${failure||'success'} retains audit and stops on failure`,async()=>{
 const r=fixture(),p=F.plans(r.state,r.feature,now)[0],calls=[],saved=[];
 const stage=(name)=>{calls.push(name);if(name===failure)throw Error(name+' failed');};
 const result=await F.execute(p,r.feature,{now:()=>now,save:async f=>saved.push(structuredClone(f)),
 validate:async()=>stage('validate'),setGroup:async(group,node,expected,value)=>{
   if(node.fs===r.target){assert.equal(expected,0);assert.equal(value,2);stage('enable');}
   else{assert.equal(node.fs,r.source);assert.equal(expected,2);assert.equal(value,0);stage('disable');}},
 block:async plan=>{assert.equal(plan.target.phone,r.target+'-active');stage('block');}});
 const sequence=['validate','disable','enable'];assert.deepEqual(calls,failure?sequence.slice(0,sequence.indexOf(failure)+1):sequence);
 assert.equal(result.status,failure?'FAILED':'DONE');assert.equal(saved[0].operation.stage,'VALIDATING');
 assert.ok(r.feature.handled[p.key]);assert.ok(r.feature.quarantined[`${r.group}|${r.target}`]);assert.equal(r.feature.history.length,1);
 assert.equal(F.plans(r.state,r.feature,now).length,0);
});

for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])for(const grows of [true,false])test(`Full rotation ${group} ${mode}: target VT grows=${grows}, conditional BLOCK after 5 seconds`,async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),D=require('../detection'),r=fixture(group);
 // Exercise the exact threshold: source has 10 BACKUP, target has 14.
 for(const nodeFs of [r.source,r.target])for(let i=0;i<4;i++)r.state.freeswitch.numbers.push({fs:nodeFs,profile:F.groups[group].profile,phone:`${nodeFs}-extra-${i}`,status:'BACKUP'});
 r.state.autoEnabled=true;r.state.config={...D.CONFIG};r.state.events=[];r.state.eventKeys={};r.state.alerts=[];r.state.pendingAutoActions=[];
 r.state.schedule={groups:Object.fromEntries(Object.keys(F.groups).map(g=>[g,D.scheduleAt(now,D.CONFIG,g)]))};
 const old=r.state.fsStates.source;old.key=`${group}|${old.fs}|${old.ip}`;old.groupId=F.groups[group].groupId;old.groupIdAt=now;old.baseline=500;
 r.state.fsStates={[old.key]:old};
 let stored={},listener,page=0,clock=now;const calls=[];
 const ctx={FsSwitch:F,Detection:D,Date:class extends Date{static now(){return clock;}},setTimeout(fn,ms){clock+=ms;fn();},structuredClone,messageQueue:Promise.resolve(),
 getState:async()=>structuredClone(r.state),saveState:async s=>{r.state=s;},waitForFreeSwitch:async()=>{},
 chrome:{storage:{local:{get:async()=>structuredClone(stored),set:async data=>Object.assign(stored,structuredClone(data))}},
 runtime:{onMessage:{addListener(fn){listener=fn;}}},alarms:{create(){},onAlarm:{addListener(){}}},tabs:{
 query:async({url})=>[{id:url.includes('5003')?2:1}],get:async()=>({status:'complete'}),reload:async()=>{page++;calls.push('refresh');},
 sendMessage:async(id,msg)=>{
 if(msg.type==='FS_SWITCH_SET_GROUP'){calls.push(`set:${msg.node.fs}:${msg.value}`);const n=r.state.opensips[group].nodes.find(x=>x.fs===msg.node.fs);n.groupId=msg.value;if(msg.node.fs===r.target&&grows)n.used++;return {ok:true,reloaded:true,groupId:msg.value,pageId:String(page)};}
 if(msg.type==='FS_SWITCH_READ_NODE'){const n=r.state.opensips[group].nodes.find(x=>x.fs===msg.node.fs);return {ok:true,groupId:n.groupId,used:n.used,pageId:String(page)};}
 if(msg.type==='READ_FS_NUMBERS')return {ok:true,numbers:r.state.freeswitch.numbers};
 assert.equal(msg.type,'AUTO_BLOCK_FS');assert.equal(msg.fs,r.target);assert.equal(grows,false);assert.equal(clock,now+5000);calls.push('block:'+msg.fs);return {ok:true};
 }}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('fs-switch-worker.js','utf8'),ctx);
 const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
 const preview=await send({type:'FS_SWITCH_SETTINGS',enabled:true,mode});assert.equal(preview.ok,true);assert.equal(calls.length,0);
 const result=await send(mode==='MANUAL'?{type:'FS_SWITCH_CONFIRM',identity:F.identity(preview.candidates[0])}:{type:'FS_SWITCH_TICK'});
 assert.equal(result.feature.operation.status,'DONE',result.feature.operation.error);
 await ctx.messageQueue;
 assert.deepEqual(calls,[`set:${r.source}:0`,'refresh',`set:${r.target}:${F.groups[group].groupId}`,'refresh',...(!grows?['block:'+r.target]:[])]);
 assert.equal(r.state.autoEnabled,true);assert.equal(r.state.fsStates[old.key].state,'INACTIVE');
 const target=Object.values(r.state.fsStates).find(x=>x.fs===r.target);assert.equal(target.state,grows?'INACTIVE':'COOLDOWN');
 if(grows)assert.equal(target.incident,null);else assert.equal(target.incident.autoExecuted,true);
 assert.equal(r.state.events.filter(e=>e.type==='AUTO_BLOCKED').length,grows?0:1);
 await send({type:'FS_SWITCH_TICK'});assert.equal(calls.length,grows?4:5);
});

function testWorker({auto=false,enabled=false,reloaded=true,oldPageOnce=false,badPageGroup=false}={}){
 const vm=require('node:vm'),fs=require('node:fs'),D=require('../detection');let listener,clock=now,oldRead=false;
 const state={autoEnabled:auto,monitoringEnabled:false,config:{...D.CONFIG},events:[],fsStates:{},schedule:{},
 opensips:{'99.153':{nodes:[{fs:'FS03',ip:'10.10.101.184',destinationId:186},{fs:'FS04',ip:'10.10.101.180',destinationId:126}]}},freeswitch:{}};
 const stored={fsSwitch:{enabled,history:[],handled:{},quarantined:{}}},writes=[],reloads=[],groups={FS03:0,FS04:0},queried=[];
 const ctx={FsSwitch:F,Detection:D,Date:class extends Date{static now(){return clock;}},setTimeout(fn,ms){clock+=ms;fn();},structuredClone,messageQueue:Promise.resolve(),getState:async()=>structuredClone(state),saveState:async s=>Object.assign(state,structuredClone(s)),
 chrome:{storage:{local:{get:async()=>structuredClone(stored),set:async data=>Object.assign(stored,structuredClone(data))}},
 runtime:{onMessage:{addListener(fn){listener=fn;}}},alarms:{create(){},onAlarm:{addListener(){}}},
 tabs:{reload:async id=>reloads.push(id),get:async()=>({status:'complete'}),query:async({url})=>{queried.push(url);assert.equal(url,'http://10.10.99.153/*');return [{id:153}];},sendMessage:async(id,msg)=>{
 assert.equal(id,153);assert.notEqual(msg.type,'AUTO_BLOCK_FS');
 if(['FS_SWITCH_READ_TEST','FS_SWITCH_READ_NODE'].includes(msg.type)){
   if(oldPageOnce&&reloads.length&&!oldRead){oldRead=true;return {ok:true,groupId:groups[msg.node.fs],pageId:`page-${reloads.length-1}`};}
   return {ok:true,groupId:groups[msg.node.fs]+(badPageGroup&&reloads.length?1:0),pageId:`page-${reloads.length}`};
 }
 writes.push(msg);assert.equal(stored.fsSwitch.lastTest.status,'RUNNING');
 assert.equal(msg.expected,groups[msg.node.fs]);groups[msg.node.fs]=msg.value;
 return {ok:true,reloaded,groupId:msg.value,pageId:`page-${reloads.length}`};}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('fs-switch-worker.js','utf8'),ctx);
 return {send:msg=>new Promise(resolve=>listener(msg,{},resolve)),stored,writes,groups,queried,state,reloads};
}
for(const fs of ['FS03','FS04'])test(`OpenSIPS-only test ${fs}: preview no mutation, enable and disable, never FreeSWITCH`,async()=>{
 const r=testWorker();
 for(const value of [2,0]){
   const before=r.writes.length,p=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs,value});
   assert.equal(p.ok,true);assert.equal(r.writes.length,before);
   const result=await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:p.preview.id});
   assert.equal(result.ok,true);assert.equal(result.test.status,'DONE');assert.equal(result.test.pageRefreshed,true);assert.equal(r.reloads.length,before+1);assert.equal(r.groups[fs],value);
   assert.equal((await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:p.preview.id})).ok,false);
   assert.equal(r.writes.length,before+1);
 }
});
test('OpenSIPS-only test allows AUTO BLOCK ON and reserves only the tested FS',async()=>{
 const r=testWorker({auto:true});const p=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:2});
 assert.equal(p.ok,true);assert.equal((await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:p.preview.id})).ok,true);
 assert.equal(r.writes.length,1);assert.equal(r.state.autoEnabled,true);
 assert.ok(r.state.fsTestExclusions['99.153|FS03']);assert.equal(r.state.fsTestExclusions['99.153|FS04'],undefined);
 const off=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:0});
 await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:off.preview.id});
 assert.equal(r.state.fsTestExclusions['99.153|FS03'].releaseAfterOff,true);
});
test('OpenSIPS-only test rejects already enabled request, out-of-scope FS, and unverified Reload',async()=>{
 const r=testWorker({reloaded:false});
 assert.equal((await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS01',value:2})).ok,false);
 assert.equal((await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:0})).ok,false);
 const preview=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:2});
 assert.equal((await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:preview.preview.id})).ok,false);
 assert.equal(r.stored.fsSwitch.lastTest.status,'FAILED');assert.equal(r.writes.length,1);
});

test('OpenSIPS-only test is unavailable while full rotation is enabled',async()=>{
 const r=testWorker({enabled:true});
 assert.equal((await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:2})).ok,false);assert.equal(r.writes.length,0);
});

test('OpenSIPS refresh waits for the new content script instead of accepting old page response',async()=>{
 const r=testWorker({oldPageOnce:true});const p=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS03',value:2});
 const result=await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:p.preview.id});
 assert.equal(result.ok,true);assert.equal(result.test.pageRefreshed,true);assert.equal(r.writes.length,1);
});
test('OpenSIPS refresh with wrong Group ID never marks the test complete or repeats Save',async()=>{
 const r=testWorker({badPageGroup:true});const p=await r.send({type:'FS_SWITCH_TEST_PREVIEW',fs:'FS04',value:2});
 const result=await r.send({type:'FS_SWITCH_TEST_CONFIRM',testId:p.preview.id});
 assert.equal(result.ok,false);assert.equal(r.stored.fsSwitch.lastTest.status,'FAILED');assert.equal(r.writes.length,1);
 assert.ok(r.state.fsTestExclusions['99.153|FS04']);
});

for(const group of Object.keys(F.groups))test(`Threshold 10 ${group}: no target permits BLOCK and replenishment is reconsidered`,()=>{
 const r=fixture(group),profile=F.groups[group].profile;
 for(let i=0;i<4;i++)r.state.freeswitch.numbers.push({fs:r.source,profile,status:'BACKUP'});
 assert.equal(F.BACKUP_THRESHOLD,10);
 assert.equal(F.plans(r.state,r.feature,now).length,0);
 assert.equal(F.holds(r.state,r.feature,r.state.fsStates.source,now),false);
 assert.equal(r.feature.handled,undefined,'No failed search is recorded as handled');
 r.state.freeswitch.numbers.push({fs:r.target,profile,status:'BACKUP'});
 assert.equal(F.plans(r.state,r.feature,now)[0].source.backups,10);
 assert.equal(F.holds(r.state,r.feature,r.state.fsStates.source,now),true);
 r.state.fsStates.source.incident={id:'next-incident',locked:false};
 assert.equal(F.plans(r.state,r.feature,now)[0].incidentId,'next-incident');
});

test('Threshold 10 is inclusive, with a destination strictly richer in BACKUP',()=>{
 const r=fixture(),rows=r.state.freeswitch.numbers;
 for(let i=0;i<4;i++)rows.push({fs:r.source,profile:'COLLECTION',status:'BACKUP',phone:`boundary-${i}`});
 rows.push({fs:r.target,profile:'COLLECTION',status:'BACKUP',phone:'target-eleven'});
 assert.equal(F.BACKUP_THRESHOLD,10);
 const p=F.plans(r.state,r.feature,now)[0];assert.equal(p.source.backups,10);assert.equal(p.target.backups,11);
 rows.push({fs:r.source,profile:'COLLECTION',status:'BACKUP',phone:'over-threshold'});
 assert.equal(F.plans(r.state,r.feature,now).length,0);
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/11 > ngưỡng 10/);
});
test('Low BACKUP alone waits for block; diagnostics expose healthy state and manual confirmation',()=>{
 const r=fixture();r.state.fsStates.source.state='HEALTHY';
 assert.equal(F.plans(r.state,r.feature,now).length,0);
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/HEALTHY.*chỉ thay tại lượt nghi block/);
 r.state.fsStates.source.state='SUSPECTED';
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/bấm Kiểm tra và xác nhận/);
 r.feature.mode='AUTOMATIC';
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/chờ lượt tự động/);
});
test('Diagnostics explain missing destination instead of silently returning empty plans',()=>{
 const r=fixture();r.state.opensips[r.group].nodes[1].groupId=2;
 r.state.opensips[r.group].nodes[2].groupId=2;
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/Không có FS đích.*Group ID 2, cần 0/);
 r.feature.enabled=false;
 assert.match(F.diagnostics(r.state,r.feature,now).find(d=>d.fs===r.source).reason,/THAY FS đang OFF/);
});

for(const group of ['99.153','99.155'])for(const reverse of [false,true])test(`Rotation ${group}: lowest source BACKUP wins regardless of OpenSIPS order (${reverse})`,()=>{
 const r=fixture(group),p=F.groups[group],[first,second,target]=p.fs;
 const nodes=r.state.opensips[group].nodes;
 nodes[1].groupId=p.groupId;
 r.state.fsStates.second={group,fs:second,ip:'target',state:'SUSPECTED',updatedAt:now,incident:{id:'second-incident',locked:false}};
 const counts={[first]:10,[second]:6,[target]:11};
 r.state.freeswitch.numbers=[];
 for(const [fs,count] of Object.entries(counts)){
   r.state.freeswitch.numbers.push({fs,profile:p.profile,phone:fs+'-active',status:'ACTIVE',hasStatusControl:true});
   for(let i=0;i<count;i++)r.state.freeswitch.numbers.push({fs,profile:p.profile,phone:fs+'-'+i,status:'BACKUP'});
 }
 if(reverse)nodes.reverse();
 for(const mode of ['MANUAL','AUTOMATIC']){
   r.feature.mode=mode;
   const plans=F.plans(r.state,r.feature,now);
   assert.deepEqual(plans.map(x=>x.source.fs),[second,first]);
   assert.equal(plans[0].target.fs,target);assert.equal(plans[0].source.backups,6);
   assert.equal(plans[0].target.backups,11);
 }
 // Eligibility still comes before priority: an already locked source is skipped.
 r.state.fsStates.second.incident.locked=true;
 assert.equal(F.plans(r.state,r.feature,now)[0].source.fs,first);
});

for(const outcome of ['growing','flat','missing-vt','group-disabled','monitor-off','growth-during-write-gap','write-error','stale-queued-snapshot'])test(`Post-rotation 5s watch: ${outcome}`,async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),D=require('../detection');
 let clock=now,reads=0,writes=0;const saved=[];
 const plan={group:'99.155',groupId:3,profile:'TELESALE',source:{fs:'FS06',baseline:500},target:{fs:'FS07',ip:'10.10.101.88',phone:'new'}};
 const target={group:plan.group,fs:'FS07',ip:plan.target.ip,state:'INACTIVE',history:[]};
 const state={monitoringEnabled:true,config:{...D.CONFIG},fsStates:{target},events:[],freeswitch:{updatedAt:now,numbers:[{fs:'FS07',profile:'TELESALE',phone:'new',status:'ACTIVE',hasStatusControl:true}]}};
 if(outcome==='stale-queued-snapshot')state.freeswitch.updatedAt=now-60000;
 const feature={operation:{id:'watch-op',targetInitialVt:31}};
 const ctx={Detection:D,FsSwitch:F,Date:class extends Date{static now(){return clock;}},structuredClone,
   setTimeout(fn,ms){clock+=ms;fn();},messageQueue:Promise.resolve(),
   chrome:{runtime:{onMessage:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('fs-switch-worker.js','utf8'),ctx);
 ctx.switchSnapshot=async()=>({...state,monitoringEnabled:outcome!=='monitor-off'});
 ctx.switchSave=async f=>saved.push(structuredClone(f));ctx.switchTab=async()=>2;
 ctx.getState=async()=>state;ctx.saveState=async()=>{};
 ctx.waitForFreeSwitch=async()=>{clock+=5000;};
 ctx.switchCommand=async(tab,msg)=>{
   if(msg.type==='FS_SWITCH_READ_NODE'){
     reads++;return {groupId:outcome==='group-disabled'?0:3,
       used:outcome==='missing-vt'?null:outcome==='growing'||outcome==='growth-during-write-gap'&&reads>3?32:31};
   }
   if(msg.type==='READ_FS_NUMBERS')return {ok:true,numbers:state.freeswitch.numbers};
   assert.equal(msg.type,'AUTO_BLOCK_FS');assert.equal(msg.fs,'FS07');assert.equal(msg.phone,'new');
   assert.ok(clock>=now+5000);writes++;
   if(outcome==='write-error')throw Error('Result unknown');return {ok:true};
 };
 const fails=['missing-vt','group-disabled','monitor-off','write-error'].includes(outcome);
 if(fails)await assert.rejects(ctx.monitorSwitchTarget(1,plan,feature));
 else await ctx.monitorSwitchTarget(1,plan,feature);
 assert.equal(writes,['flat','write-error','stale-queued-snapshot'].includes(outcome)?1:0);
 if(['flat','stale-queued-snapshot'].includes(outcome)){
   assert.equal(target.state,'COOLDOWN');assert.equal(state.events[0].type,'AUTO_BLOCKED');
   assert.equal(saved.at(-1).operation.stage,'BLOCK_TARGET');
 }else assert.equal(state.events.length,0);
});

test('Col and Sale rotations run while the other target watch is pending, then BLOCK with two-second spacing',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),D=require('../detection');
 const col=fixture('99.153'),sale=fixture('99.155');let clock=now,stored={},listener;
 const state={monitoringEnabled:true,autoEnabled:true,config:{...D.CONFIG},events:[],eventKeys:{},fsStates:{},
   opensips:{...col.state.opensips,...sale.state.opensips},freeswitch:{updatedAt:now,numbers:[...col.state.freeswitch.numbers,...sale.state.freeswitch.numbers]}};
 for(const r of [col,sale]){const f=r.state.fsStates.source;f.key=`${r.group}|${f.fs}|${f.ip}`;
   Object.assign(f,{groupId:F.groups[r.group].groupId,groupIdAt:now,baseline:500,currentVt:0,recentMedian:0,activeBeforeIncident:true,history:[]});state.fsStates[f.key]=f;}
 const writes=[],timers=[];let page=0;
 const ctx={FsSwitch:F,Detection:D,Date:class extends Date{static now(){return clock;}},structuredClone,messageQueue:Promise.resolve(),
   setTimeout(fn,ms){timers.push({fn,when:clock+ms});},getState:async()=>structuredClone(state),saveState:async s=>Object.assign(state,s),
   waitForFreeSwitch:async(s,g)=>{clock=Math.max(clock,s.lastFreeSwitchAction?.group&&s.lastFreeSwitchAction.group!==g?s.lastFreeSwitchAction.at+2000:s.freeSwitchNextActionAt||0);},
   chrome:{storage:{local:{get:async()=>structuredClone(stored),set:async data=>Object.assign(stored,structuredClone(data))}},
     runtime:{onMessage:{addListener(fn){listener=fn;}}},alarms:{create(){},onAlarm:{addListener(){}}},tabs:{
       query:async()=>[{id:1}],get:async()=>({status:'complete'}),reload:async()=>{page++;},sendMessage:async(_,msg)=>{
         if(msg.type==='READ_FS_NUMBERS')return {ok:true,numbers:state.freeswitch.numbers};
         if(msg.type==='AUTO_BLOCK_FS'){writes.push({fs:msg.fs,at:clock});return {ok:true};}
         const node=Object.values(state.opensips).flatMap(x=>x.nodes).find(x=>x.fs===msg.node.fs);
         if(msg.type==='FS_SWITCH_SET_GROUP'){node.groupId=msg.value;return {ok:true,pageId:String(page)};}
         return {ok:true,groupId:node.groupId,used:node.used,pageId:String(page)};
       }}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('fs-switch-worker.js','utf8'),ctx);
 const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
 await send({type:'FS_SWITCH_SETTINGS',enabled:true,mode:'AUTOMATIC'});
 await send({type:'FS_SWITCH_TICK'});const first=stored.fsSwitch.operation;
 assert.equal(first.plan.group,'99.153');assert.equal(first.targetWatchPending,true);assert.equal(writes.length,0);
 clock=now+2000;await send({type:'FS_SWITCH_TICK'});const second=stored.fsSwitch.operation;
 assert.equal(second.plan.group,'99.155');assert.equal(second.targetWatchPending,true);assert.equal(writes.length,0);
 assert.equal(stored.fsSwitch.history.filter(x=>x.targetWatchPending).length,2);
 // Observe the pending targets once the real-time timers become due.
 clock=now+5000;timers[0].fn();await ctx.messageQueue;
 clock=now+7000;timers[1].fn();await ctx.messageQueue;
 assert.deepEqual(writes,[{fs:col.target,at:now+5000},{fs:sale.target,at:now+7000}]);
 assert.equal(stored.fsSwitch.history.filter(x=>x.targetWatchPending).length,0);
});
