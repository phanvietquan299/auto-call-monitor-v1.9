const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const D=require('../detection');
// Run both production scripts together. Only browser APIs, clock, and the
// FreeSWITCH site's DOM/backend are substituted; no real calls or phones change.
function rig(group='99.153',behavior='success',start=Date.parse('2026-10-07T10:00:00+07:00')){
  let now=start,stored,featureStored,workerListener,pageListener,clicks=0;
  const statusSends=[];
  const profile=group==='99.153'?'COLLECTION':'TELESALE';
  const key=`${group}|FS05|10.10.101.58`;
  const rows=[{phone:'old',fs:'FS05',profile,status:'ACTIVE'},
    {phone:'backup',fs:'FS05',profile,status:'BACKUP'},
    {phone:'unrelated',fs:'FS06',profile,status:'ACTIVE'}];
  const Clock=class extends Date{static now(){return now;}};
  const timers=new Map();let timerId=0,actionTimers=0,delayedChecks=0,transactionBusyUntil=0;
  const send=msg=>new Promise(resolve=>workerListener(msg,{},resolve));
  const browser={alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener(){}}},
    storage:{local:{get:async key=>key==='fsSwitch'?{fsSwitch:structuredClone(featureStored)}:{state:structuredClone(stored),fsSwitch:structuredClone(featureStored)},set:async data=>{if(data.state)stored=structuredClone(data.state);if(data.fsSwitch)featureStored=structuredClone(data.fsSwitch);}}},
    runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){workerListener=fn;}}},
    action:{onClicked:{addListener(){}}},
    tabs:{query:async()=>[{id:1}],sendMessage:async(_id,msg)=>{
      statusSends.push({fs:msg.fs,phone:msg.phone,at:now});
      if(msg.fs==='FS01')assert.equal(stored.lastTestBlock.pending,true,'Test intent saved before page action');
      else {
        const f=Object.values(stored.fsStates).find(f=>f.fs===msg.fs&&f.group===(msg.profile==='COLLECTION'?'99.153':'99.155'));
        assert.equal(f.incident.locked,true,'Lock must precede any page action');
        assert.equal(f.state,'SUSPECTED','Must remain suspected until status response succeeds');
        assert.equal(f.incident.autoExecuted,false);assert.equal(f.incident.switchedAt,null);
        assert.ok(stored.alerts.some(a=>a.fs===msg.fs&&a.actionPending),'Pending suspicion must remain visible');
      }
      if(behavior==='inspectPending'){
        const snapshot=await send({type:'GET_STATE'});
        const pending=Object.values(snapshot.state.fsStates).find(f=>f.fs===msg.fs);
        assert.equal(pending.state,'SUSPECTED');assert.equal(pending.incident.actionPending,true);
      }
      return new Promise(resolve=>{
        let replied=false;pageListener(msg,{},result=>{replied=true;resolve(result);});
        for(let i=0;!replied&&i<45;i++){now+=250;for(const fn of [...timers.values()])fn();}
        assert.equal(replied,true,'Page must resolve success or timeout');
      });
    }}};
  const workerContext={chrome:browser,Date:Clock,Detection:D,FsSwitch:require('../fs-switch'),structuredClone,setTimeout(fn,ms){now+=ms;fn();},importScripts(){}};
  vm.createContext(workerContext);vm.runInContext(fs.readFileSync('background.js','utf8'),workerContext);
  const domRows=()=>rows.map(r=>({children:[
    {tagName:'TD',get innerText(){return r.phone;}},
    {tagName:'TD',get innerText(){return r.fs;}},
    {tagName:'TD',get innerText(){return r.profile;}},
    {tagName:'TD',querySelector:()=>({
      get value(){return r.status;},set value(v){this.selected=v;},
      get disabled(){return !!r.disabled;},
      options:[{value:'ACTIVE'},{value:'BLOCKED'},{value:'BACKUP'}],
      dispatchEvent(event){
        assert.equal(event.type,'change');clicks++;
        if(behavior==='throw')throw Error('Backend handler failed');
        if(behavior==='transaction'||behavior==='slowTransaction'){
          assert.ok(now>=transactionBusyUntil,'SQLite transaction overlap');
          transactionBusyUntil=now+(behavior==='slowTransaction'?8000:4000);
        }
        if(behavior==='timeout')return;
        if(behavior==='delayed'){r.requested=this.selected;return;}
        r.status=this.selected;
      }
    })},
    {tagName:'TD',querySelector:()=>({click(){throw Error('Swap must not be called');}})}
  ]}));
  const pageContext={Event,Date:Clock,chrome:{runtime:{id:'test',sendMessage:send,onMessage:{addListener(fn){pageListener=fn;}}}},
    document:{querySelector:()=>({querySelectorAll:domRows}),querySelectorAll:domRows},
    setInterval(fn,delay){if(delay===1500)return -1;actionTimers++;const id=++timerId;timers.set(id,()=>{if(behavior==='delayed'&&++delayedChecks>=3){for(const r of rows)if(r.requested)r.status=r.requested;}fn();});return id;},clearInterval(id){timers.delete(id);}};
  vm.createContext(pageContext);vm.runInContext(fs.readFileSync('freeswitch.js','utf8'),pageContext);
  const feed=async (vt,extra=[],step=2000)=>{now+=step;await send({type:'FREESWITCH_SAMPLE',data:{numbers:rows.map(r=>({...r,hasStatusControl:true}))}});
    await send({type:'OPENSIPS_SAMPLE',group,nodes:[{fs:'FS05',ip:'10.10.101.58',resource:'vt',used:vt,capacity:1000,destinationId:106},...extra].map(n=>({groupId:group==='99.153'?2:3,...n})),diagnostic:{tableFound:true,httpStatus:200}});};
  return {rows,send,feed,key,statusSends,setFeature(f){featureStored=structuredClone(f);},setRotationPreflight(fn){workerContext.processSwitch=fn;},restart(){const restarted={chrome:browser,Date:Clock,Detection:D,FsSwitch:require('../fs-switch'),structuredClone,setTimeout(fn,ms){now+=ms;fn();},importScripts(){}};vm.createContext(restarted);vm.runInContext(fs.readFileSync('background.js','utf8'),restarted);},setTime(time){now=time;},get state(){return stored},get clicks(){return clicks},get actionTimers(){return actionTimers},confirm(){const a=stored.pendingAutoActions[0];return send({type:'CONFIRM_AUTO_BLOCK',key,incidentId:a?.incidentId,phone:a?.phone});},async detect(){
    await send({type:'SET_AUTO',enabled:true});for(let i=0;i<30;i++)await feed(500);
    for(const v of [500,525,400,567,423,350,310,220,180,120,90,130,80,100,60])await feed(v);
  }};
}
for(const group of ['99.153','99.155'])test(`End-to-end ${group}: confirmed status change once without swap`,async()=>{
  const r=rig(group);await r.detect();
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,1);
  const a=r.state.pendingAutoActions[0];assert.equal((await r.confirm()).ok,true);
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,1);assert.equal(r.rows[0].status,'BLOCKED');
  assert.equal(r.rows[1].status,'BACKUP');assert.equal(r.rows[2].status,'ACTIVE');
  assert.equal(r.state.fsStates[r.key].incident.autoExecuted,true);
  assert.equal(r.state.pendingAutoActions.length,0);
  for(let i=0;i<100;i++)await r.feed(0);
  assert.equal(r.state.fsStates[r.key].incident.locked,true);assert.equal(r.clicks,1);
});
test('No BACKUP required for status-only AUTO',async()=>{
  const r=rig();r.rows[1].status='BLOCKED';await r.detect();assert.equal((await r.confirm()).ok,true);assert.equal(r.clicks,1);
  assert.equal(r.rows[0].status,'BLOCKED');
});
test('Duplicate ACTIVE prevents any status change',async()=>{
  const r=rig();r.rows.push({phone:'duplicate',fs:'FS05',profile:'COLLECTION',status:'ACTIVE'});
  await r.detect();assert.equal(r.clicks,0);assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');
});
for(const behavior of ['timeout','throw'])test(`Unverified ${behavior} remains locked without retry`,async()=>{
  const r=rig('99.153',behavior);await r.detect();assert.equal((await r.confirm()).ok,false);assert.equal(r.clicks,1);
  assert.equal(r.state.fsStates[r.key].incident.actionUncertain,true);
  for(let i=0;i<30;i++)await r.feed(0);assert.equal(r.clicks,1);
});
test('AUTO OFF detects but does not change status',async()=>{
  const r=rig();for(let i=0;i<30;i++)await r.feed(500);
  for(let i=0;i<20;i++)await r.feed(0);
  assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');assert.equal(r.clicks,0);
  await r.send({type:'SET_AUTO',enabled:true});assert.equal(r.clicks,0);
  assert.equal((await r.confirm()).ok,true);assert.equal(r.clicks,1);
});

