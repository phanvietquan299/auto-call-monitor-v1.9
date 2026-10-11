const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../detection');
const group='99.153',key='99.153|FS03|10.10.101.184';
function rig(){let now=Date.parse('2026-10-07T10:00:00+07:00');let s={config:{...D.CONFIG},monitoringEnabled:true,fsStates:{},events:[],grafana:{[group]:{history:[]}}};
  const feed=(vt,traffic=820,step=2000,extra=[])=>{now+=step;D.grafana(s,group,traffic,now);D.sample(s,group,[{fs:'FS03',ip:'10.10.101.184',groupId:2,resource:'vt',used:vt},...extra],now);return s.fsStates[key];};
  return {feed,get s(){return s},get now(){return now},restore(){s=JSON.parse(JSON.stringify(s));}};}
function learn(r,vt=520){for(let i=0;i<30;i++)r.feed(vt);}
function collapse(r){for(const v of [500,525,400,567,423,350,310,220,180,120,90,130,80,100,60])r.feed(v,400);return r.s.fsStates[key];}
test('High and low peak zig-zag stay healthy',()=>{for(const base of [520,80]){const r=rig();learn(r,base);for(let i=0;i<80;i++)r.feed(base*[.85,1.1,.95,1.2,.8][i%5]);assert.equal(r.s.fsStates[key].state,'HEALTHY');assert.equal(r.s.alerts.length,0);}});
test('Gradual zig-zag collapse freezes baseline and suspects once',()=>{const r=rig();learn(r);const f=collapse(r);assert.equal(f.state,'SUSPECTED');assert.ok(f.baseline>400);const id=f.incident.id;for(let i=0;i<20;i++)r.feed([0,30,80,100][i%4],400);assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.id,id);assert.equal(r.s.events.filter(e=>e.type==='SUSPECTED').length,1);});
test('Previously zero FS never suspects',()=>{const r=rig();for(let i=0;i<60;i++)r.feed(0,400);assert.equal(r.s.fsStates[key].state,'INACTIVE');assert.equal(r.s.alerts.length,0);});
test('Brief dip then recovery never suspects',()=>{const r=rig();learn(r);r.feed(100,400);r.feed(90,400);for(let i=0;i<10;i++)r.feed(520);assert.equal(r.s.fsStates[key].state,'HEALTHY');assert.ok(!r.s.events.some(e=>e.type==='SUSPECTED'));});
test('Unchanged Grafana does not prevent VT-only suspect',()=>{const r=rig();learn(r);for(let i=0;i<30;i++)r.feed(100,820);assert.equal(r.s.fsStates[key].state,'SUSPECTED');assert.equal(r.s.alerts.length,1);});
test('Slow sustained decline requires manual review',()=>{const r=rig();learn(r);r.feed(300,400);r.feed(300,400);r.feed(300,400);r.feed(250,400,125000);for(let i=0;i<20;i++)r.feed(100,400);assert.equal(r.s.fsStates[key].state,'WARNING');assert.match(r.s.fsStates[key].detectionNote,/Slow decline/);});
test('Cooldown survives zero, persistence, then low stable VT stays locked',()=>{const r=rig();learn(r);const f=collapse(r);f.incident.locked=true;f.incident.autoExecuted=true;f.incident.switchedAt=r.now;f.state='COOLDOWN';r.feed(0,400);assert.equal(f.state,'COOLDOWN');r.restore();for(let i=0;i<160;i++)r.feed([20,30,15,40,25][i%5],400);const recovered=r.s.fsStates[key];assert.equal(recovered.state,'RECOVERING');assert.equal(recovered.incident.locked,true);assert.equal(r.s.events.filter(e=>e.type==='RECOVERY_DELAYED').length,1);for(let i=0;i<60;i++)r.feed(350+[0,10,-10,5][i%4],600);assert.equal(recovered.state,'HEALTHY');assert.equal(recovered.incident,null);assert.ok(recovered.baseline>=340&&recovered.baseline<=360);});
test('Monitoring OFF continues collection without transitions',()=>{const r=rig();learn(r);r.s.monitoringEnabled=false;for(let i=0;i<20;i++)r.feed(0,400);assert.equal(r.s.fsStates[key].state,'HEALTHY');assert.equal(r.s.fsStates[key].currentVt,0);assert.equal(r.s.grafana[group].value,400);});
test('Per-FS cooldown does not prevent another FS suspecting',()=>{const r=rig();const n=v=>({fs:'FS04',ip:'10.10.101.180',groupId:2,resource:'vt',used:v});for(let i=0;i<30;i++)r.feed(520,820,2000,[n(510)]);const f=r.s.fsStates[key];f.state='COOLDOWN';f.incident={id:'locked',locked:true,autoExecuted:true,switchedAt:r.now};f.candidateId='locked';for(let i=0;i<20;i++)r.feed(0,400,2000,[n(90)]);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.locked,true);assert.equal(r.s.fsStates['99.153|FS04|10.10.101.180'].state,'SUSPECTED');});
test('Stale Grafana does not prevent VT-only suspect',()=>{const r=rig();learn(r);const s=r.s;for(let i=0;i<20;i++)D.sample(s,group,[{fs:'FS03',ip:'10.10.101.184',groupId:2,resource:'vt',used:90}],r.now+20000+i*2000);assert.equal(s.fsStates[key].state,'SUSPECTED');});
test('Normal peak to off-peak decline over 20 minutes adapts without suspect',()=>{const r=rig();learn(r);for(let i=0;i<600;i++){const v=520-(440*i/599);r.feed(v*[.95,1.05,1][i%3],820-650*i/599);}assert.equal(r.s.fsStates[key].state,'HEALTHY');assert.ok(r.s.fsStates[key].baseline<100);assert.ok(!r.s.events.some(e=>e.type==='SUSPECTED'));});
test('Data gap discards old recent samples without clearing incident lock',()=>{const r=rig();learn(r);const f=collapse(r);f.incident.locked=true;f.incident.switchedAt=r.now;f.state='COOLDOWN';r.feed(350,600,240000);assert.equal(f.history.length,1);assert.equal(f.state,'RECOVERING');assert.equal(f.incident.locked,true);});

test('Missing Grafana data does not prevent VT-only suspect',()=>{const r=rig();learn(r);r.s.grafana={};for(let i=0;i<15;i++)D.sample(r.s,group,[{fs:'FS03',ip:'10.10.101.184',groupId:2,resource:'vt',used:100}],r.now+2000+i*2000);assert.equal(r.s.fsStates[key].state,'SUSPECTED');});

test('Manual swap with off-peak recovery at 100-200 learns a new baseline',()=>{for(const vt of [100,150,200]){const r=rig();learn(r,500);const f=collapse(r);assert.equal(D.recordManualSwap(r.s,f,r.now,'manual'),true);for(let i=0;i<160;i++)r.feed(vt+[0,5,-5][i%3],400);assert.equal(f.state,'HEALTHY');assert.ok(Math.abs(f.baseline-vt)<=5);assert.equal(f.lastIncident.manualExecuted,true);assert.equal(f.lastIncident.locked,false);assert.equal(r.s.events.filter(e=>e.type==='SUSPECTED').length,1);}});
test('Observed ACTIVE to BLOCKED and BACKUP to ACTIVE locks a manual incident',()=>{const r=rig();r.s.freeswitch={numbers:[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'ACTIVE'},{fs:'FS03',profile:'COLLECTION',phone:'new',status:'BACKUP'}]};learn(r);const f=collapse(r);D.observeManualSwaps(r.s,[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'BLOCKED'},{fs:'FS03',profile:'COLLECTION',phone:'new',status:'ACTIVE'}],r.now);assert.equal(f.state,'COOLDOWN');assert.equal(f.incident.manualExecuted,true);assert.equal(r.s.alerts.length,0);});
test('Changing ACTIVE selector without a new ACTIVE never falsely confirms swap',()=>{const r=rig();r.s.freeswitch={numbers:[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'ACTIVE'}]};learn(r);const f=collapse(r);D.observeManualSwaps(r.s,[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'BLOCKED'}],r.now);assert.equal(f.state,'SUSPECTED');});