for(const change of ['phone','duplicate','recovered','stale','autoOff','monitorOff'])test(`Confirmation aborts after ${change}`,async()=>{
  const r=rig();await r.detect();const a=r.state.pendingAutoActions[0];
  if(change==='phone')r.rows[0].phone='changed';
  if(change==='duplicate')r.rows.push({phone:'duplicate',fs:'FS05',profile:'COLLECTION',status:'ACTIVE'});
  if(change==='recovered')for(let i=0;i<10;i++)await r.feed(500);
  if(change==='stale')r.state.fsStates[r.key].updatedAt=1;
  if(change==='autoOff')await r.send({type:'SET_AUTO',enabled:false});
  if(change==='monitorOff')await r.send({type:'SET_MONITORING',enabled:false});
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,0);
});
test('Cancel suppresses repeated previews for same incident',async()=>{
  const r=rig();await r.detect();const a=r.state.pendingAutoActions[0];
  await r.send({type:'CANCEL_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone});
  for(let i=0;i<10;i++)await r.feed(0);
  assert.equal(r.state.pendingAutoActions.length,0);assert.equal(r.clicks,0);
});

for(const group of ['99.153','99.155'])test(`${group}: two running FS, one collapses, third starts while confirmation is pending`,async()=>{
  const r=rig(group),profile=group==='99.153'?'COLLECTION':'TELESALE';
  r.rows.push({phone:'third',fs:'FS07',profile,status:'ACTIVE'});
  const node=(fs,used)=>({fs,ip:fs==='FS06'?'10.10.101.87':'10.10.101.88',resource:'vt',used,capacity:1000});
  const second=`${group}|FS06|10.10.101.87`,third=`${group}|FS07|10.10.101.88`;
  await r.send({type:'SET_AUTO',enabled:true});
  for(let i=0;i<30;i++)await r.feed(500,[node('FS06',500),node('FS07',0)]);
  assert.equal(r.state.fsStates[third].state,'INACTIVE');
  // Add capacity and redistribute some of the remaining load while FS05 collapses.
  for(let i=0;i<35;i++)await r.feed(0,[node('FS06',350),node('FS07',200)]);
  assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');
  assert.equal(r.state.fsStates[second].state,'WATCHING');
  assert.ok(!r.state.alerts.some(a=>a.fs==='FS06'));
  assert.equal(r.state.fsStates[third].state,'HEALTHY');
  assert.equal(r.state.fsStates[third].baseline,200);
  assert.equal(r.state.pendingAutoActions.length,1);
  assert.equal(r.state.pendingAutoActions[0].fs,'FS05');assert.equal(r.clicks,0);
  assert.equal((await r.confirm()).ok,true);
  for(let i=0;i<110;i++)await r.feed(0,[node('FS06',350),node('FS07',200)]);
  assert.equal(r.clicks,1);assert.equal(r.rows.find(n=>n.phone==='third').status,'ACTIVE');
  assert.equal(r.state.fsStates[r.key].incident.locked,true);
  assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.fsStates[second].state,'HEALTHY');
  assert.equal(r.state.fsStates[second].baseline,350);
  // The newly enabled FS is monitored independently even while FS05 stays locked.
  for(let i=0;i<15;i++)await r.feed(0,[node('FS06',350),node('FS07',0)]);
  assert.equal(r.state.fsStates[third].state,'SUSPECTED');
  assert.equal(r.state.pendingAutoActions.length,1);
  assert.equal(r.state.pendingAutoActions[0].fs,'FS07');assert.equal(r.clicks,1);
});

test('Lunch cancels preview and rejects an old confirmation without touching FreeSWITCH',async()=>{
  const r=rig('99.155','success',Date.parse('2026-10-07T11:27:00+07:00'));
  await r.detect();const a=r.state.pendingAutoActions[0];assert.ok(a);
  r.setTime(Date.parse('2026-10-07T11:40:00+07:00'));
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.fsStates[r.key].state,'INACTIVE');
  for(let i=0;i<30;i++)await r.feed(100);
  assert.equal(r.state.alerts.length,0);assert.equal(r.state.fsStates[r.key].currentVt,100);
  r.setTime(Date.parse('2026-10-07T11:40:00+07:00'));
  await r.feed(0,[{fs:'FS10',ip:'10.10.101.90',resource:'vt',used:500}]);
  assert.equal(r.state.schedule.groups['99.155'].phase,'HANDOFF');assert.equal(r.clicks,0);
  r.setTime(Date.parse('2026-10-07T13:00:00+07:00'));
  for(let i=0;i<30;i++)await r.feed(100);
  assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
  assert.equal(r.state.fsStates[r.key].baseline,100);assert.equal(r.state.pendingAutoActions.length,0);
  for(let i=0;i<15;i++)await r.feed(0);
  assert.equal(r.state.pendingAutoActions.length,1);
});
test('Collection confirmation still works during Sale lunch at 11:30',async()=>{
  const r=rig('99.153','success',Date.parse('2026-10-07T11:27:00+07:00'));
  await r.detect();r.setTime(Date.parse('2026-10-07T11:30:00+07:00'));
  await r.feed(0);
  assert.equal(r.state.schedule.groups['99.155'].paused,false);
  assert.equal(r.state.schedule.groups['99.153'].paused,false);
  assert.equal(r.state.pendingAutoActions.length,1);
  assert.equal((await r.confirm()).ok,true);assert.equal(r.clicks,1);
});
test('Collection confirmation becomes unavailable at 12:10',async()=>{
  const r=rig('99.153','success',Date.parse('2026-10-07T12:07:00+07:00'));
  await r.detect();const a=r.state.pendingAutoActions[0];assert.ok(a);
  r.setTime(Date.parse('2026-10-07T12:10:00+07:00'));
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
});