test('New BACKUP added after incident still confirms manual swap',()=>{
  const r=rig();r.s.freeswitch={numbers:[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'ACTIVE'}]};
  learn(r);const f=collapse(r);
  D.observeManualSwaps(r.s,[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'BLOCKED'},{fs:'FS03',profile:'COLLECTION',phone:'added',status:'ACTIVE'}],r.now);
  assert.equal(f.state,'COOLDOWN');assert.equal(f.incident.newPhone,'added');assert.equal(r.s.alerts.length,0);
});
test('Moving number to another FS clears old alert and baseline, including pending action',()=>{
  const r=rig();r.s.freeswitch={numbers:[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'ACTIVE'}]};
  learn(r);const f=collapse(r);r.s.pendingAutoActions=[{key,incidentId:f.incident.id}];
  D.observeManualSwaps(r.s,[{fs:'FS04',profile:'COLLECTION',phone:'old',status:'ACTIVE'}],r.now);
  assert.equal(f.state,'INACTIVE');assert.equal(f.baseline,null);assert.equal(f.lastIncident.closed,true);
  for(let i=0;i<30;i++)r.feed(0);
  assert.equal(r.s.alerts.length,0);assert.equal(r.s.pendingAutoActions.length,0);
  for(let i=0;i<30;i++)r.feed(90);
  assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,90);
});
test('Healthy FS configuration change relearns instead of comparing to old peak',()=>{
  const r=rig();learn(r);
  const previous=[{fs:'FS03',profile:'COLLECTION',phone:'old',status:'ACTIVE'}];
  D.observeManualSwaps(r.s,previous,r.now);
  D.observeManualSwaps(r.s,[{fs:'FS03',profile:'COLLECTION',phone:'new',status:'ACTIVE'}],r.now,previous);
  for(let i=0;i<30;i++)r.feed(80);
  assert.equal(r.s.fsStates[key].baseline,80);assert.equal(r.s.alerts.length,0);
});
test('Slow off-peak plateau learns lower positive baseline but zero stays under review',()=>{
  for(const vt of [80,0]){
    const r=rig();learn(r);for(let i=0;i<10;i++)r.feed(300);
    r.feed(250,400,125000);for(let i=0;i<50;i++)r.feed(vt,400);
    const f=r.s.fsStates[key];assert.equal(f.state,vt?'HEALTHY':'WARNING');
    if(vt)assert.equal(f.baseline,80);
    assert.equal(r.s.alerts.length,0);
  }
});

const vn=time=>Date.parse(`2026-10-07T${time}+07:00`);
test('Lunch boundaries are exactly 11:40 inclusive and 13:00 exclusive Vietnam time',()=>{
  for(const [time,paused] of [['11:29:59',false],['11:30:00',false],['11:39:59',false],['11:40:00',true],['12:59:59',true],['13:00:00',false]])
    assert.equal(D.scheduleAt(vn(time)).paused,paused,time);
  assert.equal(D.scheduleAt(vn('11:39:59')).phase,'LUNCH');
  assert.equal(D.scheduleAt(vn('11:40:00')).phase,'HANDOFF');
});
test('Restart during lunch removes unexecuted incident but preserves existing action lock through 13:00',()=>{
  const r=rig();learn(r);const f=collapse(r);
  D.applySchedule(r.s,vn('12:10:00'));
  assert.equal(f.incident,null);assert.equal(f.state,'INACTIVE');
  f.state='COOLDOWN';f.incident={id:'locked',locked:true,autoExecuted:true,switchedAt:vn('11:20:00'),stableSince:vn('11:29:00')};
  r.restore();const restored=r.s.fsStates[key];
  D.applySchedule(r.s,vn('12:30:00'));assert.equal(restored.incident.locked,true);
  D.applySchedule(r.s,vn('13:00:00'));assert.equal(restored.incident.locked,true);
  assert.equal(restored.incident.stableSince,null);assert.equal(restored.state,'COOLDOWN');
});
test('Offline across lunch resets old baseline even when no samples arrived during the pause',()=>{
  const r=rig();learn(r);const f=r.s.fsStates[key];
  f.updatedAt=vn('11:29:00');r.s.schedule={groups:{[group]:D.scheduleAt(f.updatedAt,D.CONFIG,group)}};
  D.applySchedule(r.s,vn('13:01:00'));
  assert.equal(f.state,'INACTIVE');assert.equal(f.baseline,null);
});

test('Collection keeps detecting between Sale lunch and its own 12:10 boundary',()=>{
  const r=rig();learn(r);
  const f=r.s.fsStates[key];f.updatedAt=vn('11:29:59');
  r.s.schedule={groups:{[group]:D.scheduleAt(f.updatedAt,D.CONFIG,group)}};
  D.applySchedule(r.s,vn('11:30:00'));
 assert.equal(f.state,'HEALTHY');assert.equal(f.baseline,520);
  for(let i=0;i<15;i++)D.sample(r.s,group,[{fs:'FS03',ip:'10.10.101.184',groupId:2,resource:'vt',used:0}],vn('11:31:00')+i*2000);
  assert.equal(f.state,'SUSPECTED');assert.equal(r.s.alerts.length,1);
  D.applySchedule(r.s,vn('12:10:00'));
  assert.equal(f.state,'INACTIVE');assert.equal(r.s.alerts.length,0);
});
test('Collection schedule begins exactly at 12:10 and both groups resume at 13:00',()=>{
  for(const [time,paused] of [['11:30:00',false],['12:09:59',false],['12:10:00',true],['12:59:59',true],['13:00:00',false]])
    assert.equal(D.scheduleAt(vn(time),D.CONFIG,'99.153').paused,paused,time);
});

function saleRecovery(){
  const sale='99.155',saleKey='99.155|FS05|10.10.101.58';
  let now=vn('13:00:00');
  const s={config:{...D.CONFIG},monitoringEnabled:true,events:[],fsStates:{[saleKey]:{
    key:saleKey,group:sale,fs:'FS05',ip:'10.10.101.58',state:'COOLDOWN',baseline:500,
    history:[],healthyHistory:[],incident:{id:'sale-locked',locked:true,autoExecuted:true,switchedAt:vn('11:20:00')}
  }}};
  const feed=(vt,step=2000)=>{now+=step;D.sample(s,sale,[{fs:'FS05',ip:'10.10.101.58',groupId:3,resource:'vt',used:vt}],now);};
  return {s,f:s.fsStates[saleKey],feed};
}
test('Sale after lunch recovers at stable low VT 4-5 or 9-10 using a new baseline',()=>{
  for(const base of [4,9]){
    const r=saleRecovery();for(let i=0;i<12;i++)r.feed(base+i%2);
    assert.equal(r.f.state,'RECOVERING');assert.equal(r.f.incident.locked,true);
    for(let i=0;i<40;i++)r.feed(base+i%2);
    assert.equal(r.f.state,'HEALTHY');assert.equal(r.f.incident,null);
    assert.equal(r.f.baseline,D.median(r.f.healthyHistory));assert.equal(r.s.alerts.length,0);
    assert.equal(r.f.lastIncident.closed,true);
  }
});
test('Sale zero VT or repeated zero interruptions never unlock recovery',()=>{
  for(const values of [[0],[0,4,5,9,10],[1,2,3]]){
    const r=saleRecovery();for(let i=0;i<100;i++)r.feed(values[i%values.length]);
    assert.equal(r.f.state,'RECOVERING');assert.equal(r.f.incident.locked,true);
    assert.equal(r.s.alerts.length,0);
  }
});
test('Sale rising traffic stays locked until it settles at 9-10',()=>{
  const r=saleRecovery();for(const v of [1,2,3,4,5,6,7,8,9,10])r.feed(v);
  assert.equal(r.f.state,'RECOVERING');
  for(let i=0;i<60;i++)r.feed(9+i%2);
  assert.equal(r.f.state,'HEALTHY');assert.equal(r.f.baseline,D.median(r.f.healthyHistory));
});
test('Missing samples break continuous stability before Sale recovery can unlock',()=>{
  const r=saleRecovery();for(let i=0;i<12;i++)r.feed(5);
  assert.ok(r.f.incident.stableSince);
  r.feed(5,80000);assert.equal(r.f.incident.stableSince,null);
  for(let i=0;i<12;i++)r.feed(5);assert.equal(r.f.state,'RECOVERING');
  for(let i=0;i<30;i++)r.feed(5);assert.equal(r.f.state,'HEALTHY');
});
test('Collection brief recovery spike never unlocks the previous incident',()=>{
  const r=rig();learn(r);const f=collapse(r);
  D.recordManualSwap(r.s,f,r.now,'manual');
  for(let i=0;i<20;i++)r.feed(0);
  for(let i=0;i<4;i++)r.feed(100);
  for(let i=0;i<40;i++)r.feed(0);
  assert.equal(f.state,'RECOVERING');assert.equal(f.incident.locked,true);
  assert.equal(r.s.events.filter(e=>e.type==='SUSPECTED').length,1);
});
test('Sale cooldown is 30 seconds and needs another 20 stable seconds',()=>{
  const r=saleRecovery();r.f.incident.switchedAt=vn('13:00:00');
  for(let i=0;i<14;i++)r.feed(5);
  assert.equal(r.f.state,'COOLDOWN');assert.equal(r.f.incident.locked,true);
  r.feed(5);assert.equal(r.f.state,'RECOVERING');
  for(let i=0;i<9;i++)r.feed(5);
  assert.equal(r.f.state,'RECOVERING');assert.equal(r.f.incident.locked,true);
  r.feed(5);assert.equal(r.f.state,'HEALTHY');assert.equal(r.f.baseline,5);
});
test('Sale stops at exactly 17:00 while Collection remains monitored',()=>{
  for(const [time,paused] of [['16:59:59',false],['17:00:00',true],['18:00:00',true],['23:59:59',true]]){
    assert.equal(D.scheduleAt(vn(time),D.CONFIG,'99.155').paused,paused,time);
    assert.equal(D.scheduleAt(vn(time),D.CONFIG,'99.153').paused,time>='18:00:00',time);
  }
  assert.equal(D.scheduleAt(vn('17:00:00')).phase,'DAY_END');
});
for(const [group,end] of [['99.155','17:00:00'],['99.153','18:00:00']])test(`${group} overnight pause persists across midnight and ends at 09:00`,()=>{
  const cfg=D.CONFIG;
  assert.equal(D.scheduleAt(vn(end),cfg,group).paused,true);
  for(const time of ['00:00:00','08:59:59'])assert.equal(D.scheduleAt(Date.parse(`2026-10-08T${time}+07:00`),cfg,group).paused,true,time);
  assert.equal(D.scheduleAt(Date.parse('2026-10-08T09:00:00+07:00'),cfg,group).paused,false);
  assert.equal(D.scheduleAt(vn('23:59:59'),cfg,group).pauseId,D.scheduleAt(Date.parse('2026-10-08T00:00:00+07:00'),cfg,group).pauseId);
});
test('09:00 schedule resume preserves MONITORING OFF and a previously executed incident lock',()=>{
  const r=rig();learn(r);const f=collapse(r);
  D.recordManualSwap(r.s,f,r.now,'manual');r.s.monitoringEnabled=false;
  D.applySchedule(r.s,vn('18:00:00'));r.restore();
  D.applySchedule(r.s,Date.parse('2026-10-08T09:00:00+07:00'));
  assert.equal(r.s.monitoringEnabled,false);
  assert.equal(r.s.fsStates[key].incident.locked,true);
  assert.equal(r.s.fsStates[key].incident.manualExecuted,true);
});