async function previewFs01(r){
  r.rows.push({phone:'fs01-phone',fs:'FS01',profile:'COLLECTION',status:'ACTIVE'});
  await r.feed(0);
  return r.send({type:'PREVIEW_TEST_BLOCK_FS01'});
}
test('Manual FS01 test with AUTO OFF previews then changes only FS01 once',async()=>{
  const r=rig();const p=await previewFs01(r);assert.equal(p.ok,true);assert.equal(r.clicks,0);
  const msg={type:'CONFIRM_TEST_BLOCK_FS01',testId:p.preview.id,phone:p.preview.phone};
  assert.equal((await r.send(msg)).ok,true);assert.equal(r.clicks,1);
  assert.equal(r.rows.find(n=>n.fs==='FS01').status,'BLOCKED');assert.equal(r.rows[0].status,'ACTIVE');
  assert.equal((await r.send(msg)).ok,false);assert.equal(r.clicks,1);
  assert.equal(r.state.fsStates[r.key].incident,null);
});
for(const change of ['phone','duplicate','expired','running'])test(`FS01 test aborts after ${change}`,async()=>{
  const r=rig();const p=await previewFs01(r);
  if(change==='phone')r.rows.find(n=>n.fs==='FS01').phone='changed';
  if(change==='duplicate')r.rows.push({phone:'duplicate',fs:'FS01',profile:'COLLECTION',status:'ACTIVE'});
  if(change==='expired')r.setTime(p.preview.createdAt+61000);
  if(change==='running')r.state.fsStates.fs01={fs:'FS01',group:'99.153',currentVt:4};
  if(change!=='running'&&change!=='expired')await r.feed(0);
  assert.equal((await r.send({type:'CONFIRM_TEST_BLOCK_FS01',testId:p.preview.id,phone:p.preview.phone})).ok,false);
  assert.equal(r.clicks,0);
});

test('Immediate BLOCKED response works without an action timer in a background tab',async()=>{
  const r=rig();await r.detect();assert.equal((await r.confirm()).ok,true);
  assert.equal(r.actionTimers,0);assert.equal(r.clicks,1);
});
test('Delayed page status still waits for observation and executes only once',async()=>{
  const r=rig('99.153','delayed');await r.detect();assert.equal((await r.confirm()).ok,true);
  assert.equal(r.actionTimers,1);assert.equal(r.clicks,1);assert.equal(r.rows[0].status,'BLOCKED');
});