test('Collection learns stable 15-17 recovery instead of waiting for old 400 baseline',()=>{
  const r=rig();learn(r,410);const f=collapse(r);
  assert.equal(D.recordManualSwap(r.s,f,r.now,'manual'),true);
  for(let i=0;i<14;i++)r.feed([15,17,16][i%3]);
  assert.equal(f.state,'COOLDOWN');assert.equal(f.incident.locked,true);
  for(let i=0;i<10;i++)r.feed([15,17,16][i%3]);
  assert.equal(f.state,'HEALTHY');assert.equal(f.incident,null);
  assert.ok(f.baseline>=15&&f.baseline<=17);
  assert.equal(r.s.alerts.length,0);
});
test('Collection zero VT stays locked while another node recovers at 15-17',()=>{
  const r=rig();const n=v=>({fs:'FS04',ip:'10.10.101.180',groupId:2,resource:'vt',used:v});
  for(let i=0;i<30;i++)r.feed(400,800,2000,[n(410)]);
  const zero=r.s.fsStates[key],low=r.s.fsStates['99.153|FS04|10.10.101.180'];
  for(const f of [zero,low]){f.state='COOLDOWN';f.incident={id:f.key,locked:true,autoExecuted:true,switchedAt:r.now};}
  for(let i=0;i<30;i++)r.feed(0,39,2000,[n(15+i%3)]);
  assert.equal(low.state,'HEALTHY');assert.equal(low.baseline,16);
  assert.equal(zero.state,'RECOVERING');assert.equal(zero.incident.locked,true);
});
test('Collection recovery with intermittent values <=10 does not unlock',()=>{
  const r=rig();learn(r);const f=collapse(r);D.recordManualSwap(r.s,f,r.now,'manual');
  for(let i=0;i<60;i++)r.feed([10,15,17,16][i%4]);
  assert.equal(f.state,'RECOVERING');assert.equal(f.incident.locked,true);
});

test('Rotation barriers persist by group and use the latest operation, including failures',()=>{
  const feature={operation:{plan:{group:'99.155'},startedAt:20,status:'FAILED'},history:[
    {plan:{group:'99.155'},startedAt:10,status:'DONE',finishedAt:15},
    {plan:{group:'99.153'},startedAt:5,status:'DONE',finishedAt:8}]};
  const barriers=D.rotationBarriers(JSON.parse(JSON.stringify(feature)));
  const s={config:{...D.CONFIG},rotationBarriers:barriers};
  assert.equal(D.backupAssessment(s,{group:'99.155',history:[]},100000).waiting,true);
  assert.equal(D.backupAssessment(s,{group:'other',history:[]},100000).waiting,false);
  feature.operation.status='ACKNOWLEDGED';feature.operation.acknowledgedAt=100;
  assert.equal(D.rotationBarriers(feature)['99.155'].finishedAt,100);
});

for(const vt of [4,5,9,10])test(`Sale newly enabled at VT ${vt} learns baseline instead of remaining inactive`,()=>{
 const sale='99.155',s={config:{...D.CONFIG},monitoringEnabled:true,events:[],fsStates:{}},start=vn('10:00:00');
 const node={fs:'FS06',ip:'10.10.101.87',groupId:3,resource:'vt',used:vt},key=D.keyOf({...node,group:sale});
 for(let i=0;i<19;i++)D.sample(s,sale,[node],start+i*2000);
 assert.equal(s.fsStates[key].state,'INACTIVE');assert.equal(s.alerts.length,0);
 D.sample(s,sale,[node],start+38000);
 assert.equal(s.fsStates[key].state,'HEALTHY');assert.equal(s.fsStates[key].baseline,vt);
 D.sample(s,sale,[{...node,groupId:0}],start+40000);assert.equal(s.fsStates[key].state,'INACTIVE');
 for(let i=0;i<20;i++)D.sample(s,sale,[node],start+42000+i*2000);
 assert.equal(s.fsStates[key].state,'HEALTHY');assert.equal(s.fsStates[key].baseline,vt);
});
test('Sale zero VT or disabled Group ID cannot learn an active baseline',()=>{
 for(const [groupId,used] of [[3,0],[0,80],[3,2]]){
   const s={config:{...D.CONFIG},monitoringEnabled:true,events:[],fsStates:{}};
   for(let i=0;i<30;i++)D.sample(s,'99.155',[{fs:'FS05',ip:'ip',resource:'vt',groupId,used}],vn('10:00:00')+i*2000);
   assert.equal(Object.values(s.fsStates)[0].state,'INACTIVE');assert.equal(s.alerts.length,0);
 }
});