for(const group of ['99.153','99.155'])test(`${group}: automatic mode executes without preview and locks once`,async()=>{
  const r=rig(group);await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.autoBlockMode,'AUTOMATIC');assert.equal(r.rows[0].status,'BLOCKED');
  for(let i=0;i<100;i++)await r.feed(0);assert.equal(r.clicks,1);
  assert.equal(r.state.fsStates[r.key].incident.locked,true);
});
test('Switch from manual to automatic processes an existing preview with the same status action',async()=>{
  const r=rig();await r.detect();assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,1);
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
  assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
});
test('Switch back to manual keeps popup confirmation available',async()=>{
  const r=rig();await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'MANUAL'});await r.detect();
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,1);
  assert.equal((await r.confirm()).ok,true);assert.equal(r.clicks,1);
});
test('Automatic mode respects AUTO OFF',async()=>{
  const r=rig();await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
  for(let i=0;i<30;i++)await r.feed(500);for(let i=0;i<15;i++)await r.feed(0);
  assert.equal(r.clicks,0);assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');
});
test('Automatic mode respects scheduled pause',async()=>{
  const r=rig('99.155','success',Date.parse('2026-10-07T11:40:00+07:00'));
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
});
test('Automatic mode does not act on duplicate ACTIVE rows',async()=>{
  const r=rig();r.rows.push({phone:'dup',fs:'FS05',profile:'COLLECTION',status:'ACTIVE'});
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();assert.equal(r.clicks,0);
});
for(const behavior of ['timeout','throw'])test(`Automatic ${behavior} remains locked without a retry`,async()=>{
  const r=rig('99.153',behavior);await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  for(let i=0;i<30;i++)await r.feed(0);assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].incident.actionUncertain,true);
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Collection ${mode}: detects and handles a second number block within 1-2 minutes after stable recovery`,async()=>{
  const r=rig();await r.send({type:'SET_AUTO_BLOCK_MODE',mode});await r.detect();
  if(mode==='MANUAL')assert.equal((await r.confirm()).ok,true);
  assert.equal(r.clicks,1);
  const firstId=r.state.fsStates[r.key].incident.id;
  const firstTime=r.state.fsStates[r.key].incident.switchedAt;
  // The operator/site supplies a new ACTIVE number; the extension does not swap.
  r.rows[1].status='ACTIVE';
  for(let i=0;i<20;i++)await r.feed(100);
  assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
  assert.equal(r.state.fsStates[r.key].baseline,100);
  assert.equal(r.state.fsStates[r.key].lastIncident.id,firstId);
  for(let i=0;i<15;i++)await r.feed(0);
  if(mode==='MANUAL'){
    assert.equal(r.state.pendingAutoActions[0].phone,'backup');
    assert.notEqual(r.state.pendingAutoActions[0].incidentId,firstId);
    assert.equal((await r.confirm()).ok,true);
  }
  assert.equal(r.clicks,2);assert.equal(r.rows[0].status,'BLOCKED');assert.equal(r.rows[1].status,'BLOCKED');
  const second=r.state.fsStates[r.key].incident;
  assert.notEqual(second.id,firstId);assert.equal(second.oldPhone,'backup');
  assert.ok(second.switchedAt-firstTime<=120000);
  for(let i=0;i<45;i++)await r.feed(0);
  assert.equal(r.clicks,2);assert.equal(r.state.fsStates[r.key].incident.locked,true);
});

test('AUTO validation rejection does not lock recovery and retries stop after three checks',async()=>{
  const r=rig();r.rows[0].disabled=true;
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  let f=r.state.fsStates[r.key];
  assert.equal(r.clicks,0);assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.locked,false);
  assert.equal(f.incident.actionCount,0);assert.equal(f.incident.actionUncertain,false);
  for(let i=0;i<60;i++)await r.feed(0);
  f=r.state.fsStates[r.key];assert.equal(f.autoValidationFailures,3);assert.equal(r.clicks,0);
  r.rows[0].disabled=false;
  assert.equal((await r.send({type:'RECHECK_AUTO_BLOCK',key:r.key,incidentId:f.incident.id})).ok,true);
  assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].incident.autoExecuted,true);
});
test('Manual acknowledgement clears uncertain error but keeps recovery lock after operator handling',async()=>{
  const r=rig('99.153','timeout');await r.detect();await r.confirm();
  const f=r.state.fsStates[r.key];assert.equal(f.incident.actionUncertain,true);
  r.rows[0].status='BLOCKED';r.rows[1].status='ACTIVE';
  assert.equal((await r.send({type:'ACK_MANUAL_AFTER_FAILURE',key:r.key,incidentId:f.incident.id})).ok,true);
  const after=r.state.fsStates[r.key];assert.equal(after.incident.actionUncertain,false);
  assert.equal(after.incident.manualExecuted,true);assert.equal(after.incident.locked,true);
  assert.equal(after.actionError,null);assert.equal(r.clicks,1);
});
test('Unknown result cannot use validation recheck to retry a status change',async()=>{
  const r=rig('99.153','timeout');await r.detect();await r.confirm();
  assert.equal((await r.send({type:'RECHECK_AUTO_BLOCK',key:r.key,incidentId:r.state.fsStates[r.key].incident.id})).ok,false);
  assert.equal(r.clicks,1);
});

test('FS05/06/07 simultaneous collapse: all three statuses change with six-second group observation',async()=>{
  const r=rig('99.155','transaction');
  r.rows.push({phone:'seven',fs:'FS07',profile:'TELESALE',status:'ACTIVE'});
  const nodes=vt=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:vt},
    {fs:'FS07',ip:'10.10.101.88',resource:'vt',used:vt}];
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
  await r.send({type:'SET_AUTO',enabled:true});
  for(let i=0;i<30;i++)await r.feed(500,nodes(500));
  for(let i=0;i<15;i++)await r.feed(0,nodes(0));
  assert.equal(r.clicks,3);assert.equal(r.statusSends.length,3);
  assert.deepEqual(r.statusSends.map(a=>a.fs),['FS05','FS06','FS07']);
  for(let i=1;i<3;i++)assert.ok(r.statusSends[i].at-r.statusSends[i-1].at>=6000);
  for(const fs of ['FS05','FS06','FS07']){
    assert.equal(r.rows.find(row=>row.fs===fs&&row.phone!=='backup').status,'BLOCKED');
    const f=Object.values(r.state.fsStates).find(f=>f.fs===fs);
    assert.equal(f.incident.autoExecuted,true);assert.equal(f.incident.actionCount,1);
  }
  for(let i=0;i<30;i++)await r.feed(0,nodes(0));assert.equal(r.clicks,3);
});
test('Manual confirmation and FS01 test share write spacing across a worker restart',async()=>{
  const r=rig('99.153','transaction');await r.detect();
  r.rows.push({phone:'one',fs:'FS01',profile:'COLLECTION',status:'ACTIVE'});await r.feed(0);
  const p=await r.send({type:'PREVIEW_TEST_BLOCK_FS01'});assert.equal(p.ok,true);
  assert.equal((await r.confirm()).ok,true);r.restart();
  assert.equal((await r.send({type:'CONFIRM_TEST_BLOCK_FS01',testId:p.preview.id,phone:p.preview.phone})).ok,true);
  assert.equal(r.clicks,2);assert.ok(r.statusSends[1].at-r.statusSends[0].at>=5000);
});
test('Five Sale FS are processed one by one with fresh samples and four-second backend transactions',async()=>{
  const r=rig('99.155','transaction');
  for(const [fs,phone] of [['FS07','seven'],['FS09','nine'],['FS10','ten']])
    r.rows.push({fs,phone,profile:'TELESALE',status:'ACTIVE'});
  const extra=vt=>[['FS06','10.10.101.87'],['FS07','10.10.101.88'],['FS09','10.10.101.89'],['FS10','10.10.101.90']]
    .map(([fs,ip])=>({fs,ip,resource:'vt',used:vt}));
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.send({type:'SET_AUTO',enabled:true});
  for(let i=0;i<30;i++)await r.feed(500,extra(500));
  for(let i=0;i<30;i++)await r.feed(0,extra(0));
  assert.equal(r.clicks,5);assert.equal(r.statusSends.length,5);
  for(let i=1;i<5;i++)assert.ok(r.statusSends[i].at-r.statusSends[i-1].at>=6000);
  for(const fs of ['FS05','FS06','FS07','FS09','FS10']){
    const f=Object.values(r.state.fsStates).find(f=>f.fs===fs);
    assert.equal(f.incident.autoExecuted,true);assert.equal(f.incident.actionCount,1);
  }
});
test('AUTO can be switched off between queued FS without waiting for the entire batch',async()=>{
  const r=rig('99.155','transaction');
  const extra=vt=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:vt}];
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.send({type:'SET_AUTO',enabled:true});
  for(let i=0;i<30;i++)await r.feed(500,extra(500));
  for(let i=0;i<6;i++)await r.feed(0,extra(0));
  assert.equal(r.clicks,1);
  await r.send({type:'SET_AUTO',enabled:false});
  for(let i=0;i<20;i++)await r.feed(0,extra(0));
  assert.equal(r.clicks,1);assert.equal(r.rows.find(row=>row.fs==='FS06').status,'ACTIVE');
});

test('Stored ten-second AUTO spacing is updated to five seconds on state load',async()=>{
  const r=rig();await r.feed(0);r.state.config.freeSwitchAutomaticGapMs=10000;
  const result=await r.send({type:'GET_STATE'});
  assert.equal(result.state.config.freeSwitchAutomaticGapMs,5000);
});

test('Timeout keeps unresolved SUSPECTED visible and only matching BLOCKED observation closes it',async()=>{
  const r=rig('99.153','timeout');await r.detect();assert.equal((await r.confirm()).ok,false);
  let f=r.state.fsStates[r.key];assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.locked,true);
  assert.equal(f.incident.autoExecuted,false);assert.equal(f.incident.switchedAt,null);
  assert.ok(r.state.alerts.some(a=>a.fs==='FS05'&&a.actionUncertain));
  for(let i=0;i<40;i++)await r.feed(100);
  f=r.state.fsStates[r.key];assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.locked,true);
  r.rows[2].status='BLOCKED';await r.feed(100);assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');
  r.rows[0].status='BLOCKED';await r.feed(100);
  f=r.state.fsStates[r.key];assert.equal(f.state,'COOLDOWN');assert.ok(f.incident.switchedAt);
  assert.equal(r.state.alerts.length,0);assert.equal(r.clicks,1);
});

test('Dashboard can read pending SUSPECTED while a status write is in progress',async()=>{
  const r=rig('99.153','inspectPending');await r.detect();
  assert.equal((await r.confirm()).ok,true);
  assert.equal(r.state.fsStates[r.key].state,'COOLDOWN');assert.equal(r.clicks,1);
});
test('Sale 17:00 cancels pending confirmation without changing FreeSWITCH',async()=>{
  const r=rig('99.155','success',Date.parse('2026-10-07T16:57:00+07:00'));
  await r.detect();const a=r.state.pendingAutoActions[0];assert.ok(a);
  r.setTime(Date.parse('2026-10-07T17:00:00+07:00'));
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.schedule.groups['99.155'].phase,'DAY_END');
  for(let i=0;i<15;i++)await r.feed(0);
  assert.equal(r.state.alerts.length,0);
});
test('Sale automatic mode stays inactive after 17:00 while still collecting VT',async()=>{
  const r=rig('99.155','success',Date.parse('2026-10-07T17:01:00+07:00'));
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.fsStates[r.key].currentVt,60);
});
for(const group of ['99.153','99.155'])test(`${group}: no block before 09:00 next morning, then learns fresh baseline and detects`,async()=>{
  const start=group==='99.153'?'18:01:00':'17:01:00';
  const r=rig(group,'success',Date.parse(`2026-10-07T${start}+07:00`));
  await r.detect();assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
  r.setTime(Date.parse('2026-10-08T08:58:00+07:00'));
  for(let i=0;i<30;i++)await r.feed(100);
  assert.equal(r.state.schedule.groups[group].paused,true);
  assert.equal(r.state.pendingAutoActions.length,0);
  r.setTime(Date.parse('2026-10-08T09:00:00+07:00'));
  for(let i=0;i<30;i++)await r.feed(100);
  assert.equal(r.state.fsStates[r.key].state,'HEALTHY');assert.equal(r.state.fsStates[r.key].baseline,100);
  for(let i=0;i<15;i++)await r.feed(0);
  assert.equal(r.state.pendingAutoActions.length,1);assert.equal(r.clicks,0);
});
test('Collection pending confirmation is rejected at 18:00',async()=>{
  const r=rig('99.153','success',Date.parse('2026-10-07T17:57:00+07:00'));
  await r.detect();const a=r.state.pendingAutoActions[0];assert.ok(a);
  r.setTime(Date.parse('2026-10-07T18:00:00+07:00'));
  assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:a.incidentId,phone:a.phone})).ok,false);
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
});

for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])test(`Backup ${group} ${mode}: wait, target new ACTIVE, stop after second block`,async()=>{
  const r=rig(group);await r.send({type:'SET_AUTO_BLOCK_MODE',mode});await r.detect();
  if(mode==='MANUAL')await r.confirm();
  assert.equal(r.clicks,1);
  const first=r.state.fsStates[r.key].incident;
  r.rows[1].status='ACTIVE';
  for(let i=0;i<7;i++)await r.feed(0);
  assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
  r.restart();
  await r.feed(0);
  if(mode==='MANUAL'){
    assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions[0].isBackup,true);
    assert.equal(r.state.pendingAutoActions[0].phone,'backup');await r.confirm();
  }
  assert.equal(r.clicks,2);assert.equal(r.rows[1].status,'BLOCKED');
  assert.equal(r.state.fsStates[r.key].incident.parentIncidentId,first.id);
  r.rows.push({phone:'third',fs:'FS05',profile:r.rows[0].profile,status:'ACTIVE'});
  for(let i=0;i<180;i++)await r.feed(0);
  assert.equal(r.clicks,2);assert.equal(r.state.pendingAutoActions.length,0);
});
for(const group of ['99.153','99.155'])test(`Backup ${group}: low stable recovered traffic does not block again`,async()=>{
  const r=rig(group);await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  r.rows[1].status='ACTIVE';for(let i=0;i<70;i++)await r.feed(group==='99.153'?17:5);
  assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
});
test('Backup rejects ambiguous ACTIVE rows and stops while monitor is OFF',async()=>{
  const r=rig();await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  r.rows[1].status='ACTIVE';r.rows.push({phone:'ambiguous',fs:'FS05',profile:'COLLECTION',status:'ACTIVE'});
  for(let i=0;i<60;i++)await r.feed(0);assert.equal(r.clicks,1);
  await r.send({type:'SET_MONITORING',enabled:false});r.rows.pop();
  for(let i=0;i<60;i++)await r.feed(0);assert.equal(r.clicks,1);
});
test('Backup manual preview revalidates first BLOCKED phone before execution',async()=>{
  const r=rig();await r.detect();await r.confirm();r.rows[1].status='ACTIVE';
  for(let i=0;i<50;i++)await r.feed(0);
  assert.equal(r.state.pendingAutoActions.length,1);
  r.rows[0].status='BACKUP';await r.feed(0);
  assert.equal((await r.confirm()).ok,false);assert.equal(r.clicks,1);
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Sale ${mode}: 11:30 preserves baseline and normal detection until 11:40`,async()=>{
  const r=rig('99.155','success',Date.parse('2026-10-07T11:27:00+07:00'));
  await r.send({type:'SET_AUTO_BLOCK_MODE',mode});await r.send({type:'SET_AUTO',enabled:true});
  for(let i=0;i<30;i++)await r.feed(500);
  r.setTime(Date.parse('2026-10-07T11:30:00+07:00'));
  await r.feed(500);
  assert.equal(r.state.schedule.groups['99.155'].paused,false);
  assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
  assert.equal(r.state.fsStates[r.key].baseline,500);
  for(let i=0;i<15;i++)await r.feed(200);
  assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
  assert.equal(r.state.fsStates[r.key].baseline,500);
  for(let i=0;i<15;i++)await r.feed(100);
  if(mode==='MANUAL'){assert.equal(r.state.pendingAutoActions.length,1);await r.confirm();}
  assert.equal(r.clicks,1);
  r.setTime(Date.parse('2026-10-07T11:40:00+07:00'));await r.feed(0);
  assert.equal(r.state.schedule.groups['99.155'].paused,true);
  assert.equal(r.state.schedule.groups['99.155'].startAt,'11:40');
  assert.equal(r.state.pendingAutoActions.length,0);
});

for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])test(`${group} ${mode}: Group ID 0 cancels suspicion despite stuck VT, no block when VT drains`,async()=>{
 const r=rig(group);await r.detect();
 const pending=r.state.pendingAutoActions[0];assert.ok(pending);
 const off={fs:'FS05',ip:'10.10.101.58',resource:'vt',used:31,capacity:1000,groupId:0};
 const next={fs:'FS07',ip:'10.10.101.88',resource:'vt',used:100,capacity:1000,groupId:group==='99.153'?2:3};
 await r.feed(31,[off,next]);
 assert.equal(r.state.fsStates[r.key].state,'INACTIVE');assert.equal(r.state.fsStates[r.key].currentVt,31);
 assert.equal(r.state.pendingAutoActions.length,0);assert.equal(r.state.alerts.length,0);
 await r.send({type:'SET_AUTO_BLOCK_MODE',mode});
 assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:r.key,incidentId:pending.incidentId,phone:pending.phone})).ok,false);
 for(let i=0;i<40;i++)await r.feed(0,[{...off,used:0},next]);
 assert.equal(r.clicks,0);assert.equal(r.state.fsStates[r.key].state,'INACTIVE');
 assert.equal(r.state.fsStates[`${group}|FS07|10.10.101.88`].state,'HEALTHY');
 // Reactivation starts learning, rather than reusing the old incident/baseline.
 for(let i=0;i<30;i++)await r.feed(50);
 assert.equal(r.state.fsStates[r.key].state,'HEALTHY');assert.equal(r.state.fsStates[r.key].baseline,50);
});
for(const groupId of [null,0,1,2])test(`Sale refuses automatic BLOCK when Group ID is ${groupId}`,async()=>{
 const r=rig('99.155');await r.detect();
 await r.feed(0,[{fs:'FS05',ip:'10.10.101.58',resource:'vt',used:0,capacity:1000,groupId}]);
 await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);assert.equal(r.state.alerts.length,0);
});
test('Disabling a recovering Sale node at VT 31 archives its incident and never opens backup block',async()=>{
 const r=rig('99.155');await r.detect();await r.confirm();r.rows[1].status='ACTIVE';
 const first=r.state.fsStates[r.key].incident.id;
 for(let i=0;i<30;i++)await r.feed(31,[{fs:'FS05',ip:'10.10.101.58',resource:'vt',used:31,groupId:0}]);
 assert.equal(r.state.fsStates[r.key].state,'INACTIVE');assert.equal(r.state.fsStates[r.key].incident,null);
 assert.equal(r.state.fsStates[r.key].lastIncident.id,first);
 assert.equal(r.state.fsStates[r.key].lastIncident.cancelled,true);
 r.restart();await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<60;i++)await r.feed(0,[{fs:'FS05',ip:'10.10.101.58',resource:'vt',used:0,groupId:0}]);
 assert.equal(r.clicks,1);assert.equal(r.rows[1].status,'ACTIVE');
});

test('Manual rotation of first group candidate holds later suspects until first action',async()=>{
 const F=require('../fs-switch'),r=rig('99.155');
 r.setFeature({enabled:true,mode:'MANUAL',history:[],quarantined:{},handled:{}});
 r.rows.push({fs:'FS07',profile:'TELESALE',phone:'active7',status:'ACTIVE'});
 for(let i=0;i<10;i++)r.rows.push({fs:'FS07',profile:'TELESALE',phone:`backup7-${i}`,status:'BACKUP'});
 for(let i=0;i<8;i++)r.rows.push({fs:'FS06',profile:'TELESALE',phone:`backup6-${i}`,status:'BACKUP'});
 const extras=vt=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:31,destinationId:107,groupId:0},
 {fs:'FS07',ip:'10.10.101.88',resource:'vt',used:vt,destinationId:109,groupId:3}];
 await r.send({type:'SET_AUTO',enabled:true});await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<30;i++)await r.feed(500,extras(500));
 for(let i=0;i<15;i++)await r.feed(0,extras(500));
 assert.equal(r.clicks,0);assert.equal(r.state.fsStates[r.key].state,'SUSPECTED');
 const plans=F.plans(r.state,{enabled:true},r.state.fsStates[r.key].updatedAt);
 assert.equal(plans[0].source.fs,'FS05');assert.equal(plans[0].target.fs,'FS06');
 for(let i=0;i<15;i++)await r.feed(0,extras(0));
 assert.equal(r.clicks,0);assert.equal(r.rows[0].status,'ACTIVE');
 const waiting=await r.send({type:'GET_STATE'});
 const other=Object.values(waiting.state.fsStates).find(f=>f.fs==='FS07');
 assert.match(waiting.state.processingStatus[other.key],/Ưu tiên FS05/);
});