test('Group priority chooses lowest live VT before trend',()=>{
 const now=vn('10:00:00'),group='99.155';
 const s={config:{...D.CONFIG},monitoringEnabled:true,fsStates:{}};
 for(const [fs,vt,values] of [['FS05',80,[120,110,90,80]],['FS06',60,[100,90,70,60]],['FS07',40,[40,40,40,40]]]){
   const key=group+'|'+fs+'|ip';s.fsStates[key]={key,group,fs,ip:'ip',groupId:3,groupIdAt:now,updatedAt:now,
     currentVt:vt,recentMedian:vt,baseline:500,activeBeforeIncident:true,state:'SUSPECTED',
     incident:{id:fs},history:values.map((vt,i)=>({time:now-6000+i*2000,vt}))};
 }
 assert.deepEqual(D.groupCandidates(s,group,now).map(f=>f.fs),['FS07','FS06','FS05']);
 assert.equal(D.groupActionGate(s,s.fsStates[group+'|FS07|ip'],now).ready,true);
});
test('Sale observation does not pause Collection; an old observation cannot suppress a later incident',()=>{
 const now=vn('10:00:00'),s={config:{...D.CONFIG},monitoringEnabled:true,fsStates:{},groupTrials:{
   '99.155':{completedAt:now,until:now+6000,peers:{}}}};
 const f={key:'99.153|FS03|ip',group:'99.153',fs:'FS03',groupId:2,groupIdAt:now,updatedAt:now,
   currentVt:20,recentMedian:20,baseline:500,activeBeforeIncident:true,state:'SUSPECTED',incident:{id:'col'},history:[{time:now,vt:20}]};
 s.fsStates[f.key]=f;assert.equal(D.groupActionGate(s,f,now).ready,true);
 f.group='99.155';f.fs='FS05';f.key='99.155|FS05|ip';f.groupId=3;
 s.fsStates={[f.key]:f};s.groupTrials['99.155']={completedAt:now-200000,until:now-194000,peers:{[f.key]:0}};
 f.history=Array.from({length:8},(_,i)=>({time:now-14000+i*2000,vt:20}));
 assert.equal(D.groupActionGate(s,f,now).ready,true);
});

test('Fresh VT cancels an unhandled suspicion at partial recovery, before 85% baseline',()=>{
 const r=rig();learn(r,600);for(let i=0;i<8;i++)r.feed(60);
 const f=r.s.fsStates[key];assert.equal(f.state,'SUSPECTED');
 r.s.pendingAutoActions=[{key,incidentId:f.incident.id}];
 r.feed(300);
 assert.equal(D.groupActionGate(r.s,f,r.now).ready,false,'live recovery blocks a stale median decision');
 for(let i=0;i<3;i++)r.feed(300);
 assert.equal(f.state,'WARNING');assert.equal(f.incident,null);
 assert.equal(r.s.pendingAutoActions.length,0);assert.equal(r.s.alerts.length,0);
 for(let i=0;i<6;i++)r.feed(60);
 assert.equal(f.state,'SUSPECTED','a renewed sustained collapse is still detected');
});

test('Equal live VT uses overall decline despite two upward bounces',()=>{
 const now=vn('10:00:00'),group='99.155',s={config:{...D.CONFIG},monitoringEnabled:true,fsStates:{}};
 for(const [fs,values] of [['FS05',[40,40,40,40,40,40]],['FS07',[120,140,80,100,60,40]]]){
  const key=group+'|'+fs+'|ip';s.fsStates[key]={key,group,fs,groupId:3,groupIdAt:now,updatedAt:now,
   currentVt:40,recentMedian:40,baseline:500,activeBeforeIncident:true,state:'SUSPECTED',incident:{id:fs},
   history:values.map((vt,i)=>({vt,time:now-5000+i*1000}))};
 }
 assert.deepEqual(D.groupCandidates(s,group,now).map(f=>f.fs),['FS07','FS05']);
});

test('One or two upward ticks before the first action cannot hide a renewed collapse',()=>{
 const r=rig();learn(r,600);
 for(const v of [100,110,120,80,60,50,40,30])r.feed(v,820,1000);
 const f=r.s.fsStates[key];assert.equal(f.state,'SUSPECTED');
 assert.equal(D.groupActionGate(r.s,f,r.now).ready,true);
 assert.equal(f.baseline,600);
});