test('Rotation ON without a richer target continues normal automatic BLOCK',async()=>{
 const r=rig('99.155');r.setFeature({enabled:true,mode:'AUTOMATIC',history:[],quarantined:{},handled:{}});
 for(let i=0;i<9;i++)r.rows.push({fs:'FS05',profile:'TELESALE',phone:`source-backup-${i}`,status:'BACKUP'});
 for(let i=0;i<8;i++)r.rows.push({fs:'FS06',profile:'TELESALE',phone:`target-backup-${i}`,status:'BACKUP'});
 const extras=[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:0,destinationId:107,groupId:0}];
 await r.send({type:'SET_AUTO',enabled:true});await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<30;i++)await r.feed(500,extras);
 for(let i=0;i<15;i++)await r.feed(0,extras);
 assert.equal(r.clicks,1);assert.equal(r.statusSends[0].fs,'FS05');assert.equal(r.rows[0].status,'BLOCKED');
});

test('Fresh SUSPECTED rows recover a missing banner after a state reload',async()=>{
 const r=rig('99.155');await r.detect();r.state.alerts=[];
 const result=await r.send({type:'GET_STATE'});
 assert.equal(result.state.alerts.length,1);assert.equal(result.state.alerts[0].fs,'FS05');
 assert.match(result.state.processingStatus[r.key],/Chờ xác nhận BLOCK/);
});
test('Below-threshold manual rotation remains visible with an explicit confirmation reason',async()=>{
 const r=rig('99.155');await r.detect();r.setFeature({enabled:true,mode:'MANUAL'});
 for(let i=0;i<8;i++)r.rows.push({fs:'FS06',profile:'TELESALE',phone:`newbackup-${i}`,status:'BACKUP'});
 await r.feed(0,[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:31,groupId:0,destinationId:107}]);
 const result=await r.send({type:'GET_STATE'});
 assert.equal(result.state.alerts.length,1);assert.match(result.state.processingStatus[r.key],/chờ xác nhận THAY FS/);
 assert.equal(r.state.pendingAutoActions.length,0);assert.equal(r.clicks,0);
});
test('Automatic rotation preflight failure does not abort normal BLOCK of other suspected FS',async()=>{
 const r=rig('99.155');r.setFeature({enabled:true,mode:'AUTOMATIC'});
 r.setRotationPreflight(async()=>{throw Error('Missing OpenSIPS tab');});
 r.rows.push({fs:'FS07',profile:'TELESALE',phone:'other-active7',status:'ACTIVE'});
 for(let i=0;i<11;i++)r.rows.push({fs:'FS07',profile:'TELESALE',phone:`regular7-${i}`,status:'BACKUP'});
 for(let i=0;i<8;i++)r.rows.push({fs:'FS06',profile:'TELESALE',phone:`target6-${i}`,status:'BACKUP'});
 const extras=used=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:31,groupId:0,destinationId:107},
 {fs:'FS07',ip:'10.10.101.88',resource:'vt',used,groupId:3,destinationId:109}];
 await r.send({type:'SET_AUTO',enabled:true});await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<30;i++)await r.feed(500,extras(500));
 for(let i=0;i<15;i++)await r.feed(0,extras(0));
 assert.equal(r.clicks,1);assert.equal(r.statusSends[0].fs,'FS07');
 const result=await r.send({type:'GET_STATE'});
 assert.match(result.state.processingStatus[r.key],/Missing OpenSIPS tab/);
});

test('Three Sale FS below threshold with no idle destination all fall back to sequential AUTO BLOCK',async()=>{
 const r=rig('99.155');r.setFeature({enabled:true,mode:'AUTOMATIC'});
 r.rows.push({fs:'FS07',profile:'TELESALE',phone:'active7-fallback',status:'ACTIVE'});
 for(const fs of ['FS06','FS07'])for(let i=0;i<3;i++)r.rows.push({fs,profile:'TELESALE',phone:`${fs}-fallback-${i}`,status:'BACKUP'});
 const extras=used=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used,groupId:3,destinationId:107},
 {fs:'FS07',ip:'10.10.101.88',resource:'vt',used,groupId:3,destinationId:109}];
 await r.send({type:'SET_AUTO',enabled:true});await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<30;i++)await r.feed(500,extras(500));
 for(let i=0;i<25;i++)await r.feed(0,extras(0));
 assert.equal(r.clicks,3);assert.deepEqual(r.statusSends.map(x=>x.fs),['FS05','FS06','FS07']);
 for(let i=1;i<r.statusSends.length;i++)assert.ok(r.statusSends[i].at-r.statusSends[i-1].at>=6000);
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Sale ${mode}: rotation defers backup until fresh settled traffic, then detects genuine failure`,async()=>{
  const r=rig('99.155');await r.send({type:'SET_AUTO_BLOCK_MODE',mode});await r.detect();
  if(mode==='MANUAL')await r.confirm();
  assert.equal(r.clicks,1);r.rows[1].status='ACTIVE';
  const started=r.state.fsStates[r.key].incident.switchedAt;
  const op={id:'rotation-other-sale',plan:{group:'99.155'},status:'RUNNING',startedAt:started};
  r.setFeature({enabled:true,mode:'AUTOMATIC',operation:op,history:[]});
  for(let i=0;i<20;i++)await r.feed([6,7,80,0][i%4]);
  assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].incident.isBackup,undefined);
  op.status='DONE';op.finishedAt=r.state.fsStates[r.key].updatedAt;
  r.setFeature({enabled:false,operation:op,history:[op]});r.restart();
  for(let i=0;i<20;i++)await r.feed(0);
  assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
  for(let i=0;i<5;i++)await r.feed(0);
  if(mode==='MANUAL'){
    assert.equal(r.state.pendingAutoActions.length,1);await r.confirm();
  }
  assert.equal(r.clicks,2);
});
test('Sale rotation with low stable recovery cancels need for backup BLOCK',async()=>{
  const r=rig('99.155');await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  r.rows[1].status='ACTIVE';const at=r.state.fsStates[r.key].updatedAt;
  r.setFeature({operation:{id:'completed',plan:{group:'99.155'},status:'DONE',startedAt:at-1000,finishedAt:at},history:[]});
  for(let i=0;i<40;i++)await r.feed(7);
  assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
  assert.equal(r.state.fsStates[r.key].baseline,7);
});

test('Already queued manual backup cannot execute during another rotation and is cancelled after recovery',async()=>{
  const r=rig('99.155');await r.detect();await r.confirm();r.rows[1].status='ACTIVE';
  for(let i=0;i<12;i++)await r.feed(0);
  assert.equal(r.state.pendingAutoActions.length,1);
  const action={...r.state.pendingAutoActions[0]},at=r.state.fsStates[r.key].updatedAt;
  const op={id:'pending-rotation',plan:{group:'99.155'},startedAt:at,status:'RUNNING'};
  r.setFeature({operation:op,history:[]});
  await r.send({type:'CONFIRM_AUTO_BLOCK',key:action.key,incidentId:action.incidentId,phone:action.phone});
  assert.equal(r.clicks,1);
  op.status='DONE';op.finishedAt=at;r.setFeature({operation:op,history:[op]});
  for(let i=0;i<30;i++)await r.feed(7);
  assert.equal(r.clicks,1);assert.equal(r.state.fsStates[r.key].state,'HEALTHY');
  assert.equal(r.state.pendingAutoActions.length,0);
});
test('Sale rotation does not defer Collection backup',async()=>{
  const r=rig('99.153');await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});await r.detect();
  r.rows[1].status='ACTIVE';
  r.setFeature({operation:{id:'sale-running',plan:{group:'99.155'},startedAt:r.state.fsStates[r.key].updatedAt,status:'RUNNING'},history:[]});
  for(let i=0;i<12;i++)await r.feed(0);
  assert.equal(r.clicks,2);
});

test('FS06 rotates to FS07 without BLOCK; FS05 continues its own normal BLOCK',async()=>{
 const F=require('../fs-switch'),r=rig('99.155');
 const feature={enabled:true,mode:'MANUAL',history:[],quarantined:{},handled:{}};
 r.setFeature(feature);
 // FS05 has 10 BACKUP, FS06 6, and inactive FS07 11.
 for(const [fs,count] of [['FS05',9],['FS06',6],['FS07',11]]){
   for(let i=0;i<count;i++)r.rows.push({fs,profile:'TELESALE',phone:`${fs}-spare-${i}`,status:'BACKUP'});
 }
 r.rows.push({fs:'FS07',profile:'TELESALE',phone:'active7',status:'ACTIVE'});
 const extras=vt=>[{fs:'FS06',ip:'10.10.101.87',resource:'vt',used:vt,destinationId:107,groupId:3},
   {fs:'FS07',ip:'10.10.101.88',resource:'vt',used:0,destinationId:109,groupId:0}];
 await r.send({type:'SET_AUTO',enabled:true});await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 for(let i=0;i<30;i++)await r.feed(500,extras(500));
 for(let i=0;i<15;i++)await r.feed(0,extras(0));
 assert.equal(r.clicks,0);
 const changes=[];feature.mode='AUTOMATIC';r.setFeature(feature);
 r.setRotationPreflight(async()=>{
   const at=r.state.fsStates[r.key].updatedAt,plan=F.plans(r.state,feature,at)[0];
   assert.equal(plan.source.fs,'FS06');assert.equal(plan.target.fs,'FS07');
   await F.execute(plan,feature,{now:()=>at,save:async f=>r.setFeature(f),validate:async()=>{},
     setGroup:async(group,node,expected,value)=>{
       changes.push(`${node.fs}:${value}`);
       const row=r.state.opensips[group].nodes.find(n=>n.fs===node.fs);row.groupId=value;
       D.sample(r.state,group,[row],at);
     },block:async()=>assert.fail('Rotation must not BLOCK FS07')});
 });
 await r.send({type:'SET_AUTO',enabled:true});
 assert.deepEqual(changes,['FS06:0','FS07:3']);
 assert.equal(r.clicks,1);assert.equal(r.statusSends[0].fs,'FS05');
 assert.equal(r.rows.find(n=>n.phone==='active7').status,'ACTIVE');
 assert.equal(r.state.fsStates[r.key].state,'COOLDOWN');
 assert.equal(Object.values(r.state.fsStates).find(f=>f.fs==='FS06').state,'INACTIVE');
 const target=Object.values(r.state.fsStates).find(f=>f.fs==='FS07');
 assert.equal(target.incident,null);
});

async function groupRig(group,mode='AUTOMATIC'){
 const r=rig(group),sale=group==='99.155',profile=sale?'TELESALE':'COLLECTION';
 const names=sale?['FS05','FS06','FS07']:['FS02','FS03','FS04'];
 const ips={FS02:'10.10.101.170',FS03:'10.10.101.184',FS04:'10.10.101.180',FS06:'10.10.101.87',FS07:'10.10.101.88'};
 for(const fs of names)if(!r.rows.some(n=>n.fs===fs&&n.profile===profile&&n.status==='ACTIVE'))r.rows.push({fs,profile,phone:fs+'-current',status:'ACTIVE'});
 const feed=async (values,step=2000)=>r.feed(sale?values[0]:0,names.filter(fs=>fs!=='FS05').map(fs=>({fs,ip:ips[fs],groupId:sale?3:2,resource:'vt',used:values[names.indexOf(fs)]})),step);
 await r.send({type:'SET_AUTO',enabled:true});
 // Collect the full incident set before choosing, using confirmation mode.
 for(let i=0;i<30;i++)await feed([500,500,500]);
 for(let i=0;i<15;i++)await feed([60,40,20]);
 assert.equal(r.clicks,0);
 if(mode==='AUTOMATIC')await r.send({type:'SET_AUTO_BLOCK_MODE',mode});
 else {
   const a=r.state.pendingAutoActions[0];assert.equal(a.fs,names[2]);
   assert.equal((await r.send({type:'CONFIRM_AUTO_BLOCK',key:a.key,incidentId:a.incidentId,phone:a.phone})).ok,true);
 }
 assert.equal(r.clicks,1);assert.equal(r.statusSends[0].fs,names[2]);
 return {r,feed,names,async nextManual(){const a=r.state.pendingAutoActions[0];assert.ok(a);return r.send({type:'CONFIRM_AUTO_BLOCK',key:a.key,incidentId:a.incidentId,phone:a.phone});}};
}
for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])test(`Grouped ${group} ${mode}: lowest VT first, 9s observation then second and third without repeat`,async()=>{
 const g=await groupRig(group,mode),{r,feed,names}=g;const at=r.statusSends[0].at;
 r.restart();
 for(let i=0;i<4;i++)await feed([60,40,20]);
 assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
 await feed([60,40,20]);
 if(mode==='MANUAL')await g.nextManual();
 assert.equal(r.clicks,2);assert.equal(r.statusSends[1].fs,names[1]);assert.ok(r.statusSends[1].at-at>=9000);
 for(let i=0;i<5;i++)await feed([60,40,20]);
 if(mode==='MANUAL')await g.nextManual();
 assert.equal(r.clicks,3);assert.equal(r.statusSends[2].fs,names[0]);assert.ok(r.statusSends[2].at-r.statusSends[1].at>=9000);
 assert.equal(new Set(r.statusSends.map(x=>x.fs)).size,3);
});
for(const group of ['99.153','99.155'])test(`Grouped ${group}: first correct action makes peers rebound, so no extra numbers changed`,async()=>{
 const {r,feed,names}=await groupRig(group);
 for(let i=0;i<12;i++)await feed([350,350,20]);
 assert.equal(r.clicks,1);
 for(const fs of names.slice(0,2)){
   const f=Object.values(r.state.fsStates).find(f=>f.fs===fs&&f.group===group);
   assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,350);assert.equal(f.incident,null);
 }
});
test('Grouped Sale: wrong first candidate does not trigger its backup before processing the real culprit',async()=>{
 const {r,feed,names}=await groupRig('99.155');
 for(let i=0;i<5;i++)await feed([60,40,20]);
 assert.equal(r.statusSends[1].fs,names[1]);
 for(let i=0;i<12;i++)await feed([350,40,20]);
 assert.equal(r.clicks,2);assert.equal(r.statusSends.some(x=>x.fs===names[0]),false);
});
test('Group observation requires fresh VT even after the 9s timer expires',async()=>{
 const {r,names}=await groupRig('99.155');const at=r.statusSends[0].at;r.setTime(at+10000);
 await r.send({type:'FREESWITCH_SAMPLE',data:{numbers:r.rows.map(n=>({...n,hasStatusControl:true}))}});
 assert.equal(r.clicks,1);
 const result=await r.send({type:'GET_STATE'}),f=Object.values(result.state.fsStates).find(f=>f.fs===names[1]);
 assert.match(result.state.processingStatus[f.key],/2 mẫu VT mới/);
});

test('Col and Sale start their own group actions two seconds apart, with independent nine-second observation',async()=>{
 const r=rig('99.155');await r.feed(0);const at=r.state.freeswitch.updatedAt;
 r.rows.push({fs:'FS03',profile:'COLLECTION',phone:'col3',status:'ACTIVE'},{fs:'FS04',profile:'COLLECTION',phone:'col4',status:'ACTIVE'});
 const nodes=[['99.153','FS03','10.10.101.184',2,20,'col3'],['99.153','FS04','10.10.101.180',2,100,'col4'],
 ['99.155','FS05','10.10.101.58',3,30,'old'],['99.155','FS06','10.10.101.87',3,70,'unrelated']];
 for(const [group,fs,ip,groupId,vt,phone] of nodes){const key=`${group}|${fs}|${ip}`;
   r.state.fsStates[key]={key,group,fs,ip,groupId,groupIdAt:at,updatedAt:at,state:'SUSPECTED',activeBeforeIncident:true,
     baseline:500,currentVt:vt,recentMedian:vt,incident:{id:fs,oldPhone:phone,locked:false,autoExecuted:false},
     history:[120,100,90,vt].map((v,i)=>({time:at-6000+i*2000,vt:v}))};
 }
 r.state.monitoringEnabled=true;r.state.autoEnabled=true;
 r.state.freeswitch={updatedAt:at,numbers:r.rows.map(n=>({...n,hasStatusControl:true}))};
 await r.send({type:'SET_AUTO_BLOCK_MODE',mode:'AUTOMATIC'});
 assert.deepEqual(r.statusSends.map(x=>x.fs),['FS03','FS05']);
 assert.equal(r.statusSends[1].at-r.statusSends[0].at,2000);
 assert.equal(r.state.groupTrials['99.153'].until,r.statusSends[0].at+9000);
 assert.equal(r.state.groupTrials['99.155'].until,r.statusSends[1].at+9000);
 assert.equal(r.rows.find(n=>n.fs==='FS04').status,'ACTIVE');assert.equal(r.rows.find(n=>n.fs==='FS06').status,'ACTIVE');
 r.restart();const restored=await r.send({type:'GET_STATE'});
 assert.equal(restored.state.lastFreeSwitchAction.group,'99.155');
});

for(const group of ['99.153','99.155'])test(`Grouped ${group}: a transient recovery peak does not force an unnecessary peer block`,async()=>{
 const {r,feed,names}=await groupRig(group);
 // A high first rebound followed by a lower but sustained healthy level.
 // The obsolete all-time peak used to reject 200 after a 500 spike.
 await feed([500,500,20]);
 for(let i=0;i<12;i++)await feed([200,200,20]);
 assert.equal(r.clicks,1);
 for(const fs of names.slice(0,2)){
  const f=Object.values(r.state.fsStates).find(f=>f.fs===fs&&f.group===group);
  assert.equal(f.state,'HEALTHY');assert.equal(f.incident,null);
 }
});

for(const mode of ['MANUAL','AUTOMATIC'])test(`Sale ${mode}: only FS05 and FS07 active, changing FS07 lets FS05 recover without a second change`,async()=>{
 const r=rig('99.155');
 r.rows.push({fs:'FS07',profile:'TELESALE',phone:'seven-current',status:'ACTIVE'});
 const feed=async (five,seven)=>r.feed(five,[
  {fs:'FS06',ip:'10.10.101.87',groupId:0,resource:'vt',used:31},
  {fs:'FS07',ip:'10.10.101.88',groupId:3,resource:'vt',used:seven}
 ]);
 await r.send({type:'SET_AUTO',enabled:true});
 for(let i=0;i<30;i++)await feed(514,524);
 for(let i=0;i<12;i++)await feed(78,58);
 if(mode==='AUTOMATIC')await r.send({type:'SET_AUTO_BLOCK_MODE',mode});
 else {
  const a=r.state.pendingAutoActions[0];assert.equal(a.fs,'FS07');
  await r.send({type:'CONFIRM_AUTO_BLOCK',key:a.key,incidentId:a.incidentId,phone:a.phone});
 }
 assert.equal(r.statusSends[0].fs,'FS07');
 await feed(500,58);
 for(let i=0;i<12;i++)await feed(200,58);
 assert.equal(r.clicks,1);assert.equal(r.state.pendingAutoActions.length,0);
 const f=Object.values(r.state.fsStates).find(f=>f.fs==='FS05');
 assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,200);
});

for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])test(`Grouped ${group} ${mode}: 1s samples catch fake rebound followed by another collapse`,async()=>{
 const g=await groupRig(group,mode),{r,feed,names}=g;
 const firstAt=r.statusSends[0].at;
 for(const vt of [70,65,60,50,40,35,30,25]){
  await feed([60,vt,20],1000);
  assert.equal(r.clicks,1,'do not act before the 9s group observation ends');
 }
 await feed([60,20,20],1000);
 if(mode==='MANUAL')await g.nextManual();
 assert.equal(r.clicks,2);assert.equal(r.statusSends[1].fs,names[1]);
 assert.ok(r.statusSends[1].at-firstAt>=9000);
 assert.equal(r.statusSends.filter(x=>x.fs===names[2]).length,1,'the handled FS must not be selected again');
});

test('Manual confirmation response and immediate GET_STATE contain no peer popup before 9s',async()=>{
 const {r,feed,names}=await groupRig('99.155','MANUAL');
 // Inject a stale queued peer as can exist in a previously persisted snapshot.
 r.state.pendingAutoActions.push({key:'99.155|'+names[1]+'|10.10.101.87',group:'99.155',fs:names[1],incidentId:'stale'});
 const snapshot=await r.send({type:'GET_STATE'});
 assert.equal(snapshot.state.pendingAutoActions.length,0);
 for(let i=0;i<8;i++){
  await feed([60,40,20],1000);
  assert.equal((await r.send({type:'GET_STATE'})).state.pendingAutoActions.length,0);
 }
 await feed([60,40,20],1000);
 assert.equal((await r.send({type:'GET_STATE'})).state.pendingAutoActions[0].fs,names[1]);
});

for(const group of ['99.153','99.155'])for(const mode of ['MANUAL','AUTOMATIC'])test(`Before first block ${group} ${mode}: 600 drops to 100 then rebounds with wiggles, no number consumed`,async()=>{
 const r=rig(group),sale=group==='99.155',fs=sale?'FS05':'FS03',profile=sale?'TELESALE':'COLLECTION';
 if(!sale)r.rows.push({fs,profile,phone:'col-current',status:'ACTIVE'});
 const feed=async vt=>r.feed(sale?vt:0,sale?[]:[
  {fs:'FS05',ip:'10.10.101.58',groupId:0,resource:'vt',used:0},
  {fs,ip:'10.10.101.184',groupId:2,resource:'vt',used:vt}
 ],1000);
 await r.send({type:'SET_AUTO',enabled:true});
 if(mode==='AUTOMATIC')await r.send({type:'SET_AUTO_BLOCK_MODE',mode});
 for(let i=0;i<25;i++)await feed(600);
 for(const v of [100,110,105,120,135,130,145,150,148,160,170]){
  await feed(v);assert.equal(r.clicks,0);assert.equal(r.state.pendingAutoActions.length,0);
 }
 const f=Object.values(r.state.fsStates).find(f=>f.fs===fs);
 assert.equal(f.state,'WARNING');assert.equal(f.baseline,600,'do not learn the low rebound as a healthy baseline');
 for(const v of [150,110,80,50,40,30,20,20])await feed(v);
 if(mode==='MANUAL'){
  const a=r.state.pendingAutoActions[0];assert.equal(a.fs,fs);
  await r.send({type:'CONFIRM_AUTO_BLOCK',key:a.key,incidentId:a.incidentId,phone:a.phone});
 }
 assert.equal(r.clicks,1,'a renewed sustained collapse still gets processed');
});
